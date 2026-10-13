import { DIGEST_STATES, weekDigest } from "../insights/digest/digest.fixture";
import {
  buildFailedCard,
  buildGreenCard,
  digestCard,
  loopFinishedCard,
  pricedCost,
} from "./chat.cards.events";
import { BUILD_1847, LOOP_1846, UI_URL } from "./chat.fixture";

/**
 * Event cards (#536): the four families, and the rule that a figure which does not exist is not
 * printed — least of all a price.
 */

describe("the stats line's honesty", () => {
  it("prints the cost of a fully priced run", () => {
    expect(loopFinishedCard(LOOP_1846, UI_URL).stats).toBe(
      "14/14 checks · 11m cycle · $0.94 · claude-fable-5",
    );
  });

  it("omits cost entirely when the work was unpriced — no $0.00, no dash, no gap", () => {
    const card = loopFinishedCard({ ...LOOP_1846, costCents: null, unpricedEvents: 12 }, UI_URL);

    expect(card.stats).toBe("14/14 checks · 11m cycle · claude-fable-5");
    expect(card.stats).not.toMatch(/\$|—/);
  });

  it("omits cost when the run was only partly priced — a lower bound is an estimate", () => {
    const card = loopFinishedCard({ ...LOOP_1846, costCents: "61", unpricedEvents: 3 }, UI_URL);

    expect(card.stats).toBe("14/14 checks · 11m cycle · claude-fable-5");
  });

  it("omits cost for a run with no usage on record at all", () => {
    expect(pricedCost({ costCents: null, unpricedEvents: 0 })).toBeNull();
  });

  it("prints a real zero: a run priced at nothing cost nothing", () => {
    expect(pricedCost({ costCents: "0", unpricedEvents: 0 })).toBe("$0.00");
  });

  it.each([
    ["94", "$0.94"],
    [187, "$1.87"],
    ["1250.4", "$12.50"],
  ])("prints %s cents as %s", (cents, text) => {
    expect(pricedCost({ costCents: cents, unpricedEvents: 0 })).toBe(text);
  });

  it("refuses a cost it cannot read rather than printing it", () => {
    expect(pricedCost({ costCents: "n/a", unpricedEvents: 0 })).toBeNull();
    expect(pricedCost({ costCents: "-5", unpricedEvents: 0 })).toBeNull();
  });

  it("names the model that ran, or no model", () => {
    expect(loopFinishedCard({ ...LOOP_1846, model: null }, UI_URL).stats).toBe(
      "14/14 checks · 11m cycle · $0.94",
    );
  });

  it("draws no stats line at all from no figures", () => {
    const bare = loopFinishedCard(
      {
        ...LOOP_1846,
        checksPassed: null,
        checksTotal: null,
        cycleSeconds: null,
        costCents: null,
        model: null,
      },
      UI_URL,
    );

    expect(bare.stats).toBeNull();
  });
});

describe("the finished loop", () => {
  it("says only what it knows about the pull request and the issue", () => {
    const card = loopFinishedCard(
      { ...LOOP_1846, prNumber: null, prId: null, issueNumber: null, issueTitle: null },
      UI_URL,
    );

    expect(card.headline).toBe("Loop #1846 finished");
    expect(card.lines).toEqual([]);
    expect(card.actions.map((action) => action.id)).toEqual(["run_console"]);
  });

  it("links the pull request only when it is mirrored here", () => {
    const card = loopFinishedCard({ ...LOOP_1846, prId: null }, UI_URL);

    expect(card.headline).toBe("Loop #1846 finished — PR #512 merged");
    expect(card.actions.map((action) => action.id)).toEqual(["run_console"]);
  });
});

describe("the build cards", () => {
  it("is green in the mockup's words", () => {
    expect(buildGreenCard(BUILD_1847, UI_URL).headline).toBe(
      "Loop #1847 build 3 green — 63/63 · publishing PR #514 rev 2",
    );
  });

  it("leaves out the build number, the PR and the revision it was not given", () => {
    const card = buildGreenCard(
      { ...BUILD_1847, buildNumber: null, prNumber: null, prId: null, revision: null },
      UI_URL,
    );

    expect(card.headline).toBe("Loop #1847 build green — 63/63");
    expect(card.actions).toEqual([
      expect.objectContaining({ id: "run_console", url: `${UI_URL}/runs/${BUILD_1847.runId}` }),
    ]);
  });

  it("is err when it failed, counting what is failing", () => {
    expect(buildFailedCard({ ...BUILD_1847, passed: 61 }, UI_URL)).toMatchObject({
      severity: "err",
      mark: "✕",
      headline: "Loop #1847 build 3 failed — 2 of 63 failing",
      actions: [{ type: "link", id: "run_console" }],
    });
  });
});

describe("the digest card", () => {
  it.each(Object.entries(DIGEST_STATES))(
    "says the %s week's headline and cost exactly as the mail's assembly does",
    (_name, facts) => {
      const assembly = weekDigest(facts());
      const card = digestCard(assembly, UI_URL);

      expect(card.headline).toBe(`Weekly insights — ${assembly.headline}`);
      expect(card.stats).toBe(assembly.empty ? null : assembly.cost.text);
      expect(card.actions).toEqual([
        {
          type: "link",
          id: "open_insights",
          label: "Open Insights",
          url: `${UI_URL}/insights?range=7d`,
        },
      ]);
    },
  );

  it("prints every KPI the assembly carries, and no figures for an empty week", () => {
    const priced = weekDigest(DIGEST_STATES.priced());
    const card = digestCard(priced, UI_URL);

    for (const kpi of priced.kpis) {
      const label = kpi.proxy ? `${kpi.label} (proxy)` : kpi.label;

      expect(card.lines.join("\n")).toContain(`${label}: ${kpi.valueText}`);
    }

    expect(digestCard(weekDigest(DIGEST_STATES.empty()), UI_URL).lines).toEqual([]);
  });

  it("never prints a dollar figure for an unpriced week", () => {
    const card = digestCard(weekDigest(DIGEST_STATES.unpriced()), UI_URL);

    expect(`${card.stats ?? ""}\n${card.lines.join("\n")}`).not.toMatch(/\$\d/);
  });
});
