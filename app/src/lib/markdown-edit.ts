/** Pure editing helpers for the card editor (Ctrl/Cmd+B, +I). */

export interface ToggleResult {
  text: string;
  selStart: number;
  selEnd: number;
}

/**
 * Toggle a markdown emphasis marker around the selection.
 *
 * - selection wrapped (markers inside or just outside) → unwrap
 * - cursor/selection INSIDE an existing span → unwrap that span
 * - otherwise → wrap (collapsed cursor lands between fresh markers)
 */
export function toggleMarker(
  text: string,
  selStart: number,
  selEnd: number,
  marker: "**" | "*"
): ToggleResult {
  const m = marker.length;
  const sel = text.slice(selStart, selEnd);
  const before = text.slice(0, selStart);
  const after = text.slice(selEnd);

  // markers included in the selection
  if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= 2 * m) {
    const inner = sel.slice(m, -m);
    return { text: before + inner + after, selStart, selEnd: selStart + inner.length };
  }
  // markers just outside the selection
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      text: before.slice(0, -m) + sel + after.slice(m),
      selStart: selStart - m,
      selEnd: selEnd - m,
    };
  }
  // cursor/selection inside an existing span → de-emphasize it
  const span = findEnclosingSpan(text, marker, selStart, selEnd);
  if (span) {
    return {
      text: text.slice(0, span.open) + text.slice(span.open + m, span.close) + text.slice(span.close + m),
      selStart: selStart - m,
      selEnd: selEnd - m,
    };
  }
  // wrap
  return {
    text: before + marker + sel + marker + after,
    selStart: selStart + m,
    selEnd: selEnd + m,
  };
}

/**
 * Find the marker pair strictly enclosing [pos, posEnd). Tokenizes so that
 * `**` and `*` don't shadow each other (`***x***` has both a bold and an
 * italic span). Pairs tokens sequentially, like markdown does in practice.
 */
function findEnclosingSpan(
  text: string,
  marker: "**" | "*",
  pos: number,
  posEnd: number
): { open: number; close: number } | null {
  const tokens: number[] = [];
  for (let i = 0; i < text.length; ) {
    if (text.startsWith("**", i)) {
      if (marker === "**") tokens.push(i);
      i += 2;
    } else if (text[i] === "*") {
      if (marker === "*") tokens.push(i);
      i += 1;
    } else {
      i += 1;
    }
  }
  for (let k = 0; k + 1 < tokens.length; k += 2) {
    const open = tokens[k];
    const close = tokens[k + 1];
    if (pos >= open + marker.length && posEnd <= close) return { open, close };
  }
  return null;
}
