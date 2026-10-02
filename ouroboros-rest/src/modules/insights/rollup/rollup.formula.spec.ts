import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROLLUP_EXTRACTORS } from "./rollup.extractors";
import {
  extractorPath,
  formulaDrift,
  formulaFingerprint,
  formulaSources,
  readFormulaLock,
  SOURCE_ROOT,
  type FormulaState,
} from "./rollup.formula.fixture";

/**
 * Formula-version enforcement (BJ.5, #441): a family whose computation moved without a
 * `metric_definitions.version` rising fails this suite — and so `ci/rest`. The mutation cases
 * below are the proof that it would: each edits a formula in memory and asserts the check
 * notices, so the check cannot quietly stop checking.
 */

/** The absolute path of a module under `src/`. */
const src = (path: string): string => join(SOURCE_ROOT, path);

const THROUGHPUT = extractorPath("throughput");
const UNTOUCHED = src("modules/insights/untouched.sql.ts");
const PROVIDERS = src("modules/internal/providers.ts");

/**
 * A family's state with some sources edited in memory.
 *
 * @param family - The family.
 * @param edits - Absolute path → a function from the file's text to its edited text.
 * @param metrics - Versions to claim instead of the extractor's own.
 * @returns The state the check would see.
 */
function stateOf(
  family: string,
  edits: Readonly<Record<string, (text: string) => string>> = {},
  metrics?: Readonly<Record<string, number>>,
): FormulaState {
  const extractor = ROLLUP_EXTRACTORS.find((candidate) => candidate.family === family);

  if (extractor === undefined) {
    throw new Error(`no ${family} extractor`);
  }

  const overrides = new Map(
    Object.entries(edits).map(([path, edit]) => [path, edit(readFileSync(path, "utf8"))]),
  );

  return {
    family,
    metrics: metrics ?? extractor.metrics,
    fingerprint: formulaFingerprint(formulaSources(extractorPath(family)), overrides),
  };
}

/**
 * Replace exactly one occurrence, so an edit that stops matching fails loudly instead of
 * proving nothing.
 */
function once(find: string, replace: string): (text: string) => string {
  return (text) => {
    expect(text.split(find)).toHaveLength(2);
    return text.replace(find, replace);
  };
}

describe("the formula lock", () => {
  const lock = readFormulaLock();

  it("matches every shipped family — a formula changed without a version bump fails here", () => {
    const drift = ROLLUP_EXTRACTORS.flatMap((extractor) =>
      formulaDrift(stateOf(extractor.family), lock[extractor.family]),
    );

    expect(drift).toEqual([]);
  });

  it("locks the families the extractors fill, and no other", () => {
    expect(Object.keys(lock).sort()).toEqual(
      ROLLUP_EXTRACTORS.map((extractor) => extractor.family).sort(),
    );
  });
});

describe("a family's formula sources", () => {
  const paths = (family: string): string[] =>
    formulaSources(extractorPath(family)).map((part) => part.path);

  it("take the insights modules an extractor computes with — I6's predicate, revert detection", () => {
    expect(paths("throughput")).toEqual(
      expect.arrayContaining([
        THROUGHPUT,
        UNTOUCHED,
        src("modules/insights/rollup/rollup.rows.ts"),
      ]),
    );
    expect(paths("dora")).toContain(src("modules/insights/rollup/revert.detection.ts"));
  });

  it("leave out type-only imports, which compute nothing", () => {
    expect(paths("throughput")).not.toContain(src("modules/insights/rollup/rollup.types.ts"));
  });

  it("take only the named declarations of a module outside insights", () => {
    expect(formulaSources(extractorPath("cost"))).toContainEqual({
      path: PROVIDERS,
      names: new Set(["LOCAL_PROVIDER_KINDS"]),
    });
  });
});

describe("the fingerprint", () => {
  const before = stateOf("throughput").fingerprint;

  it("ignores comments and formatting", () => {
    const reformat = once("count(*) as closed,", "count(*)    as\n             closed,");
    const redocument = once(
      "export const throughputExtractor",
      "/** Documented anew. */\n// And remarked upon.\nexport const throughputExtractor",
    );
    const edited = stateOf("throughput", {
      [THROUGHPUT]: (text) => `// A new header line.\n${redocument(reformat(text))}`,
    });

    expect(edited.fingerprint).toBe(before);
  });

  it("moves when the extractor's computation does", () => {
    expect(
      stateOf("throughput", {
        [THROUGHPUT]: once("run_status = 'merged'", "run_status <> 'stopped'"),
      }).fingerprint,
    ).not.toBe(before);
  });

  it("moves when a shared insights predicate does — I6 is a throughput formula too", () => {
    // Dropping the human-push check: every revision would count as the loop's.
    const edited = stateOf("throughput", {
      [UNTOUCHED]: once("`and not exists (select 1 from ouroboros.run_commits c `", "`and false `"),
    });

    expect(edited.fingerprint).not.toBe(before);
  });

  it("moves for the cost family on the local kinds, and not on the rest of their module", () => {
    const cost = stateOf("cost").fingerprint;

    expect(
      stateOf("cost", {
        [PROVIDERS]: once('"anthropic", "copilot", "cursor"', '"anthropic", "copilot"'),
      }).fingerprint,
    ).toBe(cost);
    expect(
      stateOf("cost", { [PROVIDERS]: once('["ollama", "openai_compatible"]', '["ollama"]') })
        .fingerprint,
    ).not.toBe(cost);
  });
});

describe("the drift rule", () => {
  const lock = readFormulaLock();
  const edit = { [THROUGHPUT]: once("run_status = 'merged'", "run_status <> 'stopped'") };

  it("fails a formula change without a version bump", () => {
    expect(formulaDrift(stateOf("throughput", edit), lock.throughput)).toEqual([
      expect.stringMatching(/^the throughput formula changed without a version bump/),
    ]);
  });

  it("asks only for the lock to be recorded once a version rose with the change", () => {
    const bumped = { merged_prs: 1, merge_rate: 2, merged_untouched_rate: 1 };

    expect(formulaDrift(stateOf("throughput", edit, bumped), lock.throughput)).toEqual([
      expect.stringMatching(/^the throughput entry in rollup\.formula\.lock\.json is out of date/),
    ]);
  });

  it("does not count a version that fell as a bump", () => {
    const lowered = { merged_prs: 0, merge_rate: 1, merged_untouched_rate: 1 };

    expect(formulaDrift(stateOf("throughput", edit, lowered), lock.throughput)).toEqual([
      expect.stringMatching(/changed without a version bump/),
    ]);
  });

  it("counts a metric new to the family as a rise", () => {
    const state: FormulaState = {
      family: "throughput",
      metrics: { merged_prs: 1, merge_rate: 1, merged_untouched_rate: 1, opened_prs: 1 },
      fingerprint: "sha256:moved",
    };

    expect(formulaDrift(state, lock.throughput)).toEqual([expect.stringMatching(/is out of date/)]);
  });

  it("names a family the lock has never seen", () => {
    expect(formulaDrift(stateOf("throughput"), undefined)).toEqual([
      expect.stringMatching(/^throughput has no entry in rollup\.formula\.lock\.json — record \{/),
    ]);
  });
});
