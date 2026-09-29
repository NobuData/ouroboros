/**
 * Golden row sets for the four fixture repositories
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)) — the core packs, run through the real
 * orchestrator, against a prober that answers from the fixture.
 */

import { CORE_ROW_KEYS } from "./detection.pack";
import { EMPTY, NODE, PYTHON, ZEPHYR, fixtureProber, type FixtureRepo } from "./detection.fixture";
import { runScan, type ScanOutcome } from "./detection.scan";
import { NO_CONTRIBUTING } from "./packs/conventions.pack";
import { CORE_PACKS } from "./packs/core.packs";

/**
 * Scan a fixture with the core packs and the default budget.
 *
 * @param repo - The fixture.
 * @returns The outcome, and the probes the fixture was asked.
 */
async function scan(repo: FixtureRepo): Promise<ScanOutcome & { calls: string[] }> {
  const { prober, calls } = fixtureProber(repo);

  return { ...(await runScan(CORE_PACKS, prober)), calls };
}

/**
 * The card as `[row, verdict, value, label]` — what the golden files pin.
 *
 * @param outcome - The scan.
 * @returns The rows.
 */
function card(outcome: ScanOutcome): [string, string, string, string][] {
  return outcome.rows.map((row) => [row.rowKey, row.verdict, row.value, row.label]);
}

describe("the Zephyr-like fixture — mockup 13's card", () => {
  it("reproduces the six rows, conventions warn included", async () => {
    expect(card(await scan(ZEPHYR))).toEqual([
      ["language", "ok", "C 92% · Zephyr RTOS 4.1", "detected"],
      ["build", "ok", "west + twister (found west.yml)", "detected"],
      [
        "devcontainer",
        "ok",
        "found .devcontainer.json → image ghcr.io/zephyrproject-rtos/ci:v0.27.4",
        "detected",
      ],
      ["tests", "ok", "5 suites, 63 tests (detected)", "detected"],
      ["protected_paths", "ok", "boot/, keys/ suggested", "detected"],
      ["conventions", "warn", NO_CONTRIBUTING, "detected"],
    ]);
  });

  it("carries the evidence each row was concluded from", async () => {
    const outcome = await scan(ZEPHYR);
    const evidence = Object.fromEntries(outcome.rows.map((row) => [row.rowKey, row.evidence]));

    expect(evidence.language).toMatchObject({
      pack: "language",
      packVersion: "1.0.0",
      top: { language: "C", percent: 92 },
      framework: { name: "Zephyr RTOS 4.1", from: "west.yml" },
      probes: ["languages", "tree", "file:west.yml"],
    });
    expect(evidence.build).toMatchObject({ hit: "west.yml", alsoFound: ["CMakeLists.txt"] });
    expect(evidence.devcontainer).toMatchObject({ hit: ".devcontainer.json", parsed: true });
    expect(evidence.tests).toMatchObject({
      ecosystems: ["zephyr"],
      suites: 5,
      tests: 63,
      filesRead: 5,
      filesTotal: 5,
      sampled: false,
      confidence: "medium",
    });
    expect(evidence.protected_paths).toMatchObject({
      suggested: [
        { glob: "boot/**", why: "bootloader" },
        { glob: "keys/**", why: "key and secret material" },
      ],
    });
    expect(evidence.conventions).toMatchObject({
      contributing: null,
      codeowners: null,
      commitConvention: null,
    });
  });

  it("suggests boot/** and keys/** as protected paths", async () => {
    expect((await scan(ZEPHYR)).protectedPaths).toEqual(["boot/**", "keys/**"]);
  });

  it("spends nine probes, each asked once, well inside the default budget", async () => {
    const outcome = await scan(ZEPHYR);

    expect(outcome.probesUsed).toBe(9);
    expect(outcome.calls).toHaveLength(9);
    expect(new Set(outcome.calls).size).toBe(9);
    expect(outcome.stopped).toBeNull();
    expect(outcome.packVersions).toEqual({
      language: "1.0.0",
      build: "1.0.0",
      devcontainer: "1.0.0",
      tests: "1.0.0",
      protected_paths: "1.0.0",
      conventions: "1.0.0",
    });
  });
});

describe("the Node fixture", () => {
  it("produces its golden rows", async () => {
    expect(card(await scan(NODE))).toEqual([
      ["language", "ok", "TypeScript 80% · Express", "detected"],
      ["build", "ok", "yarn + jest (found package.json)", "detected"],
      [
        "devcontainer",
        "ok",
        "found .devcontainer/devcontainer.json → Dockerfile Dockerfile · features: node",
        "detected",
      ],
      ["tests", "ok", "2 suites, 5 tests (detected)", "detected"],
      ["protected_paths", "ok", "infra/ suggested", "detected"],
      [
        "conventions",
        "ok",
        "found CONTRIBUTING.md · .github/CODEOWNERS · commitlint.config.js",
        "detected",
      ],
    ]);
  });

  it("never counts vendored code", async () => {
    const outcome = await scan(NODE);

    expect(outcome.calls.some((call) => call.includes("node_modules"))).toBe(false);
  });
});

describe("the Python fixture", () => {
  it("produces its golden rows", async () => {
    expect(card(await scan(PYTHON))).toEqual([
      ["language", "ok", "Python 100% · FastAPI", "detected"],
      ["build", "ok", "uv + pytest (found pyproject.toml)", "detected"],
      ["devcontainer", "missing", "No devcontainer found", "detected"],
      ["tests", "ok", "2 suites, 5 tests (detected)", "detected"],
      ["protected_paths", "missing", "No protected paths suggested", "detected"],
      ["conventions", "ok", "found .github/CONTRIBUTING.md", "detected"],
    ]);
  });
});

describe("the empty repository", () => {
  it("produces honest missing rows rather than fabricated conclusions", async () => {
    const outcome = await scan(EMPTY);

    expect(card(outcome)).toEqual([
      ["language", "missing", "No source code found", "detected"],
      ["build", "missing", "No build manifest found", "detected"],
      ["devcontainer", "missing", "No devcontainer found", "detected"],
      ["tests", "missing", "No tests found", "detected"],
      ["protected_paths", "missing", "No protected paths suggested", "detected"],
      ["conventions", "missing", "Empty repository — no conventions to read yet", "detected"],
    ]);
    expect(outcome.rows.every((row) => row.evidence.undetermined === undefined)).toBe(true);
    expect(outcome.protectedPaths).toEqual([]);
    expect(outcome.probesUsed).toBe(2);
  });
});

describe("every fixture", () => {
  it.each([
    ["Zephyr", ZEPHYR],
    ["Node", NODE],
    ["Python", PYTHON],
    ["empty", EMPTY],
  ])("%s emits exactly the six core rows, in card order", async (_name, repo) => {
    expect((await scan(repo)).rows.map((row) => row.rowKey)).toEqual([...CORE_ROW_KEYS]);
  });
});
