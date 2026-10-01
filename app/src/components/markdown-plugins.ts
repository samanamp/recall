import { defaultUrlTransform, type UrlTransform } from "react-markdown";
import type { Element, Root } from "hast";

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
