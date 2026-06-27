const toggleEl = document.getElementById("toggle");
const widgetDetailsEl = document.getElementById("widget-details");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const serverUrlInput = document.getElementById("server-url");
const saveUrlBtn = document.getElementById("save-url");
const sessionPickerEl = document.getElementById("session-picker");
const sessionListEl = document.getElementById("session-list");
const activeSessionEl = document.getElementById("active-session");
const activeSessionName = document.getElementById("active-session-name");
const changeSessionBtn = document.getElementById("change-session");
const connectionNoticeEl = document.getElementById("connection-notice");

// Verbose logging — visible in the popup's own devtools (right-click popup -> Inspect).
const LOG_PREFIX = "[Feedback Ext:popup]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const warn = (...args) => console.warn(LOG_PREFIX, ...args);
const logError = (...args) => console.error(LOG_PREFIX, ...args);

let currentTabId = null;
let currentSessionId = null;

// Get the active tab ID
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Single place that drives the status indicator. `kind` is the dot style
// (connected | disconnected | loading | pending); `text` is the label.
function setStatus(kind, text) {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = text;
}

// Check if the MCP server is reachable and update status display
async function checkConnection(serverUrl, sessionId) {
  const url = sessionId ? `${serverUrl}/status?session=${sessionId}` : `${serverUrl}/status`;
  try {
    log("checking connection:", url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      const data = await resp.json();
      const count = data.connectedClients || 0;
      log("server reachable:", data);
      setStatus(
        "connected",
        sessionId && count > 0
          ? `Connected (${count} client${count !== 1 ? "s" : ""})`
          : "Connected",
      );
      // Show notice when multiple clients on same session
      if (sessionId && count > 1) {
        connectionNoticeEl.textContent = `This session has ${count} connected clients. The same site may be open in another tab.`;
        connectionNoticeEl.style.display = "block";
      } else {
        connectionNoticeEl.style.display = "none";
      }
      return true;
    }
    warn(`/status returned HTTP ${resp.status}`);
  } catch (err) {
    logError(
      `server not reachable at ${url} — is 'npm start' running and reachable from this browser?`,
      err,
    );
  }
  setStatus("disconnected", "Server not reachable");
  connectionNoticeEl.style.display = "none";
  return false;
}

// Show session picker for manual selection
function showSessionPicker(sessions) {
  log(`showing session picker with ${sessions.length} session(s)`);
  sessionListEl.innerHTML = "";

  if (sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "session-empty";
    empty.textContent =
      "No sessions found. Is the MCP server running (npm start) and reachable from this browser?";
    sessionListEl.appendChild(empty);
    sessionPickerEl.style.display = "block";
    return;
  }

  for (const session of sessions) {
    const item = document.createElement("div");
    item.className = "session-item";

    const dirEl = document.createElement("div");
    dirEl.className = "session-item-dir";
    const dirLabel = session.projectDir.split("/").pop() || session.projectDir;
    dirEl.textContent = dirLabel;
    dirEl.title = session.projectDir;
    item.appendChild(dirEl);

    if (session.projectUrl) {
      const urlEl = document.createElement("div");
      urlEl.className = "session-item-url";
      urlEl.textContent = session.projectUrl;
      item.appendChild(urlEl);
    }

    item.addEventListener("click", () => {
      log("session picked:", session.sessionId);
      chrome.runtime.sendMessage(
        {
          action: "selectSession",
          tabId: currentTabId,
          sessionId: session.sessionId,
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            logError("selectSession failed", chrome.runtime.lastError);
            setStatus("disconnected", "Could not enable on this page");
            setPending(false);
            return;
          }
          log("selectSession ->", resp);
          if (!resp || !resp.active) {
            // Background couldn't activate (e.g. page blocks injection). Surface the
            // error and keep the picker open so the user can try another session.
            logError("background reported error during selectSession:", resp && resp.error);
            setStatus("disconnected", (resp && resp.error) || "Could not enable on this page");
            setPending(false);
            return;
          }
          sessionPickerEl.style.display = "none";
          init();
        },
      );
    });

    sessionListEl.appendChild(item);
  }

  sessionPickerEl.style.display = "block";
}

// Ask the background for sessions and render the picker (always renders, even on
// failure — an empty picker with an explanation beats a blank popup).
function loadSessionPicker() {
  chrome.runtime.sendMessage({ action: "getSessions" }, (sessionsResp) => {
    if (chrome.runtime.lastError) {
      logError("getSessions failed", chrome.runtime.lastError);
      showSessionPicker([]);
      return;
    }
    log("getSessions ->", sessionsResp);
    showSessionPicker((sessionsResp && sessionsResp.sessions) || []);
  });
}

// Show widget details (status, session, server URL)
async function showDetails(serverUrl, sessionId) {
  setPending(false);
  widgetDetailsEl.style.display = "block";
  serverUrlInput.value = serverUrl;
  currentSessionId = sessionId;

  await checkConnection(serverUrl, sessionId);

  // Show active session info
  if (sessionId) {
    chrome.runtime.sendMessage({ action: "getSessions" }, (sessionsResp) => {
      if (chrome.runtime.lastError) {
        logError("getSessions failed", chrome.runtime.lastError);
        return;
      }
      if (sessionsResp && sessionsResp.sessions) {
        const matched = sessionsResp.sessions.find((s) => s.sessionId === sessionId);
        activeSessionName.textContent = matched
          ? matched.projectDir.split("/").pop() || matched.projectDir
          : sessionId.slice(0, 8) + "...";
        activeSessionName.title = matched ? matched.projectDir : sessionId;
        activeSessionEl.style.display = "flex";
      }
    });
  } else {
    activeSessionEl.style.display = "none";
  }
}

// Hide widget details
function hideDetails() {
  widgetDetailsEl.style.display = "none";
  sessionPickerEl.style.display = "none";
  connectionNoticeEl.style.display = "none";
  activeSessionEl.style.display = "none";
  setPending(false);
}

// Initialize popup state
async function init() {
  const tab = await getCurrentTab();
  if (!tab) {
    warn("no active tab found");
    return;
  }
  currentTabId = tab.id;
  log("init: tab", currentTabId, tab.url);

  chrome.runtime.sendMessage({ action: "getState", tabId: currentTabId }, async (response) => {
    if (chrome.runtime.lastError) {
      logError("getState failed", chrome.runtime.lastError);
      return;
    }
    if (!response) {
      warn("getState returned no response");
      return;
    }
    log("getState ->", response);

    toggleEl.checked = response.active;

    if (response.active) {
      await showDetails(response.serverUrl, response.sessionId || null);
    } else {
      hideDetails();
    }
  });
}

// Mark the toggle as "pending" — enabling is requested but waiting on a session pick.
function setPending(pending) {
  const sw = toggleEl.closest(".toggle-switch");
  if (sw) sw.classList.toggle("pending", pending);
}

// Toggle handler
toggleEl.addEventListener("change", () => {
  log("toggle clicked; requesting", toggleEl.checked ? "activate" : "deactivate");
  if (currentTabId === null) {
    warn("no current tab id; ignoring toggle");
    toggleEl.checked = false;
    return;
  }

  if (toggleEl.checked) {
    // Enabling — show immediate feedback. Resolving the session is a network
    // round-trip and can take a moment; a blank popup reads as "nothing happened".
    widgetDetailsEl.style.display = "block";
    activeSessionEl.style.display = "none";
    sessionPickerEl.style.display = "none";
    setStatus("loading", "Finding sessions…");
  }

  chrome.runtime.sendMessage({ action: "toggle", tabId: currentTabId }, async (response) => {
    if (chrome.runtime.lastError) {
      logError("toggle message failed", chrome.runtime.lastError);
      setPending(false);
      toggleEl.checked = false;
      hideDetails();
      return;
    }
    if (!response) {
      warn("toggle returned no response");
      setPending(false);
      toggleEl.checked = false;
      hideDetails();
      return;
    }
    log("toggle ->", response);
    if (response.error) {
      logError("background reported error during toggle:", response.error);
    }

    if (response.needsSessionPicker) {
      // Activation is pending a session choice — keep the toggle visibly "pending"
      // (not a plain off) and say so, so the revert doesn't read as a failure.
      toggleEl.checked = false;
      setPending(true);
      widgetDetailsEl.style.display = "block";
      if (response.serverUrl) serverUrlInput.value = response.serverUrl;
      setStatus("pending", "Pick a session to enable");
      // Sessions came back with the toggle response — no second fetch needed.
      showSessionPicker(response.sessions || []);
    } else {
      setPending(false);
      toggleEl.checked = response.active ?? false;
      sessionPickerEl.style.display = "none";
      if (response.active) {
        // Re-init to fetch session info and show details
        init();
      } else if (response.error) {
        // e.g. the page blocks injection — show why instead of silently reverting.
        widgetDetailsEl.style.display = "block";
        activeSessionEl.style.display = "none";
        setStatus("disconnected", response.error);
      } else {
        hideDetails();
      }
    }
  });
});

// Change session button
changeSessionBtn.addEventListener("click", () => {
  log("change session clicked");
  loadSessionPicker();
});

// Save server URL
saveUrlBtn.addEventListener("click", () => {
  const url = serverUrlInput.value.trim().replace(/\/+$/, "");
  if (!url) {
    warn("empty server URL; not saving");
    return;
  }

  chrome.runtime.sendMessage({ action: "setServerUrl", serverUrl: url }, (resp) => {
    if (chrome.runtime.lastError) {
      logError("setServerUrl failed", chrome.runtime.lastError);
      return;
    }
    log("server URL saved:", url, resp);
    checkConnection(url, currentSessionId);
  });
});

init();
