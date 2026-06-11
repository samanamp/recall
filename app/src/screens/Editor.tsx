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
    async () => (await db.decks.toArray()).map((d) => d.name).sort(),
    [],
    [] as string[]
  );
  const [dragging, setDragging] = useState(false);

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

  /** Store the image, insert its markdown reference at the cursor. */
  async function insertImage(file: File | Blob) {
    const path = await addMedia(file);
    const at = textareaRef.current?.selectionStart ?? text.length;
    const ref = `![](../../${path})`;
    setText((t) => t.slice(0, at) + ref + t.slice(at));
    void syncAll();
  }

  async function onPaste(e: React.ClipboardEvent) {
    const file = [...e.clipboardData.items]
      .find((i) => i.type.startsWith("image/"))
      ?.getAsFile();
    if (!file) return; // plain text pastes untouched — that's the point
    e.preventDefault();
    await insertImage(file);
  }

  async function onDrop(e: React.DragEvent) {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    setDragging(false);
    for (const f of files) await insertImage(f);
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
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">{id ? "Edit card" : "New card"}</h1>
        <input
          list="deck-list"
          value={deck}
          onChange={(e) => setDeck(e.target.value)}
          placeholder="Deck"
          className="ml-auto w-40 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-sky-500 dark:border-zinc-800 dark:bg-zinc-900/70"
        />
        <datalist id="deck-list">
          {decks.map((d) => <option key={d} value={d} />)}
        </datalist>
        <button
          onClick={() => void onSave()}
          disabled={!valid || saving}
          className="rounded-xl bg-sky-600 px-5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-500 disabled:opacity-40"
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

      <div className="hidden grid-cols-2 gap-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 sm:grid">
        <span>Write — front, ---, back</span>
        <span>Preview</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => {
            if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          placeholder={
            "Front of the card (markdown, $math$, ```code```)…\n---\nBack of the card. Paste or drop images directly."
          }
          spellCheck={false}
          className={`min-h-[50dvh] w-full resize-y rounded-xl border bg-white p-3 font-mono text-sm shadow-sm outline-none focus:border-sky-500 dark:bg-zinc-900/70 ${
            dragging
              ? "border-sky-500 ring-2 ring-sky-500/30"
              : "border-zinc-200 dark:border-zinc-800"
          } ${mobileTab === "preview" ? "hidden sm:block" : ""}`}
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
