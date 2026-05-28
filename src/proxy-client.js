import { detectProjectUrl } from "./utils.ts";

export function createProxyClient({ port, sessionId, processId, projectDir }) {
  const baseUrl = `http://localhost:${port}`;

  async function fetchServerStatus(sid) {
    try {
      const url = sid ? `${baseUrl}/status?session=${sid}` : `${baseUrl}/status`;
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Server not running or not reachable
    }
    return null;
  }

  async function fetchReadyFeedback(clear = true) {
    try {
      const response = await fetch(
        `${baseUrl}/feedback?clear=${clear}&session=${sessionId}`,
      );
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Server not running or not reachable
    }
    return null;
  }

  async function pollForFeedback(timeoutSeconds) {
    const pollInterval = 500;
    const maxAttempts = (timeoutSeconds * 1000) / pollInterval;

    for (let i = 0; i < maxAttempts; i++) {
      const result = await fetchReadyFeedback(true);
      if (result && result.feedback && result.feedback.length > 0) {
        if (result.feedback.length === 1) return result.feedback[0];
        return result.feedback;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    throw new Error("Timeout waiting for browser feedback");
  }

  async function broadcastViaHttp(message) {
    try {
      const response = await fetch(`${baseUrl}/broadcast?session=${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Server not running or not reachable
    }
    return null;
  }

  async function fetchPendingSummary() {
    try {
      const response = await fetch(`${baseUrl}/pending-summary?session=${sessionId}`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Server not running or not reachable
    }
    return null;
  }

  async function deleteFeedbackViaHttp(id) {
    try {
      const response = await fetch(`${baseUrl}/feedback/${id}?session=${sessionId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Server not running or not reachable
    }
    return null;
  }

  async function registerSession() {
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
      });
    } catch {
      // Server not reachable, session won't appear in registry
    }
  }

  async function unregisterSession() {
    try {
      await fetch(`${baseUrl}/unregister-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, processId }),
      });
    } catch {
      // Ignore errors during shutdown
    }
  }

  return {
    fetchServerStatus,
    fetchReadyFeedback,
    pollForFeedback,
    broadcastViaHttp,
    fetchPendingSummary,
    deleteFeedbackViaHttp,
    registerSession,
    unregisterSession,
  };
}
