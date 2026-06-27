/**
 * Content script for Claude Code Browser Feedback extension.
 *
 * Runs in the ISOLATED world. Injects/removes the widget by adding or
 * removing a <script src="...widget.js"> tag in the page's MAIN world.
 */

const LOG_PREFIX = "[Feedback Ext:content]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const warn = (...args) => console.warn(LOG_PREFIX, ...args);
const logError = (...args) => console.error(LOG_PREFIX, ...args);

let injectedScript = null;
let currentSessionId = null;

function activate(serverUrl, sessionId) {
  if (injectedScript) {
    // Already active — only re-inject if session changed
    if (sessionId === currentSessionId) {
      log("already active for this session; skipping re-inject", sessionId);
      return;
    }
    log(`session changed (${currentSessionId} -> ${sessionId}); re-injecting`);
    deactivate();
  }

  currentSessionId = sessionId;
  injectedScript = document.createElement("script");
  const url = sessionId ? `${serverUrl}/widget.js?session=${sessionId}` : `${serverUrl}/widget.js`;
  injectedScript.src = url;
  injectedScript.id = "claude-feedback-ext-script";
  injectedScript.onload = () => log("widget.js loaded from", url);
  injectedScript.onerror = () =>
    logError(
      `failed to load widget.js from ${url} — the server is not reachable from this browser. ` +
        `Try opening ${serverUrl}/sessions in a tab to confirm.`,
    );
  document.documentElement.appendChild(injectedScript);
  log("injecting widget script:", url);
}

function deactivate() {
  log("deactivating widget");
  // Call destroy() in the MAIN world via an inline script
  const teardown = document.createElement("script");
  teardown.textContent = `
    if (typeof window.__claudeFeedbackDestroy === 'function') {
      window.__claudeFeedbackDestroy();
    }
  `;
  document.documentElement.appendChild(teardown);
  teardown.remove();

  // Remove the injected widget script tag
  if (injectedScript) {
    injectedScript.remove();
    injectedScript = null;
  }
  currentSessionId = null;
  // Also remove any script tag that might have been left from a previous session
  const existing = document.getElementById("claude-feedback-ext-script");
  if (existing) existing.remove();
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  log("message received:", message.action);
  if (message.action === "activate") {
    activate(message.serverUrl, message.sessionId);
    sendResponse({ ok: true });
  } else if (message.action === "deactivate") {
    deactivate();
    sendResponse({ ok: true });
  } else if (message.action === "ping") {
    sendResponse({ ok: true });
  }
});

// On load, check if this tab should be active (handles navigation/reload)
chrome.runtime.sendMessage({ action: "getTabState" }, (response) => {
  if (chrome.runtime.lastError) {
    // Extension context invalidated (e.g., extension was reloaded). Normal — don't spam.
    return;
  }
  log("getTabState ->", response);
  if (response && response.error) {
    warn("background reported an error resolving tab state:", response.error);
  }
  if (response && response.active && response.sessionId) {
    activate(response.serverUrl, response.sessionId);
  }
});
