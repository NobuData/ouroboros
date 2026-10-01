/**
 * The safe-first-issue score ([#387](https://github.com/NobuData/ouroboros/issues/387), BB.4) —
 * the seeded pick and its line, weight changes reordering predictably, disqualification, cost
 * honesty, and the line being assembled from components.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { candidate, hoursAgo, NOW, SEEDED_CANDIDATES } from "./first-issue.fixture";
import {
  bySafety,
  FRAGMENT_SEPARATOR,
  LINE_COMPONENTS,
  loopMinutesOf,
  SAFETY_WEIGHTS,
  scoreCandidate,
  type SafetyWeights,
  type ScoreResult,
} from "./first-issue.score";

type Scored = Extract<ScoreResult, { disqualified: false }>;

/**
 * Score a row and insist it qualified.
 *
 * @param result - The score.
 * @returns It, narrowed.
 */
function qualified(result: ScoreResult): Scored {
  if (result.disqualified) {
    throw new Error(`expected a qualifying score, got ${result.reason}`);
  }

  return result;
}

/**
 * The seeded backlog's qualifying numbers, safest first, under some weights.
 *
 * @param weights - The weights.
 * @param globs - Protected paths.
 * @returns The issue numbers in order.
 */
function order(weights: SafetyWeights = SAFETY_WEIGHTS, globs: string[] = []): number[] {
  return SEEDED_CANDIDATES.flatMap((row) => {
    const result = scoreCandidate(row, globs, NOW, weights);

    return result.disqualified ? [] : [{ number: row.number, score: result.score }];
  })
    .sort(bySafety)
    .map((entry) => entry.number);
}

describe("the safe-first-issue score", () => {
  describe("against the seeded backlog", () => {
    it("ranks #488 first with the mockup's reasoning line", () => {
      const pick = qualified(scoreCandidate(candidate(), [], NOW));

      expect(order()[0]).toBe(488);
      expect(pick.line).toBe("no code paths touched · est. 4 min");
      expect(pick.clearsBar).toBe(true);
    });

    it("orders the qualifying candidates by score, then by number", () => {
      // 488: 35 + 30 + 25 + 9.4 · 491: 20 + 15 + 5 + 9.9 · 485 and 489 tie at 34.9 · 484: 34.5
      expect(order()).toEqual([488, 491, 485, 489, 484]);
      expect(qualified(scoreCandidate(SEEDED_CANDIDATES[4], [], NOW)).score).toBe(99.4);
    });

    it("leaves only #488 and #491 above the safety bar", () => {
      const clearing = SEEDED_CANDIDATES.filter((row) => {
        const result = scoreCandidate(row, [], NOW);

        return !result.disqualified && result.clearsBar;
      }).map((row) => row.number);

      expect(clearing).toEqual([488, 491]);
    });
  });

  describe("weights", () => {
    it("are versioned and add up to 100", () => {
      const max =
        Math.max(...Object.values(SAFETY_WEIGHTS.effort)) +
        Math.max(SAFETY_WEIGHTS.otherWorkflow, ...Object.values(SAFETY_WEIGHTS.workflow)) +
        Math.max(SAFETY_WEIGHTS.paths.noCode, SAFETY_WEIGHTS.paths.code) +
        SAFETY_WEIGHTS.freshness.max;

      expect(SAFETY_WEIGHTS.version).toBe("safety-v1");
      expect(max).toBe(100);
    });

    it("reorder predictably when the effort weight flips S above XS", () => {
      const weights: SafetyWeights = { ...SAFETY_WEIGHTS, effort: { xs: 0, s: 60, m: 5 } };

      // 491: 60 + 15 + 5 + 9.9 = 89.9 over 488: 0 + 30 + 25 + 9.4 = 64.4.
      expect(order(weights)).toEqual([491, 488, 485, 489, 484]);
    });

    it("reorder predictably when freshness dominates", () => {
      const weights: SafetyWeights = {
        ...SAFETY_WEIGHTS,
        freshness: { max: 1000, halfLifeDays: 1 },
      };

      // Recency now outweighs everything but #488's 90 base points over #484's 25:
      // 485 942 · 489 916 · 491 906 · 488 510 · 484 497.
      expect(order(weights)).toEqual([485, 489, 491, 488, 484]);
    });

    it("move the bar: raising it above #491 leaves #488 alone", () => {
      const weights: SafetyWeights = { ...SAFETY_WEIGHTS, safetyBar: 60 };

      expect(qualified(scoreCandidate(SEEDED_CANDIDATES[6], [], NOW, weights)).clearsBar).toBe(
        false,
      );
      expect(qualified(scoreCandidate(candidate(), [], NOW, weights)).clearsBar).toBe(true);
    });

    it("score a workflow they do not name as feature-shaped", () => {
      const result = qualified(
        scoreCandidate(candidate({ suggestedWorkflow: "feature-loop" }), [], NOW),
      );

      expect(result.components.find((c) => c.key === "workflow")?.points).toBe(
        SAFETY_WEIGHTS.otherWorkflow,
      );
    });
  });

  describe("disqualification", () => {
    it("disqualifies a candidate touching a protected path, whatever it would score", () => {
      const row = candidate({ files: ["docs/manual.md", "boot/loader.c"] });
      const result = scoreCandidate(row, ["boot/**", "keys/**"], NOW);

      expect(result).toEqual({
        disqualified: true,
        reason: "protected_path",
        protectedGlobs: ["boot/**"],
      });
    });

    it("keeps the candidate out of the ranking rather than down-ranking it", () => {
      expect(order(SAFETY_WEIGHTS, ["src/config/**"])).toEqual([488, 485, 489, 484]);
    });

    it("excludes L and above from first picks", () => {
      expect(scoreCandidate(candidate({ effort: "l" }), [], NOW)).toMatchObject({
        disqualified: true,
        reason: "too_large",
      });
      expect(scoreCandidate(candidate({ effort: "xl" }), [], NOW)).toMatchObject({
        disqualified: true,
        reason: "too_large",
      });
    });

    it("lets a protected glob that matches nothing stand", () => {
      expect(scoreCandidate(candidate(), ["keys/**"], NOW).disqualified).toBe(false);
    });
  });

  describe("path risk", () => {
    it("scores documentation-only files as touching no code path", () => {
      const result = qualified(
        scoreCandidate(candidate({ files: ["docs/operator-manual.md", "README.md"] }), [], NOW),
      );

      expect(result.components.find((c) => c.key === "paths")).toMatchObject({
        signal: "no_code",
        points: SAFETY_WEIGHTS.paths.noCode,
        label: "no code paths touched",
      });
    });

    it("counts the code files a breakdown names", () => {
      const one = qualified(
        scoreCandidate(candidate({ files: ["docs/a.md", "src/a.c"] }), [], NOW),
      );
      const two = qualified(scoreCandidate(candidate({ files: ["src/a.c", "src/b.c"] }), [], NOW));

      expect(one.line).toBe("1 code path touched · est. 4 min");
      expect(two.components.find((c) => c.key === "paths")).toMatchObject({
        signal: "code",
        points: SAFETY_WEIGHTS.paths.code,
      });
    });
  });

  describe("estimate and cost", () => {
    it("derives the minutes from the estimate's cycle range", () => {
      const result = qualified(scoreCandidate(candidate({ cycleMin: 12, cycleMax: 18 }), [], NOW));

      expect(result.loopMinutes).toBe(15);
      expect(result.line).toBe("no code paths touched · est. 15 min");
    });

    it.each([
      [3, 6, 4],
      [8, 14, 11],
      [1, 2, 1],
      [5, 5, 5],
    ])("prints a %i–%i minute cycle as its midpoint, rounded down: %i", (min, max, minutes) => {
      expect(loopMinutesOf(min, max)).toBe(minutes);
    });

    it("leaves cost out of the payload entirely when the model is unpriced", () => {
      const result = qualified(scoreCandidate(candidate({ price: null }), [], NOW));

      expect(result).not.toHaveProperty("cost");
      expect(result.fragments.map((f) => f.source)).not.toContain("cost");
    });

    it("leaves cost out for seat- and usage-billed models too", () => {
      for (const billingMode of ["seat", "usage"] as const) {
        const row = candidate({ price: { billingMode, inputCentsPer1m: null } });

        expect(qualified(scoreCandidate(row, [], NOW))).not.toHaveProperty("cost");
      }
    });

    it("prints the cost when the model is priced — the mockup's $0.03", () => {
      // 25 000 tokens at 120¢ per 1M input tokens is 3¢.
      const row = candidate({ price: { billingMode: "token", inputCentsPer1m: "120" } });
      const result = qualified(scoreCandidate(row, [], NOW));

      expect(result.cost).toEqual({ cents: 3, display: "$0.03" });
      expect(result.line).toBe("no code paths touched · est. 4 min · est. $0.03");
    });

    it("prints a free model's real zero, and never rounds a real cost down to nothing", () => {
      const free = candidate({ price: { billingMode: "free", inputCentsPer1m: null } });
      const tiny = candidate({ price: { billingMode: "token", inputCentsPer1m: "1" } });

      expect(qualified(scoreCandidate(free, [], NOW)).cost).toEqual({ cents: 0, display: "$0.00" });
      expect(qualified(scoreCandidate(tiny, [], NOW)).cost).toEqual({
        cents: 0,
        display: "< $0.01",
      });
    });
  });

  describe("freshness", () => {
    it("halves every half-life of quiet, and reads a future stamp as today", () => {
      const fresh = qualified(scoreCandidate(candidate({ updatedAt: NOW }), [], NOW));
      const old = qualified(scoreCandidate(candidate({ updatedAt: hoursAgo(14 * 24) }), [], NOW));
      const ahead = qualified(scoreCandidate(candidate({ updatedAt: hoursAgo(-5) }), [], NOW));

      expect(fresh.components.find((c) => c.key === "freshness")).toMatchObject({
        points: 10,
        signal: "0",
        label: "active today",
      });
      expect(old.components.find((c) => c.key === "freshness")).toMatchObject({
        points: 5,
        label: "active 14d ago",
      });
      expect(ahead.components.find((c) => c.key === "freshness")?.points).toBe(10);
    });
  });

  describe("reasoning", () => {
    it("assembles the line from its fragments, and each fragment from a component or the estimate", () => {
      for (const row of SEEDED_CANDIDATES) {
        const result = scoreCandidate(row, [], NOW);

        if (result.disqualified) {
          continue;
        }

        const labels = new Map(result.components.map((c) => [c.key, c.label]));

        expect(result.line).toBe(result.fragments.map((f) => f.text).join(FRAGMENT_SEPARATOR));
        expect(result.fragments[0]).toEqual({ source: "paths", text: labels.get("paths") });
        expect(result.fragments[1]).toEqual({
          source: "estimate",
          text: `est. ${String(result.loopMinutes)} min`,
        });
        expect(result.score).toBeCloseTo(
          result.components.reduce((sum, c) => sum + c.points, 0),
          5,
        );
      }

      expect(LINE_COMPONENTS).toEqual(["paths"]);
    });

    it("writes no sentence for a particular issue — the picker's files never name one", () => {
      const sources = ["first-issue.service.ts", "first-issue.resources.ts", "first-issue.score.ts"]
        .map((file) => readFileSync(join(__dirname, file), "utf8"))
        .join("\n")
        // Documentation may quote the mockup; code may not.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      // The only line text is the components' own templates, never a pick's.
      expect(sources).not.toMatch(/#?488|Typo sweep|est\. 4 min/);
    });
  });
});
