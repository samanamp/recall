import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import Markdown from "../components/Markdown";
import { addMedia, saveCard } from "../lib/actions";
import { db } from "../lib/db";
import { deckColor } from "../lib/deck-color";
import { toggleMarker } from "../lib/markdown-edit";

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
  const [newDeckMode, setNewDeckMode] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");

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

  /** Wrap/unwrap markdown emphasis (Ctrl/Cmd+B, +I) — logic in markdown-edit.ts. */
  function toggleWrap(marker: "**" | "*") {
    const ta = textareaRef.current;
    if (!ta) return;
    const r = toggleMarker(text, ta.selectionStart, ta.selectionEnd, marker);
    setText(r.text);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(r.selStart, r.selEnd);
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "b") {
      e.preventDefault();
      toggleWrap("**");
    } else if (key === "i") {
      e.preventDefault();
      toggleWrap("*");
    }
  }

  /** Store the image, insert its markdown reference at the cursor. */
  async function insertImage(file: File | Blob) {
    const path = await addMedia(file);
    const at = textareaRef.current?.selectionStart ?? text.length;
    const ref = `![](../../${path})`;
    setText((t) => t.slice(0, at) + ref + t.slice(at));
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
        <button
          onClick={() => void onSave()}
          disabled={!valid || saving}
          className="ml-auto rounded-xl bg-sky-600 px-5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-500 disabled:opacity-40"
        >
          {id ? "Save" : "Add card"}
        </button>
      </div>

      {/* deck picker: chips beat a datalist, especially on mobile */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[...new Set(deck && !decks.includes(deck) ? [...decks, deck] : decks)].map((d) => (
          <button
            key={d}
            onClick={() => {
              setDeck(d);
              setNewDeckMode(false);
            }}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              deck === d
                ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: deckColor(d) }} />
            {d}
          </button>
        ))}
        {newDeckMode ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = newDeckName.trim();
              if (name) setDeck(name);
              setNewDeckMode(false);
              setNewDeckName("");
            }}
          >
            <input
              autoFocus
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setNewDeckMode(false)}
              onBlur={() => setNewDeckMode(false)}
              placeholder="deck name ⏎"
              className="w-32 rounded-full border border-sky-500 bg-white px-3 py-1 text-xs outline-none dark:bg-zinc-900"
            />
          </form>
        ) : (
          <button
            onClick={() => setNewDeckMode(true)}
            className="rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-sky-400 hover:text-sky-500 dark:border-zinc-700"
          >
            + new deck
          </button>
        )}
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
        <span>Write — front, ---, back · ⌘B bold · ⌘I italic</span>
        <span>Preview</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
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
