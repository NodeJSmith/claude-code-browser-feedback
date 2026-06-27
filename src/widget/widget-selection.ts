export function getElementSelector(el: Element): string {
  if (el.id) return `#${el.id}`;

  let selector = el.tagName.toLowerCase();
  // className is an SVGAnimatedString (not a string) on SVG elements; the typeof
  // guard skips those. The trim() guard skips empty/whitespace-only classes,
  // which would otherwise build a malformed "tag." selector with a trailing dot.
  if (typeof el.className === "string" && el.className.trim()) {
    selector += "." + el.className.trim().split(/\s+/).join(".");
  }

  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      selector += `:nth-of-type(${index})`;
    }
  }

  return selector;
}

export function getTruncatedSelector(el: Element, maxDepth = 2): string {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  let hasMore = false;

  while (current && current !== document.documentElement && depth < maxDepth) {
    parts.unshift(getElementSelector(current));
    current = current.parentElement;
    depth++;
  }

  if (current && current !== document.documentElement) {
    hasMore = true;
  }

  return (hasMore ? "... > " : "") + parts.join(" > ");
}

export function getFullSelector(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    parts.unshift(getElementSelector(current));
    current = current.parentElement;
  }
  return parts.join(" > ");
}

export interface ElementInfo {
  tagName: string;
  id: string | null;
  className: string | null;
  selector: string;
  fullSelector: string;
  text: string | null;
  innerHTML: string | null;
  outerHTML: string | null;
  attributes: Record<string, string>;
  boundingRect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  computedStyles?: {
    display: string;
    position: string;
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontWeight: string;
    padding: string;
    margin: string;
    border: string;
    opacity: string;
    visibility: string;
    zIndex: string;
  };
}

export function getElementInfo(el: Element): ElementInfo {
  const rect = el.getBoundingClientRect();
  const styles = window.getComputedStyle(el);

  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || null,
    className: (el.className as string) || null,
    selector: getElementSelector(el),
    fullSelector: getFullSelector(el),
    text: el.textContent?.slice(0, 200) || null,
    innerHTML: el.innerHTML?.slice(0, 500) || null,
    outerHTML: el.outerHTML?.slice(0, 1000) || null,
    attributes: Array.from(el.attributes || []).reduce(
      (acc, attr) => {
        acc[attr.name] = attr.value;
        return acc;
      },
      {} as Record<string, string>,
    ),
    boundingRect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
    computedStyles: {
      display: styles.display,
      position: styles.position,
      color: styles.color,
      backgroundColor: styles.backgroundColor,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      padding: styles.padding,
      margin: styles.margin,
      border: styles.border,
      opacity: styles.opacity,
      visibility: styles.visibility,
      zIndex: styles.zIndex,
    },
  };
}
