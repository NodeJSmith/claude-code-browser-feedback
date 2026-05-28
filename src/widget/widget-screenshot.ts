import { WIDGET_ID } from "./widget-state.ts";

let html2canvasPromise: Promise<void> | null = null;

declare const html2canvas: ((
  el: HTMLElement,
  opts: Record<string, unknown>,
) => Promise<HTMLCanvasElement>) & { toString(): string };

export function loadHtml2Canvas(wsBaseUrl: string): Promise<void> {
  if (typeof html2canvas !== "undefined") return Promise.resolve();
  if (html2canvasPromise) return html2canvasPromise;

  let baseUrl: string;
  try {
    const wsUrl = new URL(wsBaseUrl);
    baseUrl = `http://${wsUrl.host}`;
  } catch {
    baseUrl = `http://localhost:9877`;
  }

  const url = `${baseUrl}/html2canvas.min.js`;

  html2canvasPromise = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then((scriptText) => {
      // new Function() avoids CSP script-src restrictions on pages with strict policies
      new Function(scriptText)();
    })
    .catch((err) => {
      html2canvasPromise = null;
      throw new Error("Failed to load html2canvas: " + (err.message || err));
    });

  return html2canvasPromise;
}

export async function captureScreenshot(
  targetElement: Element | null,
  wsBaseUrl: string,
): Promise<string | null> {
  try {
    await loadHtml2Canvas(wsBaseUrl);
  } catch (err) {
    console.warn("[Claude Feedback] Could not load html2canvas:", (err as Error)?.message || err);
    return null;
  }

  if (typeof html2canvas === "undefined") return null;

  try {
    const widgetHost = document.getElementById(WIDGET_ID);
    const canvas = await html2canvas(document.body, {
      logging: false,
      useCORS: true,
      scale: 1,
      ignoreElements: (el: Element) => el === widgetHost,
    });

    if (targetElement) {
      const rect = targetElement.getBoundingClientRect();
      const padding = 50;

      const sx = Math.max(0, rect.left - padding);
      const sy = Math.max(0, rect.top - padding);
      const sw = Math.min(canvas.width - sx, rect.width + padding * 2);
      const sh = Math.min(canvas.height - sy, rect.height + padding * 2);

      const cropped = document.createElement("canvas");
      cropped.width = sw;
      cropped.height = sh;
      const ctx = cropped.getContext("2d")!;
      ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      return cropped.toDataURL("image/jpeg", 0.7);
    }

    return canvas.toDataURL("image/jpeg", 0.7);
  } catch (err) {
    console.warn("[Claude Feedback] html2canvas failed:", (err as Error)?.message || err);
    return null;
  }
}
