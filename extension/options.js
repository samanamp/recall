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
