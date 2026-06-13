import { describe, expect, it } from "vitest";
import {
  ankiCardId,
  ankiDeckName,
  clozeBack,
  clozeFront,
  htmlToMarkdown,
  isCloze,
  mapAnkiCards,
  referencedMedia,
} from "./apkg-convert";

describe("htmlToMarkdown", () => {
  it("converts basic Anki HTML", () => {
    expect(htmlToMarkdown("Hello <b>world</b><br>line 2")).toBe("Hello **world**\nline 2");
    expect(htmlToMarkdown("<div>a</div><div>b</div>")).toBe("a\nb");
    expect(htmlToMarkdown("<i>em</i> and <em>em</em>")).toBe("*em* and *em*");
  });

  it("keeps images as refs with the original name", () => {
    expect(htmlToMarkdown('see <img src="pic 1.png">')).toBe("see ![](pic 1.png)");
    expect(htmlToMarkdown('see <img src="pic.png" width="20">')).toBe("see ![](pic.png)");
    expect(htmlToMarkdown("see <img src=bare.png>")).toBe("see ![](bare.png)");
  });

  it("converts TeX delimiters and strips audio", () => {
    expect(htmlToMarkdown("x[$]a^2[/$]y")).toBe("x$a^2$y");
    expect(htmlToMarkdown("\\(E=mc^2\\)")).toBe("$E=mc^2$");
    expect(htmlToMarkdown("hi [sound:foo.mp3]there")).toBe("hi there");
  });

  it("decodes entities after stripping tags", () => {
    expect(htmlToMarkdown("a &lt;b&gt; c &amp;&nbsp;d")).toBe("a <b> c & d");
  });

  it("preserves code blocks", () => {
    expect(htmlToMarkdown("<code>x &lt; y</code>")).toBe("`x < y`");
  });
});

describe("cloze", () => {
  const text = "The {{c1::mitochondria}} is the {{c2::powerhouse::organ part}} of the cell";

  it("detects cloze notes", () => {
    expect(isCloze(text)).toBe(true);
    expect(isCloze("plain text")).toBe(false);
  });

  it("blanks only this card's deletion, shows hints", () => {
    expect(clozeFront(text, 0)).toBe("The **[…]** is the powerhouse of the cell");
    expect(clozeFront(text, 1)).toBe("The mitochondria is the **[organ part]** of the cell");
  });

  it("reveals all answers on the back", () => {
    expect(clozeBack(text)).toBe("The **mitochondria** is the **powerhouse** of the cell");
  });
});

describe("ankiCardId", () => {
  it("is deterministic, 26 chars, time-ordered", () => {
    const a = ankiCardId(1650000000000);
    const b = ankiCardId(1650000000000);
    const later = ankiCardId(1700000000000);
    expect(a).toBe(b);
    expect(a).toHaveLength(26);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(later > a).toBe(true);
  });

  it("differs for adjacent cids", () => {
    expect(ankiCardId(1650000000000)).not.toBe(ankiCardId(1650000000001));
  });
});

describe("ankiDeckName", () => {
  it("maps :: nesting to folders and sanitizes", () => {
    expect(ankiDeckName("Japanese::JLPT N3")).toBe("Japanese/JLPT N3");
    expect(ankiDeckName('we|ird::"name"')).toBe("weird/name");
    expect(ankiDeckName("")).toBe("imported");
  });
});

describe("mapAnkiCards", () => {
  const deckNames = new Map([[1, "Default"]]);

  it("maps basic and reversed cards keyed by cid", () => {
    const { cards, skipped } = mapAnkiCards({
      notes: [{ id: 10, flds: "front html\x1fback html" }],
      cards: [
        { id: 100, nid: 10, did: 1, ord: 0 },
        { id: 101, nid: 10, did: 1, ord: 1 },
      ],
      deckNames,
    });
    expect(skipped).toBe(0);
    expect(cards[0]).toMatchObject({ cid: 100, front: "front html", back: "back html" });
    expect(cards[1]).toMatchObject({ cid: 101, front: "back html", back: "front html" });
    expect(cards[0].id).not.toBe(cards[1].id);
  });

  it("expands cloze cards per ord", () => {
    const { cards } = mapAnkiCards({
      notes: [{ id: 11, flds: "{{c1::A}} and {{c2::B}}\x1fextra" }],
      cards: [
        { id: 200, nid: 11, did: 1, ord: 0 },
        { id: 201, nid: 11, did: 1, ord: 1 },
      ],
      deckNames,
    });
    expect(cards[0].front).toBe("**[…]** and B");
    expect(cards[1].front).toBe("A and **[…]**");
    expect(cards[0].back).toBe("**A** and **B**");
  });

  it("skips cards with missing notes or empty fronts", () => {
    const { cards, skipped } = mapAnkiCards({
      notes: [{ id: 12, flds: "\x1fonly back" }],
      cards: [
        { id: 300, nid: 12, did: 1, ord: 0 },
        { id: 301, nid: 999, did: 1, ord: 0 },
      ],
      deckNames,
    });
    expect(cards).toHaveLength(0);
    expect(skipped).toBe(2);
  });
});

describe("referencedMedia", () => {
  it("collects local refs only", () => {
    const card = {
      id: "x",
      cid: 1,
      deck: "d",
      front: "![](a.png) ![](https://x/y.png)",
      back: "![](../../media/done.webp) ![](b.jpg)",
    };
    expect([...referencedMedia([card])].sort()).toEqual(["a.png", "b.jpg"]);
  });
});
