import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import Markdown from "../components/Markdown";
import { addMedia, saveCard } from "../lib/actions";
import { db } from "../lib/db";
import { syncAll } from "../lib/sync";

/**
 * One markdown textarea per card: front, a `---` line, back.
 * Paste an image → uploaded to media/, reference inserted.
 */
export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [deck, setDeck] = useState("");
  const [text, setText] = useState("");
  const [mobileTab, setMobileTab] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const decks = useLiveQuery(
    async () => [...new Set((await db.cards.toArray()).map((c) => c.deck))].sort(),
    [],
    [] as string[]
  );

  useEffect(() => {
    if (!id) return;
    void db.cards.get(id).then((card) => {
      if (card) {
        setDeck(card.deck);
        setText(`${card.front}\n---\n${card.back}`);
      }
    });
  }, [id]);

  const split = text.split(/\n---\s*\n/, 2);
  const front = split[0]?.trim() ?? "";
  const back = split[1]?.trim() ?? "";

  async function onPaste(e: React.ClipboardEvent) {
    const file = [...e.clipboardData.items]
      .find((i) => i.type.startsWith("image/"))
      ?.getAsFile();
    if (!file) return; // plain text pastes untouched — that's the point
    e.preventDefault();
    const path = await addMedia(file);
    const ta = textareaRef.current!;
    const at = ta.selectionStart;
    const ref = `![](../../${path})`;
    setText(text.slice(0, at) + ref + text.slice(at));
    void syncAll();
  }

  async function onSave() {
    if (!deck.trim() || !front) return;
    setSaving(true);
    await saveCard({ id, deck: deck.trim(), front, back });
    void syncAll();
    if (id) {
      navigate(-1);
    } else {
      setText("");
      setSaving(false);
      textareaRef.current?.focus();
    }
  }

  const valid = deck.trim() !== "" && front !== "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          list="deck-list"
          value={deck}
          onChange={(e) => setDeck(e.target.value)}
          placeholder="Deck name"
          className="w-48 rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-zinc-700"
        />
        <datalist id="deck-list">
          {decks.map((d) => <option key={d} value={d} />)}
        </datalist>
        <button
          onClick={() => void onSave()}
          disabled={!valid || saving}
          className="ml-auto rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
        >
          {id ? "Save" : "Add card"}
        </button>
      </div>

      {/* mobile: write/preview tabs */}
      <div className="flex gap-1 sm:hidden">
        {(["write", "preview"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMobileTab(t)}
            className={`rounded-lg px-3 py-1 text-sm capitalize ${
              mobileTab === t
                ? "bg-zinc-200 dark:bg-zinc-800"
                : "text-zinc-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          placeholder={
            "Front of the card (markdown, $math$, ```code```)…\n---\nBack of the card. Paste images directly."
          }
          spellCheck={false}
          className={`min-h-[50dvh] w-full resize-y rounded-xl border border-zinc-200 bg-white p-3 font-mono text-sm shadow-sm outline-none focus:border-sky-500 dark:border-zinc-800 dark:bg-zinc-900/70 ${
            mobileTab === "preview" ? "hidden sm:block" : ""
          }`}
        />
        <div
          className={`min-h-[50dvh] overflow-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70 ${
            mobileTab === "write" ? "hidden sm:block" : ""
          }`}
        >
          <Markdown text={front || "*front preview*"} />
          <hr className="my-3 border-dashed border-zinc-300 dark:border-zinc-700" />
          <Markdown text={back || "*back preview*"} />
        </div>
      </div>
    </div>
  );
}
