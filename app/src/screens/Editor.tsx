import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import Markdown from "../components/Markdown";
import { addMedia, deleteCard, saveCard } from "../lib/actions";
import { splitFrontBack } from "../lib/cardfile";
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
  const [chosenDeck, setDeck] = useState("");
  // New cards preselect the last deck used (once decks have loaded).
  const [lastDeck] = useState(() => (id ? null : localStorage.getItem("lastDeck")));
  // New-card drafts survive accidental navigation; edit mode loads from the card.
  const [text, setText] = useState(() => (id ? "" : localStorage.getItem("editorDraft") ?? ""));
  const [mobileTab, setMobileTab] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const decks = useLiveQuery(
    async () => (await db.decks.toArray()).map((d) => d.name).sort(),
    [],
    [] as string[]
  );
  const [dragging, setDragging] = useState(false);
  const [newDeckMode, setNewDeckMode] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [justAdded, setJustAdded] = useState(false);

  useEffect(() => {
    if (!id) return;
    void db.cards.get(id).then((card) => {
      if (card) {
        setDeck(card.deck);
        setText(`${card.front}\n---\n${card.back}`);
      }
    });
  }, [id]);

  useEffect(() => {
    if (!id) localStorage.setItem("editorDraft", text);
  }, [id, text]);

  const deck = chosenDeck || (lastDeck && decks.includes(lastDeck) ? lastDeck : "");

  const { front, back } = splitFrontBack(text);

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
    } else if (key === "enter") {
      e.preventDefault();
      void onSave();
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
    if (!deck.trim() || !front || saving) return;
    setSaving(true);
    localStorage.setItem("lastDeck", deck.trim());
    await saveCard({ id, deck: deck.trim(), front, back });
    if (id) {
      navigate(-1);
    } else {
      setText("");
      setSaving(false);
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1200);
      textareaRef.current?.focus();
    }
  }

  /** Deleting drops the card and its review history; the repo file goes on next sync. */
  async function onDelete() {
    if (!id || deleting) return;
    setDeleting(true);
    await deleteCard(id);
    navigate(-1);
  }

  const valid = deck.trim() !== "" && front !== "";
  const needsDeck = deck.trim() === "" && text.trim() !== "";

  const chip = (active: boolean) =>
    `flex h-10 shrink-0 items-center gap-1.5 rounded-full sm:h-9 border px-3.5 text-13 font-medium transition-colors ${
      active
        ? "border-accent-rule bg-accent-soft text-accent"
        : "border-hairline bg-paper text-ink-2 hover:border-hairline-strong hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-display font-semibold tracking-tight">{id ? "Edit card" : "New card"}</h1>
        <div className="ml-auto flex items-center gap-1">
          {id && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="h-10 rounded-md px-3 text-sm font-medium text-muted transition-colors hover:bg-danger-soft hover:text-danger"
            >
              Delete
            </button>
          )}
          <button
            onClick={() => void onSave()}
            disabled={(!valid || saving) && !justAdded}
            className={`h-10 rounded-md px-5 text-sm font-semibold transition-colors disabled:opacity-40 ${
              justAdded
                ? "bg-ok-soft text-ok ring-1 ring-ok/40"
                : "bg-accent-fill text-on-accent hover:bg-accent-fill-hover"
            }`}
          >
            {justAdded ? "Added ✓" : id ? "Save" : "Add card"}
          </button>
        </div>
      </div>

      {id && confirmDelete && (
        <div
          role="alertdialog"
          aria-label="Delete this card?"
          className="flex flex-wrap items-center gap-3 rounded-md border border-danger/30 bg-danger-soft px-4 py-3"
        >
          <span className="text-sm text-danger">
            Delete this card and its review history? The file stays in git history, but the app
            can’t undo this.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="h-10 rounded-md px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-paper disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={() => void onDelete()}
              disabled={deleting}
              className="h-10 rounded-md bg-danger-fill px-4 text-sm font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete card"}
            </button>
          </div>
        </div>
      )}

      {/* deck picker: chips beat a datalist, especially on mobile */}
      <div>
        <div className="label-caps mb-2 text-muted">Deck</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[...new Set(deck && !decks.includes(deck) ? [...decks, deck] : decks)].map((d) => (
            <button
              key={d}
              aria-pressed={deck === d}
              onClick={() => {
                setDeck(d);
                setNewDeckMode(false);
              }}
              className={chip(deck === d)}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: deckColor(d) }} aria-hidden />
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
                aria-label="New deck name"
                className="h-10 w-36 rounded-full sm:h-9 border border-accent-rule bg-paper px-3.5 text-13 outline-none placeholder:text-faint"
              />
            </form>
          ) : (
            <button
              onClick={() => setNewDeckMode(true)}
              className="flex h-10 items-center rounded-full border border-dashed sm:h-9 border-hairline-strong px-3.5 text-13 font-medium text-muted transition-colors hover:border-accent-rule hover:text-accent"
            >
              + New deck
            </button>
          )}
        </div>
      </div>

      {needsDeck && (
        <p role="status" className="text-13 font-medium text-warn">
          Pick a deck above — the card can't be saved without one.
        </p>
      )}

      {/* mobile: write/preview tabs */}
      <div className="inline-flex self-start rounded-md border border-hairline bg-sunken p-0.5 sm:hidden" role="tablist">
        {(["write", "preview"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={mobileTab === t}
            onClick={() => setMobileTab(t)}
            className={`h-10 rounded-[5px] px-4 text-sm font-medium capitalize sm:h-9 ${
              mobileTab === t ? "bg-paper text-ink shadow-sm" : "text-muted"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="hidden grid-cols-2 gap-4 sm:grid">
        <span className="label-caps text-muted">
          Write <span className="font-medium normal-case tracking-normal text-faint">· front, ---, back · ⌘B bold · ⌘I italic · ⌘⏎ save</span>
        </span>
        <span className="label-caps text-muted">Preview</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
          aria-label="Card markdown: front, a --- line, then back"
          spellCheck={false}
          className={`min-h-[50dvh] w-full resize-y rounded-md border bg-paper p-4 font-mono text-[0.8125rem] leading-relaxed text-ink outline-none placeholder:text-faint focus:border-accent-rule ${
            dragging ? "border-accent-rule ring-2 ring-accent-rule/30" : "border-hairline"
          } ${mobileTab === "preview" ? "hidden sm:block" : ""}`}
        />
        <div
          className={`index-card index-card--ruled min-h-[50dvh] overflow-auto px-5 pb-6 pt-5 ${
            mobileTab === "write" ? "hidden sm:block" : ""
          }`}
        >
          {front ? (
            <Markdown text={front} className="card-front text-[1.25rem]!" />
          ) : (
            <p className="font-serif text-[1.25rem] italic text-faint">Front preview</p>
          )}
          <div className="answer-rule label-caps -mr-5 mb-4 mt-6">Answer</div>
          {back ? (
            <Markdown text={back} className="card-back text-base!" />
          ) : (
            <p className="font-serif italic text-faint">Back preview</p>
          )}
        </div>
      </div>
    </div>
  );
}
