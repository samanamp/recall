/**
 * The preview overlay — the feature's quality gate. A selection yields 1–4
 * atomic cards, shown editable; you trim and tweak, nothing saves until you
 * confirm. Rendered in a shadow root so the host page's CSS can't touch it.
 * All network goes through the background worker (the app token never reaches
 * this context).
 */
(() => {
  const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));
  let host, root, els, source;

  function onShow(msg) {
    if (msg.type !== "recall:show") return;
    source = { text: msg.text, title: msg.title, url: msg.url };
    open();
    void generate();
    void loadDecks();
  }

  // Replace any listener left by a prior injection (including an older version
  // of this script after an extension update), so re-injection always runs the
  // current code exactly once — no duplicate panels, no stale handler winning.
  if (window.__recallShow) chrome.runtime.onMessage.removeListener(window.__recallShow);
  window.__recallShow = onShow;
  chrome.runtime.onMessage.addListener(onShow);

  function open() {
    if (host) close();
    host = document.createElement("div");
    host.id = "recall-overlay-host";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    document.documentElement.appendChild(host);

    els = {
      panel: root.querySelector(".panel"),
      status: root.querySelector(".status"),
      deck: root.querySelector(".deck"),
      decklist: root.querySelector("#recall-decks"),
      list: root.querySelector(".list"),
      regen: root.querySelector(".regen"),
      save: root.querySelector(".save"),
    };

    root.querySelector(".close").addEventListener("click", close);
    els.regen.addEventListener("click", () => void generate(currentFronts()));
    els.save.addEventListener("click", () => void saveCards());
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void saveCards();
      }
    });
  }

  function close() {
    host?.remove();
    host = root = els = null;
  }

  function setBusy(busy, label) {
    if (!els) return;
    if (label != null) els.status.textContent = label;
    els.list.style.opacity = busy ? "0.5" : "1";
    els.regen.disabled = els.save.disabled = busy;
  }

  async function generate(avoid) {
    setBusy(true, avoid ? "Rewriting…" : "Reading the selection…");
    els.list.innerHTML = "";
    const r = await send({ type: "recall:generate", ...source, avoid });
    if (!els) return; // closed while waiting
    if (!r?.ok) {
      setBusy(false, `⚠ ${r?.error || "generation failed"}`);
      return;
    }
    // Tolerate response-shape skew (e.g. a stale background service worker after
    // an extension update): accept {cards}, a wrapped {card:{cards}}, or a single
    // {card:{front,back}} — and never fail silently into an empty panel.
    const cards = Array.isArray(r.cards)
      ? r.cards
      : Array.isArray(r.card?.cards)
        ? r.card.cards
        : r.card?.front
          ? [r.card]
          : [];
    if (cards.length === 0) {
      setBusy(false, "⚠ No cards came back. Reload the extension at chrome://extensions, reload this page, and try again.");
      return;
    }
    renderCards(cards);
    setBusy(false, "Review, trim, save — ⌘⏎ / Esc");
    els.list.querySelector("textarea")?.focus();
  }

  function renderCards(cards) {
    els.list.innerHTML = "";
    for (const card of cards) addCard(card);
    refreshCount();
  }

  function addCard(card) {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <button class="drop" title="Remove this card">×</button>
      <label>Front</label><textarea class="front" rows="2"></textarea>
      <label>Back</label><textarea class="back" rows="2"></textarea>`;
    item.querySelector(".front").value = card.front || "";
    item.querySelector(".back").value = card.back || "";
    item.querySelector(".drop").addEventListener("click", () => {
      item.remove();
      refreshCount();
    });
    els.list.appendChild(item);
  }

  function items() {
    return [...els.list.querySelectorAll(".item")];
  }

  function collect() {
    return items()
      .map((it) => ({
        front: it.querySelector(".front").value.trim(),
        back: it.querySelector(".back").value.trim(),
      }))
      .filter((c) => c.front);
  }

  function currentFronts() {
    return collect()
      .map((c) => c.front)
      .join("\n");
  }

  function refreshCount() {
    if (!els) return;
    const n = items().length;
    els.save.textContent = n > 1 ? `Save ${n}` : "Save";
    els.save.disabled = n === 0;
  }

  async function loadDecks() {
    const r = await send({ type: "recall:decks" });
    if (!els || !r?.ok) return;
    els.decklist.innerHTML = (r.decks || []).map((d) => `<option value="${esc(d)}">`).join("");
    if (!els.deck.value) els.deck.value = r.lastDeck || r.decks?.[0] || "inbox";
  }

  async function saveCards() {
    if (!els) return;
    const deck = els.deck.value.trim();
    const cards = collect();
    if (!deck) return void (els.status.textContent = "⚠ pick a deck");
    if (cards.length === 0) return void (els.status.textContent = "⚠ nothing to save");
    setBusy(true, `Saving ${cards.length}…`);
    const r = await send({ type: "recall:save", deck, cards });
    if (!els) return;
    if (!r?.ok) {
      setBusy(false, `⚠ ${r?.error || "save failed"}`);
      return;
    }
    els.panel.classList.add("done");
    els.status.textContent =
      `✓ Added ${r.saved} to ${deck}` + (r.error ? ` (${cards.length - r.saved} failed)` : "");
    setTimeout(close, 1200);
  }

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const TEMPLATE = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed; top: 16px; right: 16px; z-index: 2147483647;
        display: flex; flex-direction: column;
        width: 390px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        color: #e4e4e7; background: #18181b;
        border: 1px solid #3f3f46; border-radius: 16px;
        box-shadow: 0 16px 40px rgba(0,0,0,.5); overflow: hidden;
      }
      .panel.done { border-color: #10b981; }
      .head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #27272a; flex: none; }
      .brand { font-weight: 700; letter-spacing: -.01em; }
      .brand b { color: #38bdf8; }
      .deck {
        margin-left: auto; width: 150px; padding: 5px 9px; color: #e4e4e7;
        background: #27272a; border: 1px solid #3f3f46; border-radius: 8px; font: inherit; outline: none;
      }
      .deck:focus { border-color: #38bdf8; }
      .close { background: none; border: 0; color: #71717a; font-size: 18px; cursor: pointer; padding: 0 2px; line-height: 1; }
      .close:hover { color: #e4e4e7; }
      .list { padding: 10px 14px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; transition: opacity .15s; }
      .item { position: relative; padding: 10px; background: #1f1f23; border: 1px solid #2e2e33; border-radius: 12px; }
      .drop { position: absolute; top: 6px; right: 6px; background: none; border: 0; color: #52525b; font-size: 15px; line-height: 1; cursor: pointer; padding: 2px 4px; }
      .drop:hover { color: #f87171; }
      label { display: block; font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #71717a; margin: 0 0 3px; }
      .item label:nth-of-type(2) { margin-top: 7px; }
      textarea {
        width: 100%; box-sizing: border-box; resize: vertical; color: #fafafa;
        background: #27272a; border: 1px solid #3f3f46; border-radius: 9px; padding: 7px 9px;
        font: inherit; outline: none; min-height: 38px;
      }
      textarea:focus { border-color: #38bdf8; }
      .foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid #27272a; flex: none; }
      .status { font-size: 12px; color: #a1a1aa; flex: 1; min-width: 0; }
      button.act { padding: 6px 14px; border-radius: 9px; font: inherit; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
      button.act:disabled { opacity: .45; cursor: default; }
      .regen { background: #27272a; color: #e4e4e7; border-color: #3f3f46; }
      .regen:hover:not(:disabled) { border-color: #52525b; }
      .save { background: #0284c7; color: #fff; }
      .save:hover:not(:disabled) { background: #0369a1; }
    </style>
    <div class="panel" part="panel">
      <div class="head">
        <span class="brand">re<b>call</b></span>
        <input class="deck" list="recall-decks" placeholder="deck" spellcheck="false" />
        <datalist id="recall-decks"></datalist>
        <button class="close" title="Close (Esc)">×</button>
      </div>
      <div class="list"></div>
      <div class="foot">
        <span class="status">Reading the selection…</span>
        <button class="act regen" title="Generate a different set">↻ Regenerate</button>
        <button class="act save" title="Save (⌘⏎)">Save</button>
      </div>
    </div>`;
})();
