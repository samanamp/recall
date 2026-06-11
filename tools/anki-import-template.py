#!/usr/bin/env python3
"""Import the an Anki deck. Fill CARDS with hand-converted content (see CLAUDE.md import gotchas)."""
import hashlib
import json
import time
import urllib.request

W = "https://recall-api.info-d80.workers.dev"
TOKEN = __import__("os").environ["RECALL_TOKEN"]
DECK = "CHANGE-ME"

NF4_IMG = "../../media/49643526805e05fdef0c.webp"
E8M0_GIF = "../../media/5bea0cf326b86c9fbd97.gif"
NVFP4_GIF = "../../media/b0a613edecc0d6786738.gif"

CARDS = {
    # nid: (slug, front_markdown, back_markdown)
}

B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

def ulid(ts_ms, seed):
    rand = int.from_bytes(hashlib.sha256(str(seed).encode()).digest()[:10])
    n = (int(ts_ms) << 80) | rand
    return "".join(B32[(n >> (5 * i)) & 31] for i in range(25, -1, -1))

def call(method, path, body=None):
    req = urllib.request.Request(
        W + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json",
                 "User-Agent": "recall-anki-import"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and attempt < 2:
                print(f"  {e.code} — backing off 30s"); time.sleep(30); continue
            print("  error body:", e.read().decode()[:300]); raise

export = json.load(open("/tmp/deck-export.json"))
nid_to_cid = {c["nid"]: c["cid"] for c in export["cards"]}

missing = set(map(int, export["notes"])) - set(CARDS)
assert not missing, f"unconverted notes: {missing}"

existing = {f["path"] for f in call("POST", "/sync", {"reviews": []})["files"]}
cid_to_ulid = {}
for nid, (slug, front, back) in CARDS.items():
    cid = nid_to_cid[nid]
    uid = ulid(cid, f"card-{cid}")
    cid_to_ulid[cid] = uid
    created = time.strftime("%Y-%m-%d", time.gmtime(cid / 1000))
    content = f"---\nid: {uid}\ncreated: {created}\n---\n{front.strip()}\n---\n{back.strip()}\n"
    path = f"decks/{DECK}/{uid.lower()}-{slug}.md"
    if path in existing:
        print("skip (exists)", slug); continue
    call("PUT", "/cards/file", {"path": path, "content": content,
                                "message": f"import from anki: {slug}"})
    print("card", slug)
    time.sleep(1.0)

reviews, dropped = [], 0
for r in export["revlog"]:
    if r["type"] not in (0, 1, 2) or r["ease"] < 1:
        dropped += 1
        continue
    if r["cid"] not in cid_to_ulid:
        raise SystemExit(f"FATAL: revlog cid {r['cid']} has no card")
    reviews.append({
        "id": ulid(r["ts"], "rev-{}-{}".format(r["cid"], r["ts"])),
        "cardId": cid_to_ulid[r["cid"]],
        "rating": r["ease"],
        "reviewedAt": r["ts"],
        "deviceId": "anki-import",
    })

accepted = 0
for i in range(0, len(reviews), 500):
    accepted += call("POST", "/reviews", reviews[i:i + 500])["accepted"]
print(f"RECONCILE: anki revlog={len(export['revlog'])}, importable={len(reviews)}, "
      f"skipped={dropped}, accepted={accepted}")
assert accepted == len(reviews)
