import { ATOM_XML, rssXml } from "./competitor.recordings.fixture";
import { feedText, parseFeed } from "./competitor.feeds";
import { releasesText } from "./competitor.github";

describe("feeds", () => {
  it("read RSS items — title, link, date, summary as text", () => {
    const items = parseFeed(rssXml(["6.2 — Gust-adaptive final approach"]));

    expect(items).toEqual([
      {
        title: "6.2 — Gust-adaptive final approach",
        link: "https://skylink.example.com/releases/1",
        published: "Tue, 01 Sep 2026 00:00:00 GMT",
        summary: "6.2 — Gust-adaptive final approach — details inside.",
      },
    ]);
  });

  it("read Atom entries by their alternate link", () => {
    expect(parseFeed(ATOM_XML)).toEqual([
      {
        title: "Skylink opens a Rotterdam depot",
        link: "https://skylink.example.com/news/rotterdam",
        published: "2026-09-10T00:00:00Z",
        summary: "Same-day dock swaps in the Benelux.",
      },
    ]);
  });

  it("refuse a document that is not a feed, or not XML at all", () => {
    expect(parseFeed("<html><body>hi</body></html>")).toBeNull();
    expect(parseFeed("not < xml")).toBeNull();
  });

  it("render as blocks of lines", () => {
    expect(feedText([{ title: "A", link: null, published: "today", summary: "" }])).toBe(
      "A\ntoday",
    );
  });
});

describe("GitHub releases", () => {
  it("render without drafts, untitled ones named as such", () => {
    expect(
      releasesText([
        { tag_name: "", name: "" },
        { draft: true, tag_name: "v9" },
      ]),
    ).toBe("untitled release");
  });
});
