import type { ElementInfo } from "./widget/widget-selection.ts";

export interface ConsoleLogEntry {
  type: string;
  timestamp: string;
  message: string;
  stack?: string;
}

export interface FeedbackItem {
  id: string;
  timestamp: string;
  url: string;
  viewport?: { width: number; height: number; devicePixelRatio: number };
  userAgent?: string;
  element: ElementInfo | null;
  description: string;
  screenshot: string | null;
  consoleLogs: ConsoleLogEntry[];
  selector?: string;
}
