/**
 * Server-side card file creation — mirrors app/src/lib/cardfile.ts so cards
 * created through the API (the browser extension) are byte-identical in shape
 * to ones written by the app. Card identity is the frontmatter id (invariant 4).
 */
import { ulid } from "ulid";

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/`[^`]*`/g, "") // drop inline code from slugs
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "card"
  );
}

/**
 * Turn a free-text deck name into a safe folder path: per `/` segment, spaces
 * become `-` and only letters, digits, `-` and `_` survive, so `.`/`..` and
 * empty segments vanish. A deny-list (stripping "..") missed things like
 * "a/./b" or "a//b".
 */
export function sanitizeDeck(name: string): string {
  return (typeof name === "string" ? name : "")
    .split("/")
    .map((seg) => seg.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter((seg) => seg !== "")
    .join("/");
}

/** Deck folders present in a manifest: "decks/a/b/x.md" → "a/b". */
export function deckFolders(paths: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    const m = p.match(/^decks\/(.+)\/[^/]+$/);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * The app allows deck names sanitizeDeck would rewrite ("Machine Learning").
 * A name that matches an existing folder exactly is used as-is, so the
 * extension still saves into that deck instead of forking a look-alike one.
 */
export function resolveDeck(name: string, existing: Set<string>): string {
  const trimmed = (typeof name === "string" ? name : "").trim().replace(/^\/+|\/+$/g, "");
  return existing.has(trimmed) ? trimmed : sanitizeDeck(trimmed);
}

export function cardPath(deck: string, id: string, front: string): string {
  return `decks/${deck}/${id.toLowerCase()}-${slugify(front)}.md`;
}

export function serializeCardFile(card: {
  id: string;
  created: string;
  front: string;
  back: string;
}): string {
  return `---\nid: ${card.id}\ncreated: ${card.created}\n---\n${card.front.trim()}\n---\n${card.back.trim()}\n`;
}

/** Build a brand-new card file from {deck, front, back}. */
export function makeCard(deck: string, front: string, back: string) {
  const id = ulid();
  const created = new Date().toISOString().slice(0, 10);
  const path = cardPath(deck, id, front);
  const content = serializeCardFile({ id, created, front, back });
  return { id, created, path, content };
}
