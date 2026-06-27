// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  getElementSelector,
  getTruncatedSelector,
  getFullSelector,
  getElementInfo,
} from "../src/widget/widget-selection.ts";

describe("getElementSelector", () => {
  it("returns #id when element has an id", () => {
    const el = document.createElement("div");
    el.id = "main";
    expect(getElementSelector(el)).toBe("#main");
  });

  it("returns tag.class for element with classes", () => {
    const el = document.createElement("span");
    el.className = "foo bar";
    expect(getElementSelector(el)).toBe("span.foo.bar");
  });

  it("returns bare tag name when no id or class", () => {
    const el = document.createElement("p");
    expect(getElementSelector(el)).toBe("p");
  });

  it("omits the class part when className is only whitespace", () => {
    const el = document.createElement("div");
    el.className = "   ";
    // A whitespace-only class must not produce a trailing dot ("div."),
    // which is a malformed selector that throws in querySelector.
    expect(getElementSelector(el)).toBe("div");
  });

  it("adds :nth-of-type when siblings share the same tag", () => {
    const parent = document.createElement("ul");
    const li1 = document.createElement("li");
    const li2 = document.createElement("li");
    parent.append(li1, li2);

    expect(getElementSelector(li1)).toBe("li:nth-of-type(1)");
    expect(getElementSelector(li2)).toBe("li:nth-of-type(2)");
  });

  it("omits :nth-of-type when element is the only child of its tag", () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.appendChild(child);

    expect(getElementSelector(child)).toBe("span");
  });

  it("prefers id over class and nth-of-type", () => {
    const parent = document.createElement("div");
    const el = document.createElement("div");
    el.id = "unique";
    el.className = "cls";
    parent.append(document.createElement("div"), el);

    expect(getElementSelector(el)).toBe("#unique");
  });
});

describe("getTruncatedSelector", () => {
  it("returns selector up to maxDepth levels", () => {
    document.body.innerHTML = "<div><section><p></p></section></div>";
    const p = document.querySelector("p")!;
    const result = getTruncatedSelector(p, 2);
    expect(result).toBe("... > section > p");
  });

  it("omits ellipsis when depth fits within maxDepth", () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.appendChild(child);
    document.body.appendChild(parent);

    const result = getTruncatedSelector(child, 5);
    expect(result).toContain("span");
    expect(result).not.toMatch(/^\.\.\./);

    parent.remove();
  });

  it("defaults to maxDepth of 2", () => {
    document.body.innerHTML = "<div><section><article><p></p></article></section></div>";
    const p = document.querySelector("p")!;
    const result = getTruncatedSelector(p);
    expect(result).toMatch(/^\.\.\. > /);
    const parts = result.replace("... > ", "").split(" > ");
    expect(parts).toHaveLength(2);
  });
});

describe("getFullSelector", () => {
  it("returns full path from body to element", () => {
    document.body.innerHTML = "<div id='outer'><span class='inner'><a></a></span></div>";
    const a = document.querySelector("a")!;
    const result = getFullSelector(a);
    expect(result).toContain("#outer");
    expect(result).toContain("span.inner");
    expect(result).toContain("a");
    expect(result.split(" > ").length).toBeGreaterThanOrEqual(3);
  });

  it("includes body in path for direct body child", () => {
    const el = document.createElement("main");
    document.body.innerHTML = "";
    document.body.appendChild(el);
    const result = getFullSelector(el);
    expect(result).toBe("body > main");
  });
});

describe("getElementInfo", () => {
  it("returns complete element metadata", () => {
    document.body.innerHTML =
      '<button id="submit" class="btn primary" data-action="save">Click me</button>';
    const btn = document.querySelector("button")!;
    const info = getElementInfo(btn);

    expect(info.tagName).toBe("button");
    expect(info.id).toBe("submit");
    expect(info.className).toBe("btn primary");
    expect(info.selector).toBe("#submit");
    expect(info.text).toBe("Click me");
    expect(info.attributes["data-action"]).toBe("save");
    expect(info.boundingRect).toHaveProperty("top");
    expect(info.boundingRect).toHaveProperty("width");
  });

  it("returns null for missing id and className", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const info = getElementInfo(el);
    expect(info.id).toBeNull();
    expect(info.className).toBeNull();
    el.remove();
  });

  it("truncates text, innerHTML, and outerHTML", () => {
    const el = document.createElement("div");
    el.textContent = "x".repeat(300);
    document.body.appendChild(el);
    const info = getElementInfo(el);

    expect(info.text!.length).toBeLessThanOrEqual(200);
    expect(info.innerHTML!.length).toBeLessThanOrEqual(500);
    expect(info.outerHTML!.length).toBeLessThanOrEqual(1000);
    el.remove();
  });

  it("includes computedStyles", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const info = getElementInfo(el);

    expect(info.computedStyles).toBeDefined();
    expect(info.computedStyles).toHaveProperty("display");
    expect(info.computedStyles).toHaveProperty("position");
    expect(info.computedStyles).toHaveProperty("color");
    el.remove();
  });

  it("collects all attributes", () => {
    document.body.innerHTML = '<input type="text" name="email" required />';
    const input = document.querySelector("input")!;
    const info = getElementInfo(input);

    expect(info.attributes["type"]).toBe("text");
    expect(info.attributes["name"]).toBe("email");
    expect("required" in info.attributes).toBe(true);
  });
});
