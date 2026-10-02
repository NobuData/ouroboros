import { join } from "node:path";

import { GoldenFile } from "../../../testing/golden.fixture";
import { emptyScoreboard, keysOf } from "../page/page.fixture";
import { assembleDigest, type DigestAssembly } from "./digest.assembly";
import { DIGEST_PALETTE, renderDigestHtml } from "./digest.html";
import {
  DIGEST_CONTEXT,
  DIGEST_STATES,
  emptyWeekFacts,
  unpricedWeekFacts,
  weekDigest,
  weekFacts,
  weekPage,
  weekWindow,
  withWeekWindows,
} from "./digest.fixture";
import { insightsUrl, renderDigest, unsubscribeUrl } from "./digest.render";
import { renderDigestText } from "./digest.text";

const GOLDEN_PATH = join(__dirname, "digest.golden.json");
const REGENERATE = "OURO_UPDATE_GOLDENS=1 yarn jest src/modules/insights/digest/digest.render";

/** Undo `escapeHtml`, so a figure can be looked for in the HTML part as it was written. */
function unescaped(html: string): string {
  return html
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** Every sentence and figure an assembly carries for a reader. */
function printed(digest: DigestAssembly): string[] {
  return [
    digest.headline,
    ...digest.kpis.flatMap((kpi) => [kpi.label, kpi.valueText, kpi.deltaText ?? ""]),
    digest.topCause?.text ?? "",
    digest.topCause?.line ?? "",
    ...digest.flaky.flatMap((mover) => [mover.name, mover.text]),
    digest.cost.text,
  ].filter((text) => text !== "");
}

describe("the rendered digest", () => {
  const golden = new GoldenFile(
    GOLDEN_PATH,
    "The weekly Insights digest's subject, HTML part and text part in its four states. " +
      `tests/e2e/email renders the HTML parts under client profiles. Regenerate with: ${REGENERATE}`,
    REGENERATE,
  );

  afterAll(() => {
    golden.save();
  });

  it.each(Object.entries(DIGEST_STATES))("renders the %s digest as its golden", (name, facts) => {
    golden.hold(name, renderDigest(weekDigest(facts()), DIGEST_CONTEXT));
  });

  it("records exactly the four states", () => {
    if (!golden.updating) {
      expect(golden.names()).toEqual(Object.keys(DIGEST_STATES));
    }
  });

  it.each(Object.entries(DIGEST_STATES))(
    "prints the same figures in the %s digest's HTML and text parts",
    (_name, facts) => {
      const digest = weekDigest(facts());
      const html = unescaped(renderDigestHtml(digest, DIGEST_CONTEXT));
      const text = renderDigestText(digest, DIGEST_CONTEXT);

      // An empty digest prints its headline and no figures, in both parts alike.
      const expected = digest.empty ? [digest.headline] : printed(digest);

      expect(expected.length).toBeGreaterThan(0);
      for (const figure of expected) {
        expect(html).toContain(figure);
        expect(text).toContain(figure);
      }
    },
  );

  it("names the workspace, the window and the reader's way out, in both parts", () => {
    const { subject, html, text } = renderDigest(weekDigest(), DIGEST_CONTEXT);

    expect(subject).toBe("Weekly insights · Acme Robotics · Aug 2 – Aug 8, 2026");
    for (const part of [unescaped(html), text]) {
      expect(part).toContain("Acme Robotics");
      expect(part).toContain("Aug 2 – Aug 8, 2026");
      expect(part).toContain(DIGEST_CONTEXT.insightsUrl);
      expect(part).toContain(DIGEST_CONTEXT.unsubscribeUrl);
      expect(part).toContain("you subscribed to the weekly Insights digest");
    }
  });

  it("gives a preview no unsubscribe link, and says it was sent to nobody", () => {
    const { html, text } = renderDigest(weekDigest(), { ...DIGEST_CONTEXT, unsubscribeUrl: null });

    for (const part of [html, text]) {
      expect(part).not.toContain("nsubscribe");
      expect(part).toContain("It was not sent to anyone.");
    }
  });

  it("prints no dollar sign anywhere for a workspace nothing prices", () => {
    const { subject, html, text } = renderDigest(weekDigest(unpricedWeekFacts()), DIGEST_CONTEXT);

    expect(`${subject}${html}${text}`).not.toContain("$");
    expect(text).toContain("Tokens per merged PR: 1.1M");
    expect(text).toContain("31M tokens this week.");
  });

  it("prints no figure at all for an empty week — one honest sentence instead", () => {
    const { html, text } = renderDigest(weekDigest(emptyWeekFacts()), DIGEST_CONTEXT);

    for (const part of [html, text]) {
      expect(part).toContain("Nothing to report this week.");
      expect(part).toContain("No merges, interventions, builds, test runs or model usage");
      expect(part).not.toMatch(/Autonomous merge rate|Cost per merged PR|Human interventions|\$/);
    }
    // No row of zeroes and dashes, either.
    expect(text).not.toMatch(/: (0|0%|—)\b/);
  });

  it("marks a proxy metric in words, in both parts", () => {
    const digest = weekDigest(
      withWeekWindows(
        weekFacts(),
        weekWindow("cycle_time", {
          value: 860_000,
          prior: 980_000,
          unit: "duration_ms",
          aggregation: "median",
          proxy: true,
          fill: null,
        }),
      ),
    );

    expect(renderDigestText(digest, DIGEST_CONTEXT)).toContain("Median cycle (proxy): 14m 20s");
    expect(renderDigestHtml(digest, DIGEST_CONTEXT)).toMatch(/Median cycle <span[^>]*>\(proxy\)/);
    expect(renderDigestText(weekDigest(), DIGEST_CONTEXT)).not.toContain("(proxy)");
  });

  it("says whether a move was the good way in words, not only in colour", () => {
    const text = renderDigestText(weekDigest(), DIGEST_CONTEXT);
    const html = renderDigestHtml(weekDigest(), DIGEST_CONTEXT);

    expect(text).toContain("Human interventions: 12 (▲ 3 vs prior week, worse)");
    expect(html).toContain("▲ 3 vs prior week, worse");
    expect(html).toContain("▼ 2m vs prior week, better");
  });
});

describe("the honesty gates, in the mail (BJ.5, #441)", () => {
  /** The claims the page withholds until #237, #209 and mockup 18 make them — and the money guide. */
  const GATED_WORD = /alert|suggest|cluster|budget|projected|projection|spike/i;

  it.each(Object.entries(DIGEST_STATES))(
    "makes none of the gated claims in the %s digest — not in its data, not in either part",
    (_name, facts) => {
      const digest = weekDigest(facts());
      const { subject, html, text } = renderDigest(digest, DIGEST_CONTEXT);

      expect(keysOf(digest).filter((key) => GATED_WORD.test(key))).toEqual([]);
      expect(`${subject}\n${unescaped(html)}\n${text}`).not.toMatch(GATED_WORD);
    },
  );

  it("passes on no suggestion even when AB.3 has given the page one, nor the page's budget guide", () => {
    const facts = weekFacts();
    const page = weekPage({
      ...facts,
      scoreboard: { ...emptyScoreboard(), suggestion: { text: "Route implement to fable" } },
    });

    // The page carries both — so the digest's silence below is its own, not the page's.
    expect(page.scoreboard).toHaveProperty("suggestion");
    expect(page.series.cost).toHaveProperty("budget");

    const digest = assembleDigest(page);
    const { html, text } = renderDigest(digest, DIGEST_CONTEXT);

    expect(JSON.stringify(digest)).not.toContain("Route implement");
    expect(`${html}${text}`).not.toContain("Route implement");
    expect(`${html}${text}`).not.toMatch(GATED_WORD);
  });

  it("carries no money field for a workspace nothing prices", () => {
    const digest = weekDigest(unpricedWeekFacts());

    expect(keysOf(digest).filter((key) => /cents$|dollar|price$/i.test(key))).toEqual([]);
  });
});

describe("the HTML part, as an email", () => {
  const html = renderDigestHtml(weekDigest(), DIGEST_CONTEXT);

  it("draws in the light tokens and nothing else", () => {
    // Six hex digits after a colon: a colour in a style, not the `#1847` of an issue.
    const colours = new Set([...html.matchAll(/:\s*(#[0-9a-fA-F]{6})\b/g)].map(([, hex]) => hex));
    const bordered = [...html.matchAll(/solid (#[0-9a-fA-F]{6})\b/g)].map(([, hex]) => hex);

    for (const hex of bordered) colours.add(hex);

    expect([...colours].sort()).toEqual([...new Set(Object.values(DIGEST_PALETTE))].sort());
  });

  it("declares itself light, so a dark-mode client leaves it as drawn", () => {
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).not.toContain("prefers-color-scheme");
  });

  it("fetches nothing and runs nothing: no image, script, stylesheet or web font", () => {
    expect(html).not.toMatch(/<img|<script|<link|@import|@font-face|url\(/);
    // The only addresses in the document are the two links a reader may follow.
    expect(html.match(/https?:\/\/[^"<\s]+/g)).toEqual([
      DIGEST_CONTEXT.insightsUrl,
      DIGEST_CONTEXT.unsubscribeUrl,
    ]);
  });

  it("keeps every essential style inline: the style block is only the narrow-screen padding", () => {
    expect(html.match(/<style>[^<]*<\/style>/g)).toEqual([
      "<style>@media (max-width:480px){.pad{padding-left:20px !important;padding-right:20px !important;}}</style>",
    ]);
  });

  it("escapes what came from data", () => {
    const hostile = renderDigestHtml(
      weekDigest(
        weekFacts({
          flaky: [
            {
              ...weekFacts().flaky[1],
              name: `<img src=x onerror=alert(1)>`,
              repository: `a"b`,
            },
          ],
        }),
      ),
      { ...DIGEST_CONTEXT, workspaceName: `Acme <b>& Sons</b>` },
    );

    expect(hostile).not.toContain("<img");
    expect(hostile).not.toContain("<b>");
    expect(hostile).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(hostile).toContain("Acme &lt;b&gt;&amp; Sons&lt;/b&gt;");
    expect(hostile).toContain("a&quot;b");
  });
});

describe("the digest's links", () => {
  it("points Open Insights at the UI's seven-day page", () => {
    expect(insightsUrl("https://ouroboros.acme.dev")).toBe(
      "https://ouroboros.acme.dev/insights?range=7d",
    );
    expect(insightsUrl("http://localhost:3000/")).toBe("http://localhost:3000/insights?range=7d");
  });

  it("points the unsubscribe link at this API's public route", () => {
    expect(unsubscribeUrl("https://api.acme.dev/", "ouro_unsub_x")).toBe(
      "https://api.acme.dev/api/v1/insights/digest/unsubscribe/ouro_unsub_x",
    );
  });
});
