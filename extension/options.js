const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

function show(text, cls) {
  const el = $("msg");
  el.textContent = text;
  el.className = `msg ${cls || ""}`;
}

async function load() {
  const { workerUrl = "", appToken = "" } = await chrome.storage.local.get(["workerUrl", "appToken"]);
  $("url").value = workerUrl;
  $("token").value = appToken;
}

async function save() {
  const workerUrl = $("url").value.trim().replace(/\/+$/, "");
  const appToken = $("token").value.trim();
  if (!workerUrl || !appToken) return show("Both fields are required.", "err");
  let origin;
  try {
    origin = new URL(workerUrl).origin;
  } catch {
    return show("That worker URL isn't a valid URL.", "err");
  }
  // Host access for just your worker, asked for here (inside the click) rather
  // than <all_urls> at install. The page itself needs none: the context menu
  // grants activeTab. Declining still works — the worker allows extension
  // origins via CORS — so it's a nice-to-have, not a requirement.
  await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
  await chrome.storage.local.set({ workerUrl, appToken });
  show("Saved ✓", "ok");
}

async function test() {
  await save();
  show("Testing…");
  const r = await send({ type: "recall:test" });
  show(r?.ok ? "Connected ✓ — you're ready." : `Failed: ${r?.error || "unknown error"}`, r?.ok ? "ok" : "err");
}

$("save").addEventListener("click", save);
$("test").addEventListener("click", test);
load();
