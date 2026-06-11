import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { db } from "../lib/db";

/**
 * Card markdown renderer: GFM + $math$ (KaTeX) + syntax-highlighted code.
 * Raw HTML is not rendered (react-markdown default — XSS-safe).
 * Image srcs pointing into media/ resolve to locally-synced blobs.
 *
 * Heavy (katex + highlight.js) — only ever import via Markdown.tsx (lazy),
 * so the initial bundle stays small and the deck list boots fast.
 */
export default function MarkdownInner({ text }: { text: string }) {
  return (
    <div className="prose prose-zinc max-w-none dark:prose-invert prose-img:rounded-lg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        urlTransform={(url) => url} // keep relative media paths intact
        components={{ img: MediaImg }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function MediaImg(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const src = typeof props.src === "string" ? props.src : "";
  const match = src.match(/(?:^|\/)media\/([^/]+)$/);
  const [url, setUrl] = useState<string | null>(match ? null : src);

  useEffect(() => {
    if (!match) return;
    let objectUrl: string | null = null;
    void db.media.get(`media/${match[1]}`).then((row) => {
      if (row) {
        objectUrl = URL.createObjectURL(row.blob);
        setUrl(objectUrl);
      }
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!url) return <span className="text-sm text-zinc-400">[image not synced yet]</span>;
  return <img {...props} src={url} loading="lazy" />;
}
