import { describe, expect, it } from "vitest";
import type { Element, Root } from "hast";
import { rehypeCardMeta, rehypeSmartypants, urlTransform } from "./markdown-plugins";

const img = { type: "element", tagName: "img", properties: {}, children: [] } as Element;
const a = { type: "element", tagName: "a", properties: {}, children: [] } as Element;

describe("urlTransform", () => {
  it("keeps relative media paths", () => {
    expect(urlTransform("../../media/abc.webp", "src", img)).toBe("../../media/abc.webp");
    expect(urlTransform("media/abc.png", "src", img)).toBe("media/abc.png");
  });
  it("keeps https links and image blob/data sources", () => {
    expect(urlTransform("https://example.com/x", "href", a)).toBe("https://example.com/x");
    expect(urlTransform("blob:http://localhost/123", "src", img)).toBe("blob:http://localhost/123");
    expect(urlTransform("data:image/png;base64,AAAA", "src", img)).toBe("data:image/png;base64,AAAA");
  });
  it("strips script-capable URLs", () => {
    expect(urlTransform("javascript:alert(1)", "href", a)).toBe("");
    expect(urlTransform("data:text/html,<script>", "href", a)).toBe("");
    expect(urlTransform("data:image/png;base64,AAAA", "href", a)).toBe("");
  });
});

const p = (...children: Element["children"]): Element => ({ type: "element", tagName: "p", properties: {}, children });
const em = (t: string): Element => ({ type: "element", tagName: "em", properties: {}, children: [{ type: "text", value: t }] });

describe("rehypeCardMeta", () => {
  it("tags a trailing emphasis-only paragraph", () => {
    const tree: Root = { type: "root", children: [p({ type: "text", value: "answer" }), { type: "text", value: "\n" }, p(em("src: x"))] };
    rehypeCardMeta()(tree);
    expect((tree.children[2] as Element).properties.className).toEqual(["card-meta"]);
  });
  it("leaves mixed or non-trailing paragraphs alone", () => {
    const tree: Root = { type: "root", children: [p(em("a")), p({ type: "text", value: "see " }, em("b"))] };
    rehypeCardMeta()(tree);
    expect((tree.children[0] as Element).properties.className).toBeUndefined();
    expect((tree.children[1] as Element).properties.className).toBeUndefined();
  });
});

describe("rehypeSmartypants", () => {
  const run = (children: Root["children"]) => {
    const tree: Root = { type: "root", children };
    rehypeSmartypants()(tree);
    return tree;
  };
  const text = (n: Root["children"][number] | Element["children"][number]): string =>
    n.type === "text" ? n.value : n.type === "element" ? n.children.map(text).join("") : "";
  const el = (tagName: string, ...children: Element["children"]): Element => ({ type: "element", tagName, properties: {}, children });
  const t = (value: string) => ({ type: "text" as const, value });

  it("curls quotes and apostrophes and converts ellipses and spaced dashes", () => {
    const tree = run([p(t(`the "model half" isn't 'it'... -- done`))]);
    expect(text(tree.children[0])).toBe("the \u201cmodel half\u201d isn\u2019t \u2018it\u2019\u2026 \u2014 done");
  });
  it("carries context across inline elements and resets per block", () => {
    const tree = run([p(t('"'), el("strong", t("bold")), t('"')), p(t('"x"'))]);
    expect(text(tree.children[0])).toBe("\u201cbold\u201d");
    expect(text(tree.children[1])).toBe("\u201cx\u201d");
  });
  it("leaves code and math untouched", () => {
    const math: Element = { type: "element", tagName: "span", properties: { className: ["katex"] }, children: [t("f'(x)")] };
    const tree = run([p(t('"'), el("code", t(`a = "b" -- c...`)), t('" and '), math)]);
    expect(text(tree.children[0])).toBe(`\u201ca = "b" -- c...\u201d and f'(x)`);
  });
});
