import { describe, expect, it } from "vitest";

import { MODELS_PATH } from "@/app/paths";
import {
  columnNotes,
  costCell,
  roleNote,
  scoreboardRow,
  suggestionView,
  trendCell,
} from "@/app/insights/scoreboard-view";

import { COST_PER_SUCCESS_FORMULA, I6_FORMULA, scoreRow, seededScoreboard } from "../helpers/insights";

/**
 * The model scoreboard's decisions (#445): the fallback hop, `$ / success` under each pricing,
 * the trend coloured by goodness, the low-sample badge, the column popovers' words — and the
 * suggestion band, drawn from AB.3's payload and absent without it.
 */

describe("a scoreboard row", () => {
  it("annotates a fallback with its hop, and leaves the primary bare", () => {
    expect(roleNote(scoreRow({ role: "fallback", hop: 2 }))).toBe("fallback · hop 2");
    expect(roleNote(scoreRow())).toBeNull();
  });

  it("draws the seeded primary: 84%, $0.87, a good-news arrow", () => {
    expect(scoreboardRow(scoreRow(), 5)).toEqual({
      key: "implement|claude-fable-5|1",
      task: "implement",
      role: null,
      model: "claude-fable-5",
      untouched: 0.84,
      untouchedText: "84%",
      cost: { text: "$0.87", note: null },
      trend: { glyph: "▲", tone: "up", label: "Up 4pts on the prior range" },
      lowSample: null,
    });
  });

  it("badges a row under the sample threshold, saying the threshold", () => {
    expect(scoreboardRow(scoreRow({ merged: 3, lowSample: true }), 5).lowSample).toBe(
      "3 merges — fewer than 5, too few to route on.",
    );
    expect(scoreboardRow(scoreRow({ merged: 1, lowSample: true }), 5).lowSample).toMatch(/^1 merge —/);
  });

  it("draws a row with nothing merged as unmeasured, not as 0%", () => {
    expect(scoreboardRow(scoreRow({ untouchedRate: null }), 5)).toMatchObject({
      untouched: null,
      untouchedText: "—",
    });
  });
});

describe("the $ / success cell", () => {
  it("shows $0.00 for a local model priced at zero", () => {
    expect(costCell({ pricing: "priced", cents: 0, centsPerSuccess: 0 })).toEqual({ text: "$0.00", note: null });
  });

  it("shows tokens, never dollars, when any usage was unpriced", () => {
    const cell = costCell({ pricing: "unpriced", tokens: 123_600, unpricedTokens: 600, tokensPerSuccess: 41_200 });

    expect(cell.text).toBe("41.2k tok");
    expect(cell.text).not.toContain("$");
    expect(cell.note).toMatch(/no price/);
  });

  it.each([
    [{ pricing: "priced", cents: 100, centsPerSuccess: null }],
    [{ pricing: "unpriced", tokens: 10, unpricedTokens: 10, tokensPerSuccess: null }],
    [{ pricing: "none" }],
  ] as const)("is unmeasured with nothing to divide: %j", (cost) => {
    expect(costCell(cost).text).toBe("—");
  });
});

describe("the trend arrow", () => {
  it("colours a rise in untouched merges as good news and a fall as bad — by goodness, not sign", () => {
    expect(trendCell({ direction: "up", prior: 80, delta: 4 })).toMatchObject({ glyph: "▲", tone: "up" });
    expect(trendCell({ direction: "down", prior: 66, delta: -5 })).toMatchObject({ glyph: "▼", tone: "down" });
  });

  it("is a muted dash with no prior, or no move", () => {
    expect(trendCell({ direction: "flat", prior: null, delta: null })).toEqual({
      glyph: "—",
      tone: "muted",
      label: "No prior range to compare",
    });
    expect(trendCell({ direction: "flat", prior: 90, delta: 0 }).label).toBe("No change on the prior range");
  });
});

describe("the column popovers", () => {
  it("state the untouched definition and the $ / success denominator, from the registry", () => {
    const notes = columnNotes(seededScoreboard().methodology);

    expect(notes.untouched).toEqual({ label: "Merge-untouched %", text: I6_FORMULA });
    expect(notes.cost).toEqual({ label: "$ / success", text: COST_PER_SUCCESS_FORMULA });
  });
});

describe("the suggestion band", () => {
  it("is absent without AB.3's payload", () => {
    expect(suggestionView(undefined)).toBeNull();
  });

  it("is absent when the payload carries no claim — nothing is composed in its place", () => {
    expect(suggestionView({})).toBeNull();
    expect(suggestionView({ claim: "   ", monthlySavingCents: 1400 })).toBeNull();
    expect(suggestionView({ claim: 42 })).toBeNull();
  });

  it("renders the claim, its saving and a deep link to the task's route", () => {
    expect(
      suggestionView({
        claim: "fable stays primary; consider dropping fallback to ollama/qwen3-coder for XS issues",
        monthlySavingCents: 1412,
        taskKind: "implement",
      }),
    ).toEqual({
      claim: "fable stays primary; consider dropping fallback to ollama/qwen3-coder for XS issues",
      saving: "would save ~$14/mo",
      href: `${MODELS_PATH}?route=implement`,
    });
  });

  it("links to the routing table itself without a task, and encodes one with odd characters", () => {
    expect(suggestionView({ claim: "Swap it." })).toEqual({ claim: "Swap it.", saving: null, href: MODELS_PATH });
    expect(suggestionView({ claim: "Swap it.", taskKind: "a b/c" })!.href).toBe(`${MODELS_PATH}?route=a%20b%2Fc`);
    expect(suggestionView({ claim: "Swap it.", monthlySavingCents: -5 })!.saving).toBeNull();
  });
});
