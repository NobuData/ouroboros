import { escapeHtml } from "./html";

describe("escapeHtml", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Acme Robotics — 92% ▲ 3pts")).toBe("Acme Robotics — 92% ▲ 3pts");
  });

  it("escapes every character a tag or an attribute could be opened or closed with", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });

  it("escapes an ampersand once, not the entities it has just written", () => {
    expect(escapeHtml("a & b &amp; c")).toBe("a &amp; b &amp;amp; c");
  });
});
