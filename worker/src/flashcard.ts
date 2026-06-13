/**
 * Flashcard generation — prompt construction + tolerant parsing. Pure and
 * unit-testable; the actual `env.AI.run()` call lives in index.ts.
 *
 * The quality of the whole feature lives in this prompt: small models happily
 * produce verbose, sentence-copying, recognition-testing cards unless pushed
 * hard toward one atomic recallable fact.
 */

// 70b-fp8-fast writes markedly better cards than the 8b (sharper questions,
// genuinely atomic) and still costs well under the free tier per card. Override
// to @cf/meta/llama-3.1-8b-instruct-fp8 via AI_MODEL if you want it cheaper.
export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface Flashcard {
  front: string;
  back: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const SYSTEM = `You are an expert at writing spaced-repetition flashcards. From a passage the user highlighted while reading, you write exactly ONE excellent card.

Principles:
- Test a single atomic fact. If the passage holds several, pick the most important one.
- The FRONT is a specific question that forces active recall. Never vague ("What is this about?") and never answerable with yes/no.
- The BACK is the answer only — a word, phrase, or one short sentence. No restating the question, no padding.
- Rephrase into a genuine question; never copy a sentence from the passage verbatim.
- Prefer understanding over trivia. A good card makes you think, not pattern-match.
- Markdown is allowed where it helps: \`code\`, **bold**, and $math$.

Output ONLY a minified JSON object, nothing else: {"front":"...","back":"..."}`;

export function buildMessages(
  text: string,
  opts: { title?: string; url?: string; avoid?: string } = {}
): ChatMessage[] {
  const ctx: string[] = [];
  if (opts.title) ctx.push(`Page: ${opts.title}`);
  if (opts.url) ctx.push(`URL: ${opts.url}`);
  // Cap the passage so a giant selection can't blow the context or the budget.
  const passage = text.trim().slice(0, 4000);

  let user = `${ctx.length ? ctx.join("\n") + "\n\n" : ""}Highlighted passage:\n"""\n${passage}\n"""\n\nWrite one flashcard as JSON.`;
  if (opts.avoid) {
    // Regenerate: nudge toward a different angle than the rejected card.
    user += `\n\nThe user rejected this card — make a meaningfully different one (different question or angle):\n"""\n${opts.avoid.slice(0, 500)}\n"""`;
  }
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

/**
 * Pull a {front, back} out of a model's text response. Tolerates code fences,
 * leading prose, and smart quotes; throws a clear error if nothing usable is
 * found so the endpoint can return a 502 rather than a broken card.
 */
export function parseFlashcard(raw: unknown): Flashcard {
  // Some models (e.g. 70b-fast) return `response` already parsed as an object.
  if (raw && typeof raw === "object") return validate(raw as Record<string, unknown>);
  if (!raw || typeof raw !== "string") throw new Error("empty model response");

  // Strip ```json fences and grab the first {...} block.
  const fenced = raw.replace(/```(?:json)?/gi, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model response");

  let obj: unknown;
  try {
    obj = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    throw new Error("model response was not valid JSON");
  }
  return validate(obj as Record<string, unknown>);
}

function validate(rec: Record<string, unknown>): Flashcard {
  const front = clean(rec.front);
  const back = clean(rec.back);
  if (!front) throw new Error("model produced no front");
  if (!back) throw new Error("model produced no back");
  return { front, back };
}

function clean(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/ /g, " ")
    .trim()
    .slice(0, 2000); // guard against a runaway generation
}
