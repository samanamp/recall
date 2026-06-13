/**
 * Service worker: owns the context menu and all network calls to your recall
 * worker. The app token lives here and in chrome.storage only — it never enters
 * the page's content script or JS context. The content script just renders the
 * preview UI and messages this worker.
 */

const MENU_ID = "recall-flashcard";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Create recall flashcard from "%s"',
    contexts: ["selection"],
  });
});

// Toolbar icon → settings (there's no popup; the action just opens options).
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id || !info.selectionText) return;

  const cfg = await getConfig();
  if (!cfg.workerUrl || !cfg.appToken) {
    chrome.runtime.openOptionsPage();
    return;
  }

  // Inject the overlay (idempotent — content.js guards re-injection), then
  // hand it the selection to generate from.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, {
      type: "recall:show",
      text: info.selectionText,
      title: tab.title || "",
      url: tab.url || "",
    });
  } catch (e) {
    // executeScript fails on chrome:// pages, the web store, PDFs, etc.
    console.warn("recall: can't run on this page —", e?.message);
  }
});

// ---- config ----

async function getConfig() {
  const { workerUrl = "", appToken = "", lastDeck = "" } = await chrome.storage.local.get([
    "workerUrl",
    "appToken",
    "lastDeck",
  ]);
  return { workerUrl: workerUrl.replace(/\/+$/, ""), appToken, lastDeck };
}

async function api(path, init = {}) {
  const cfg = await getConfig();
  if (!cfg.workerUrl || !cfg.appToken) throw new Error("not configured");
  const res = await fetch(`${cfg.workerUrl}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.appToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${res.status}: unexpected non-JSON response (wrong worker URL?)`);
  }
  if (!res.ok) throw new Error(body.error || `${res.status}`);
  return body;
}

// ---- message router (content script + options page) ----

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "recall:generate") {
        sendResponse({ ok: true, card: await api("/flashcard", {
          method: "POST",
          body: JSON.stringify({ text: msg.text, title: msg.title, url: msg.url, avoid: msg.avoid }),
        }) });
      } else if (msg.type === "recall:save") {
        const card = await api("/cards", {
          method: "POST",
          body: JSON.stringify({ deck: msg.deck, front: msg.front, back: msg.back }),
        });
        await chrome.storage.local.set({ lastDeck: msg.deck });
        sendResponse({ ok: true, card });
      } else if (msg.type === "recall:decks") {
        sendResponse({ ok: true, ...(await decksAndLast()) });
      } else if (msg.type === "recall:test") {
        await api("/cards/manifest"); // any authed GET proves URL + token
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true; // async sendResponse
});

async function decksAndLast() {
  const cfg = await getConfig();
  let decks = [];
  try {
    const { files = [] } = await api("/cards/manifest");
    decks = [
      ...new Set(
        files
          .map((f) => f.path.match(/^decks\/(.+)\/[^/]+$/)?.[1])
          .filter(Boolean)
      ),
    ].sort();
  } catch {
    // offline / not yet synced — the deck field still works as free text
  }
  return { decks, lastDeck: cfg.lastDeck };
}
