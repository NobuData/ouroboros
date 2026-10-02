import { confirmPage, invalidLinkPage, unsubscribedPage } from "./digest.pages";

describe("the unsubscribe pages", () => {
  it("asks before unsubscribing: one form that posts back to the same address", () => {
    const page = confirmPage("Acme Robotics");

    expect(page.status).toBe(200);
    expect(page.html).toContain("Unsubscribe from the weekly digest?");
    expect(page.html).toContain("weekly Insights digest for Acme Robotics");
    // No action: the form posts to the URL it was served from, token and all.
    expect(page.html).toMatch(/<form method="post"><button type="submit"/);
    expect(page.html).not.toContain("action=");
  });

  it("says it is done, and how to come back", () => {
    const page = unsubscribedPage("Acme Robotics");

    expect(page.status).toBe(200);
    expect(page.html).toContain("You are unsubscribed");
    expect(page.html).toContain("subscribe again from the Insights page");
    expect(page.html).not.toContain("<form");
  });

  it("answers a link that names no send with a page, as a 404", () => {
    const page = invalidLinkPage();

    expect(page.status).toBe(404);
    expect(page.html).toContain("This link is not valid");
  });

  it.each([confirmPage, unsubscribedPage])("escapes the workspace's name", (render) => {
    const { html } = render(`<script>alert("x")</script> & Sons`);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Sons");
  });

  it.each([confirmPage("A"), unsubscribedPage("A"), invalidLinkPage()])(
    "is self-contained: no script, nothing fetched, not indexed",
    ({ html }) => {
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).not.toMatch(/<script|<link|<img|src=|url\(|@import|https?:\/\//);
      expect(html).toContain('<meta name="robots" content="noindex">');
    },
  );
});
