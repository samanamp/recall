import { defaultUrlTransform, type UrlTransform } from "react-markdown";
import type { Element, Root } from "hast";
import { smarten } from "../lib/typography";

/** Default-safe URLs, plus inline image data (pasted or locally generated). */
export const urlTransform: UrlTransform = (url, key, node) => {
  if (key === "src" && node.tagName === "img" && /^(blob:|data:image\/)/i.test(url)) return url;
  return defaultUrlTransform(url);
};

/**
 * Tag a trailing emphasis-only paragraph (the `*… · src: …*` footer cards
 * carry) as `.card-meta`, so it renders small and muted. Anything else — text
 * beside the emphasis, or the paragraph not being last — is left alone.
 */
export function rehypeCardMeta() {
  return (tree: Root) => {
    const last = [...tree.children].reverse().find(
      (n) => !(n.type === "text" && n.value.trim() === "")
    );
    if (!last || last.type !== "element" || last.tagName !== "p") return;
    const parts = last.children.filter((n) => !(n.type === "text" && n.value.trim() === ""));
    if (parts.length === 1 && parts[0].type === "element" && parts[0].tagName === "em") {
      const p = last as Element;
      const existing = p.properties.className;
      p.properties.className = [...(Array.isArray(existing) ? existing : []), "card-meta"];
    }
  };
}

const BLOCK = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "blockquote", "dt", "dd"]);
const VERBATIM = new Set(["code", "pre", "kbd", "samp", "script", "style"]);

/**
 * Book typography (see `smarten`) for rendered card prose. Code, KaTeX
 * output and other verbatim text are left alone. Quote direction carries
 * across inline elements (so `"**bold**"` curls correctly) and resets at
 * each block.
 */
export function rehypeSmartypants() {
  return (tree: Root) => {
    let prev = "";
    const walk = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type === "text") {
          const r = smarten(child.value, prev);
          child.value = r.text;
          prev = r.last;
        } else if (child.type === "element") {
          const cls = child.properties.className;
          const isMath = Array.isArray(cls) && cls.some((c) => String(c).startsWith("katex"));
          if (VERBATIM.has(child.tagName) || isMath) {
            prev = "x"; // verbatim text counts as a word: `name`" closes the quote
            continue;
          }
          if (BLOCK.has(child.tagName)) prev = "";
          walk(child);
          if (BLOCK.has(child.tagName)) prev = "";
        }
      }
    };
    walk(tree);
  };
}
