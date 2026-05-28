import {
  WIDGET_ID,
  consoleLogs,
  modifierSymbol,
  setShadowRoot,
  shadowRoot,
} from "./widget-state.ts";

export function getStyles(): string {
  return `
    :host {
      all: initial;
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
    }

    .cf-root {
      all: initial;
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #374151;
      color-scheme: light;
      -webkit-text-size-adjust: 100%;
    }

    .cf-root *, .cf-root *::before, .cf-root *::after {
      box-sizing: border-box;
    }

    .cf-root input, .cf-root textarea, .cf-root select, .cf-root button {
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      color: inherit;
    }

    #${WIDGET_ID}-button {
      background: linear-gradient(135deg, #da7756 0%, #e78d6d 100%);
      color: white;
      border: none;
      border-radius: 12px;
      padding: 12px 16px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(218, 119, 86, 0.4);
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    #${WIDGET_ID}-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(218, 119, 86, 0.5);
    }

    #${WIDGET_ID}-button .shortcut-hint {
      font-size: 11px;
      opacity: 0.8;
      margin-left: 4px;
      background: rgba(255, 255, 255, 0.2);
      padding: 2px 6px;
      border-radius: 4px;
    }

    #${WIDGET_ID}-button.disconnected {
      background: linear-gradient(135deg, #6b7280 0%, #9ca3af 100%);
      box-shadow: 0 4px 12px rgba(107, 114, 128, 0.4);
    }

    #${WIDGET_ID}-button .claude-icon {
      flex-shrink: 0;
    }

    #${WIDGET_ID}-button-group {
      display: none;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    #${WIDGET_ID}-button-group.visible {
      display: flex;
    }

    #${WIDGET_ID}-button-group button {
      border: none;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: filter 0.15s ease;
      color: white;
    }

    #${WIDGET_ID}-button-group button:hover {
      filter: brightness(1.1);
    }

    #${WIDGET_ID}-add-btn {
      background: linear-gradient(135deg, #da7756 0%, #e78d6d 100%);
    }

    #${WIDGET_ID}-pending-btn {
      background: #ffffff;
      color: #1f2937 !important;
      border-left: 1px solid #e5e7eb !important;
      border-right: 1px solid #e5e7eb !important;
    }

    #${WIDGET_ID}-pending-count {
      background: #da7756;
      color: white;
      font-size: 11px;
      font-weight: 700;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
    }

    #${WIDGET_ID}-send-btn-group {
      background: linear-gradient(135deg, #22c55e 0%, #4ade80 100%);
    }

    #${WIDGET_ID}-queue-panel {
      position: fixed;
      bottom: 60px;
      right: 20px;
      width: 320px;
      max-width: 90vw;
      max-height: 300px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      z-index: 2147483646;
      display: none;
      flex-direction: column;
      overflow: hidden;
    }

    #${WIDGET_ID}-queue-panel.active {
      display: flex;
    }

    #${WIDGET_ID}-queue-header {
      background: #f3f4f6;
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #e5e7eb;
    }

    #${WIDGET_ID}-queue-header h4 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #374151;
    }

    #${WIDGET_ID}-queue-close {
      background: none;
      border: none;
      color: #6b7280;
      font-size: 18px;
      cursor: pointer;
      padding: 4px;
      line-height: 1;
    }

    #${WIDGET_ID}-queue-close:hover {
      color: #374151;
    }

    #${WIDGET_ID}-queue-footer {
      display: none;
      gap: 8px;
      padding: 10px 16px;
      border-top: 1px solid #e5e7eb;
      background: #f9fafb;
    }

    #${WIDGET_ID}-queue-footer button {
      flex: 1;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid #e5e7eb;
      background: white;
      color: #374151;
      transition: all 0.15s ease;
    }

    #${WIDGET_ID}-queue-footer button:hover {
      background: #f3f4f6;
      border-color: #d1d5db;
    }

    #${WIDGET_ID}-queue-list {
      overflow-y: auto;
      flex: 1;
      padding: 8px 0;
    }

    #${WIDGET_ID}-queue-empty {
      padding: 24px;
      text-align: center;
      color: #9ca3af;
      font-size: 13px;
    }

    .${WIDGET_ID}-queue-item {
      padding: 10px 16px;
      border-bottom: 1px solid #f3f4f6;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .${WIDGET_ID}-queue-item:last-child {
      border-bottom: none;
    }

    .${WIDGET_ID}-queue-item-content {
      flex: 1;
      min-width: 0;
    }

    .${WIDGET_ID}-queue-item-selector {
      font-family: monospace;
      font-size: 11px;
      color: #6b7280;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .${WIDGET_ID}-queue-item-description {
      font-size: 13px;
      color: #374151;
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .${WIDGET_ID}-queue-item-time {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 4px;
    }

    .${WIDGET_ID}-queue-item-delete {
      background: none;
      border: none;
      color: #9ca3af;
      cursor: pointer;
      padding: 4px;
      font-size: 14px;
      line-height: 1;
      flex-shrink: 0;
    }

    .${WIDGET_ID}-queue-item-delete:hover {
      color: #ef4444;
    }

    #${WIDGET_ID}-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.3);
      z-index: 2147483646;
      cursor: crosshair;
      display: none;
    }

    #${WIDGET_ID}-overlay.active {
      display: block;
    }

    #${WIDGET_ID}-highlight {
      position: fixed;
      pointer-events: none;
      border: 3px solid #da7756;
      background: rgba(218, 119, 86, 0.1);
      border-radius: 4px;
      z-index: 2147483646;
      display: none;
    }

    #${WIDGET_ID}-highlight.selected {
      border-color: #3b82f6;
      background: rgba(59, 130, 246, 0.1);
    }

    #${WIDGET_ID}-tooltip {
      position: fixed;
      background: #1f2937;
      color: white;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12px;
      z-index: 2147483647;
      pointer-events: none;
      display: none;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #${WIDGET_ID}-panel {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 400px;
      max-width: 90vw;
      max-height: 80vh;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
      z-index: 2147483647;
      display: none;
      overflow: hidden;
    }

    #${WIDGET_ID}-panel.active {
      display: flex;
      flex-direction: column;
    }

    #${WIDGET_ID}-panel.minimized {
      max-height: none;
      height: auto;
    }

    #${WIDGET_ID}-panel.minimized #${WIDGET_ID}-panel-body {
      display: none;
    }

    #${WIDGET_ID}-panel-header {
      background: linear-gradient(135deg, #da7756 0%, #e78d6d 100%);
      color: white;
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      user-select: none;
    }

    #${WIDGET_ID}-panel-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }

    #${WIDGET_ID}-panel-controls {
      display: flex;
      gap: 6px;
    }

    #${WIDGET_ID}-panel-minimize,
    #${WIDGET_ID}-panel-close {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: white;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #${WIDGET_ID}-panel-minimize:hover,
    #${WIDGET_ID}-panel-close:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    #${WIDGET_ID}-panel-body {
      padding: 20px;
      overflow-y: auto;
      max-height: calc(90vh - 60px);
    }

    #${WIDGET_ID}-screenshot-preview {
      width: 100%;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      margin-bottom: 16px;
      max-height: 200px;
      object-fit: contain;
      background: #f9fafb;
    }

    #${WIDGET_ID}-element-info-wrapper {
      margin-bottom: 16px;
    }

    #${WIDGET_ID}-element-info-toggle {
      background: none;
      border: none;
      color: #6b7280;
      font-size: 13px;
      cursor: pointer;
      padding: 4px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    #${WIDGET_ID}-element-info-toggle:hover {
      color: #374151;
    }

    #${WIDGET_ID}-element-info-toggle .toggle-icon {
      font-size: 10px;
      transition: transform 0.2s ease;
    }

    #${WIDGET_ID}-element-info-wrapper.expanded #${WIDGET_ID}-element-info-toggle .toggle-icon {
      transform: rotate(90deg);
    }

    #${WIDGET_ID}-element-info {
      background: #f3f4f6;
      color: #374151;
      padding: 12px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      margin-top: 8px;
      word-break: break-all;
      display: none;
    }

    #${WIDGET_ID}-element-info-wrapper.expanded #${WIDGET_ID}-element-info {
      display: block;
    }

    #${WIDGET_ID}-description {
      width: 100%;
      min-height: 100px;
      padding: 12px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      resize: vertical;
      margin-bottom: 16px;
      background: white;
    }

    #${WIDGET_ID}-description:focus {
      outline: none;
      border-color: #da7756;
    }

    #${WIDGET_ID}-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }

    #${WIDGET_ID}-options label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: #374151;
      cursor: pointer;
    }

    #${WIDGET_ID}-options input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: #da7756;
    }

    #${WIDGET_ID}-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }

    #${WIDGET_ID}-actions button {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    #${WIDGET_ID}-cancel-btn {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      color: #374151;
    }

    #${WIDGET_ID}-cancel-btn:hover {
      background: #e5e7eb;
    }

    #${WIDGET_ID}-send-btn {
      background: linear-gradient(135deg, #da7756 0%, #e78d6d 100%);
      border: none;
      color: white;
    }

    #${WIDGET_ID}-send-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(218, 119, 86, 0.4);
    }

    #${WIDGET_ID}-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    #${WIDGET_ID}-send-btn .shortcut-hint {
      font-size: 11px;
      opacity: 0.7;
      margin-left: 6px;
    }

    #${WIDGET_ID}-instructions {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1f2937;
      color: white;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 14px;
      z-index: 2147483647;
      display: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    #${WIDGET_ID}-instructions.active {
      display: block;
    }

    #${WIDGET_ID}-success {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #22c55e;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 2147483647;
      display: none;
      animation: slideIn 0.3s ease;
    }

    #${WIDGET_ID}-error {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ef4444;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 2147483647;
      display: none;
      animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    @keyframes countBump {
      0%   { transform: scale(1); }
      40%  { transform: scale(1.3); }
      100% { transform: scale(1); }
    }
  `;
}

export function createWidget(onReady: () => void): void {
  const existing = document.getElementById(WIDGET_ID);
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = WIDGET_ID;
  const root = host.attachShadow({ mode: "open" });
  setShadowRoot(root);

  const styleEl = document.createElement("style");
  styleEl.textContent = getStyles();
  root.appendChild(styleEl);

  const container = document.createElement("div");
  container.innerHTML = `
    <div class="cf-root">
    <div id="${WIDGET_ID}-button-area" style="position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 10px;">
      <button id="${WIDGET_ID}-button" class="disconnected" title="Click to annotate an element and send feedback to Claude. Add multiple items before sending.">
        <svg class="claude-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H4.104v-.08l2.878-1.17-.107-.312h-.063L3.87 12.802v-.064l6.048-3.318V9.3L4.14 6.622l.064-.064 4.848 1.336.063-.063-.08-.392L4.66 3.893 8.34 5.58l.312-.072V5.34L6.35 2.766l2.374 1.68.08-.064-.032-.44L6.83.782 9.3 3.67l.12-.048.064-3.59h.064l.663 3.222.168.056L12.12.614v.064l-.92 3.406.072.128h.08L14.12.766v.08l-1.92 3.83.064.104 3.63-2.63-.064.08-2.35 3.734.04.12.128.024 3.934-1.4-.08.08-3.07 2.63v.08l.112.063 3.83-.92-.064.08-3.35 1.6v.04l.12.128 3.566.128-.08.064-3.606.695-.064.136.032.048 3.83 1.4-.08.048-3.83-.015-.128.104-.008.072 3.35 2.446-.08.032-3.59-1.344-.12.064-.04.104 2.342 3.35-.08.016-2.998-2.566-.088.056-.128.168.87 3.95h-.08l-1.664-3.35-.112-.04-.08.04-.6 4.12h-.064l.12-3.862-.12-.136-.088.008-1.92 3.398-.048-.064.84-3.83-.072-.12-.136-.024-2.566 2.998-.032-.08 1.824-3.59-.056-.128-.104-.024-3.19 1.824.048-.08 2.566-2.87-.048-.127-.12-.016-3.67.463z"/>
        </svg>
        <span>Add annotation</span>
        <span class="shortcut-hint" id="${WIDGET_ID}-button-shortcut" style="display: none;">Shift+C</span>
      </button>

      <div id="${WIDGET_ID}-button-group">
        <button id="${WIDGET_ID}-add-btn" title="Add another annotation">
          <span>+ Add</span>
        </button>
        <button id="${WIDGET_ID}-pending-btn">
          <span>Pending</span>
          <span id="${WIDGET_ID}-pending-count">0</span>
        </button>
        <button id="${WIDGET_ID}-send-btn-group" title="Send all feedback to Claude">
          <span>Send</span>
        </button>
      </div>
    </div>

    <div id="${WIDGET_ID}-queue-panel">
      <div id="${WIDGET_ID}-queue-header">
        <h4>Pending Feedback</h4>
        <button id="${WIDGET_ID}-queue-close" title="Close">×</button>
      </div>
      <div id="${WIDGET_ID}-queue-list">
        <div id="${WIDGET_ID}-queue-empty">No pending feedback</div>
      </div>
      <div id="${WIDGET_ID}-queue-footer" style="display: none;">
        <button id="${WIDGET_ID}-export-md-btn">Export Markdown</button>
        <button id="${WIDGET_ID}-export-gh-btn">Create GitHub Issue</button>
      </div>
    </div>

    <div id="${WIDGET_ID}-overlay"></div>
    <div id="${WIDGET_ID}-highlight"></div>
    <div id="${WIDGET_ID}-tooltip"></div>

    <div id="${WIDGET_ID}-instructions">
      Click on any element to select it, or press <strong>Escape</strong> to cancel
    </div>

    <div id="${WIDGET_ID}-panel">
      <div id="${WIDGET_ID}-panel-header">
        <h3>Report annotation to Claude</h3>
        <div id="${WIDGET_ID}-panel-controls">
          <button id="${WIDGET_ID}-panel-minimize" title="Minimize">−</button>
          <button id="${WIDGET_ID}-panel-close" title="Close">×</button>
        </div>
      </div>
      <div id="${WIDGET_ID}-panel-body">
        <img id="${WIDGET_ID}-screenshot-preview" alt="Screenshot" />
        <textarea
          id="${WIDGET_ID}-description"
          placeholder="Describe what's wrong or what you'd like to change..."
        ></textarea>
        <div id="${WIDGET_ID}-element-info-wrapper">
          <button id="${WIDGET_ID}-element-info-toggle" type="button">
            <span class="toggle-icon">▶</span> Element Details
          </button>
          <div id="${WIDGET_ID}-element-info"></div>
        </div>
        <div id="${WIDGET_ID}-options">
          <label>
            <input type="checkbox" id="${WIDGET_ID}-include-screenshot" checked />
            Include screenshot (element area)
          </label>
          <label>
            <input type="checkbox" id="${WIDGET_ID}-include-logs" checked />
            <span id="${WIDGET_ID}-include-logs-text">Include console logs (${consoleLogs.length} captured)</span>
          </label>
          <label>
            <input type="checkbox" id="${WIDGET_ID}-include-styles" checked />
            Include computed styles
          </label>
        </div>
        <div id="${WIDGET_ID}-actions">
          <button id="${WIDGET_ID}-cancel-btn">Cancel</button>
          <button id="${WIDGET_ID}-send-btn">Add item<span class="shortcut-hint">${modifierSymbol}↵</span></button>
        </div>
      </div>
    </div>

    <div id="${WIDGET_ID}-success"></div>
    <div id="${WIDGET_ID}-error"></div>
    </div>
  `;

  while (container.firstChild) {
    root.appendChild(container.firstChild);
  }

  document.body.appendChild(host);
  onReady();
}
