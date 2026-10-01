const OPENS_AFTER = /[\s([{\u2014\u2013-]/;

/**
 * Book typography for a run of prose: curly quotes and apostrophes, `...` → …,
 * and a spaced ` -- ` → em dash. `prev` is the character before the run ("" at
 * the start of a block), so callers can carry quote direction across pieces.
 */
export function smarten(text: string, prev = ""): { text: string; last: string } {
  let out = "";
  for (const ch of text.replace(/\.\.\./g, "\u2026").replace(/ -- /g, " \u2014 ")) {
    const open = prev === "" || OPENS_AFTER.test(prev);
    if (ch === '"') out += open ? "\u201c" : "\u201d";
    else if (ch === "'") out += open ? "\u2018" : "\u2019";
    else out += ch;
    prev = ch;
  }
  return { text: out, last: prev };
}
