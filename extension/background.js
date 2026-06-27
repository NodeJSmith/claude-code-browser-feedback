/**
 * Background script (service worker for Chrome, event page for Firefox)
 * for the Claude Code Browser Feedback extension.
 *
 * Tracks per-tab enabled state, updates badge, and re-injects on navigation.
 * Supports session isolation for multi-project scenarios.
 */

const DEFAULT_SERVER_URL = "http://localhost:9877";

// Verbose logging — on while the extension is being stabilized. Every decision
// point and error path logs so failures are visible in the service worker
// console (chrome://extensions -> this extension -> "service worker").
const LOG_PREFIX = "[Feedback Ext:bg]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const warn = (...args) => console.warn(LOG_PREFIX, ...args);
const logError = (...args) => console.error(LOG_PREFIX, ...args);

// In-memory set of active tab IDs (persisted to storage for reload survival)
const activeTabs = new Set();

// Per-tab session mapping: tabId -> sessionId
const tabSessionMap = new Map();

// Load persisted state on startup
chrome.storage.local.get(["activeTabs", "serverUrl", "tabSessions"], (result) => {
  if (chrome.runtime.lastError) {
    logError("failed to load persisted state", chrome.runtime.lastError);
    return;
  }
  if (result.activeTabs) {
    for (const id of result.activeTabs) activeTabs.add(id);
  }
  if (result.tabSessions) {
    for (const [tabId, sessionId] of Object.entries(result.tabSessions)) {
      tabSessionMap.set(Number(tabId), sessionId);
    }
  }
  log("loaded persisted state:", {
    activeTabs: Array.from(activeTabs),
    sessions: Object.fromEntries(tabSessionMap),
    serverUrl: result.serverUrl || DEFAULT_SERVER_URL,
  });
});

function getServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get("serverUrl", (result) => {
      resolve(result.serverUrl || DEFAULT_SERVER_URL);
    });
  });
}

function persistActiveTabs() {
  const sessions = {};
  for (const [tabId, sessionId] of tabSessionMap) {
    sessions[tabId] = sessionId;
  }
  chrome.storage.local.set({ activeTabs: Array.from(activeTabs), tabSessions: sessions }, () => {
    if (chrome.runtime.lastError) {
      logError("failed to persist state", chrome.runtime.lastError);
    }
  });
}

function updateBadge(tabId, active) {
  if (active) {
    chrome.action.setBadgeText({ text: "ON", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId });
  } else {
    chrome.action.setBadgeText({ text: "OFF", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#9ca3af", tabId });
  }
}

// Send message to a tab's content script, swallowing errors for uninjected tabs
async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    warn(
      `could not message content script in tab ${tabId} (action: ${message.action}) — ` +
        "the page may block injection (chrome://, web store, PDF viewer) or the content script isn't loaded yet",
      err,
    );
    return null;
  }
}

// Fetch available sessions from the MCP server
async function fetchSessions(serverUrl) {
  const url = `${serverUrl}/sessions`;
  try {
    log("fetching sessions from", url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) {
      warn(`/sessions returned HTTP ${resp.status}`);
      return [];
    }
    const sessions = (await resp.json()).sessions || [];
    log(`fetched ${sessions.length} session(s)`);
    return sessions;
  } catch (err) {
    logError(
      `could not reach the MCP server at ${url} — is it running (npm start) and reachable from this browser?`,
      err,
    );
    return [];
  }
}

// Pure: choose a session for a tab URL from an already-fetched list.
// Returns null when no auto-match is possible (caller should show the picker).
function pickSession(sessions, tabUrl) {
  if (sessions.length === 0) {
    warn("no sessions available — server unreachable or no Claude sessions registered");
    return null;
  }
  if (sessions.length === 1) {
    log("single session available — auto-selecting", sessions[0].sessionId);
    return sessions[0].sessionId;
  }

  // Try matching tab's origin against each session's detected project URL
  let tabOrigin;
  try {
    tabOrigin = new URL(tabUrl).origin;
  } catch {
    warn("tab URL unavailable or invalid; cannot auto-match a session:", tabUrl);
    return null;
  }

  for (const session of sessions) {
    if (session.projectUrl) {
      try {
        const sessionOrigin = new URL(session.projectUrl).origin;
        if (tabOrigin === sessionOrigin) {
          log(`matched session ${session.sessionId} by origin ${tabOrigin}`);
          return session.sessionId;
        }
      } catch {
        // Skip invalid URLs
      }
    }
  }

  log(`no session matched origin ${tabOrigin} among ${sessions.length} sessions — picker needed`);
  return null;
}

// Auto-match a tab URL to a session (fetches the session list first).
async function resolveSessionForTab(tabUrl, serverUrl) {
  const sessions = await fetchSessions(serverUrl);
  return pickSession(sessions, tabUrl);
}

// Validate that a cached session still exists on the server; re-resolve if stale
async function validateOrRefreshSession(tabId, cachedSessionId, serverUrl) {
  if (!cachedSessionId) {
    const tab = await chrome.tabs.get(tabId);
    const resolved = await resolveSessionForTab(tab.url, serverUrl);
    if (resolved) {
      tabSessionMap.set(tabId, resolved);
      persistActiveTabs();
    }
    return resolved;
  }

  const sessions = await fetchSessions(serverUrl);
  if (sessions.length === 0) {
    warn(
      `server unreachable while validating session for tab ${tabId}; keeping cached ${cachedSessionId}`,
    );
    return cachedSessionId; // Server unreachable, keep cached
  }

  const stillExists = sessions.some((s) => s.sessionId === cachedSessionId);
  if (stillExists) return cachedSessionId;

  // Session is stale — re-resolve by project URL
  const tab = await chrome.tabs.get(tabId);
  const resolved = await resolveSessionForTab(tab.url, serverUrl);
  if (resolved) {
    tabSessionMap.set(tabId, resolved);
    persistActiveTabs();
    log(`session refreshed: ${cachedSessionId.slice(0, 8)} -> ${resolved.slice(0, 8)}`);
  }
  return resolved || cachedSessionId;
}

// Toggle widget on a specific tab
async function toggleTab(tabId) {
  const serverUrl = await getServerUrl();
  const isActive = activeTabs.has(tabId);
  log(`toggleTab tab=${tabId} currentlyActive=${isActive} serverUrl=${serverUrl}`);

  if (isActive) {
    // Deactivate
    activeTabs.delete(tabId);
    tabSessionMap.delete(tabId);
    await sendToTab(tabId, { action: "deactivate" });
    updateBadge(tabId, false);
    persistActiveTabs();
    log(`deactivated tab ${tabId}`);
    return { active: false };
  }

  // Activate — resolve session first
  let sessionId = tabSessionMap.get(tabId);
  let sessions = [];

  if (!sessionId) {
    const tab = await chrome.tabs.get(tabId);
    sessions = await fetchSessions(serverUrl);
    log(`resolving session for tab ${tabId} url=${tab.url} (${sessions.length} sessions)`);
    sessionId = pickSession(sessions, tab.url);
  }

  if (!sessionId) {
    // Cannot auto-match, need user to pick a session. Return the sessions we already
    // fetched so the popup can render the picker without a second round-trip.
    log(`no session resolved for tab ${tabId} — requesting session picker`);
    return { active: false, needsSessionPicker: true, sessions, serverUrl };
  }

  activeTabs.add(tabId);
  tabSessionMap.set(tabId, sessionId);
  const delivered = await sendToTab(tabId, { action: "activate", serverUrl, sessionId });
  if (delivered === null) {
    warn(`activate not delivered to tab ${tabId}; the widget may not appear on this page`);
  }
  updateBadge(tabId, true);
  persistActiveTabs();
  log(`activated tab ${tabId} with session ${sessionId}`);
  // Popup re-fetches full state via getState after an activate, so this response
  // intentionally carries no serverUrl — only the needsSessionPicker path needs it.
  return { active: true };
}

// Handle messages from popup and content scripts. Every async handler attaches
// a .catch so a thrown error still produces a response — otherwise the message
// port closes silently and the popup renders nothing.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log("message received:", message.action, message.tabId != null ? `tab=${message.tabId}` : "");

  if (message.action === "toggle") {
    toggleTab(message.tabId)
      .then((result) => {
        log("toggle ->", result);
        sendResponse(result);
      })
      .catch((err) => {
        logError("toggleTab threw", err);
        sendResponse({ active: false, error: String((err && err.message) || err) });
      });
    return true; // async response
  }

  if (message.action === "getTabState") {
    // Called by content script on page load
    const tabId = sender.tab?.id;
    if (tabId && activeTabs.has(tabId)) {
      getServerUrl()
        .then(async (serverUrl) => {
          const cachedSession = tabSessionMap.get(tabId) || null;
          const sessionId = await validateOrRefreshSession(tabId, cachedSession, serverUrl);
          sendResponse({ active: true, serverUrl, sessionId });
        })
        .catch((err) => {
          logError(`getTabState failed for tab ${tabId}`, err);
          sendResponse({ active: false, error: String((err && err.message) || err) });
        });
      return true; // async response
    }
    sendResponse({ active: false });
    return false;
  }

  if (message.action === "getState") {
    // Called by popup
    const tabId = message.tabId;
    getServerUrl()
      .then((serverUrl) => {
        sendResponse({
          active: activeTabs.has(tabId),
          serverUrl,
          sessionId: tabSessionMap.get(tabId) || null,
        });
      })
      .catch((err) => {
        logError("getState failed", err);
        sendResponse({ active: false, error: String((err && err.message) || err) });
      });
    return true; // async response
  }

  if (message.action === "setServerUrl") {
    chrome.storage.local.set({ serverUrl: message.serverUrl }, () => {
      if (chrome.runtime.lastError) {
        logError("setServerUrl failed", chrome.runtime.lastError);
        sendResponse({ ok: false, error: String(chrome.runtime.lastError.message) });
        return;
      }
      log("server URL set to", message.serverUrl);
      sendResponse({ ok: true });
    });
    return true; // async response
  }

  if (message.action === "getSessions") {
    getServerUrl()
      .then((serverUrl) => fetchSessions(serverUrl))
      .then((sessions) => sendResponse({ sessions }))
      .catch((err) => {
        logError("getSessions failed", err);
        sendResponse({ sessions: [], error: String((err && err.message) || err) });
      });
    return true; // async response
  }

  if (message.action === "selectSession") {
    // User picked a session from the popup picker
    const { tabId, sessionId } = message;

    getServerUrl()
      .then(async (serverUrl) => {
        // Mark active only inside the success path — a rejection must not leave the
        // tab flagged active while the popup is told the selection failed.
        tabSessionMap.set(tabId, sessionId);
        activeTabs.add(tabId);
        await sendToTab(tabId, { action: "deactivate" });
        await sendToTab(tabId, { action: "activate", serverUrl, sessionId });
        updateBadge(tabId, true);
        persistActiveTabs();
        log(`selected session ${sessionId} for tab ${tabId}`);
        sendResponse({ active: true });
      })
      .catch((err) => {
        logError("selectSession failed", err);
        sendResponse({ active: false, error: String((err && err.message) || err) });
      });
    return true; // async response
  }

  warn("unhandled message action:", message.action);
});

// Re-inject widget when an active tab navigates to a new page
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete" && activeTabs.has(tabId)) {
    try {
      const serverUrl = await getServerUrl();
      const cachedSession = tabSessionMap.get(tabId) || null;
      const sessionId = await validateOrRefreshSession(tabId, cachedSession, serverUrl);
      updateBadge(tabId, true);
      await sendToTab(tabId, { action: "activate", serverUrl, sessionId });
      log(`re-injected widget after navigation in tab ${tabId}`);
    } catch (err) {
      logError(`re-injection failed for tab ${tabId}`, err);
    }
  }
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabs.has(tabId)) {
    activeTabs.delete(tabId);
    tabSessionMap.delete(tabId);
    persistActiveTabs();
    log(`tab ${tabId} closed — cleaned up state`);
  }
});
