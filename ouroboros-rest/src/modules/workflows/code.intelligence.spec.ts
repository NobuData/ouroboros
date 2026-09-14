import { join } from "node:path";

import { GoldenFile } from "../../testing/golden.fixture";
import { readPublishedDslSchema } from "./catalog.schema";
import { mergeCodeDiagnostics } from "./code.diagnostics";
import { STAGE_CALLEES, STAGE_OPTIONS } from "./code.grammar";
import {
  contextsIn,
  diagnoseFile,
  disagreements,
  expectEditorOrder,
  expectHonestRows,
  formatContext,
  GOLDEN_DIR,
  MERGED_CASE,
  openGoldens,
  PARSE_REFUSAL,
  parseRefusal,
  readCanonical,
  recorded,
  REGENERATE,
  sabotagedFiles,
  seedCaseName,
  seedFiles,
  shiftCases,
  shiftedDiagnostics,
  shiftedSpans,
  spanOf,
  stageCallsOf,
  suggestionsFor,
  unoffered,
  WORKSPACE_STATES,
  type Diagnosed,
  type SeedFile,
  type WorkspaceState,
} from "./code.intelligence.fixture";
import { buildCodeSymbols, codeSymbolTable, SUGGESTION_SCOPES } from "./code.symbols";

/**
 * The code view's intelligence, held to committed fixtures — W.3
 * ([#179](https://github.com/NobuData/ouroboros/issues/179)).
 *
 * Range mapping and completion contexts drift silently: a grammar change that adds a line to the
 * printed output shifts every span below it, nothing crashes, and diagnostics start pointing one
 * line off. The issue's harness suites, each against `schemas/workflow-dsl/fixtures/code-intelligence/`:
 *
 *   * **Node→span accuracy across every seed**, held to `spans.json` and to the lines the
 *     TypeScript compiler finds each stage call on — including edit-shift cases, where a stage's
 *     description or prompt grows or shrinks and every span and finding below it moves by exactly
 *     that many lines.
 *   * **Diagnostics merge** — ordering and severity ranking across parse errors, validation
 *     findings and reference checks, held to `diagnostics.json`.
 *   * **Checks summary derivation**, held to `checks.json`, with decision C7's *no infra row*.
 *   * **Completion contexts per stage type** — every word each stage type's calls write is offered
 *     by the symbol table at the scope the editor completes it from, held to `contexts.json`.
 *
 * `code.intelligence.integration-spec.ts` holds the served payloads to the same goldens. A change
 * that moves an answer fails naming the golden, the case and the command below; the diff it writes
 * is the review.
 *
 * ```bash
 * OURO_UPDATE_GOLDENS=1 yarn jest src/modules/workflows/code.intelligence.spec.ts
 * ```
 */

/** The goldens, compared against — or rewritten, under `OURO_UPDATE_GOLDENS=1`. */
const GOLDENS = openGoldens();

/** Every seeded document, as the code view opens it. */
const SEEDS = seedFiles();

/** The seeded `standard-fix` v14 — mockup 04's canvas. */
const CANVAS = SEEDS.find((seed) => seed.tag === "standard_fix_v14") as SeedFile;

/** The static symbol table, built from the committed schema as the service builds it at boot. */
const STATIC_TABLE = buildCodeSymbols(readPublishedDslSchema());

/** Each seed's diagnosis in each workspace, by golden case name. */
const DIAGNOSES = new Map<string, Diagnosed>();

/**
 * A seed's diagnosis in a workspace, computed once.
 *
 * @param seed - The seed.
 * @param state - The workspace.
 * @returns The diagnosis.
 */
function diagnosed(seed: SeedFile, state: WorkspaceState): Diagnosed {
  const name = seedCaseName(seed.tag, state);
  const diagnosis = DIAGNOSES.get(name) ?? diagnoseFile(seed, state);
  DIAGNOSES.set(name, diagnosis);
  return diagnosis;
}

/** The sabotaged canvases, each read as the code view would store it. */
const SABOTAGED = sabotagedFiles(CANVAS).map((file) => ({
  ...file,
  diagnosed: diagnoseFile(readCanonical(CANVAS.slug, file.text), "seeded"),
}));

/** Every seed in every workspace, as `[case name, seed, state]`. */
const SEED_CASES = SEEDS.flatMap((seed) =>
  WORKSPACE_STATES.map((state) => [seedCaseName(seed.tag, state), seed, state] as const),
);

afterAll(() => {
  for (const golden of Object.values(GOLDENS)) golden.save();
});

describe("node→span accuracy across every seed", () => {
  describe.each(SEEDS.map((seed) => [seed.tag, seed] as const))("%s", (_tag, seed) => {
    it("records the printer's span map in spans.json", () => {
      GOLDENS.spans.hold(seed.tag, seed.spans);
    });

    it("puts every span on the lines the compiler finds its stage call on", () => {
      expect(stageCallsOf(seed.text).map(spanOf)).toEqual(seed.spans);
    });

    it.each(shiftCases(seed.text).map((shift) => [shift.name, shift] as const))(
      "keeps every span, and every finding on one, on its stage when an edit %s",
      (_name, shift) => {
        const edited = readCanonical(seed.slug, shift.text);

        expect(edited.spans).toEqual(shiftedSpans(seed.spans, shift.index, shift.delta));
        expect(stageCallsOf(edited.text).map(spanOf)).toEqual(edited.spans);

        for (const state of WORKSPACE_STATES) {
          expect(recorded(diagnoseFile(edited, state).diagnostics)).toEqual(
            shiftedDiagnostics(
              recorded(diagnosed(seed, state).diagnostics),
              seed.spans,
              shift.index,
              shift.delta,
            ),
          );
        }
      },
    );
  });

  it.each(SEEDS.map((seed) => [seed.tag, seed] as const))(
    "has content growing and shrinking above a stage in %s",
    (_tag, seed) => {
      const deltas = shiftCases(seed.text).map((shift) => Math.sign(shift.delta));

      expect(deltas).toContain(1);
      expect(deltas).toContain(-1);
    },
  );

  it("moves a finding below an edit with it — the seeded workspace's unrouted split", () => {
    const [shift] = shiftCases(CANVAS.text).filter((candidate) => candidate.delta > 0);
    const before = diagnosed(CANVAS, "seeded").diagnostics;
    const after = diagnoseFile(readCanonical(CANVAS.slug, shift.text), "seeded").diagnostics;

    expect(before).toEqual([expect.objectContaining({ code: "reference.unknown_task" })]);
    expect(after[0].range.line).toBe(before[0].range.line + shift.delta);
  });
});

describe("merged diagnostics: ordering and severity", () => {
  it.each(SEED_CASES)(
    "records %s in diagnostics.json, in the editor's order",
    (name, seed, state) => {
      const { diagnostics } = diagnosed(seed, state);

      expectEditorOrder(diagnostics);
      GOLDENS.diagnostics.hold(name, recorded(diagnostics));
    },
  );

  it.each(SABOTAGED.map((file) => [file.name, file] as const))(
    "records %s in diagnostics.json, in the editor's order",
    (name, file) => {
      expectEditorOrder(file.diagnosed.diagnostics);
      GOLDENS.diagnostics.hold(name, recorded(file.diagnosed.diagnostics));
    },
  );

  it("records the parser's refusal in diagnostics.json, every one an error, by position", () => {
    const { diagnostics } = parseRefusal();

    expect(diagnostics.length).toBeGreaterThan(1);
    expect(new Set(diagnostics.map((diagnostic) => diagnostic.severity))).toEqual(
      new Set(["error"]),
    );
    expectEditorOrder(diagnostics);
    GOLDENS.diagnostics.hold(PARSE_REFUSAL.name, recorded(diagnostics));
  });

  it("interleaves two warning sources by position, and breaks a tie on one stage by code", () => {
    const { diagnostics } = SABOTAGED[0].diagnosed;
    const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
    const ranges = diagnostics.map((diagnostic) => JSON.stringify(diagnostic.range));

    expect(codes).toContain("graph.undeclared_cycle");
    expect(codes).toContain("reference.unknown_skill");
    expect(codes).toContain("reference.unknown_task");
    expect(new Set(ranges).size).toBeLessThan(ranges.length);
  });

  describe("the three sources merged", () => {
    const parse = parseRefusal().diagnostics;
    const [references, validation] = SABOTAGED.map((file) => file.diagnosed.diagnostics);
    const streams = [parse, validation, references];

    it("draws on each source: the parser, the validator and the reference checks", () => {
      expect(parse.every((diagnostic) => diagnostic.code.startsWith("code_"))).toBe(true);
      expect(validation.every((diagnostic) => diagnostic.severity === "error")).toBe(true);
      expect(references.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
      expect(streams.every((stream) => stream.length > 0)).toBe(true);
    });

    it("ranks every error before every warning, each by position, and records it", () => {
      const merged = mergeCodeDiagnostics(...streams);

      expect(merged).toHaveLength(parse.length + validation.length + references.length);
      expectEditorOrder(merged);
      GOLDENS.diagnostics.hold(MERGED_CASE, recorded(merged));
    });

    it("is the same stream whatever order the sources arrive in", () => {
      const merged = mergeCodeDiagnostics(parse, validation, references);

      for (const order of [
        [parse, references, validation],
        [validation, parse, references],
        [validation, references, parse],
        [references, parse, validation],
        [references, validation, parse],
      ]) {
        expect(mergeCodeDiagnostics(...order)).toEqual(merged);
      }
    });
  });
});

describe("Loop Checks summary derivation", () => {
  it.each(SEED_CASES)(
    "records %s's rows in checks.json, derived honestly from its diagnostics (C7)",
    (name, seed, state) => {
      const { diagnostics, rows } = diagnosed(seed, state);

      expectHonestRows(rows, diagnostics);
      GOLDENS.checks.hold(name, rows);
    },
  );

  it.each(SABOTAGED.map((file) => [file.name, file] as const))(
    "records %s's rows in checks.json, derived honestly from its diagnostics (C7)",
    (name, file) => {
      expectHonestRows(file.diagnosed.rows, file.diagnosed.diagnostics);
      GOLDENS.checks.hold(name, file.diagnosed.rows);
    },
  );

  it("reports the unrouted split as a warning row in the seeded workspace, and no row when unchecked", () => {
    expect(diagnosed(CANVAS, "seeded").rows.map((row) => [row.id, row.status])).toEqual([
      ["graph", "ok"],
      ["references", "warn"],
    ]);
    expect(diagnosed(CANVAS, "unconfigured").rows.map((row) => row.id)).toEqual(["graph"]);
  });
});

describe("completion contexts: the symbol table per stage type", () => {
  it.each(SEEDS.map((seed) => [seed.tag, seed] as const))(
    "records %s's contexts in contexts.json",
    (tag, seed) => {
      GOLDENS.contexts.hold(tag, contextsIn(STATIC_TABLE, seed.text).map(formatContext));
    },
  );

  it.each(SEED_CASES)(
    "agrees with the diagnostics about every name %s writes",
    (_name, seed, state) => {
      const table = codeSymbolTable(STATIC_TABLE, suggestionsFor(state));

      expect(
        disagreements(table, seed.text, diagnosed(seed, state).diagnostics, suggestionsFor(state)),
      ).toEqual([]);
    },
  );

  it("offers every word of the loop and trigger blocks, outside any stage", () => {
    for (const seed of SEEDS) {
      const [first] = stageCallsOf(seed.text);
      const outside = contextsIn(STATIC_TABLE, seed.text).filter(
        (context) => context.line < first.startLine,
      );

      expect(outside.map((context) => context.scope)).toEqual(
        expect.arrayContaining(["loop.options", "trigger.options", "trigger.on"]),
      );
      expect(unoffered(STATIC_TABLE, outside).map(formatContext)).toEqual([]);
    }
  });

  describe.each(STAGE_CALLEES)("stage.%s", (callee) => {
    /** Every context inside one of this callee's stage calls, across the seeds. */
    const inside = SEEDS.flatMap((seed) => {
      const calls = stageCallsOf(seed.text).filter((call) => call.callee === callee);
      return contextsIn(STATIC_TABLE, seed.text)
        .filter((context) =>
          calls.some((call) => call.startLine <= context.line && context.line <= call.endLine),
        )
        .map((context) => ({ seed, context }));
    });

    it("is written by a seed, so its contexts are exercised", () => {
      expect(inside.map(({ context }) => `${context.scope} ${context.label}`)).toContain(
        `loop.stages ${callee}`,
      );
    });

    it("offers each option key the seeds write inside it, and only keys the callee takes", () => {
      const keys = inside
        .filter(({ context }) => context.scope === `stage.${callee}.options`)
        .map(({ context }) => context);

      expect(keys.length).toBeGreaterThan(0);
      expect(unoffered(STATIC_TABLE, keys).map(formatContext)).toEqual([]);
      expect(STAGE_OPTIONS[callee]).toEqual(
        expect.arrayContaining([...new Set(keys.map((key) => key.label))]),
      );
    });

    it.each(WORKSPACE_STATES)(
      "offers every other word inside it in the %s workspace, but a name the workspace does not suggest",
      (state) => {
        const table = codeSymbolTable(STATIC_TABLE, suggestionsFor(state));
        const suggestionScopes = new Set<string>(Object.values(SUGGESTION_SCOPES));

        expect(
          unoffered(
            table,
            inside.map(({ context }) => context),
          )
            .filter((context) => !suggestionScopes.has(context.scope))
            .map(formatContext),
        ).toEqual([]);
      },
    );
  });
});

describe("the goldens fail loudly", () => {
  it("record exactly the cases this suite produces, and no case it no longer does", () => {
    if (GOLDENS.spans.updating) return;

    const sorted = (names: readonly string[]) => [...names].sort();

    expect(sorted(GOLDENS.spans.names())).toEqual(sorted(SEEDS.map((seed) => seed.tag)));
    expect(sorted(GOLDENS.contexts.names())).toEqual(sorted(SEEDS.map((seed) => seed.tag)));
    expect(sorted(GOLDENS.checks.names())).toEqual(
      sorted([...SEED_CASES.map(([name]) => name), ...SABOTAGED.map((file) => file.name)]),
    );
    expect(sorted(GOLDENS.diagnostics.names())).toEqual(
      sorted([
        ...SEED_CASES.map(([name]) => name),
        ...SABOTAGED.map((file) => file.name),
        PARSE_REFUSAL.name,
        MERGED_CASE,
      ]),
    );
  });

  it("fails naming spans.json, the seed and the command when the printer writes one more line above the stages", () => {
    if (GOLDENS.spans.updating) return;

    // A printer that put a blank line after its header, with a span map honest about its own text.
    const shifted = CANVAS.text.replace("\n\n", "\n\n\n");
    const spans = stageCallsOf(shifted).map(spanOf);
    const golden = new GoldenFile(join(GOLDEN_DIR, "spans.json"), "", REGENERATE, false);

    expect(spans).toEqual(
      CANVAS.spans.map((span) => ({
        ...span,
        startLine: span.startLine + 1,
        endLine: span.endLine + 1,
      })),
    );
    expect(() => golden.hold(CANVAS.tag, spans)).toThrow(
      new RegExp(
        `spans\\.json no longer matches its case "${CANVAS.tag}"[\\s\\S]*OURO_UPDATE_GOLDENS=1`,
      ),
    );
  });

  it("catches a span map one line off its own text, whatever its golden says", () => {
    const offByOne = CANVAS.spans.map((span) => ({ ...span, startLine: span.startLine + 1 }));

    expect(stageCallsOf(CANVAS.text).map(spanOf)).not.toEqual(offByOne);
  });
});
