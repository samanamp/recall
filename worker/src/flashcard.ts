/**
 * Flashcard generation — prompt construction + tolerant parsing. Pure and
 * unit-testable; the actual `env.AI.run()` call lives in index.ts.
 *
 * A rich passage holds several separable ideas, so we ask for 1–4 atomic cards
 * (never one bloated card — that's a leech FSRS can't schedule) and push the
 * model toward the load-bearing insight rather than the easiest definition.
 */

// 70b-fp8-fast writes markedly better cards than the 8b (sharper questions,
// genuinely atomic) and still costs well under the free tier per card. Override
// to @cf/meta/llama-3.1-8b-instruct-fp8 via AI_MODEL if you want it cheaper.
export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Upper bound on cards per selection — keeps the preview and budget sane. */
export const MAX_CARDS = 5;

export interface Flashcard {
  front: string;
  back: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const SYSTEM = `You are an expert at writing spaced-repetition flashcards. From a passage the user highlighted while reading, extract the ideas worth remembering and write one atomic card for each.

Principles:
- Write 1 to 4 cards: ONE card per distinct idea that's worth remembering on its own. Don't split a single idea across cards, and don't pad a thin passage to hit a number — a short or simple selection may yield just one card.
- Bias toward the load-bearing insight — the mechanism, the consequence, the non-obvious "why" you'd still want in six months — not the easiest definition. If the passage defines a term AND explains why it matters, the "why" is usually the better card.
- Each FRONT is a specific question that forces active recall: never vague ("What is this about?"), never answerable yes/no.
- Each BACK is the answer only — a word, phrase, or one short sentence. One atomic fact per card; never cram several facts into one back.
- Rephrase into genuine questions; never copy a sentence from the passage verbatim.
- Markdown is allowed where it helps: \`code\`, **bold**, and $math$.

Output ONLY a JSON array, nothing else: [{"front":"...","back":"..."}, ...]`;

export function buildMessages(
  text: string,
  opts: { title?: string; url?: string; avoid?: string } = {}
): ChatMessage[] {
  const ctx: string[] = [];
  if (opts.title) ctx.push(`Page: ${opts.title}`);
  if (opts.url) ctx.push(`URL: ${opts.url}`);
  // Cap the passage so a giant selection can't blow the context or the budget.
  const passage = text.trim().slice(0, 4000);

  let user = `${ctx.length ? ctx.join("\n") + "\n\n" : ""}Highlighted passage:\n"""\n${passage}\n"""\n\nWrite the flashcards as a JSON array.`;
  if (opts.avoid) {
    // Regenerate: nudge toward different angles than the rejected set.
    user += `\n\nThe user rejected these — produce a meaningfully different set (different questions or angles):\n"""\n${opts.avoid.slice(0, 800)}\n"""`;
  }
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

/**
 * Pull a list of {front, back} cards out of a model response. Tolerates a bare
 * array, a {cards:[...]} wrapper, a single object, code fences, leading prose,
 * and smart quotes. Skips malformed entries; throws only if nothing usable is
 * found so the endpoint can return a clean 502.
 */
export function parseFlashcards(raw: unknown): Flashcard[] {
  const data = typeof raw === "string" ? extractJson(raw) : raw;

  let list: unknown[];
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === "object" && Array.isArray((data as { cards?: unknown[] }).cards)) {
    list = (data as { cards: unknown[] }).cards;
  } else if (data && typeof data === "object") {
    list = [data]; // a single object — wrap it
  } else {
    throw new Error("no cards in model response");
  }

  const cards = list
    .map((c) => tryCard(c))
    .filter((c): c is Flashcard => c !== null)
    .slice(0, MAX_CARDS);
  if (cards.length === 0) throw new Error("model produced no usable cards");
  return cards;
}

/** Find the JSON value in a text blob: prefer an array, fall back to an object. */
function extractJson(raw: string): unknown {
  if (!raw) throw new Error("empty model response");
  const s = raw.replace(/```(?:json)?/gi, "");
  const tryParse = (open: string, close: string): unknown | undefined => {
    const a = s.indexOf(open);
    const b = s.lastIndexOf(close);
    if (a === -1 || b <= a) return undefined;
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch {
      return undefined;
    }
  };
  const arr = tryParse("[", "]");
  if (arr !== undefined) return arr;
  const obj = tryParse("{", "}");
  if (obj !== undefined) return obj;
  throw new Error("no JSON found in model response");
}

/** Validate one entry, returning null (not throwing) so a bad card is skipped. */
function tryCard(v: unknown): Flashcard | null {
  if (!v || typeof v !== "object") return null;
  const front = clean((v as Record<string, unknown>).front);
  const back = clean((v as Record<string, unknown>).back);
  return front && back ? { front, back } : null;
}

function clean(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/ /g, " ")
    .trim()
    .slice(0, 2000); // guard against a runaway generation
}
