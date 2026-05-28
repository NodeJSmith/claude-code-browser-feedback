import { detectProjectUrl } from "./utils.ts";

const PROXY_TIMEOUT_MS = 5000;

interface ProxyClientOptions {
  port: number;
  sessionId: string;
  processId: string;
  projectDir: string;
}

export function createProxyClient({ port, sessionId, processId, projectDir }: ProxyClientOptions) {
  const baseUrl = `http://localhost:${port}`;

  async function fetchServerStatus(sid?: string): Promise<Record<string, unknown> | null> {
    try {
      const url = sid ? `${baseUrl}/status?session=${sid}` : `${baseUrl}/status`;
      const response = await fetch(url, { signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) });
      if (response.ok) {
        return (await response.json()) as Record<string, unknown>;
      }
    } catch {
      // Server not running or not reachable
    }
    return null;
  }

  async function broadcastViaHttp(message: unknown): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${baseUrl}/broadcast?session=${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, processId, message }),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
      if (response.ok) {
        return (await response.json()) as Record<string, unknown>;
      }
    } catch {
      // Server not running or not reachable
    }
    return null;
  }

  async function pushFeedbackViaHttp(items: unknown[], targetSessionId?: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      const response = await fetch(`${baseUrl}/push-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: targetSessionId ?? sessionId, processId, items }),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
      if (response.ok) {
        return (await response.json()) as { ok: boolean; reason?: string };
      }
      return { ok: false, reason: `HTTP ${response.status}` };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async function registerSession(): Promise<void> {
    const detected = detectProjectUrl(projectDir);
    try {
      await fetch(`${baseUrl}/register-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          processId,
          projectDir,
          projectUrl: detected.url,
          detectedFrom: detected.detectedFrom,
        }),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
    } catch {
      // Server not reachable, session won't appear in registry
    }
  }

  async function unregisterSession(): Promise<void> {
    try {
      await fetch(`${baseUrl}/unregister-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, processId }),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
    } catch {
      // Ignore errors during shutdown
    }
  }

  return {
    fetchServerStatus,
    broadcastViaHttp,
    pushFeedbackViaHttp,
    registerSession,
    unregisterSession,
  };
}
