import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  getPendingSummary,
  detectProjectUrl,
  formatFeedbackAsContent,
} from "./utils.ts";
import {
  sessionRegistry,
  isHttpServerOwner,
  getSessionPending,
  setSessionPending,
  getSessionReady,
  setSessionReady,
  getSessionResolvers,
  getSessionClients,
  findOrphanBuckets,
  migrateOrphanInto,
} from "./session-store.ts";
import { broadcastPendingStatus } from "./http-server.ts";
import type { createProxyClient } from "./proxy-client.ts";

interface McpHandlersOptions {
  mcpServer: Server;
  port: number;
  sessionId: string;
  srcDir: string;
  proxy: ReturnType<typeof createProxyClient>;
  broadcast: (message: unknown, sessionId?: string) => void;
}

const DEFAULT_TIMEOUT_SECONDS = 300;
const IDLE_TIMEOUT_MS = 5000;

export function registerMcpHandlers({ mcpServer, port, sessionId, srcDir, proxy, broadcast }: McpHandlersOptions): void {

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "install_widget",
        description:
          "Automatically install the feedback widget into a web application by injecting the script tag into an HTML file. Supports auto-detection of common entry points (index.html, etc.) or a specific file path.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description:
                "Path to the HTML file to inject the widget into. If not provided, will attempt to auto-detect common entry points in the current directory.",
            },
            project_dir: {
              type: "string",
              description:
                "Project directory to search for HTML files. Defaults to current working directory.",
            },
            dev_only: {
              type: "boolean",
              description:
                "If true, wraps the script in a hostname check so it only loads in development. Defaults to true.",
              default: true,
            },
            allowed_hostnames: {
              type: "array",
              items: { type: "string" },
              description:
                "List of hostnames or patterns allowed when dev_only is true. Supports exact matches (e.g., 'localhost') and wildcard patterns where '*' matches any characters including dots (e.g., '*.local.itkdev.dk' matches 'app.local.itkdev.dk', '*.local.*' matches 'app.local.example.dk'). Defaults to common local dev patterns: localhost, 127.0.0.1, *.local, *.local.*, *.test, *.dev, *.ddev.site",
            },
          },
          required: [],
        },
      },
      {
        name: "uninstall_widget",
        description:
          "Remove the feedback widget from a web application by removing the injected script tag.",
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description:
                "Path to the HTML file to remove the widget from. If not provided, will search for files containing the widget script.",
            },
            project_dir: {
              type: "string",
              description: "Project directory to search. Defaults to current working directory.",
            },
          },
          required: [],
        },
      },
      {
        name: "get_widget_snippet",
        description:
          "Get the HTML snippet to add to a web app for browser feedback collection. Use install_widget instead for automatic installation.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "wait_for_browser_feedback",
        description:
          "Wait for feedback from the browser widget. Blocks until user submits feedback. Returns screenshot, element info, console logs, and description. IMPORTANT: After receiving feedback, DO NOT call this tool again. Instead, analyze the feedback and take action (fix bugs, make changes, etc.). Only call this tool again if the user explicitly asks for more feedback or you need to verify your fix worked.",
        inputSchema: {
          type: "object",
          properties: {
            timeout_seconds: {
              type: "number",
              description: "Maximum time to wait for feedback (default: 300 seconds / 5 minutes)",
              default: 300,
            },
          },
          required: [],
        },
      },
      {
        name: "get_pending_feedback",
        description:
          "Get all pending feedback that has been submitted. Use this to collect multiple annotations at once - user can submit several feedback items, then you call this to get them all. Returns an array of feedback items. After receiving, analyze ALL items and take action on each.",
        inputSchema: {
          type: "object",
          properties: {
            clear: {
              type: "boolean",
              description: "Whether to clear the pending feedback after retrieving (default: true)",
              default: true,
            },
          },
          required: [],
        },
      },
      {
        name: "preview_pending_feedback",
        description:
          "Preview all pending feedback without consuming it. Use this to see what feedback has been submitted without clearing the queue. Returns summaries of pending items (id, timestamp, description, selector). The browser widget also shows this information.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "delete_pending_feedback",
        description:
          "Delete a specific pending feedback item by ID. Use this when a user wants to remove feedback they submitted by mistake or that is no longer relevant.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The ID of the feedback item to delete",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "wait_for_multiple_feedback",
        description:
          "Wait for the user to submit multiple feedback items. Shows a prompt in the browser telling user to submit all their annotations, then click 'Done'. Returns array of all feedback. Use this when user wants to report multiple issues at once.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description:
                "Message to show user (default: 'Submit all your feedback, then click Done when finished')",
            },
            timeout_seconds: {
              type: "number",
              description: "Maximum time to wait (default: 300 seconds / 5 minutes)",
              default: 300,
            },
          },
          required: [],
        },
      },
      {
        name: "get_connection_status",
        description: "Check if any browser clients are connected to the feedback server.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "request_annotation",
        description:
          "Send a prompt to connected browsers asking user to annotate something specific. After calling this, use wait_for_browser_feedback ONCE to receive the response. Do not loop - act on the feedback received.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Message to show to the user explaining what to annotate",
            },
          },
          required: ["message"],
        },
      },
      {
        name: "open_in_browser",
        description:
          "Open the project in the default browser. Automatically detects the project URL from common configuration files (.env, docker-compose.yml, etc.) or accepts an explicit URL. Can also just return the detected URL without opening.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description:
                "Explicit URL to open. If not provided, will attempt to detect from project configuration.",
            },
            project_dir: {
              type: "string",
              description:
                "Project directory to search for configuration files. Defaults to current working directory.",
            },
            open: {
              type: "boolean",
              description:
                "If true, open the URL in the default browser. Defaults to false (just returns the URL).",
              default: false,
            },
          },
          required: [],
        },
      },
      {
        name: "setup_extension",
        description:
          "Help the user install the browser extension for widget injection without modifying project files. Opens the extension directory and provides step-by-step instructions for Chrome and Firefox.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = (request.params.arguments || {}) as Record<string, unknown>;

  switch (name) {
    case "install_widget": {
      const devOnly = args.dev_only !== false;
      const projectDir = (args.project_dir as string) || process.cwd();
      let filePath = args.file_path as string | undefined;

      // Default hostname patterns for local development
      const defaultHostnamePatterns = [
        "localhost",
        "127.0.0.1",
        "*.local",
        "*.local.*",
        "*.test",
        "*.dev",
        "*.ddev.site",
      ];
      const allowedHostnames = (args.allowed_hostnames as string[]) || defaultHostnamePatterns;

      // Auto-detect HTML file if not specified
      if (!filePath) {
        const candidates = [
          "index.html",
          "public/index.html",
          "src/index.html",
          "app/index.html",
          "dist/index.html",
          "build/index.html",
          "www/index.html",
          "static/index.html",
        ];

        for (const candidate of candidates) {
          const fullPath = path.join(projectDir, candidate);
          if (fs.existsSync(fullPath)) {
            filePath = fullPath;
            break;
          }
        }

        if (!filePath) {
          return {
            content: [
              {
                type: "text",
                text: `Could not auto-detect HTML file in ${projectDir}. Searched for:\n${candidates.map((c) => `  - ${c}`).join("\n")}\n\nPlease specify the file_path explicitly.`,
              },
            ],
          };
        }
      }

      // Make path absolute if relative
      if (!path.isAbsolute(filePath)) {
        filePath = path.join(projectDir, filePath);
      }

      // Check file exists
      if (!fs.existsSync(filePath)) {
        return {
          content: [
            {
              type: "text",
              text: `File not found: ${filePath}`,
            },
          ],
        };
      }

      // Read current content
      let content = fs.readFileSync(filePath, "utf8");

      // Check if already installed
      if (
        content.includes("localhost:" + port + "/widget.js") ||
        content.includes("claude-feedback-widget")
      ) {
        return {
          content: [
            {
              type: "text",
              text: `Widget already installed in ${filePath}`,
            },
          ],
        };
      }

      // Generate script tag
      let scriptTag: string;
      let hostnameInfo: string;
      let detected = detectProjectUrl(projectDir);

      if (devOnly) {
        let hostnameCheck: string;

        if (detected.url) {
          // Use exact hostname match from detected URL
          const detectedHostname = new URL(detected.url).hostname;
          hostnameCheck = `h === '${detectedHostname}'`;
          hostnameInfo = `Development only (hostname: ${detectedHostname}, detected from ${detected.detectedFrom})`;
        } else {
          // Fall back to regex pattern matching
          const patternChecks = allowedHostnames.map((pattern) => {
            // Escape special regex chars except *
            const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
            // Convert * to regex pattern (match any chars including dots for multi-segment matches)
            const regexPattern = escaped.replace(/\*/g, ".*");
            return `/${"^" + regexPattern + "$"}/i.test(h)`;
          });
          hostnameCheck = patternChecks.join(" || ");
          hostnameInfo = `Development only (allowed hostnames: ${allowedHostnames.join(", ")})`;
        }

        scriptTag = `
<!-- Claude Code Browser Feedback Widget (dev only) -->
<script>
  (function() {
    var h = location.hostname;
    var isDevHost = ${hostnameCheck};
    if (isDevHost) {
      var s = document.createElement('script');
      s.src = 'http://localhost:${port}/widget.js?session=${sessionId}';
      s.id = 'claude-feedback-widget-script';
      document.body.appendChild(s);
    }
  })();
</script>`;
      } else {
        hostnameInfo = "Always loaded";
        scriptTag = `
<!-- Claude Code Browser Feedback Widget -->
<script src="http://localhost:${port}/widget.js?session=${sessionId}" id="claude-feedback-widget-script"></script>`;
      }

      // Find injection point (before </body> or </html>)
      if (content.includes("</body>")) {
        content = content.replace("</body>", scriptTag + "\n</body>");
      } else if (content.includes("</html>")) {
        content = content.replace("</html>", scriptTag + "\n</html>");
      } else {
        // Append to end
        content += scriptTag;
      }

      // Write back
      fs.writeFileSync(filePath, content, "utf8");

      // Include URL info if detected (and not already in hostnameInfo)
      const urlInfo = detected.url ? `\n**URL:** [${detected.url}](${detected.url})` : "";

      return {
        content: [
          {
            type: "text",
            text: `✅ Widget installed successfully!

**File:** ${filePath}
**Mode:** ${hostnameInfo}${urlInfo}

The floating "Add annotation" button will appear when you load the page.

Next steps:
1. Refresh your browser to load the widget
2. Use \`wait_for_browser_feedback\` to receive feedback from the browser

**Tip:** You can also use the browser extension to toggle the widget without modifying files. Run \`setup_extension\` for instructions.`,
          },
        ],
      };
    }

    case "uninstall_widget": {
      const projectDir = (args.project_dir as string) || process.cwd();
      let filePath = args.file_path as string | undefined;

      // If no file specified, search for files containing the widget
      if (!filePath) {
        const candidates = [
          "index.html",
          "public/index.html",
          "src/index.html",
          "app/index.html",
          "dist/index.html",
          "build/index.html",
          "www/index.html",
          "static/index.html",
        ];

        for (const candidate of candidates) {
          const fullPath = path.join(projectDir, candidate);
          if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, "utf8");
            if (
              content.includes("claude-feedback-widget") ||
              content.includes("localhost:" + port + "/widget.js")
            ) {
              filePath = fullPath;
              break;
            }
          }
        }

        if (!filePath) {
          return {
            content: [
              {
                type: "text",
                text: `Could not find any HTML file with the widget installed in ${projectDir}.`,
              },
            ],
          };
        }
      }

      // Make path absolute if relative
      if (!path.isAbsolute(filePath)) {
        filePath = path.join(projectDir, filePath);
      }

      // Check file exists
      if (!fs.existsSync(filePath)) {
        return {
          content: [
            {
              type: "text",
              text: `File not found: ${filePath}`,
            },
          ],
        };
      }

      // Read content
      let content = fs.readFileSync(filePath, "utf8");

      // Check if widget is installed
      if (
        !content.includes("claude-feedback-widget") &&
        !content.includes("localhost:" + port + "/widget.js")
      ) {
        return {
          content: [
            {
              type: "text",
              text: `Widget not found in ${filePath}`,
            },
          ],
        };
      }

      // Remove the widget script block (handles both dev-only and always-on versions)
      // Pattern 1: Dev-only version with surrounding comment
      content = content.replace(
        /\n?<!-- Claude Code Browser Feedback Widget[^>]*-->[\s\S]*?claude-feedback-widget[\s\S]*?<\/script>/g,
        "",
      );

      // Pattern 2: Simple script tag
      content = content.replace(
        /\n?<script[^>]*src="http:\/\/localhost:\d+\/widget\.js"[^>]*><\/script>/g,
        "",
      );

      // Pattern 3: Script tag with id
      content = content.replace(
        /\n?<script[^>]*id="claude-feedback-widget-script"[^>]*>[\s\S]*?<\/script>/g,
        "",
      );

      // Clean up any leftover empty lines
      content = content.replace(/\n{3,}/g, "\n\n");

      // Write back
      fs.writeFileSync(filePath, content, "utf8");

      return {
        content: [
          {
            type: "text",
            text: `✅ Widget uninstalled successfully from ${filePath}`,
          },
        ],
      };
    }

    case "get_widget_snippet": {
      const snippet = `<script src="http://localhost:${port}/widget.js?session=${sessionId}"></script>`;
      const instructions = `
Add this script tag to your web application's HTML (typically before </body>):

${snippet}

Once added, a small "Add annotation" button will appear in the bottom-right corner of your app.

Users can:
1. Click the button to activate annotation mode
2. Click on any element to select it
3. Add a description of the issue
4. Optionally include console logs
5. Send the feedback directly to Claude Code

The widget only loads in development (localhost) by default.

**Tip:** You can also use the browser extension to toggle the widget without modifying files. Run \`setup_extension\` for instructions.
      `.trim();

      return {
        content: [
          {
            type: "text",
            text: instructions,
          },
        ],
      };
    }

    case "wait_for_browser_feedback": {
      const timeoutSeconds = (args.timeout_seconds as number) || DEFAULT_TIMEOUT_SECONDS;

      if (!isHttpServerOwner()) {
        try {
          const feedback = await proxy.pollForFeedback(timeoutSeconds);
          return {
            content: formatFeedbackAsContent(feedback),
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: (err as Error).message,
              },
            ],
          };
        }
      }

      // Check if there's already ready feedback (user clicked "Send to Claude")
      const ready = getSessionReady(sessionId);
      if (ready.length > 0) {
        const items = [...ready];
        setSessionReady(sessionId, []);
        return {
          content: formatFeedbackAsContent(items),
        };
      }

      // Wait for user to click "Send to Claude"
      const feedback = await Promise.race([
        new Promise((resolve) => {
          getSessionResolvers(sessionId).push(resolve);
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Timeout waiting for browser feedback")),
            timeoutSeconds * 1000,
          ),
        ),
      ]);

      // feedback is now an array (from send_to_claude handler)
      return {
        content: formatFeedbackAsContent(feedback),
      };
    }

    case "get_pending_feedback": {
      const shouldClear = args.clear !== false;

      // If we don't own the HTTP server, fetch via HTTP
      if (!isHttpServerOwner()) {
        const result = await proxy.fetchReadyFeedback(shouldClear) as { feedback?: unknown[]; orphans?: unknown[] } | null;
        if (result && result.feedback) {
          if (result.feedback.length === 0) {
            const orphans = Array.isArray(result.orphans) ? result.orphans as Record<string, unknown>[] : [];
            if (orphans.length > 0) {
              const hint = orphans
                .map(
                  (o) =>
                    `  - ${o.sessionId} (${o.pendingCount} pending, ${o.readyCount} ready, ${o.clientCount} client(s))`,
                )
                .join("\n");
              return {
                content: [
                  {
                    type: "text",
                    text: `No pending feedback for this session.\n\nHowever, ${orphans.length} orphan bucket(s) hold feedback under session IDs not tied to any MCP session (likely a stale widget cache — see #46):\n${hint}\n\nReload the browser tab so the widget rebinds to the current session, then try again.`,
                  },
                ],
              };
            }
            return {
              content: [
                {
                  type: "text",
                  text: "No pending feedback.",
                },
              ],
            };
          }
          return {
            content: formatFeedbackAsContent(result.feedback),
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Could not fetch feedback. Is the feedback server running?",
              },
            ],
          };
        }
      }

      const sessionReady = getSessionReady(sessionId);
      let feedback = [...sessionReady];
      if (shouldClear) {
        setSessionReady(sessionId, []);
      }

      // If our own bucket is empty but a stale widget filed feedback under an
      // unknown session ID, recover it. With deterministic IDs there can only
      // be one MCP session per projectDir, so when exactly one is registered
      // it's safe to fold the orphan bucket into ours. Otherwise just report.
      if (feedback.length === 0) {
        const orphans = findOrphanBuckets();
        if (orphans.length > 0) {
          if (sessionRegistry.size === 1) {
            for (const o of orphans) {
              console.error(
                `[browser-feedback-mcp] Rescuing orphan bucket ${o.sessionId} into ${sessionId} (${o.pendingCount} pending, ${o.readyCount} ready)`,
              );
              migrateOrphanInto(sessionId, o.sessionId);
            }
            const rescuedReady = getSessionReady(sessionId);
            const rescuedPending = getSessionPending(sessionId);
            feedback = [...rescuedReady, ...rescuedPending];
            if (shouldClear) {
              setSessionReady(sessionId, []);
              setSessionPending(sessionId, []);
            }
            if (feedback.length > 0) {
              return { content: formatFeedbackAsContent(feedback) };
            }
          } else {
            const hint = orphans
              .map(
                (o) =>
                  `  - ${o.sessionId} (${o.pendingCount} pending, ${o.readyCount} ready, ${o.clientCount} client(s))`,
              )
              .join("\n");
            return {
              content: [
                {
                  type: "text",
                  text: `No pending feedback for this session.\n\nHowever, ${orphans.length} orphan bucket(s) hold feedback under session IDs not tied to any MCP session (likely a stale widget cache — see #46):\n${hint}\n\nReload the browser tab so the widget rebinds to the current session, then try again.`,
                },
              ],
            };
          }
        }
        return {
          content: [
            {
              type: "text",
              text: "No pending feedback.",
            },
          ],
        };
      }

      return {
        content: formatFeedbackAsContent(feedback),
      };
    }

    case "preview_pending_feedback": {
      // If we don't own the HTTP server, fetch via HTTP
      if (!isHttpServerOwner()) {
        const result = await proxy.fetchPendingSummary();
        if (result) {
          if (result.count === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No pending feedback.",
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Could not fetch feedback. Is the feedback server running?",
              },
            ],
          };
        }
      }

      const summary = getPendingSummary(getSessionPending(sessionId));
      if (summary.count === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No pending feedback.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }

    case "delete_pending_feedback": {
      const id = args.id as string | undefined;
      if (!id) {
        return {
          content: [
            {
              type: "text",
              text: "Error: id is required",
            },
          ],
        };
      }

      // If we don't own the HTTP server, delete via HTTP
      if (!isHttpServerOwner()) {
        const result = await proxy.deleteFeedbackViaHttp(id);
        if (result) {
          return {
            content: [
              {
                type: "text",
                text: result.success
                  ? `Feedback ${id} deleted successfully.`
                  : `Feedback ${id} not found.`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Could not delete feedback. Is the feedback server running?",
              },
            ],
          };
        }
      }

      const pending = getSessionPending(sessionId) as { id?: string }[];
      const initialLength = pending.length;
      setSessionPending(
        sessionId,
        pending.filter((f) => f.id !== id),
      );
      const deleted = getSessionPending(sessionId).length < initialLength;

      if (deleted) {
        broadcastPendingStatus(sessionId);
      }

      return {
        content: [
          {
            type: "text",
            text: deleted ? `Feedback ${id} deleted successfully.` : `Feedback ${id} not found.`,
          },
        ],
      };
    }

    case "wait_for_multiple_feedback": {
      const timeoutSeconds = (args.timeout_seconds as number) || DEFAULT_TIMEOUT_SECONDS;
      const message = (args.message as string) || "Submit all your feedback, then click 'Done' when finished.";

      // If we don't own the HTTP server, use a simpler polling approach
      if (!isHttpServerOwner()) {
        // Check connection status first
        const status = await proxy.fetchServerStatus(sessionId) as { connectedClients?: number } | null;
        if (!status || !status.connectedClients) {
          return {
            content: [
              {
                type: "text",
                text: "No browser clients connected. Make sure the widget script is loaded in your app.",
              },
            ],
          };
        }

        // Clear any existing feedback and broadcast request
        await proxy.fetchReadyFeedback(true);
        await proxy.broadcastViaHttp({
          type: "request_multiple_annotations",
          message: message,
        });

        // Poll for feedback - collect until timeout or no new feedback for 5 seconds
        const allFeedback: unknown[] = [];
        const startTime = Date.now();
        let lastFeedbackTime = startTime;
        const idleTimeout = IDLE_TIMEOUT_MS;

        while (Date.now() - startTime < timeoutSeconds * 1000) {
          const result = await proxy.fetchReadyFeedback(true) as { feedback?: unknown[] } | null;
          if (result && result.feedback && result.feedback.length > 0) {
            allFeedback.push(...result.feedback);
            lastFeedbackTime = Date.now();
          } else if (allFeedback.length > 0 && Date.now() - lastFeedbackTime > idleTimeout) {
            // Got some feedback and no new feedback for a while - assume done
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        if (allFeedback.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No feedback was submitted within the timeout period.",
              },
            ],
          };
        }

        return {
          content: formatFeedbackAsContent(allFeedback),
        };
      }

      const sessionClients = getSessionClients(sessionId);
      if (sessionClients.size === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No browser clients connected. Make sure the widget script is loaded in your app.",
            },
          ],
        };
      }

      // Clear stale queues for this session
      setSessionReady(sessionId, []);
      setSessionPending(sessionId, []);
      broadcastPendingStatus(sessionId);

      // Send request to browser to enter multi-feedback mode
      broadcast(
        {
          type: "request_multiple_annotations",
          message: message,
        },
        sessionId,
      );

      // Check if ready feedback already has items (early return)
      const readyNow = getSessionReady(sessionId);
      if (readyNow.length > 0) {
        const items = [...readyNow];
        setSessionReady(sessionId, []);
        return {
          content: formatFeedbackAsContent(items),
        };
      }

      // Wait for user to press "Send to Claude" via feedbackResolvers
      try {
        const allFeedback = await Promise.race([
          new Promise<unknown[]>((resolve) => {
            getSessionResolvers(sessionId).push(resolve);
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("Timeout waiting for feedback")),
              timeoutSeconds * 1000,
            ),
          ),
        ]);

        if (allFeedback.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "User clicked Send but no feedback was submitted.",
              },
            ],
          };
        }

        return {
          content: formatFeedbackAsContent(allFeedback),
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: (err as Error).message,
            },
          ],
        };
      }
    }

    case "get_connection_status": {
      // If we don't own the HTTP server, fetch status from the running server
      if (!isHttpServerOwner()) {
        const status = await proxy.fetchServerStatus(sessionId) as { connectedClients?: number; orphanSessions?: unknown[] } | null;
        if (status) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    connected: (status.connectedClients || 0) > 0,
                    clientCount: status.connectedClients || 0,
                    serverUrl: `http://localhost:${port}`,
                    widgetUrl: `http://localhost:${port}/widget.js?session=${sessionId}`,
                    sessionId: sessionId,
                    orphanSessions: status.orphanSessions || [],
                    note: "Status fetched from running server (this MCP instance is proxying)",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    connected: false,
                    clientCount: 0,
                    serverUrl: `http://localhost:${port}`,
                    widgetUrl: `http://localhost:${port}/widget.js`,
                    error: "Could not connect to feedback server. Is it running?",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }

      const sessionClientCount = getSessionClients(sessionId).size;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                connected: sessionClientCount > 0,
                clientCount: sessionClientCount,
                serverUrl: `http://localhost:${port}`,
                widgetUrl: `http://localhost:${port}/widget.js?session=${sessionId}`,
                sessionId: sessionId,
                orphanSessions: findOrphanBuckets(),
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    case "request_annotation": {
      const message = (args.message as string) || "Please annotate the issue you'd like to report.";

      // If we don't own the HTTP server, broadcast via HTTP
      if (!isHttpServerOwner()) {
        const result = await proxy.broadcastViaHttp({
          type: "request_annotation",
          message: message,
        }) as { success?: boolean; clientCount?: number } | null;
        if (result && result.success) {
          return {
            content: [
              {
                type: "text",
                text:
                  (result.clientCount || 0) > 0
                    ? `Annotation request sent to ${result.clientCount} connected browser(s). The user will see a prompt asking them to annotate.`
                    : "No browser clients connected. Make sure the widget script is loaded in your app.",
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Could not send annotation request. Is the feedback server running?",
              },
            ],
          };
        }
      }

      const sessionClientCount = getSessionClients(sessionId).size;
      if (sessionClientCount === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No browser clients connected. Make sure the widget script is loaded in your app.",
            },
          ],
        };
      }

      broadcast(
        {
          type: "request_annotation",
          message: message,
        },
        sessionId,
      );

      return {
        content: [
          {
            type: "text",
            text: `Annotation request sent to ${sessionClientCount} connected browser(s). The user will see a prompt asking them to annotate.`,
          },
        ],
      };
    }

    case "open_in_browser": {
      const projectDir = (args.project_dir as string) || process.cwd();
      const shouldOpen = args.open === true;
      let url = args.url as string | null | undefined;
      let detectedFrom: string | null = null;

      // If no URL provided, try to detect from config files
      if (!url) {
        const detected = detectProjectUrl(projectDir);
        url = detected.url;
        detectedFrom = detected.detectedFrom;

        if (!url) {
          return {
            content: [
              {
                type: "text",
                text: `Could not detect project URL in ${projectDir}.\n\nSearched in:\n- .env (APP_URL, BASE_URL, SITE_URL, VIRTUAL_HOST, etc.)\n- .env.local\n- docker-compose.yml (VIRTUAL_HOST, traefik labels)\n- docker-compose.override.yml\n- package.json (homepage, proxy)\n\nPlease provide an explicit URL using the 'url' parameter.`,
              },
            ],
          };
        }
      }

      // If not opening, just return the URL
      if (!shouldOpen) {
        return {
          content: [
            {
              type: "text",
              text: detectedFrom ? `Detected URL: ${url}\nSource: ${detectedFrom}` : `URL: ${url}`,
            },
          ],
        };
      }

      // Open in browser based on platform using execFile (safer than exec)
      const platform = process.platform;
      let command;
      let commandArgs;

      if (platform === "darwin") {
        command = "open";
        commandArgs = [url];
      } else if (platform === "win32") {
        command = "cmd";
        commandArgs = ["/c", "start", "", url];
      } else {
        // Linux and others
        command = "xdg-open";
        commandArgs = [url];
      }

      return new Promise((resolve) => {
        execFile(command, commandArgs, (error) => {
          if (error) {
            resolve({
              content: [
                {
                  type: "text",
                  text: `Failed to open browser: ${error.message}\n\nURL: ${url}\n\nYou can open it manually.`,
                },
              ],
            });
          } else {
            resolve({
              content: [
                {
                  type: "text",
                  text: detectedFrom
                    ? `Opened ${url} in your default browser.\n\nDetected from: ${detectedFrom}`
                    : `Opened ${url} in your default browser.`,
                },
              ],
            });
          }
        });
      });
    }

    case "setup_extension": {
      const extensionDir = path.join(srcDir, "..", "extension");

      // Check extension directory exists
      if (!fs.existsSync(extensionDir)) {
        return {
          content: [
            {
              type: "text",
              text: `Extension directory not found at ${extensionDir}. Make sure you have the full package installed.`,
            },
          ],
        };
      }

      // Open the extension directory in the file manager
      const platform = process.platform;
      let openCommand;
      let openArgs;

      if (platform === "darwin") {
        openCommand = "open";
        openArgs = [extensionDir];
      } else if (platform === "win32") {
        openCommand = "explorer";
        openArgs = [extensionDir];
      } else {
        openCommand = "xdg-open";
        openArgs = [extensionDir];
      }

      return new Promise((resolve) => {
        execFile(openCommand, openArgs, (error) => {
          const instructions = `## Browser Extension Setup

The extension directory has been opened in your file manager.

### Chrome
1. Navigate to \`chrome://extensions\`
2. Enable **Developer Mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the opened folder: \`${extensionDir}\`

### Firefox
1. Navigate to \`about:debugging#/runtime/this-firefox\`
2. Click **Load Temporary Add-on...**
3. Select \`manifest.json\` from: \`${extensionDir}\`

### Usage
Once installed, click the extension icon in your browser toolbar to toggle the feedback widget on any tab. No need to modify project HTML files.

The extension connects to the MCP server at \`http://localhost:${port}\`. You can change this in the extension popup settings.`;

          if (error) {
            resolve({
              content: [
                {
                  type: "text",
                  text: `Could not open file manager: ${error.message}\n\n${instructions}`,
                },
              ],
            });
          } else {
            resolve({
              content: [
                {
                  type: "text",
                  text: instructions,
                },
              ],
            });
          }
        });
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

}
