import { describe, expect, it } from "vitest";

import {
  EFFORT_TAG,
  NO_EFFORT,
  NO_SUITE_FAILURES,
  NO_TOKENS,
  effortView,
  isEffort,
  rankEmphasis,
  suitesView,
  tokensView,
} from "@/app/insights/bars-view";

import { barCard, seededEffort, seededSuites, seededTokens } from "../helpers/insights";

/**
 * The three secondary bar cards (#446): the seeded rows and tags as mockup 15 draws them, the
 * rank emphasis, effort chips as labels, and the service's computed lines passed through — so a
 * card whose data changes says the changed sentence, and one with nothing to say says nothing.
 */

describe("rankEmphasis", () => {
  it("lifts the largest and recedes the two smallest, as the mockup's suite card", () => {
    expect(rankEmphasis([14, 9, 6, 3, 1])).toEqual(["top", undefined, undefined, "dim", "dim"]);
  });

  it("ranks by value, not position — the effort ladder's largest is last", () => {
    expect(rankEmphasis([6, 11, 19, 48, 130])).toEqual(["dim", "dim", undefined, undefined, "top"]);
  });

  it("recedes nothing on a card of three or fewer rows", () => {
    expect(rankEmphasis([3, 2, 1])).toEqual(["top", undefined, undefined]);
    expect(rankEmphasis([5])).toEqual(["top"]);
    expect(rankEmphasis([])).toEqual([]);
  });

  it("lifts only the first of a tie at the top", () => {
    expect(rankEmphasis([4, 4, 2, 1])).toEqual(["top", undefined, "dim", "dim"]);
  });
});

describe("suitesView", () => {
  it("draws the seeded card — `33 cases`, the computed share line", () => {
    const view = suitesView(seededSuites(), "30d");

    expect(view.title).toBe("Test failures by suite · 30d");
    expect(view.tag).toBe("33 cases");
    expect(view.rows.map((row) => [row.name, row.display, row.emphasis])).toEqual([
      ["telemetry integration", "14", "top"],
      ["OTA update", "9", undefined],
      ["physical · HIL", "6", undefined],
      ["motor control", "3", "dim"],
      ["unit · drivers", "1", "dim"],
    ]);
    expect(view.line).toBe("33 failing cases total — 0.12% of everything that ran.");
  });

  it("passes a changed line through verbatim and draws none when the service had none", () => {
    const changed = barCard([["ota", "OTA update", 1]], { line: "1 failing case total — 0.01% of everything that ran." });

    expect(suitesView(changed, "7d")).toMatchObject({ tag: "1 case", line: changed.line });
    expect(suitesView(barCard([["ota", "OTA update", 1]]), "7d").line).toBeNull();
  });

  it("draws the designed empty state for a range nothing failed in", () => {
    expect(suitesView(barCard([]), "30d").empty).toBe(NO_SUITE_FAILURES);
  });
});

describe("effortView", () => {
  it("draws the seeded ladder with effort chips and durations, XS 6m → XL 2h 10m", () => {
    const view = effortView(seededEffort());

    expect(view.tag).toBe(EFFORT_TAG);
    expect(view.rows.map((row) => [row.effort, row.display, row.emphasis])).toEqual([
      ["XS", "6m", "dim"],
      ["S", "11m", "dim"],
      ["M", "19m", undefined],
      ["L", "48m", undefined],
      ["XL", "2h 10m", "top"],
    ]);
    expect(view.line).toBe("Estimator calibration: 89% of issues land within their predicted band.");
  });

  it("draws a label no chip can stand for as words", () => {
    expect(effortView(barCard([["unsized", "UNSIZED", 60_000]])).rows[0]).not.toHaveProperty("effort");
    expect(isEffort("XL")).toBe(true);
    expect(isEffort("xl")).toBe(false);
  });

  it("draws the designed empty state with nothing merged", () => {
    expect(effortView(barCard([])).empty).toBe(NO_EFFORT);
  });
});

describe("tokensView", () => {
  it("draws the seeded card — `126M total`, compact counts, the per-PR and local-share line", () => {
    const view = tokensView(seededTokens(), "30d");

    expect(view.title).toBe("Tokens by stage · 30d");
    expect(view.tag).toBe("126M total");
    expect(view.rows.map((row) => [row.name, row.display, row.emphasis])).toEqual([
      ["implement", "71.0M", "top"],
      ["review", "18.0M", undefined],
      ["plan", "14.0M", undefined],
      ["analyze", "12.0M", undefined],
      ["test-gen", "8.0M", "dim"],
      ["docs", "3.0M", "dim"],
    ]);
    expect(view.line).toBe("≈ 4.6M tokens per merged PR · 31% served by local models.");
  });

  it("tags the window's total, not the bars' sum — usage with no task kind is in it", () => {
    expect(tokensView(barCard([["implement", "implement", 1_000]], { total: 5_000 }), "30d").tag).toBe("5.0k total");
  });

  it("draws the designed empty state with no usage", () => {
    expect(tokensView(barCard([], { total: 0 }), "30d").empty).toBe(NO_TOKENS);
  });
});
