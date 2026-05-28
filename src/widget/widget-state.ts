import type { FeedbackItem, ConsoleLogEntry } from "../shared-types.ts";
export type { FeedbackItem, ConsoleLogEntry } from "../shared-types.ts";

export const WIDGET_ID = "claude-feedback-widget";
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
export const modifierKey: "metaKey" | "ctrlKey" = isMac ? "metaKey" : "ctrlKey";
export const modifierSymbol = isMac ? "⌘" : "Ctrl+";

export let shadowRoot: ShadowRoot | null = null;
export let ws: WebSocket | null = null;
export let isConnected = false;
export let isAnnotationMode = false;
export let selectedElement: Element | null = null;
export let consoleLogs: ConsoleLogEntry[] = [];
export let pendingItems: FeedbackItem[] = [];
export let localPendingItems: FeedbackItem[] = [];
export let isPendingQueueOpen = false;
export let currentSessionId: string | null = null;
export let hoveredElement: Element | null = null;

export let _listeners: Record<string, EventListener> = {};
export let _selfHealObserver: MutationObserver | null = null;
export let _selfHealInterval: ReturnType<typeof setInterval> | null = null;
export let _wsReconnectTimeout: ReturnType<typeof setTimeout> | null = null;

export function setShadowRoot(root: ShadowRoot | null) {
  shadowRoot = root;
}
export function setWs(socket: WebSocket | null) {
  ws = socket;
}
export function setIsConnected(connected: boolean) {
  isConnected = connected;
}
export function setIsAnnotationMode(mode: boolean) {
  isAnnotationMode = mode;
}
export function setSelectedElement(el: Element | null) {
  selectedElement = el;
}
export function setConsoleLogs(logs: ConsoleLogEntry[]) {
  consoleLogs = logs;
}
export function setPendingItems(items: FeedbackItem[]) {
  pendingItems = items;
}
export function setLocalPendingItems(items: FeedbackItem[]) {
  localPendingItems = items;
}
export function setIsPendingQueueOpen(open: boolean) {
  isPendingQueueOpen = open;
}
export function setCurrentSessionId(id: string | null) {
  currentSessionId = id;
}
export function setHoveredElement(el: Element | null) {
  hoveredElement = el;
}
export function setListeners(listeners: Record<string, EventListener>) {
  _listeners = listeners;
}
export function setSelfHealObserver(observer: MutationObserver | null) {
  _selfHealObserver = observer;
}
export function setSelfHealInterval(interval: ReturnType<typeof setInterval> | null) {
  _selfHealInterval = interval;
}
export function setWsReconnectTimeout(timeout: ReturnType<typeof setTimeout> | null) {
  _wsReconnectTimeout = timeout;
}

export function getEl(id: string): HTMLElement | null {
  return shadowRoot ? shadowRoot.getElementById(id) : null;
}

export function getAllPendingItems(): FeedbackItem[] {
  return isConnected ? pendingItems : localPendingItems;
}

export function resetState() {
  consoleLogs = [];
  pendingItems = [];
  localPendingItems = [];
  selectedElement = null;
  isAnnotationMode = false;
  isPendingQueueOpen = false;
  hoveredElement = null;
}
