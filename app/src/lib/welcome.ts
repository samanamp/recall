import { saveCard } from "./actions";
import { db, kvGet, kvSet } from "./db";

/**
 * First run on a genuinely empty collection: seed a small deck that teaches
 * the app by being cards. Existing users (any cards, or a pull in flight)
 * just get the flag set so this never fires again.
 */
const CARDS: { front: string; back: string }[] = [
  {
    front: "Welcome to **recall** 👋\n\nHow does reviewing work?",
    back:
      "Cards become **due** on a schedule ([FSRS](https://github.com/open-spaced-repetition)) " +
      "that adapts to you.\n\nOpen **Review**, recall the answer, then grade yourself: " +
      "**Again · Hard · Good · Easy**. Honest grading = better scheduling.\n\n" +
      "Keyboard: **Space** reveals, **1–4** grades, **Z** undoes.",
  },
  {
    front: "Where do my cards actually *live*?",
    back:
      "As markdown files in **your GitHub repo**, one file per card:\n\n" +
      "```\ndecks/<deck>/<id>-<slug>.md\n```\n\n" +
      "Edit them here or directly on GitHub — they sync both ways. " +
      "Decks are just folders. Your data is yours, forever, in plain text.",
  },
  {
    front: "How do I write a card?",
    back:
      "Front, a `---` line, back:\n\n```\nWhat does `Box<T>` do in Rust?\n---\nHeap-allocates `T`.\n```\n\n" +
      "Full markdown works: **bold**, `code`, fenced blocks with highlighting, " +
      "$\\KaTeX$ math, and images — just paste or drop them into the editor.",
  },
  {
    front: "Done with this tour?",
    back:
      "Delete the *welcome* deck in **Browse** (or delete its folder in your repo).\n\n" +
      "Then add your first real card — small cards, one fact each, beat big ones. " +
      "Happy recalling ✌️",
  },
];

export async function maybeSeedWelcome(): Promise<void> {
  if (await kvGet<boolean>("welcomeSeeded")) return;
  const existing = (await db.cards.count()) > 0 || (await db.pendingFiles.count()) > 0;
  await kvSet("welcomeSeeded", true);
  if (existing) return;
  for (const c of CARDS) await saveCard({ deck: "welcome", ...c });
}
