/**
 * Pure conversion logic for Anki .apkg imports — everything here is
 * unit-testable in node. The browser-only parts (unzip, sql.js, media blobs)
 * live in apkg.ts.
 *
 * Hard-won mapping rules (see CLAUDE.md):
 * - Key everything by cards.id (cid), NOT notes.id — they usually match but
 *   cids can drift, and a mismatch silently drops that card's revlog.
 * - Anki v3 ease is 1-4 for every review type: identity mapping, no remap.
 */

export interface AnkiNote {
  id: number;
  flds: string; // fields joined by \x1f
}

export interface AnkiCard {
  id: number; // cid — also the creation timestamp in ms
  nid: number;
  did: number;
  ord: number;
}

export interface AnkiCollection {
  notes: AnkiNote[];
  cards: AnkiCard[];
  deckNames: Map<number, string>; // did → "Parent::Child"
}

export interface MappedCard {
  id: string; // deterministic pseudo-ULID from cid
  cid: number;
  deck: string;
  front: string;
  back: string;
}

// ---------------------------------------------------------------- ids

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford, same as ulid

/**
 * Deterministic pseudo-ULID from an Anki card id. The time half encodes the
 * cid (which IS the card's creation time in ms), so imported ids sort
 * naturally; the random half is a PRNG seeded by the cid, so re-importing
 * the same .apkg yields the same ids and updates instead of duplicating.
 */
export function ankiCardId(cid: number): string {
  let t = cid;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const MASK = (1n << 64n) - 1n;
  let x = (BigInt(cid) * 2862933555777941757n + 3037000493n) & MASK;
  let rest = "";
  for (let i = 0; i < 16; i++) {
    x = (x * 6364136223846793005n + 1442695040888963407n) & MASK;
    rest += B32[Number(x >> 59n)];
  }
  return time + rest;
}

// ---------------------------------------------------------------- html → md

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"); // last, so &amp;lt; doesn't double-decode
}

/** Best-effort Anki-HTML → markdown. Media refs come out as ![](<original name>). */
export function htmlToMarkdown(html: string): string {
  let s = html;
  s = s.replace(/\[sound:[^\]]*\]/g, ""); // audio is not supported
  // TeX notations → KaTeX delimiters
  s = s.replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, (_, x: string) => `$$${x}$$`);
  s = s.replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, (_, x: string) => `$${x}$`);
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, x: string) => `$${x.trim()}$`);
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, x: string) => `$$${x.trim()}$$`);
  // structure → newlines
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(div|p|li|ul|ol|h[1-6]|blockquote|tr)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "- ");
  // code first (so emphasis markers inside it survive literally)
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, x: string) => `\n\`\`\`\n${stripTags(x)}\n\`\`\`\n`);
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, x: string) => `\`${stripTags(x)}\``);
  s = s.replace(/<\/?(b|strong)(\s[^>]*)?>/gi, "**");
  s = s.replace(/<\/?(i|em)(\s[^>]*)?>/gi, "*");
  // src may be quoted (spaces in Anki media names are common) or bare
  s = s.replace(
    /<img[^>]*src=(?:"([^"]*)"|'([^']*)'|([^"'\s>]+))[^>]*>/gi,
    (_, d?: string, q?: string, bare?: string) => `![](${d ?? q ?? bare ?? ""})`
  );
  s = stripTags(s);
  s = decodeEntities(s);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------- cloze

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function isCloze(flds: string): boolean {
  CLOZE.lastIndex = 0;
  return CLOZE.test(flds);
}

/** Blank out this card's cloze (hint shown if present), reveal the others. */
export function clozeFront(text: string, ord: number): string {
  return text.replace(CLOZE, (_, n: string, ans: string, hint?: string) =>
    Number(n) === ord + 1 ? `**[${hint || "…"}]**` : ans
  );
}

export function clozeBack(text: string): string {
  return text.replace(CLOZE, (_, _n: string, ans: string) => `**${ans}**`);
}

// ---------------------------------------------------------------- decks

/** "Parent::Child" → "Parent/Child", path-safe. */
export function ankiDeckName(name: string): string {
  const segs = name
    .split("::")
    .map((s) => s.replace(/[\\:*?"<>|]/g, "").replace(/^[\s.]+|[\s.]+$/g, ""))
    .filter(Boolean);
  return segs.join("/") || "imported";
}

// ---------------------------------------------------------------- mapping

export function mapAnkiCards(col: AnkiCollection): { cards: MappedCard[]; skipped: number } {
  const notes = new Map(col.notes.map((n) => [n.id, n]));
  const out: MappedCard[] = [];
  let skipped = 0;

  for (const card of col.cards) {
    const note = notes.get(card.nid);
    if (!note) {
      skipped++;
      continue;
    }
    const fields = note.flds.split("\x1f");
    let front: string;
    let back: string;
    if (isCloze(note.flds)) {
      front = htmlToMarkdown(clozeFront(fields[0] ?? "", card.ord));
      back = htmlToMarkdown(clozeBack(fields[0] ?? ""));
    } else if (card.ord === 1 && fields[1]) {
      // Basic (and reversed): ord 1 is the back→front direction.
      front = htmlToMarkdown(fields[1]);
      back = htmlToMarkdown(fields[0] ?? "");
    } else {
      front = htmlToMarkdown(fields[0] ?? "");
      back = htmlToMarkdown(fields.slice(1).filter(Boolean).join("\n\n"));
    }
    if (!front) {
      skipped++;
      continue;
    }
    out.push({
      id: ankiCardId(card.id),
      cid: card.id,
      deck: ankiDeckName(col.deckNames.get(card.did) ?? "imported"),
      front,
      back,
    });
  }
  return { cards: out, skipped };
}

/** Media names referenced from converted markdown (skips http/already-repo refs). */
export function referencedMedia(cards: MappedCard[]): Set<string> {
  const names = new Set<string>();
  for (const c of cards) {
    for (const m of `${c.front}\n${c.back}`.matchAll(/!\[\]\(([^)]+)\)/g)) {
      const src = m[1];
      if (!/^(https?:|data:|\.\.\/)/.test(src)) names.add(src);
    }
  }
  return names;
}
