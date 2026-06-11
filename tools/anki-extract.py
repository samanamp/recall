#!/usr/bin/env python3
"""Extract the 'diffusion models' deck from a copy of the Anki collection."""
import json
import re
import sqlite3

DECK_ID = 0  # set to the anki deck id (SELECT id, name FROM decks)
db = sqlite3.connect("/tmp/anki-copy.db")

notes = {}
for nid, flds in db.execute(
    "SELECT n.id, n.flds FROM notes n JOIN cards c ON c.nid = n.id WHERE c.did = ? GROUP BY n.id",
    (DECK_ID,),
):
    fields = flds.split("\x1f")
    notes[nid] = {"front": fields[0], "back": fields[1] if len(fields) > 1 else ""}

cards = [
    {"cid": cid, "nid": nid}
    for cid, nid in db.execute(
        "SELECT id, nid FROM cards WHERE did = ? ORDER BY id", (DECK_ID,)
    )
]

revlog = [
    {"cid": cid, "ts": rid, "ease": ease, "type": rtype}
    for rid, cid, ease, rtype in db.execute(
        "SELECT r.id, r.cid, r.ease, r.type FROM revlog r JOIN cards c ON r.cid = c.id "
        "WHERE c.did = ? ORDER BY r.id",
        (DECK_ID,),
    )
]

media = set()
for n in notes.values():
    for html in (n["front"], n["back"]):
        media.update(re.findall(r'<img[^>]+src="([^"]+)"', html))

out = {"notes": notes, "cards": cards, "revlog": revlog, "media": sorted(media)}
with open("/tmp/deck-export.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print(f"notes={len(notes)} cards={len(cards)} reviews={len(revlog)} media={sorted(media)}")
