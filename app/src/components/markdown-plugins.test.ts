import { describe, expect, it } from "vitest";
import type { Element, Root } from "hast";
import { rehypeCardMeta, urlTransform } from "./markdown-plugins";

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
