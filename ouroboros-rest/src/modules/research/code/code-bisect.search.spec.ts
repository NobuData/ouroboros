import {
  applyVerdict,
  type BisectWindow,
  maxSteps,
  nextMove,
  type Verdict,
} from "./code-bisect.search";

/**
 * Run a whole bisect over a scripted-failure line: every candidate from `culprit` on builds bad.
 *
 * @param candidates - n.
 * @param culprit - The planted culprit's index, or `null` for a line where everything builds good.
 * @returns The outcome and the candidates built, in order.
 */
function bisect(
  candidates: number,
  culprit: number | null,
): { outcome: "converged" | "inconclusive" | "exhausted"; found?: number; built: number[] } {
  let window: BisectWindow = {
    lo: 0,
    hi: candidates - 1,
    steps: 0,
    maxSteps: maxSteps(candidates),
  };
  const built: number[] = [];

  for (;;) {
    const move = nextMove(window);
    if (move.kind === "converged") return { outcome: "converged", found: move.culprit, built };
    if (move.kind === "exhausted") return { outcome: "exhausted", built };

    built.push(move.candidate);
    const verdict: Verdict = culprit !== null && move.candidate >= culprit ? "bad" : "good";
    const applied = applyVerdict(window, move.candidate, verdict);
    if (applied.kind === "inconclusive") return { outcome: "inconclusive", built };
    window = { ...window, lo: applied.lo, hi: applied.hi, steps: window.steps + 1 };
  }
}

describe("the bisect search", () => {
  it("walks the fixture's six candidates to the planted culprit in two builds", () => {
    // c2…c7, culprit c4 (index 2) — the engine fixture's `Gust feed-forward in PID`.
    expect(bisect(6, 2)).toEqual({ outcome: "converged", found: 2, built: [2, 1] });
  });

  it("isolates every planted culprit within ⌊log₂ n⌋ + 1 farm jobs, for every n up to 300", () => {
    for (let n = 1; n <= 300; n += 1) {
      for (let culprit = 0; culprit < n; culprit += 1) {
        const run = bisect(n, culprit);

        expect(run).toMatchObject({ outcome: "converged", found: culprit });
        expect(run.built.length).toBeLessThanOrEqual(Math.floor(Math.log2(n)) + 1);
        expect(run.built.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("never builds the same candidate twice", () => {
    for (let n = 1; n <= 64; n += 1) {
      for (let culprit = 0; culprit < n; culprit += 1) {
        const { built } = bisect(n, culprit);
        expect(new Set(built).size).toBe(built.length);
      }
    }
  });

  it("confirms a one-commit line with one build rather than citing nothing", () => {
    expect(bisect(1, 0)).toEqual({ outcome: "converged", found: 0, built: [0] });
  });

  it("calls a bad commit that builds good inconclusive, never a guess", () => {
    expect(bisect(1, null)).toEqual({ outcome: "inconclusive", built: [0] });
  });

  it("names the bad commit itself when everything before it builds good", () => {
    const run = bisect(9, null);

    expect(run.outcome).toBe("converged");
    expect(run.found).toBe(8);
  });

  it("refuses a step past the bound rather than taking it", () => {
    expect(nextMove({ lo: 0, hi: 5, steps: 3, maxSteps: 3 })).toEqual({ kind: "exhausted" });
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
    [6, 3],
    [8, 4],
    [300, 9],
    [10_000, 14],
  ])("bounds a line of %i at %i steps", (n, steps) => {
    expect(maxSteps(n)).toBe(steps);
  });
});
