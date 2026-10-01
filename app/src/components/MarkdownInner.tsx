import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { db } from "../lib/db";
import { rehypeCardMeta, urlTransform } from "./markdown-plugins";

/**
 * Card markdown renderer: GFM + $math$ (KaTeX) + syntax-highlighted code.
 * Raw HTML is not rendered (react-markdown default — XSS-safe), and URLs go
 * through react-markdown's sanitizer (no `javascript:` links), widened only
 * for image `blob:`/`data:image/` sources. Relative paths (`../../media/…`,
 * `media/…`) pass the sanitizer untouched; MediaImg then resolves them to
 * locally-synced blobs.
 *
 * Heavy (katex + highlight.js) — only ever import via Markdown.tsx (lazy),
 * so the initial bundle stays small and the deck list boots fast.
 */
export default function MarkdownInner({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={`prose card-type max-w-none ${className ?? ""}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeCardMeta]}
        urlTransform={urlTransform}
        components={{ img: MediaImg }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function MediaImg(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const src = typeof props.src === "string" ? props.src : "";
  // `../../media/x.webp` (repo-relative, as the editor writes it) or `media/x.webp`
  const match = src.match(/(?:^|\/)media\/([^/]+)$/);
  const mediaKey = match ? `media/${match[1]}` : null;
  const [url, setUrl] = useState<string | null>(mediaKey ? null : src);

  useEffect(() => {
    if (!mediaKey) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void db.media.get(mediaKey).then((row) => {
      if (row && !cancelled) {
        objectUrl = URL.createObjectURL(row.blob);
        setUrl(objectUrl);
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaKey]);

  if (!url) return <span className="font-sans text-sm text-muted">[image not synced yet]</span>;
  return <img {...props} src={url} loading="lazy" />;
}
