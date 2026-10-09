import { decodeEntities, extractMainContent } from "./web.extract";
import { ARTICLE_HTML } from "./web.recordings.fixture";

describe("main-content extraction", () => {
  it("takes the article and leaves the furniture", () => {
    const page = extractMainContent(ARTICLE_HTML);

    expect(page.title).toBe("Gust-tolerant docking: what the field shows");
    expect(page.text.split("\n\n")).toEqual([
      "Gust-tolerant docking: what the field shows",
      "Docking success falls from 97% below 6 m/s to 52% above 8 m/s, and the aborts cluster in the final two metres of the approach.",
      "Units that apply wind feedforward over the last 2 m keep lateral error under 0.2 m in the same gusts — a fixed-gain PID does not.",
      "Retrying from a re-planned approach vector recovers most aborts without an operator; returning to loiter recovers none.",
    ]);
    expect(page.text).not.toMatch(/analytics|font-family|cookies|Home|Privacy/);
  });

  it("finds the densest block when the page has no article", () => {
    const html = `<html><head><title>Notes &amp; links</title></head><body>
      <div id="menu"><a href="/a">A</a><a href="/b">B</a></div>
      <div class="links"><p><a href="/x">a link</a></p><p><a href="/y">another, link</a></p></div>
      <div class="post-body"><p>First paragraph, with commas, of real content.</p><p>Second paragraph of real content.</p></div>
      <div class="sidebar"><p>Subscribe to our newsletter, please, now.</p></div>
    </body></html>`;
    const page = extractMainContent(html);

    expect(page.title).toBe("Notes & links");
    expect(page.text).toBe(
      "First paragraph, with commas, of real content.\n\nSecond paragraph of real content.",
    );
  });

  it("survives unclosed tags, stray end tags and raw text elements", () => {
    const page = extractMainContent(
      "<body><main><p>One<p>Two</div><script>if (a < b) { x('</p>') }</script><p>Three</main>",
    );

    expect(page.text).toBe("One\n\nTwo\n\nThree");
  });

  it("keeps list items and preformatted text readable, and drops hidden content", () => {
    const page = extractMainContent(
      '<main><ul><li>alpha</li><li>beta</li></ul><pre>a  =  1\nb = 2</pre><p hidden>secret</p><p aria-hidden="true">x</p></main>',
    );

    expect(page.text).toBe("• alpha\n\n• beta\n\na = 1\nb = 2");
  });

  it("answers a page with no text with an empty text and no title", () => {
    expect(extractMainContent("<html><body><script>render()</script></body></html>")).toEqual({
      title: null,
      text: "",
    });
  });

  it("decodes named and numeric entities, keeping unknown ones", () => {
    expect(decodeEntities("&lt;a&gt; &#169; &#x2014; &rsquo;s &bogus; &#0;")).toBe(
      "<a> © — ’s &bogus; &#0;",
    );
  });
});
