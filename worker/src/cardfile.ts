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

/** Sanitize a deck name to a safe folder (mirrors actions.ts createDeck). */
export function sanitizeDeck(name: string): string {
  return (name ?? "").trim().replace(/\.\./g, "").replace(/^\/+|\/+$/g, "");
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
