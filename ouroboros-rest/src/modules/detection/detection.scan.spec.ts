/**
 * The orchestrator's bounds and honesty ([#384](https://github.com/NobuData/ouroboros/issues/384)):
 * budget, deadline, rate limits, partial results, and a new pack with no orchestrator change.
 */

import { CORE_ROW_KEYS, type ProbeResults, type RulePack } from "./detection.pack";
import { EMPTY, NODE, ZEPHYR, fixtureProber } from "./detection.fixture";
import {
  DEFAULT_SCAN_BUDGET,
  UNDETERMINED_SENTENCES,
  isProtectedGlob,
  runScan,
  type ScanBudget,
} from "./detection.scan";
import { CORE_PACKS } from "./packs/core.packs";

/**
 * The default budget with some bounds changed.
 *
 * @param overrides - The changes.
 * @returns The budget.
 */
function budget(overrides: Partial<ScanBudget>): ScanBudget {
  return { ...DEFAULT_SCAN_BUDGET, ...overrides };
}

/** A pack emitting a custom row from the tree — the extensibility criterion's worked example. */
const LICENSE_PACK: RulePack = {
  key: "license",
  version: "0.1.0",
  rows: ["custom:license"],
  probes: () => [{ kind: "tree" }, { kind: "file", path: "LICENSE" }],
  conclude: (seen: ProbeResults) => {
    const license = seen.file("LICENSE");

    return {
      rows: [
        license == null
          ? {
              rowKey: "custom:license",
              verdict: "missing",
              value: "No LICENSE found",
              evidence: {},
              confidence: "high",
            }
          : {
              rowKey: "custom:license",
              verdict: "ok",
              value: license.content.split("\n")[0] ?? "LICENSE",
              evidence: { hit: "LICENSE" },
              confidence: "high",
            },
      ],
    };
  },
};

describe("a new rule pack", () => {
  it("adds a custom:* row with no change to the orchestrator", async () => {
    const repo = { ...ZEPHYR, files: { ...ZEPHYR.files, LICENSE: "Apache License 2.0\n..." } };
    const outcome = await runScan([...CORE_PACKS, LICENSE_PACK], fixtureProber(repo).prober);

    expect(outcome.rows.map((row) => row.rowKey)).toEqual([...CORE_ROW_KEYS, "custom:license"]);
    expect(outcome.rows.at(-1)).toMatchObject({
      rowKey: "custom:license",
      verdict: "ok",
      value: "Apache License 2.0",
      label: "detected",
      evidence: { hit: "LICENSE", pack: "license", packVersion: "0.1.0" },
    });
    expect(outcome.packVersions.license).toBe("0.1.0");
  });

  it("shares the tree the core packs already read rather than asking again", async () => {
    const { prober, calls } = fixtureProber(ZEPHYR);

    await runScan([...CORE_PACKS, LICENSE_PACK], prober);

    expect(calls.filter((call) => call === "tree")).toHaveLength(1);
    expect(calls).toContain("file:LICENSE");
  });
});

describe("the probe budget", () => {
  it("completes the Zephyr scan inside the default budget, and records its duration", async () => {
    const outcome = await runScan(CORE_PACKS, fixtureProber(ZEPHYR, { delayMs: 5 }).prober);

    expect(outcome.stopped).toBeNull();
    expect(outcome.probesUsed).toBeLessThanOrEqual(DEFAULT_SCAN_BUDGET.maxProbes);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(5);
    expect(outcome.rows.every((row) => row.evidence.undetermined === undefined)).toBe(true);
  });

  it("yields partial results when exhausted: undetermined rows are marked, never omitted", async () => {
    const { prober, calls } = fixtureProber(ZEPHYR);
    const outcome = await runScan(CORE_PACKS, prober, { budget: budget({ maxProbes: 4 }) });
    const byRow = Object.fromEntries(outcome.rows.map((row) => [row.rowKey, row]));

    expect(calls).toHaveLength(4);
    expect(outcome.probesUsed).toBe(4);
    expect(outcome.stopped).toBe("budget_exhausted");
    expect(outcome.rows.map((row) => row.rowKey)).toEqual([...CORE_ROW_KEYS]);

    // The tree-only packs finished …
    expect(byRow.build?.value).toBe("west + twister (found west.yml)");
    expect(byRow.protected_paths?.value).toBe("boot/, keys/ suggested");
    expect(byRow.conventions?.verdict).toBe("warn");
    expect(byRow.conventions?.evidence.undetermined).toBeUndefined();

    // … and the tests pack, whose suite files were cut, says so.
    expect(byRow.tests).toMatchObject({
      verdict: "warn",
      value: `Could not determine — ${UNDETERMINED_SENTENCES.budget_exhausted}`,
      confidence: "low",
      label: "detected",
      evidence: { undetermined: true, reason: "budget_exhausted", pack: "tests" },
    });
    expect(byRow.tests?.evidence.unfinished).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "skipped", reason: "budget_exhausted" }),
      ]),
    );
  });

  it("never suggests protected paths from a pack it could not conclude", async () => {
    const outcome = await runScan(CORE_PACKS, fixtureProber(ZEPHYR).prober, {
      budget: budget({ maxProbes: 1 }),
    });

    expect(outcome.protectedPaths).toEqual([]);
    expect(outcome.rows.every((row) => row.evidence.undetermined === true)).toBe(true);
    expect(outcome.rows.every((row) => row.verdict === "warn")).toBe(true);
  });

  it("cuts a pack that keeps asking for more after maxRounds", async () => {
    let asked = 0;
    const greedy: RulePack = {
      key: "greedy",
      version: "1.0.0",
      rows: ["custom:greedy"],
      probes: () => {
        asked += 1;

        return [{ kind: "file", path: `f${String(asked)}` }];
      },
      conclude: () => ({ rows: [] }),
    };
    const outcome = await runScan([greedy], fixtureProber(EMPTY).prober, {
      budget: budget({ maxRounds: 2 }),
    });

    expect(outcome.probesUsed).toBe(2);
    expect(outcome.stopped).toBe("budget_exhausted");
    expect(outcome.rows[0]?.evidence).toMatchObject({ undetermined: true });
  });
});

describe("the wall-clock ceiling", () => {
  it("abandons probes still in flight and marks their rows, recording the duration", async () => {
    const { prober } = fixtureProber(NODE, { hang: ["file:package.json"] });
    const outcome = await runScan(CORE_PACKS, prober, { budget: budget({ deadlineMs: 50 }) });
    const byRow = Object.fromEntries(outcome.rows.map((row) => [row.rowKey, row]));

    expect(outcome.stopped).toBe("deadline");
    expect(outcome.durationMs).toBeGreaterThanOrEqual(45);
    expect(outcome.durationMs).toBeLessThan(DEFAULT_SCAN_BUDGET.deadlineMs);
    expect(byRow.build?.evidence).toMatchObject({ undetermined: true, reason: "deadline" });
    expect(byRow.build?.value).toBe(`Could not determine — ${UNDETERMINED_SENTENCES.deadline}`);
    expect(outcome.rows).toHaveLength(6);
  });
});

describe("the host's rate limit (#101)", () => {
  it("stops probing at the first refusal under a constrained budget", async () => {
    const { prober, calls } = fixtureProber(ZEPHYR, { remaining: 2 });
    const outcome = await runScan(CORE_PACKS, prober, { budget: budget({ concurrency: 1 }) });

    // Two answered, one refused, and nothing sent after the refusal.
    expect(calls).toEqual(["languages", "tree", "file:west.yml"]);
    expect(outcome.stopped).toBe("rate_limited");
    expect(outcome.rows.find((row) => row.rowKey === "language")?.evidence).toMatchObject({
      undetermined: true,
      reason: "rate_limited",
    });
    expect(outcome.rows.find((row) => row.rowKey === "conventions")?.verdict).toBe("warn");
    expect(outcome.rows).toHaveLength(6);
  });

  it("spends at most one refused request when the workspace starts at the floor", async () => {
    const { prober, calls } = fixtureProber(ZEPHYR, { remaining: 0 });
    const outcome = await runScan(CORE_PACKS, prober, { budget: budget({ concurrency: 1 }) });

    expect(calls).toHaveLength(1);
    expect(outcome.rows.every((row) => row.evidence.undetermined === true)).toBe(true);
  });

  it("keeps parallel probes within the concurrency bound", async () => {
    const fixture = fixtureProber(ZEPHYR, { delayMs: 5 });

    await runScan(CORE_PACKS, fixture.prober, { budget: budget({ concurrency: 2 }) });

    expect(fixture.peakInFlight()).toBeLessThanOrEqual(2);
    expect(fixture.peakInFlight()).toBeGreaterThan(1);
  });
});

describe("a host failure that is not a rate limit", () => {
  it("marks the packs that needed the probe and carries on with the rest", async () => {
    const { prober, calls } = fixtureProber(ZEPHYR, { fail: ["file:.devcontainer.json"] });
    const outcome = await runScan(CORE_PACKS, prober);
    const byRow = Object.fromEntries(outcome.rows.map((row) => [row.rowKey, row]));

    expect(outcome.stopped).toBeNull();
    expect(byRow.devcontainer?.evidence).toMatchObject({ undetermined: true, reason: "error" });
    expect(byRow.tests?.value).toBe("5 suites, 63 tests (detected)");
    expect(calls).toHaveLength(9);
  });
});

describe("a pack that misbehaves", () => {
  const base = { version: "1.0.0", conclude: () => ({ rows: [] }) };

  it("is marked undetermined when probes() throws", async () => {
    const outcome = await runScan(
      [
        {
          ...base,
          key: "throws",
          rows: ["custom:a"],
          probes: () => {
            throw new Error("bug");
          },
        },
      ],
      fixtureProber(EMPTY).prober,
    );

    expect(outcome.rows[0]).toMatchObject({
      rowKey: "custom:a",
      verdict: "warn",
      evidence: { undetermined: true, reason: "pack_failed" },
    });
  });

  it("is marked undetermined when conclude() throws", async () => {
    const outcome = await runScan(
      [
        {
          ...base,
          key: "throws",
          rows: ["custom:a"],
          probes: () => [],
          conclude: () => {
            throw new Error("bug");
          },
        },
      ],
      fixtureProber(EMPTY).prober,
    );

    expect(outcome.rows[0]?.evidence).toMatchObject({ reason: "pack_failed" });
  });

  it("has a declared row it did not conclude marked, and an undeclared row dropped", async () => {
    const outcome = await runScan(
      [
        {
          ...base,
          key: "partial",
          rows: ["custom:a", "custom:b"],
          probes: () => [],
          conclude: () => ({
            rows: [
              {
                rowKey: "custom:a",
                verdict: "ok",
                value: "fine",
                evidence: {},
                confidence: "high",
              },
              {
                rowKey: "custom:zzz",
                verdict: "ok",
                value: "stray",
                evidence: {},
                confidence: "high",
              },
              { rowKey: "custom:b", verdict: "ok", value: "   ", evidence: {}, confidence: "high" },
            ],
          }),
        },
      ],
      fixtureProber(EMPTY).prober,
    );

    expect(outcome.rows.map((row) => [row.rowKey, row.value])).toEqual([
      ["custom:a", "fine"],
      ["custom:b", `Could not determine — ${UNDETERMINED_SENTENCES.not_concluded}`],
    ]);
  });

  it("cannot restate its own provenance in the evidence", async () => {
    const outcome = await runScan(
      [
        {
          ...base,
          key: "honest",
          rows: ["custom:a"],
          probes: () => [],
          conclude: () => ({
            rows: [
              {
                rowKey: "custom:a",
                verdict: "ok",
                value: "fine",
                evidence: { pack: "someone-else", packVersion: "9.9.9" },
                confidence: "high",
              },
            ],
          }),
        },
      ],
      fixtureProber(EMPTY).prober,
    );

    expect(outcome.rows[0]?.evidence).toMatchObject({ pack: "honest", packVersion: "1.0.0" });
  });

  it("never reaches the host with a path that is not relative", async () => {
    const { prober, calls } = fixtureProber(EMPTY);
    const outcome = await runScan(
      [
        {
          ...base,
          key: "escape",
          rows: ["custom:a"],
          probes: () => [{ kind: "file", path: "../../etc/passwd" }],
        },
      ],
      prober,
    );

    expect(calls).toEqual([]);
    expect(outcome.rows[0]?.evidence).toMatchObject({ undetermined: true, reason: "error" });
  });

  it("has only well-formed protected globs stored", async () => {
    const outcome = await runScan(
      [
        {
          ...base,
          key: "globs",
          rows: ["custom:a"],
          probes: () => [],
          conclude: () => ({
            rows: [
              { rowKey: "custom:a", verdict: "ok", value: "x", evidence: {}, confidence: "low" },
            ],
            protectedPaths: ["boot/**", "/abs/**", "../up/**", " spaced", "ok/**", "boot/**"],
          }),
        },
      ],
      fixtureProber(EMPTY).prober,
    );

    expect(outcome.protectedPaths).toEqual(["boot/**", "ok/**"]);
  });
});

describe("isProtectedGlob", () => {
  it("is V067's protected_path_policies_glob_format", () => {
    expect(isProtectedGlob("keys/**")).toBe(true);
    expect(isProtectedGlob("")).toBe(false);
    expect(isProtectedGlob("a\\b")).toBe(false);
    expect(isProtectedGlob("a/../b")).toBe(false);
    expect(isProtectedGlob("a\u0007b")).toBe(false);
    expect(isProtectedGlob("x".repeat(513))).toBe(false);
  });
});

describe("progress", () => {
  it("reports every probe as it settles", async () => {
    const events: { planned: number; settled: number }[] = [];

    await runScan(CORE_PACKS, fixtureProber(ZEPHYR).prober, {
      onProgress: (event) => events.push(event),
    });

    expect(events.at(-1)).toEqual({ planned: 9, settled: 9 });
    expect(events.every((event) => event.settled <= event.planned)).toBe(true);
  });
});
