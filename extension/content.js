/**
 * The preview overlay — the feature's quality gate. Generated cards are shown
 * editable; nothing is saved until you confirm. Rendered in a shadow root so
 * the host page's CSS can't touch it. All network goes through the background
 * worker (the app token never reaches this context).
 */
(() => {
  if (window.__recallReady) return; // guard re-injection
  window.__recallReady = true;

  const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));
  let host, root, els, source;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "recall:show") {
      source = { text: msg.text, title: msg.title, url: msg.url };
      open();
      void generate();
      void loadDecks();
    }
  });

  function open() {
    if (host) {
      close();
    }
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
      front: root.querySelector(".front"),
      back: root.querySelector(".back"),
      regen: root.querySelector(".regen"),
      save: root.querySelector(".save"),
      fields: root.querySelector(".fields"),
    };

    root.querySelector(".close").addEventListener("click", close);
    els.regen.addEventListener("click", () => void generate(els.front.value));
    els.save.addEventListener("click", () => void saveCard());
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void saveCard();
      }
    });
  }

  function close() {
    host?.remove();
    host = root = els = null;
  }

  function setBusy(busy, label) {
    if (!els) return;
    els.status.textContent = label || "";
    els.fields.style.opacity = busy ? "0.5" : "1";
    els.regen.disabled = els.save.disabled = busy;
  }

  async function generate(avoid) {
    setBusy(true, avoid ? "Rewriting…" : "Reading the selection…");
    const r = await send({ type: "recall:generate", ...source, avoid });
    if (!els) return; // closed while waiting
    if (!r?.ok) {
      setBusy(false);
      els.status.textContent = `⚠ ${r?.error || "generation failed"}`;
      return;
    }
    els.front.value = r.card.front;
    els.back.value = r.card.back;
    setBusy(false, "Review and save — ⌘⏎ / Esc");
    els.front.focus();
    els.front.select();
  }

  async function loadDecks() {
    const r = await send({ type: "recall:decks" });
    if (!els || !r?.ok) return;
    els.decklist.innerHTML = (r.decks || []).map((d) => `<option value="${esc(d)}">`).join("");
    if (!els.deck.value) els.deck.value = r.lastDeck || r.decks?.[0] || "inbox";
  }

  async function saveCard() {
    if (!els) return;
    const deck = els.deck.value.trim();
    const front = els.front.value.trim();
    if (!deck || !front) {
      els.status.textContent = "⚠ deck and front are required";
      return;
    }
    setBusy(true, "Saving…");
    const r = await send({ type: "recall:save", deck, front, back: els.back.value.trim() });
    if (!els) return;
    if (!r?.ok) {
      setBusy(false);
      els.status.textContent = `⚠ ${r?.error || "save failed"}`;
      return;
    }
    els.panel.classList.add("done");
    els.status.textContent = `✓ Added to ${deck}`;
    setTimeout(close, 1100);
  }

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const TEMPLATE = `
    <style>
      :host { all: initial; }
      .panel {
        position: fixed; top: 16px; right: 16px; z-index: 2147483647;
        width: 380px; max-width: calc(100vw - 32px);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        color: #e4e4e7; background: #18181b;
        border: 1px solid #3f3f46; border-radius: 16px;
        box-shadow: 0 16px 40px rgba(0,0,0,.5); overflow: hidden;
      }
      .panel.done { border-color: #10b981; }
      .head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #27272a; }
      .brand { font-weight: 700; letter-spacing: -.01em; }
      .brand b { color: #38bdf8; font-weight: 700; }
      .deck {
        margin-left: auto; width: 150px; padding: 5px 9px; color: #e4e4e7;
        background: #27272a; border: 1px solid #3f3f46; border-radius: 8px; font: inherit; outline: none;
      }
      .deck:focus { border-color: #38bdf8; }
      .close { background: none; border: 0; color: #71717a; font-size: 18px; cursor: pointer; padding: 0 2px; line-height: 1; }
      .close:hover { color: #e4e4e7; }
      .fields { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; transition: opacity .15s; }
      label { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #71717a; }
      textarea {
        width: 100%; box-sizing: border-box; resize: vertical; color: #fafafa;
        background: #27272a; border: 1px solid #3f3f46; border-radius: 10px; padding: 8px 10px;
        font: inherit; outline: none;
      }
      textarea:focus { border-color: #38bdf8; }
      .front { min-height: 48px; } .back { min-height: 64px; }
      .foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid #27272a; }
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
      <div class="fields">
        <div><label>Front</label><textarea class="front" spellcheck="true"></textarea></div>
        <div><label>Back</label><textarea class="back" spellcheck="true"></textarea></div>
      </div>
      <div class="foot">
        <span class="status">Reading the selection…</span>
        <button class="act regen" title="Generate a different card">↻ Regenerate</button>
        <button class="act save" title="Save (⌘⏎)">Save</button>
      </div>
    </div>`;
})();
