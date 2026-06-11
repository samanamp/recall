import { lazy, Suspense } from "react";

// The real renderer drags in katex + highlight.js (~700 kB) — load on demand.
const MarkdownInner = lazy(() => import("./MarkdownInner"));

export default function Markdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<div className="min-h-6" />}>
      <MarkdownInner text={text} />
    </Suspense>
  );
}
