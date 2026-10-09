import { looksScriptRendered, scopeHtml } from "./competitor.scope";
import { CHANGELOG_V1, SPA_HTML } from "./competitor.recordings.fixture";

describe("a watch's region", () => {
  it("is the selector's matches, outermost first, without what surrounds them", () => {
    const region = scopeHtml(CHANGELOG_V1, "main .entries");

    expect(region.matches).toBe(1);
    expect(region.text).toContain("6.1 — Beacon-guided approach for the S4 dock.");
    expect(region.text).not.toMatch(/Home|Last updated|sale/);
  });

  it("does not count a nested match twice", () => {
    expect(scopeHtml(CHANGELOG_V1, ".entries, .entry").matches).toBe(1);
    expect(scopeHtml(CHANGELOG_V1, ".entry").matches).toBe(2);
  });

  it("is empty when nothing matches", () => {
    expect(scopeHtml(CHANGELOG_V1, ".missing")).toEqual({ text: "", matches: 0 });
  });
});

describe("a script-rendered page", () => {
  it("is recognised by its shell, its noscript plea or its missing text", () => {
    expect(looksScriptRendered(SPA_HTML)).toBe(true);
    expect(
      looksScriptRendered(
        '<html><body><div id="__next"></div><script src="/a.js"></script></body></html>',
      ),
    ).toBe(true);
  });

  it("is not a server-rendered page that also runs scripts", () => {
    expect(
      looksScriptRendered(
        CHANGELOG_V1.replace("</main>", `<p>${"Plenty of text. ".repeat(20)}</p></main>`),
      ),
    ).toBe(false);
    expect(looksScriptRendered("<html><body><p>short page, no scripts</p></body></html>")).toBe(
      false,
    );
  });
});
