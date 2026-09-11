import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BREAKDOWN_EYEBROW,
  EXCERPT_LIMIT,
  FILES_LABEL,
  FILES_PENDING_NOTE,
  HEURISTIC_ESTIMATOR,
  NO_FILES_NOTE,
  NO_SIGNALS,
  OPEN_ON_GITHUB_LABEL,
  PANEL_TITLE,
  QUEUE_ALREADY_QUEUED,
  QUEUE_NOT_SIZED,
  QUEUE_ONE_LABEL,
  REESTIMATE_ONE_BUSY,
  REESTIMATE_ONE_LABEL,
  REESTIMATE_ONE_ROLE_REASON,
  REESTIMATE_ONE_STARTED,
  RISK_FILL,
  RISK_LABEL,
  RISK_TONE,
  ROW_LABELS,
  TRACE_LABEL,
  confidenceLabel,
  cycleLabel,
  estimationOutcome,
  excerpt,
  filesNote,
  githubHref,
  metaLine,
  needsHumanLine,
  panelState,
  provenanceLine,
  queueOneReason,
  quoted,
  reestimateOneReason,
  signalsLine,
  tokensLabel,
} from "@/app/issues/panel";
import { QUEUE_ROLE_REASON } from "@/app/issues/view";

import {
  READ_AT,
  SEEDED_BODY,
  SEEDED_FILES,
  SEEDED_RISK_NOTE,
  estimateDetail,
  estimatingDetail,
  estimationAccepted,
  issueDetail,
  needsHumanDetail,
} from "../helpers/issues";

/**
 * The detail panel's copy and its decisions (#119).
 *
 * The **copy** is compared with `docs/mockups/03-issues.html` itself: the card's title, the meta
 * line, the excerpt, the section's eyebrow and captions, the three row keys and their values, the
 * risk level and its rationale, the three actions and the trace's summary — every one read from
 * the panel the mockup draws for `#485`, against the seed's `#485`. The one place the two must
 * differ is the trace's lines, and that difference is asserted rather than avoided: the mockup
 * names a model the seed never called (decision K10). The **decisions** are where the excerpt is
 * cut, how a figure is spelled, when each action is inert, and which state an answer is in.
 */

/** The mockup this panel is drawn from, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "03-issues.html"),
  "utf8",
);

/** The mockup's panel alone — from its comment to the end of the page's main. */
const PANEL = MOCKUP.slice(MOCKUP.indexOf("<!-- side panel: issue detail -->"), MOCKUP.indexOf("</main>"));

/** The contract the estimator's name must appear in, read once. */
const CONTRACT = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "ouroboros-rest", "openapi.yaml"),
  "utf8",
);

/**
 * Text as a reader sees it: tags dropped, `&nbsp;` read as a space, whitespace collapsed.
 *
 * @param html A fragment of the mockup.
 * @returns Its text.
 */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first element of a class in the panel, as text.
 *
 * @param className The class, exactly as the mockup writes it.
 * @returns The element's text.
 */
function byClass(className: string): string {
  const match = new RegExp(`<(\\w+) class="${className}"[^>]*>([\\s\\S]*?)<\\/\\1>`).exec(PANEL);
  if (match === null) throw new Error(`no .${className} in the mockup's panel`);
  return text(match[2]!);
}

/** The mockup's `.breakdown-row`s, key to value. */
function mockupRows(): Record<string, string> {
  return Object.fromEntries(
    [...PANEL.matchAll(/<div class="breakdown-row"><span class="k">([^<]*)<\/span><span class="v">([\s\S]*?)<\/span><\/div>/g)].map(
      ([, key, value]) => [text(key!), text(value!)],
    ),
  );
}

/** The reader's clock in these cases — the read's instant, in whole seconds. */
const NOW = Math.floor(READ_AT / 1000);

describe("the copy, against the mockup's panel", () => {
  it("titles the card as the mockup does, capitalised by the card head", () => {
    expect(byClass("card-title")).toBe(PANEL_TITLE.toUpperCase());
  });

  it("reads the seeded #485's meta line exactly as the mockup writes it", () => {
    expect(metaLine(issueDetail().issue, NOW)).toBe(byClass("mono muted small"));
    expect(metaLine(issueDetail().issue, NOW)).toBe("#485 · opened 2d ago by field-support");
  });

  it("carries the mockup's title and its four tags", () => {
    const { issue } = issueDetail();

    expect(PANEL).toContain(issue.title);
    expect([...PANEL.matchAll(/<span class="tag">([^<]*)<\/span>/g)].map((tag) => tag[1]).slice(0, 4)).toEqual(
      issue.labels,
    );
  });

  it("quotes the seeded body whole, which is the mockup's excerpt to the character", () => {
    const cut = excerpt(SEEDED_BODY);

    expect(cut.truncated).toBe(false);
    expect(quoted(cut.text)).toBe(byClass("panel-body-excerpt"));
    expect(SEEDED_BODY.length).toBeLessThanOrEqual(EXCERPT_LIMIT);
  });

  it("heads the breakdown with the mockup's eyebrow and file caption, and lists the mockup's three files", () => {
    expect(byClass("eyebrow")).toBe(BREAKDOWN_EYEBROW);
    expect(byClass("small muted")).toBe(FILES_LABEL);

    const list = /<div class="file-list">([\s\S]*?)<\/div>/.exec(PANEL)![1]!;
    expect([...list.matchAll(/<span>([^<]*)<\/span>/g)].map((file) => file[1])).toEqual(SEEDED_FILES);
  });

  it("spells the three rows as the mockup does, over the seed's figures", () => {
    const estimate = estimateDetail();
    const rows = mockupRows();

    expect(rows[ROW_LABELS.tokens]).toBe(tokensLabel(estimate.breakdown.estTokens));
    expect(rows[ROW_LABELS.cycle]).toBe(cycleLabel(estimate.breakdown.cycleMin, estimate.breakdown.cycleMax));
    expect(rows[ROW_LABELS.effort]).toBe(`M ${confidenceLabel(estimate.confidence)}`);
    expect(Object.keys(rows)).toEqual([ROW_LABELS.tokens, ROW_LABELS.cycle, ROW_LABELS.effort]);
  });

  it("draws the risk as the mockup does: the caption, the level, the low meter's width, the sentence", () => {
    const risk = /<span class="muted">([^<]*)<\/span><span class="mono" style="color:var\(--ok\)">([^<]*)<\/span>/.exec(PANEL)!;

    expect(risk[1]).toBe(RISK_LABEL);
    expect(risk[2]).toBe(estimateDetail().risk);
    expect(RISK_TONE.low).toBe("ok");
    expect(PANEL).toContain('<div class="meter ok"');
    expect(PANEL).toContain(`width:${Math.round(RISK_FILL.low * 100)}%`);
    expect(byClass("small faint")).toBe(SEEDED_RISK_NOTE);
  });

  it("names the three actions as the mockup does, in its order", () => {
    expect([...PANEL.matchAll(/<button class="btn [^"]*">([^<]*)<\/button>/g)].map((button) => button[1])).toEqual([
      QUEUE_ONE_LABEL,
      REESTIMATE_ONE_LABEL,
      OPEN_ON_GITHUB_LABEL,
    ]);
  });

  it("heads the trace as the mockup does, and says something different inside it — on purpose", () => {
    expect(byClass("head-line")).toBe(`▾ ${TRACE_LABEL}`);

    const lines = [...PANEL.matchAll(/<div class="line">([^<]*)<\/div>/g)].map((line) => line[1]!);
    const estimate = estimateDetail();

    // The mockup's first line names a model the seed never called and tokens it never spent.
    expect(lines[0]).toMatch(/sized by claude-sonnet-5 · 2m ago · 41k tokens/);
    expect(provenanceLine(estimate.trace, estimate.version, NOW)).toBe("sized by heuristic-v0 · 2m ago");

    // Its second names knowledge signals the seed's trace does not carry.
    expect(lines[1]).toMatch(/^signals: 3 similar closed issues/);
    expect(signalsLine(estimate.trace.signals)).toBe(NO_SIGNALS);
  });

  it("names the rule engine as the contract spells it", () => {
    expect(HEURISTIC_ESTIMATOR).toBe("heuristic-v0");
    expect(CONTRACT).toContain(`\`${HEURISTIC_ESTIMATOR}\``);
  });
});

describe("the meta line", () => {
  it("drops the author when GitHub no longer has one, and keeps the rest", () => {
    expect(metaLine(issueDetail({ issue: { authorLogin: null } }).issue, NOW)).toBe("#485 · opened 2d ago");
  });

  it("drops the opening age for an instant it cannot read, rather than saying NaN", () => {
    expect(metaLine(issueDetail({ issue: { ghCreatedAt: "yesterday" } }).issue, NOW)).toBe("#485 · by field-support");
    expect(metaLine(issueDetail({ issue: { ghCreatedAt: "yesterday", authorLogin: null } }).issue, NOW)).toBe("#485");
  });

  it("measures the age from the clock it is given, in the table's units", () => {
    expect(metaLine(issueDetail().issue, NOW + 3 * 24 * 3600)).toBe("#485 · opened 5d ago by field-support");
    expect(metaLine(issueDetail().issue, NOW - 47 * 3600)).toBe("#485 · opened 1h ago by field-support");
  });
});

describe("the excerpt", () => {
  it("cuts a long body at a word, never earlier than half the limit, and marks the cut", () => {
    const word = "telemetry ";
    const body = word.repeat(60);
    const cut = excerpt(body);

    expect(cut.truncated).toBe(true);
    expect(cut.text.endsWith("…")).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(EXCERPT_LIMIT + 1);
    expect(cut.text.slice(0, -1).endsWith("telemetry")).toBe(true);
    expect(cut.text.length).toBeGreaterThan(EXCERPT_LIMIT / 2);
  });

  it("cuts one long token at the limit itself, since there is no word to stop at", () => {
    const cut = excerpt("x".repeat(EXCERPT_LIMIT * 2));

    expect(cut.truncated).toBe(true);
    expect(cut.text).toBe(`${"x".repeat(EXCERPT_LIMIT)}…`);
  });

  it("trims a short body and leaves it whole", () => {
    expect(excerpt("  short  ")).toEqual({ text: "short", truncated: false });
  });

  it("quotes in the panel's own curly marks", () => {
    expect(quoted("a")).toBe("“a”");
  });
});

describe("the breakdown's figures", () => {
  it("spells tokens as an estimate, compacted without a zero decimal", () => {
    expect(tokensLabel(180_000)).toBe("~180k");
    expect(tokensLabel(25_000)).toBe("~25k");
    expect(tokensLabel(1_250_000)).toBe("~1.3M");
    expect(tokensLabel(900)).toBe("~900");
  });

  it("spells the cycle as a range with the mockup's dash, or one figure when the ends agree", () => {
    expect(cycleLabel(12, 18)).toBe("12–18 min");
    expect(cycleLabel(90, 150)).toBe("90–150 min");
    expect(cycleLabel(6, 6)).toBe("6 min");
  });

  it("rounds the confidence", () => {
    expect(confidenceLabel(92)).toBe("conf 92%");
    expect(confidenceLabel(61.4)).toBe("conf 61%");
  });

  it("says why the file list is empty, by who wrote the estimate", () => {
    expect(filesNote(HEURISTIC_ESTIMATOR)).toBe(FILES_PENDING_NOTE);
    expect(filesNote("claude-sonnet-5")).toBe(NO_FILES_NOTE);
  });

  it("fills the meter more the higher the risk, in the ticket's three hues", () => {
    expect(RISK_FILL.low).toBeLessThan(RISK_FILL.medium);
    expect(RISK_FILL.medium).toBeLessThan(RISK_FILL.high);
    expect(RISK_FILL.high).toBeLessThanOrEqual(1);
    expect(RISK_TONE).toEqual({ low: "ok", medium: "warn", high: "err" });
  });
});

describe("the actions", () => {
  it("lets a member queue a sized, unqueued issue", () => {
    expect(queueOneReason({ sizingStatus: "sized", queued: false }, true)).toBeUndefined();
  });

  it("inerts Queue for loop for a viewer before anything about the issue", () => {
    expect(queueOneReason({ sizingStatus: "unsized", queued: true }, false)).toBe(QUEUE_ROLE_REASON);
  });

  it("inerts Queue for loop on a queued issue, and on one that is not sized, by its state", () => {
    expect(queueOneReason({ sizingStatus: "sized", queued: true }, true)).toBe(QUEUE_ALREADY_QUEUED);
    expect(queueOneReason({ sizingStatus: "unsized", queued: false }, true)).toBe(QUEUE_NOT_SIZED.unsized);
    expect(queueOneReason({ sizingStatus: "estimating", queued: false }, true)).toBe(QUEUE_NOT_SIZED.estimating);
    expect(queueOneReason({ sizingStatus: "needs_human", queued: false }, true)).toBe(QUEUE_NOT_SIZED.needs_human);
  });

  it("lets a member re-estimate anything not already in flight", () => {
    expect(reestimateOneReason("sized", true)).toBeUndefined();
    expect(reestimateOneReason("unsized", true)).toBeUndefined();
    expect(reestimateOneReason("needs_human", true)).toBeUndefined();
    expect(reestimateOneReason("estimating", true)).toBe(REESTIMATE_ONE_BUSY);
    expect(reestimateOneReason("sized", false)).toBe(REESTIMATE_ONE_ROLE_REASON);
  });

  it("links only to a web address", () => {
    expect(githubHref("https://github.com/acme-robotics/helios-firmware/issues/485")).toBe(
      "https://github.com/acme-robotics/helios-firmware/issues/485",
    );
    expect(githubHref("http://ghe.internal/issues/1")).toBe("http://ghe.internal/issues/1");
    expect(githubHref("javascript:alert(1)")).toBeNull();
    expect(githubHref("")).toBeNull();
    expect(githubHref("https://github.com/a b")).toBeNull();
  });

  it("reports a re-estimate that took with one sentence, whatever the acceptance carried", () => {
    expect(estimationOutcome(estimationAccepted())).toEqual({ ok: true, message: REESTIMATE_ONE_STARTED });
  });
});

describe("the trace's lines", () => {
  it("adds the tokens only when any were spent, and the version only past the first", () => {
    const spent = estimateDetail({
      version: 3,
      trace: { estimator: "claude-sonnet-5", sizedAt: "2026-09-10T15:39:52.000Z", tokensUsed: 41_000, signals: [] },
    });

    expect(provenanceLine(spent.trace, spent.version, NOW)).toBe("sized by claude-sonnet-5 · 2m ago · 41k tokens · v3");
  });

  it("drops the age for an instant it cannot read", () => {
    const odd = estimateDetail({ trace: { estimator: "heuristic-v0", sizedAt: "soon", tokensUsed: 0, signals: [] } });

    expect(provenanceLine(odd.trace, 1, NOW)).toBe("sized by heuristic-v0");
  });

  it("joins the signals it was given, and says so when there are none", () => {
    expect(signalsLine(["label-map", "title-verb"])).toBe("signals: label-map · title-verb");
    expect(signalsLine([])).toBe(NO_SIGNALS);
  });

  it("opens a needs-human trace with the confidence that fell short, or with the absence of an estimate", () => {
    expect(needsHumanLine(needsHumanDetail().estimate)).toBe(
      "needs a human: confidence 61% was under the floor for a sized estimate",
    );
    expect(needsHumanLine(null)).toBe("needs a human: the estimator produced no estimate for this issue");
  });
});

describe("the state", () => {
  it("is the sizing status", () => {
    expect(panelState(issueDetail())).toBe("sized");
    expect(panelState(estimatingDetail())).toBe("estimating");
    expect(panelState(estimatingDetail("unsized"))).toBe("unsized");
    expect(panelState(needsHumanDetail())).toBe("needs_human");
  });

  it("draws a sized issue with no estimate as unsized, rather than a breakdown over nothing", () => {
    expect(panelState(issueDetail({ estimate: null }))).toBe("unsized");
  });
});
