import { ulid } from "ulid";
import type { CardRow } from "./db";

/**
 * Card file format (SPEC §3):
 *
 *   ---
 *   id: <ULID>
 *   created: <ISO date>
 *   ---
 *   front markdown
 *   ---
 *   back markdown
 */

export interface ParsedCard {
  id: string;
  created: string;
  front: string;
  back: string;
  /** False if the file had no id (hand-authored) and one was generated. */
  hadId: boolean;
}

/** Parse a card file. Tolerates a missing frontmatter block (generates an id). */
export function parseCardFile(text: string): ParsedCard {
  const lines = text.split("\n");
  let id = "";
  let created = "";
  let bodyStart = 0;

  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const m = line.match(/^(\w+):\s*(.*)$/);
        if (m?.[1] === "id") id = m[2].trim();
        if (m?.[1] === "created") created = m[2].trim();
      }
      bodyStart = end + 1;
    }
  }

  const body = lines.slice(bodyStart);
  const split = body.findIndex((l) => l.trim() === "---");
  const front = body.slice(0, split === -1 ? body.length : split).join("\n").trim();
  const back = split === -1 ? "" : body.slice(split + 1).join("\n").trim();

  return {
    id: id || ulid(),
    created: created || new Date().toISOString().slice(0, 10),
    front,
    back,
    hadId: Boolean(id),
  };
}

export function serializeCardFile(card: Pick<CardRow, "id" | "created" | "front" | "back">): string {
  return `---\nid: ${card.id}\ncreated: ${card.created}\n---\n${card.front.trim()}\n---\n${card.back.trim()}\n`;
}

export function deckFromPath(path: string): string {
  // decks/<deck>/<file>.md — nested folders flatten with "/" kept in the name
  const parts = path.split("/");
  return parts.slice(1, -1).join("/") || "default";
}

export function cardPath(deck: string, id: string, front: string): string {
  return `decks/${deck}/${id.toLowerCase()}-${slugify(front)}.md`;
}

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
