import {
  WIDGET_ID,
  isAnnotationMode,
  isConnected,
  isPendingQueueOpen,
  selectedElement,
  hoveredElement,
  consoleLogs,
  pendingItems,
  localPendingItems,
  modifierKey,
  shadowRoot,
  _listeners,
  getEl,
  getAllPendingItems,
  setIsAnnotationMode,
  setSelectedElement,
  setHoveredElement,
  setIsPendingQueueOpen,
  setLocalPendingItems,
  setListeners,
  type FeedbackItem,
} from "./widget-state.ts";
import { getElementInfo, getTruncatedSelector } from "./widget-selection.ts";
import { captureScreenshot } from "./widget-screenshot.ts";
import { sendMessage, isSocketOpen, WS_BASE_URL } from "./widget-connection.ts";

export function startAnnotationMode(): void {
  setIsAnnotationMode(true);
  getEl(`${WIDGET_ID}-overlay`)!.classList.add("active");
  getEl(`${WIDGET_ID}-instructions`)!.classList.add("active");
}

export function stopAnnotationMode(): void {
  setIsAnnotationMode(false);
  setHoveredElement(null);
  getEl(`${WIDGET_ID}-overlay`)!.classList.remove("active");
  getEl(`${WIDGET_ID}-instructions`)!.classList.remove("active");
  getEl(`${WIDGET_ID}-highlight`)!.style.display = "none";
  getEl(`${WIDGET_ID}-tooltip`)!.style.display = "none";
}

export async function showPanel(): Promise<void> {
  const panel = getEl(`${WIDGET_ID}-panel`);
  const screenshotEl = getEl(`${WIDGET_ID}-screenshot-preview`) as HTMLImageElement | null;
  const elementInfoEl = getEl(`${WIDGET_ID}-element-info`);
  const elementInfoWrapper = getEl(`${WIDGET_ID}-element-info-wrapper`);
  const minimizeBtn = getEl(`${WIDGET_ID}-panel-minimize`);

  if (!panel) {
    console.error("[Claude Feedback] Panel element not found");
    return;
  }

  panel.style.top = "20px";
  panel.style.right = "20px";
  panel.style.left = "auto";
  panel.classList.remove("minimized");
  if (minimizeBtn) minimizeBtn.textContent = "−";

  if (elementInfoWrapper) elementInfoWrapper.classList.remove("expanded");

  const logsText = getEl(`${WIDGET_ID}-include-logs-text`);
  if (logsText) {
    logsText.textContent = `Include console logs (${consoleLogs.length} captured)`;
  }

  if (selectedElement && elementInfoEl) {
    const info = getElementInfo(selectedElement);
    elementInfoEl.innerHTML = `
      <strong>Selected:</strong> &lt;${info.tagName}${info.id ? ` id="${info.id}"` : ""}${info.className ? ` class="${info.className}"` : ""}&gt;<br>
      <strong>Selector:</strong> ${info.selector}
    `;
  }

  if (screenshotEl) {
    const includeScreenshotCheckbox = getEl(`${WIDGET_ID}-include-screenshot`) as HTMLInputElement | null;
    if (includeScreenshotCheckbox && includeScreenshotCheckbox.checked) {
      screenshotEl.alt = "Screenshot will be captured when submitted";
      screenshotEl.removeAttribute("src");
      screenshotEl.style.display = "none";
    } else {
      screenshotEl.style.display = "none";
    }
  }

  if (selectedElement) {
    const highlight = getEl(`${WIDGET_ID}-highlight`)!;
    const rect = selectedElement.getBoundingClientRect();
    highlight.style.top = `${rect.top}px`;
    highlight.style.left = `${rect.left}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    highlight.classList.add("selected");
    highlight.style.display = "block";
  }

  panel.classList.add("active");
  getEl(`${WIDGET_ID}-description`)!.focus();
}

export function hidePanel(): void {
  getEl(`${WIDGET_ID}-panel`)!.classList.remove("active");
  (getEl(`${WIDGET_ID}-description`) as HTMLTextAreaElement).value = "";
  setSelectedElement(null);
  const highlight = getEl(`${WIDGET_ID}-highlight`)!;
  highlight.style.display = "none";
  highlight.classList.remove("selected");
}

export async function addItem(): Promise<void> {
  if (!selectedElement) {
    console.warn("[Claude Feedback] No element selected");
    return;
  }

  const description = (getEl(`${WIDGET_ID}-description`) as HTMLTextAreaElement | null)?.value || "";
  const includeLogs = (getEl(`${WIDGET_ID}-include-logs`) as HTMLInputElement | null)?.checked ?? true;
  const includeStyles = (getEl(`${WIDGET_ID}-include-styles`) as HTMLInputElement | null)?.checked ?? true;
  const includeScreenshot = (getEl(`${WIDGET_ID}-include-screenshot`) as HTMLInputElement | null)?.checked ?? true;

  const elementInfo = getElementInfo(selectedElement);
  if (!includeStyles) {
    delete elementInfo.computedStyles;
  }

  const screenshot = includeScreenshot ? await captureScreenshot(selectedElement, WS_BASE_URL) : null;

  const feedback: FeedbackItem = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    url: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    userAgent: navigator.userAgent,
    element: elementInfo,
    description: description,
    screenshot: screenshot,
    consoleLogs: includeLogs ? consoleLogs.slice(-20) : [],
  };

  if (isSocketOpen()) {
    try {
      sendMessage({ type: "feedback", payload: feedback });
      hidePanel();
    } catch (err) {
      console.error("[Claude Feedback] Failed to add item:", err);
      showError("Failed to send. Saved locally.");
      setLocalPendingItems([...localPendingItems, feedback]);
      updatePendingUI();
      hidePanel();
    }
  } else {
    setLocalPendingItems([...localPendingItems, feedback]);
    updatePendingUI();
    hidePanel();
    showSuccess("Item saved locally (offline)");
  }
}

export function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString();
}

export function updatePendingUI(): void {
  const mainButton = getEl(`${WIDGET_ID}-button`);
  const buttonGroup = getEl(`${WIDGET_ID}-button-group`);
  const pendingCount = getEl(`${WIDGET_ID}-pending-count`);
  const queueList = getEl(`${WIDGET_ID}-queue-list`);
  const queueEmpty = getEl(`${WIDGET_ID}-queue-empty`);
  const sendBtnGroup = getEl(`${WIDGET_ID}-send-btn-group`);
  const exportFooter = getEl(`${WIDGET_ID}-queue-footer`);

  const items = getAllPendingItems();
  const hasPending = items.length > 0;

  if (mainButton) mainButton.style.display = hasPending ? "none" : "flex";
  if (buttonGroup) buttonGroup.classList.toggle("visible", hasPending);
  const prevCount = pendingCount ? parseInt(pendingCount.textContent!, 10) || 0 : 0;
  if (pendingCount) pendingCount.textContent = String(items.length);

  if (sendBtnGroup) sendBtnGroup.style.display = isConnected ? "" : "none";
  if (exportFooter) exportFooter.style.display = hasPending ? "flex" : "none";

  if (pendingCount && items.length > prevCount) {
    pendingCount.style.animation = "none";
    void pendingCount.offsetWidth; // force reflow to restart CSS animation
    pendingCount.style.animation = "countBump 0.3s ease";
  }

  if (!hasPending) closeQueuePanel();

  if (queueList) {
    const existingItems = queueList.querySelectorAll(`.${WIDGET_ID}-queue-item`);
    existingItems.forEach((item) => item.remove());

    if (items.length === 0) {
      if (queueEmpty) queueEmpty.style.display = "block";
    } else {
      if (queueEmpty) queueEmpty.style.display = "none";

      items.forEach((item) => {
        const itemEl = document.createElement("div");
        itemEl.className = `${WIDGET_ID}-queue-item`;
        itemEl.dataset.id = item.id;

        const contentEl = document.createElement("div");
        contentEl.className = `${WIDGET_ID}-queue-item-content`;

        const selectorEl = document.createElement("div");
        selectorEl.className = `${WIDGET_ID}-queue-item-selector`;
        selectorEl.textContent = item.selector || item.element?.selector || "Unknown element";
        contentEl.appendChild(selectorEl);

        if (item.description) {
          const descEl = document.createElement("div");
          descEl.className = `${WIDGET_ID}-queue-item-description`;
          descEl.textContent = item.description;
          contentEl.appendChild(descEl);
        }

        const timeEl = document.createElement("div");
        timeEl.className = `${WIDGET_ID}-queue-item-time`;
        timeEl.textContent = formatRelativeTime(item.timestamp);
        contentEl.appendChild(timeEl);

        itemEl.appendChild(contentEl);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = `${WIDGET_ID}-queue-item-delete`;
        deleteBtn.title = "Delete this feedback";
        deleteBtn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          deletePendingItem(item.id);
        });
        itemEl.appendChild(deleteBtn);

        queueList.appendChild(itemEl);
      });
    }
  }
}

export function toggleQueuePanel(): void {
  const panel = getEl(`${WIDGET_ID}-queue-panel`);
  if (panel) {
    setIsPendingQueueOpen(!isPendingQueueOpen);
    panel.classList.toggle("active", isPendingQueueOpen);
  }
}

export function closeQueuePanel(): void {
  const panel = getEl(`${WIDGET_ID}-queue-panel`);
  if (panel) {
    setIsPendingQueueOpen(false);
    panel.classList.remove("active");
  }
}

export function deletePendingItem(id: string): void {
  if (isSocketOpen()) {
    sendMessage({ type: "delete_feedback", id });
  } else {
    setLocalPendingItems(localPendingItems.filter((item) => item.id !== id));
    updatePendingUI();
  }
}

export function generateMarkdown(items: FeedbackItem[]): string {
  const now = new Date().toISOString();
  const url = items[0]?.url || window.location.href;
  let md = `# Browser Feedback Report\n\n`;
  md += `- **URL:** ${url}\n`;
  md += `- **Date:** ${now}\n`;
  md += `- **User Agent:** ${navigator.userAgent}\n`;
  md += `- **Items:** ${items.length}\n\n`;
  md += `---\n\n`;

  items.forEach((item, i) => {
    md += `## Item ${i + 1}\n\n`;

    const selector = item.selector || item.element?.selector || "Unknown";
    const fullSelector = item.element?.fullSelector || selector;
    md += `**Element:** \`${selector}\`\n\n`;
    md += `**Full path:** \`${fullSelector}\`\n\n`;

    if (item.description) {
      md += `**Description:** ${item.description}\n\n`;
    }

    if (item.element?.outerHTML) {
      md += `**HTML:**\n\`\`\`html\n${item.element.outerHTML}\n\`\`\`\n\n`;
    }

    if (item.element?.computedStyles) {
      const styles = item.element.computedStyles;
      const styleLines = Object.entries(styles)
        .filter(([, v]) => v)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n");
      if (styleLines) {
        md += `**Computed Styles:**\n\`\`\`\n${styleLines}\n\`\`\`\n\n`;
      }
    }

    if (item.consoleLogs && item.consoleLogs.length > 0) {
      md += `**Console Logs (${item.consoleLogs.length}):**\n\`\`\`\n`;
      item.consoleLogs.forEach((log) => {
        md += `[${log.type}] ${log.message}\n`;
      });
      md += `\`\`\`\n\n`;
    }

    if (item.screenshot) {
      md += `**Screenshot:** Captured (${Math.round(item.screenshot.length / 1024)}KB base64)\n\n`;
    }

    md += `---\n\n`;
  });

  return md;
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function showSuccess(message: string): void {
  const el = getEl(`${WIDGET_ID}-success`);
  if (el) {
    el.textContent = message;
    el.style.display = "block";
    setTimeout(() => {
      el.style.display = "none";
    }, 3000);
  }
}

export function showItemAdded(): void {
  showSuccess("Item added");
}

export function showBatchSuccess(count: number): void {
  showSuccess(`${count} item${count !== 1 ? "s" : ""} sent to Claude!`);
}

export function showError(message: string): void {
  const el = getEl(`${WIDGET_ID}-error`);
  if (el) {
    el.textContent = "✗ " + message;
    el.style.display = "block";
    setTimeout(() => {
      el.style.display = "none";
    }, 4000);
  } else {
    console.error("[Claude Feedback]", message);
  }
}

export function showNotification(message: string): void {
  console.log("[Claude Feedback]", message);
}

export function bindEvents(): void {
  const button = getEl(`${WIDGET_ID}-button`)!;
  const overlay = getEl(`${WIDGET_ID}-overlay`)!;
  const highlight = getEl(`${WIDGET_ID}-highlight`)!;
  const tooltip = getEl(`${WIDGET_ID}-tooltip`)!;
  const panel = getEl(`${WIDGET_ID}-panel`)!;
  const panelHeader = getEl(`${WIDGET_ID}-panel-header`)!;
  const minimizeBtn = getEl(`${WIDGET_ID}-panel-minimize`)!;
  const closeBtn = getEl(`${WIDGET_ID}-panel-close`)!;
  const cancelBtn = getEl(`${WIDGET_ID}-cancel-btn`)!;
  const sendBtn = getEl(`${WIDGET_ID}-send-btn`)!;
  const elementInfoToggle = getEl(`${WIDGET_ID}-element-info-toggle`)!;
  const elementInfoWrapper = getEl(`${WIDGET_ID}-element-info-wrapper`)!;
  const queueCloseBtn = getEl(`${WIDGET_ID}-queue-close`)!;
  const addBtn = getEl(`${WIDGET_ID}-add-btn`)!;
  const pendingBtn = getEl(`${WIDGET_ID}-pending-btn`)!;
  const sendBtnGroupEl = getEl(`${WIDGET_ID}-send-btn-group`)!;

  addBtn.addEventListener("click", () => {
    startAnnotationMode();
  });

  pendingBtn.addEventListener("click", () => {
    if (pendingItems.length > 0) toggleQueuePanel();
  });

  sendBtnGroupEl.addEventListener("click", () => {
    if (isSocketOpen() && pendingItems.length > 0) {
      sendMessage({ type: "send_to_claude" });
    }
  });

  queueCloseBtn.addEventListener("click", closeQueuePanel);

  const exportMdBtn = getEl(`${WIDGET_ID}-export-md-btn`)!;
  exportMdBtn.addEventListener("click", () => {
    const items = getAllPendingItems();
    if (items.length === 0) return;
    const md = generateMarkdown(items);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadFile(md, `feedback-${timestamp}.md`, "text/markdown");
  });

  const exportGhBtn = getEl(`${WIDGET_ID}-export-gh-btn`)!;
  exportGhBtn.addEventListener("click", () => {
    const items = getAllPendingItems();
    if (items.length === 0) return;

    let repo = localStorage.getItem("claude-feedback-github-repo");
    if (!repo) {
      repo = prompt("Enter GitHub repository (owner/repo):");
      if (!repo || !repo.includes("/")) {
        showError("Invalid repository format. Use owner/repo.");
        return;
      }
      localStorage.setItem("claude-feedback-github-repo", repo);
    }

    const md = generateMarkdown(items);
    const title = `Browser Feedback: ${items.length} item${items.length !== 1 ? "s" : ""} from ${new URL(items[0]?.url || window.location.href).hostname}`;

    const maxBodyLength = 6000;
    const body =
      md.length > maxBodyLength
        ? md.slice(0, maxBodyLength) + "\n\n... (truncated, export as Markdown for full report)"
        : md;

    const url = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank");
  });

  elementInfoToggle.addEventListener("click", () => {
    elementInfoWrapper.classList.toggle("expanded");
  });

  button.addEventListener("click", () => {
    startAnnotationMode();
  });

  minimizeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("minimized");
    minimizeBtn.textContent = panel.classList.contains("minimized") ? "+" : "−";
  });

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  panelHeader.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    isDragging = true;
    dragOffsetX = e.clientX - panel.offsetLeft;
    dragOffsetY = e.clientY - panel.offsetTop;
    panel.style.transition = "none";
  });

  function onDocumentMousemove(e: MouseEvent) {
    if (!isDragging) return;
    const x = Math.max(
      0,
      Math.min(e.clientX - dragOffsetX, window.innerWidth - panel.offsetWidth),
    );
    const y = Math.max(
      0,
      Math.min(e.clientY - dragOffsetY, window.innerHeight - panel.offsetHeight),
    );
    panel.style.left = x + "px";
    panel.style.top = y + "px";
    panel.style.right = "auto";
  }
  const listeners = { ..._listeners };
  listeners.onDocumentMousemove = onDocumentMousemove as EventListener;
  document.addEventListener("mousemove", onDocumentMousemove);

  function onDocumentMouseup() {
    isDragging = false;
    panel.style.transition = "";
  }
  listeners.onDocumentMouseup = onDocumentMouseup as EventListener;
  document.addEventListener("mouseup", onDocumentMouseup);

  function onWindowResize() {
    if (!panel.classList.contains("active")) return;
    const rect = panel.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      panel.style.left = Math.max(0, window.innerWidth - panel.offsetWidth) + "px";
      panel.style.right = "auto";
    }
    if (rect.bottom > window.innerHeight) {
      panel.style.top = Math.max(0, window.innerHeight - panel.offsetHeight) + "px";
    }
  }
  listeners.onWindowResize = onWindowResize as EventListener;
  window.addEventListener("resize", onWindowResize);

  overlay.addEventListener("mousemove", (e) => {
    if (!isAnnotationMode) return;

    overlay.style.pointerEvents = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = "auto";

    if (el && !el.closest(`#${WIDGET_ID}`)) {
      setHoveredElement(el);
      const rect = el.getBoundingClientRect();

      highlight.style.display = "block";
      highlight.style.top = rect.top + "px";
      highlight.style.left = rect.left + "px";
      highlight.style.width = rect.width + "px";
      highlight.style.height = rect.height + "px";

      tooltip.style.display = "block";
      tooltip.textContent = getTruncatedSelector(el);

      if (rect.top - 40 < 0) {
        tooltip.style.top = rect.bottom + 8 + "px";
      } else {
        tooltip.style.top = rect.top - 40 + "px";
      }

      const tooltipLeft = Math.max(4, Math.min(rect.left, window.innerWidth - 308));
      tooltip.style.left = tooltipLeft + "px";
    }
  });

  overlay.addEventListener("click", (e) => {
    if (!isAnnotationMode || !hoveredElement) return;
    e.preventDefault();
    e.stopPropagation();

    setSelectedElement(hoveredElement);
    stopAnnotationMode();
    showPanel();
  });

  function onDocumentKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      const panelEl = getEl(`${WIDGET_ID}-panel`);
      if (panelEl && panelEl.classList.contains("active")) {
        e.stopPropagation();
        hidePanel();
        return;
      }
      if (isPendingQueueOpen) {
        e.stopPropagation();
        closeQueuePanel();
        return;
      }
      if (isAnnotationMode) {
        e.stopPropagation();
        stopAnnotationMode();
        return;
      }
    }

    if (e.key === "C" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const panelEl = getEl(`${WIDGET_ID}-panel`);
      if (panelEl && panelEl.classList.contains("active")) return;

      const active = document.activeElement;
      const deepActive = (active as HTMLElement)?.shadowRoot?.activeElement || active;
      const isInputFocused =
        deepActive &&
        (["INPUT", "TEXTAREA"].includes(deepActive.tagName) ||
          (deepActive as HTMLElement).isContentEditable);

      if (!isInputFocused && !isAnnotationMode) {
        e.preventDefault();
        startAnnotationMode();
      }
    }
  }
  listeners.onDocumentKeydown = onDocumentKeydown as EventListener;
  document.addEventListener("keydown", onDocumentKeydown);

  function onShadowRootKeydown(e: KeyboardEvent) {
    const panelEl = getEl(`${WIDGET_ID}-panel`);
    const panelIsOpen = panelEl && panelEl.classList.contains("active");
    if (panelIsOpen || isAnnotationMode || isPendingQueueOpen) {
      e.stopPropagation();
    }
  }
  listeners.onShadowRootKeydown = onShadowRootKeydown as EventListener;
  shadowRoot!.addEventListener("keydown", onShadowRootKeydown as EventListener);

  const descriptionTextarea = getEl(`${WIDGET_ID}-description`) as HTMLTextAreaElement;
  descriptionTextarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e[modifierKey]) {
      e.preventDefault();
      e.stopPropagation();
      addItem();
    }
  });

  closeBtn.addEventListener("click", hidePanel);
  cancelBtn.addEventListener("click", hidePanel);
  sendBtn.addEventListener("click", addItem);

  setListeners(listeners);
}
