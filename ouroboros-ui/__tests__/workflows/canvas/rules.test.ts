import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@/app/api/workflows";
import { edgeProblem, insertProblem, stageProblem, structuralFindings } from "@/app/workflows/canvas/rules";

import { standardFixDefinition } from "../../helpers/workflows";

/**
 * The DSL's structural rules on the canvas (#151) — held to the parity contract both validators are
 * held to, and then asked about one edit at a time.
 *
 * `schemas/workflow-dsl/fixtures/expected.json` freezes, per rule, the diagnostic `ouroboros-rest`'s zod
 * stage and `ouroboros-engine`'s pydantic stage must produce. Every case in it whose errors are all
 * § 7's is replayed here against `structuralFindings`, so the canvas refusing an edit and the publish
 * gate refusing the document are the same rule in the same words — not a third reading of
 * `docs/WORKFLOW_DSL.md`. The edit checks are then asserted over the seeded `standard-fix`.
 */

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "..", "schemas", "workflow-dsl", "fixtures");

/** One case of the parity file, as far as this suite reads it. */
interface ParityCase {
  readonly name: string;
  readonly document: string;
  readonly valid: boolean;
  readonly errors: readonly { readonly code: string }[];
}

const CASES = (JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf8")) as { cases: ParityCase[] }).cases;

/** The § 7 codes — the structural stage's, as opposed to the schema stage's and the references'. */
const STRUCTURAL = /^(?:document\.(?:no_trigger|multiple_triggers|no_terminal)|node\.(?:duplicate_id|unreachable)|edge\.)/;

/** The cases whose every error is a structural one. */
const STRUCTURAL_CASES = CASES.filter(
  (entry) => entry.errors.length > 0 && entry.errors.every((error) => STRUCTURAL.test(error.code)),
);

/** The cases both validators accept. */
const VALID_CASES = CASES.filter((entry) => entry.valid);

/**
 * One fixture document.
 *
 * @param path Its path under the fixtures directory, as the parity file names it.
 * @returns The document.
 */
function fixture(path: string): WorkflowDefinition {
  return JSON.parse(readFileSync(join(FIXTURES, path), "utf8")) as WorkflowDefinition;
}

/** The seeded document. */
const SEEDED = standardFixDefinition();

describe("the parity contract", () => {
  it("has a case for every one of § 7's fourteen codes, so the replay below covers the table", () => {
    const codes = new Set(STRUCTURAL_CASES.flatMap((entry) => entry.errors.map((error) => error.code)));

    expect(codes.size).toBe(14);
    expect(VALID_CASES.length).toBeGreaterThan(0);
  });

  it.each(STRUCTURAL_CASES.map((entry) => [entry.name, entry] as const))(
    "reports %s exactly as both validators do — code, path and name",
    (_name, entry) => {
      expect(structuralFindings(fixture(entry.document))).toEqual(entry.errors);
    },
  );

  it.each(VALID_CASES.map((entry) => [entry.name, entry] as const))("finds nothing wrong with %s", (_name, entry) => {
    expect(structuralFindings(fixture(entry.document))).toEqual([]);
  });
});

describe("the whole table, read defensively", () => {
  it("says a blank document has no terminal and no trigger, in code order at one path, and nothing else", () => {
    expect(structuralFindings({})).toEqual([
      { code: "document.no_terminal", path: "/nodes" },
      { code: "document.no_trigger", path: "/nodes" },
    ]);
  });

  it("does not throw on a nodes or edges value that is not a list, or entries that are not objects", () => {
    expect(() => structuralFindings({ nodes: "x", edges: 3 })).not.toThrow();
    expect(() => structuralFindings({ nodes: [null, 1, { id: 2 }], edges: [null, { from: 1 }] })).not.toThrow();
  });

  it("asks about reachability only with exactly one trigger", () => {
    const twoTriggers = {
      nodes: [
        { id: "a", type: "trigger" },
        { id: "b", type: "trigger" },
        { id: "c", type: "term" },
      ],
      edges: [{ from: "a", to: "c", kind: "default" }],
    };

    expect(structuralFindings(twoTriggers).map((finding) => finding.code)).toEqual(["document.multiple_triggers"]);
  });
});

describe("one edge, judged before it is made", () => {
  it.each([
    ["a stage connected to itself", { from: "analyze", to: "analyze", kind: "default" }, "edge.self_reference"],
    ["a pair already joined", { from: "issue-queued", to: "analyze", kind: "default" }, "edge.duplicate"],
    ["an edge into the trigger", { from: "analyze", to: "issue-queued", kind: "default" }, "edge.into_trigger"],
    ["an edge out of a terminal", { from: "open-pr", to: "analyze", kind: "default" }, "edge.out_of_terminal"],
    ["a branch with no condition", { from: "plan", to: "split", kind: "branch" }, "edge.branch_without_condition"],
    [
      "a default edge with a condition",
      { from: "plan", to: "split", kind: "default", condition: { kind: "always" } },
      "edge.unexpected_condition",
    ],
    ["a loop that does not return upstream", { from: "implement", to: "open-pr", kind: "loop" }, "edge.loop_not_upstream"],
    ["an endpoint the draft does not hold", { from: "nope", to: "analyze", kind: "default" }, "edge.unknown_from"],
    ["a target the draft does not hold", { from: "analyze", to: "nope", kind: "default" }, "edge.unknown_to"],
  ] as const)("refuses %s", (_what, candidate, code) => {
    expect(edgeProblem(SEEDED, candidate)).toBe(code);
  });

  it.each([
    ["a new plain connection", { from: "plan", to: "build", kind: "default" }],
    ["a loop back up the graph", { from: "test", to: "implement", kind: "loop" }],
    ["a branch that carries its condition", { from: "plan", to: "split", kind: "branch", condition: { kind: "always" } }],
  ] as const)("allows %s", (_what, candidate) => {
    expect(edgeProblem(SEEDED, candidate)).toBeNull();
  });

  it("does not call an edge being edited a duplicate of itself", () => {
    const loop = { from: "checks-green", to: "implement" };

    expect(edgeProblem(SEEDED, { ...loop, kind: "loop", condition: { kind: "checks", op: "any_failed" } }, loop)).toBeNull();
    expect(edgeProblem(SEEDED, { ...loop, kind: "default" }, loop)).toBeNull();
  });

  it("refuses turning a forward edge into a loop, and a branch into one with no condition", () => {
    const forward = { from: "analyze", to: "effort-recheck" };
    const branch = { from: "effort-recheck", to: "plan" };

    expect(edgeProblem(SEEDED, { ...forward, kind: "loop" }, forward)).toBe("edge.loop_not_upstream");
    expect(edgeProblem(SEEDED, { ...branch, kind: "branch" }, branch)).toBe("edge.branch_without_condition");
  });

  it("says a self-reference first, even when the pair is also taken", () => {
    const selfLoop = { ...SEEDED, edges: [...(SEEDED.edges as unknown[]), { from: "plan", to: "plan", kind: "default" }] };

    expect(edgeProblem(selfLoop, { from: "plan", to: "plan", kind: "default" })).toBe("edge.self_reference");
  });

  it("refuses any edge on a document with no stages", () => {
    expect(edgeProblem({}, { from: "a", to: "b", kind: "default" })).toBe("edge.unknown_from");
  });
});

describe("one stage, judged before it is added", () => {
  it("refuses a second trigger, and nothing else", () => {
    expect(stageProblem(SEEDED, "trigger")).toBe("document.multiple_triggers");
    for (const type of ["llm", "infra", "flow", "term"]) expect(stageProblem(SEEDED, type)).toBeNull();
  });

  it("allows the first trigger", () => {
    expect(stageProblem({}, "trigger")).toBeNull();
  });

  it("refuses inserting a trigger or a terminal between two stages, and allows the three kinds that pass a run on", () => {
    expect(insertProblem(SEEDED, "trigger")).toBe("document.multiple_triggers");
    expect(insertProblem({}, "trigger")).toBe("edge.into_trigger");
    expect(insertProblem(SEEDED, "term")).toBe("edge.out_of_terminal");
    for (const type of ["llm", "infra", "flow"]) expect(insertProblem(SEEDED, type)).toBeNull();
  });
});
