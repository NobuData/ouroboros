import {
  CODE_UNDECLARED_CYCLE,
  checkUndeclaredCycles,
  diagnoseDocument,
  fromParseIssues,
  mergeCodeDiagnostics,
  sortCodeDiagnostics,
  spanRange,
  type CodeDiagnostic,
} from "./code.diagnostics";
import { LineMap } from "./code.errors";
import { parseWorkflowCode } from "./code.parser";
import { edit, golden } from "./code.parser.fixture";
import { printWorkflowCode } from "./code.printer";
import { projectWorkflowCode } from "./code.projection";
import { validDocument } from "./code.recover.fixture";
import { slugMismatch } from "./code.resources";
import { readFixture } from "./dsl.golden.fixture";
import type { DslCatalogue } from "./dsl.references";
import type { EdgeKind, WorkflowDocument, WorkflowEdge, WorkflowNode } from "./dsl.schema";

/**
 * The code view's diagnostics stream — W.2 ([#178](https://github.com/NobuData/ouroboros/issues/178)).
 *
 * The acceptance criteria this suite holds:
 *
 *   * **Sabotaged fixtures map to the correct lines.** Each case breaks the committed
 *     `standard-fix.loop.ts` in one way, spelled canonically so the file is exactly what the code view
 *     would serve, and records the range as literal numbers — golden ranges, not ranges recomputed
 *     from the span map under test.
 *   * **Including when an edit has shifted line numbers**: a prompt above the broken stage grows or
 *     shrinks, and the range moves by exactly as many lines.
 *   * **A node-anchored finding resolves to the span of the stage that produced it**, by index for a
 *     duplicate id, through the leaving stage for an edge, and to the `defineLoop` line for a finding
 *     about the whole document.
 *   * **Parse errors, validation findings and reference checks merge into one ordered,
 *     severity-ranked stream.**
 */

/** The committed projection of mockup 04's canvas. Its stage calls, by line: */
const STANDARD_FIX = golden("standard-fix");
// issue-queued 10–14 · analyze 15–30 · effort-recheck 31–39 · plan 40–53 · split 54–66
// back-to-queue 67–70 · implement 71–85 · build 86–91 · test 92–98 · review 99–113
// checks-green 114–122 (its `}),` carries the loop comment) · open-pr 123–128

/** A workspace that names every skill and task route the canvas uses. */
const ROUTED: DslCatalogue = {
  skills: ["repo-map", "zephyr-conventions"],
  tasks: ["split", "implement"],
};

/**
 * A stage call's range: from its first character (column 5, under `stages: [`) to the end of its
 * closing `}),`.
 *
 * @param line - The call's first line.
 * @param endLine - Its closing line.
 * @param endColumn - Just past the closing line's last character: 8 for `    }),`.
 * @returns The range.
 */
function stageRange(line: number, endLine: number, endColumn = 8) {
  return { line, column: 5, endLine, endColumn };
}

/**
 * Diagnose a `standard-fix` file as the code view would serve it.
 *
 * @param text - The file. It must be canonical, which is asserted, so the ranges are ranges in it.
 * @param catalogue - The workspace's names.
 * @returns The diagnosis.
 */
function diagnoseFile(text: string, catalogue: DslCatalogue = ROUTED) {
  const parsed = parseWorkflowCode(text);
  expect(parsed.errors).toEqual([]);

  const printed = projectWorkflowCode("standard-fix", parsed.document);
  if (printed === undefined) throw new Error("The sabotaged file has no projection.");
  expect(printed.text).toBe(text);

  return diagnoseDocument({ text, spans: printed.spans, document: parsed.document, catalogue });
}

/** `implement`'s skill, misspelled — a P7 warning on the `implement` stage. */
function misspelledSkill(text: string): string {
  return edit(text, 'skill: "zephyr-conventions"', 'skill: "zephyr-conventionz"');
}

/** The warning {@link misspelledSkill} produces, at `implement`'s lines. */
function misspelledSkillWarning(line: number, endLine: number): CodeDiagnostic {
  return {
    severity: "warning",
    range: stageRange(line, endLine),
    code: "reference.unknown_skill",
    message: "No skill named `zephyr-conventionz` is defined in this workspace yet.",
    node: "implement",
  };
}

/** The minimal fixture, typed and freshly copied. */
function minimal(): WorkflowDocument {
  return structuredClone(validDocument(readFixture("valid/minimal.json")));
}

/** An infra stage with nothing configured, for graphs built by hand. */
function infraNode(id: string): WorkflowNode {
  return { id, type: "infra", title: id, position: { x: 0, y: 0 }, config: {} };
}

/** An edge, for graphs built by hand. */
function edge(from: string, to: string, kind: EdgeKind = "default"): WorkflowEdge {
  return { from, to, kind };
}

describe("a clean file", () => {
  it("has no diagnostics, and hands back the typed document", () => {
    const diagnosis = diagnoseFile(STANDARD_FIX);

    expect(diagnosis.diagnostics).toEqual([]);
    expect(diagnosis.document?.nodes.map((node) => node.id)).toContain("checks-green");
  });

  it("reports no reference warnings when the workspace supplies no names", () => {
    expect(diagnoseFile(misspelledSkill(STANDARD_FIX), {}).diagnostics).toEqual([]);
  });
});

describe("a sabotaged file, mapped to golden ranges", () => {
  it("puts an unknown skill on the lines of the stage that names it", () => {
    expect(diagnoseFile(misspelledSkill(STANDARD_FIX)).diagnostics).toEqual([
      misspelledSkillWarning(71, 85),
    ]);
  });

  it("puts an unrouted task on the lines of the stage that routes to it", () => {
    expect(diagnoseFile(STANDARD_FIX, { tasks: ["implement"] }).diagnostics).toEqual([
      {
        severity: "warning",
        range: stageRange(54, 66),
        code: "reference.unknown_task",
        message: "No route is configured for the task `split`.",
        node: "split",
      },
    ]);
  });

  it("puts each unreachable stage on its own lines, below a branch that was removed", () => {
    // Removing the branch removes a line from `effort-recheck`, so every later stage moves up one.
    const file = edit(
      edit(STANDARD_FIX, '        { to: "split", when: (i) => i.effort.gt(effort.M) },\n', ""),
      '// edge effort-recheck split "> M ↘"\n',
      "",
    );
    const message = "No path of edges reaches this stage from the trigger.";

    expect(diagnoseFile(file).diagnostics).toEqual([
      {
        severity: "error",
        range: stageRange(53, 65),
        code: "node.unreachable",
        message,
        node: "split",
      },
      {
        severity: "error",
        range: stageRange(66, 69),
        code: "node.unreachable",
        message,
        node: "back-to-queue",
      },
    ]);
  });

  it("puts an edge's finding on the stage the edge leaves", () => {
    const file = edit(
      edit(STANDARD_FIX, 'onFail: "implement",', 'onFail: "split",'),
      '// edge checks-green implement "fail ↺"',
      '// edge checks-green split "fail ↺"',
    );

    expect(diagnoseFile(file).diagnostics).toEqual([
      {
        severity: "error",
        // `}), // the loop bites its tail` is 34 characters long.
        range: stageRange(114, 122, 35),
        code: "edge.loop_not_upstream",
        message:
          "A loop edge goes back up the graph, and this one does not: " +
          "`split` cannot reach `checks-green` without it.",
        node: "checks-green",
      },
    ]);
  });

  it("puts an undeclared cycle on the lines of its first stage", () => {
    // A branch from the gate back to `build` closes build → test → review → checks-green → build
    // without a loop edge.
    const passBranch = '        { to: "open-pr", when: (i) => i.checks.allPassed() },\n';
    const file = edit(
      edit(
        STANDARD_FIX,
        passBranch,
        `${passBranch}        { to: "build", when: (i) => i.effort.gt(effort.M) },\n`,
      ),
      '// edge checks-green implement "fail ↺"\n',
      '// edge checks-green implement "fail ↺"\n// edge checks-green build\n',
    );

    expect(diagnoseFile(file).diagnostics).toEqual([
      {
        severity: "warning",
        range: stageRange(86, 91),
        code: CODE_UNDECLARED_CYCLE,
        message:
          "The stages `build`, `test`, `review` and `checks-green` form a cycle that no loop edge " +
          "declares, so a run could go round it without end. Declare the edge back with `onFail`.",
        node: "build",
      },
    ]);
  });
});

describe("a finding after an edit has shifted the lines", () => {
  const PROMPT_END = "Name the files the change will touch and the risks you can see.";

  it("moves down by as many lines as a prompt above it grew", () => {
    const grown = edit(
      misspelledSkill(STANDARD_FIX),
      PROMPT_END,
      `${PROMPT_END}\n\nList anything you could not scope.`,
    );

    expect(diagnoseFile(grown).diagnostics).toEqual([misspelledSkillWarning(73, 87)]);
  });

  it("moves up by as many lines as a prompt above it shrank", () => {
    const shrunk = edit(misspelledSkill(STANDARD_FIX), "Body:  {{issue.body}}\n", "");

    expect(diagnoseFile(shrunk).diagnostics).toEqual([misspelledSkillWarning(70, 84)]);
  });

  it("moves every stage below the edit, and none above it", () => {
    const before = projectWorkflowCode("standard-fix", parseWorkflowCode(STANDARD_FIX).document);
    const grown = edit(
      STANDARD_FIX,
      PROMPT_END,
      `${PROMPT_END}\n\nList anything you could not scope.`,
    );
    const after = projectWorkflowCode("standard-fix", parseWorkflowCode(grown).document);

    expect(after?.text).toBe(grown);
    expect(
      after?.spans.map((span, index) => [
        span.node,
        span.startLine - (before?.spans[index].startLine ?? 0),
        span.endLine - (before?.spans[index].endLine ?? 0),
      ]),
    ).toEqual([
      ["issue-queued", 0, 0],
      ["analyze", 0, 2],
      ...["effort-recheck", "plan", "split", "back-to-queue", "implement", "build", "test"]
        .concat(["review", "checks-green", "open-pr"])
        .map((id) => [id, 2, 2]),
    ]);
  });
});

describe("where a finding lands", () => {
  it("maps a duplicate id by position, so the second stage's error is on the second stage", () => {
    const document = minimal();
    document.nodes.push({
      id: "done",
      type: "term",
      title: "Needs review again",
      position: { x: 480, y: 0 },
      config: { action: "needs_review", options: {} },
    });
    const { text, spans } = printWorkflowCode("minimal", document);

    const [finding] = diagnoseDocument({ text, spans, document }).diagnostics;

    expect(finding).toMatchObject({ code: "node.duplicate_id", node: "done" });
    expect(finding.range).toEqual(spanRange(text, new LineMap(text), spans[2]));
    expect(finding.range.line).not.toBe(spans[1].startLine);
  });

  it("puts a finding about the whole document on the defineLoop line", () => {
    const document = minimal();
    document.nodes = document.nodes.filter((node) => node.type !== "term");
    document.edges = [];
    const { text, spans } = printWorkflowCode("minimal", document);

    expect(diagnoseDocument({ text, spans, document }).diagnostics).toEqual([
      {
        severity: "error",
        // `export default defineLoop("minimal", {` is 38 characters long.
        range: { line: 3, column: 1, endLine: 3, endColumn: 39 },
        code: "document.no_terminal",
        message: "A workflow needs at least one terminal node; no path through this one ends.",
      },
    ]);
  });

  it("starts a range at the first non-blank character, and a blank line at column 1", () => {
    const text = "a\n   \n    b }),\n";

    // `    b }),` is 9 characters long.
    expect(spanRange(text, new LineMap(text), { startLine: 2, endLine: 3 })).toEqual({
      line: 2,
      column: 1,
      endLine: 3,
      endColumn: 10,
    });
    expect(spanRange(text, new LineMap(text), { startLine: 3, endLine: 3 }).column).toBe(5);
  });

  it("refuses a span map from another print rather than inventing lines", () => {
    const document = minimal();
    document.nodes.push({
      id: "orphan",
      type: "term",
      title: "Nothing reaches this",
      position: { x: 480, y: 0 },
      config: { action: "needs_review", options: {} },
    });
    const { text, spans } = printWorkflowCode("minimal", document);
    const elsewhere = spans.map((span) => ({ ...span, startLine: span.startLine + 900 }));

    expect(() => diagnoseDocument({ text, spans: elsewhere, document })).toThrow(RangeError);
  });
});

describe("the parser's refusals", () => {
  const RANGE = { line: 4, column: 8, endLine: 4, endColumn: 11 };

  it("are errors on their own ranges, with the hint as the note", () => {
    expect(
      fromParseIssues([
        { code: "code_out_of_grammar", message: "Out of grammar.", hint: "Full SDK.", ...RANGE },
        slugMismatch({ line: 3, column: 27, endLine: 3, endColumn: 41 }, "standard-fix", "docs"),
      ]),
    ).toEqual([
      {
        severity: "error",
        range: { line: 3, column: 27, endLine: 3, endColumn: 41 },
        code: "code_slug_mismatch",
        message: expect.stringContaining('defineLoop("docs", …)') as string,
      },
      {
        severity: "error",
        range: RANGE,
        code: "code_out_of_grammar",
        message: "Out of grammar.",
        note: "Full SDK.",
      },
    ]);
  });
});

describe("one stream", () => {
  /** A diagnostic, for ordering. */
  function diagnostic(
    severity: CodeDiagnostic["severity"],
    line: number,
    code = "node.unreachable",
    message = "m",
  ): CodeDiagnostic {
    return { severity, range: { line, column: 5, endLine: line + 2, endColumn: 8 }, code, message };
  }

  const parseError = fromParseIssues([
    {
      code: "code_syntax_error",
      message: "';' expected.",
      line: 90,
      column: 3,
      endLine: 90,
      endColumn: 4,
    },
  ]);
  const findings = [diagnostic("error", 40)];
  const references = [diagnostic("warning", 10, "reference.unknown_task")];

  it("ranks errors before warnings, then orders by position", () => {
    expect(
      mergeCodeDiagnostics(references, findings, parseError).map((entry) => [
        entry.severity,
        entry.range.line,
      ]),
    ).toEqual([
      ["error", 40],
      ["error", 90],
      ["warning", 10],
    ]);
  });

  it("is the same list whatever order the sources arrive in", () => {
    expect(mergeCodeDiagnostics(parseError, references, findings)).toEqual(
      mergeCodeDiagnostics(findings, parseError, references),
    );
  });

  it("breaks a tie at one range by code, then by message", () => {
    const tied = [
      diagnostic("warning", 7, "reference.unknown_task", "b"),
      diagnostic("warning", 7, "reference.unknown_skill", "z"),
      diagnostic("warning", 7, "reference.unknown_task", "a"),
    ];

    expect(sortCodeDiagnostics(tied).map((entry) => `${entry.code}/${entry.message}`)).toEqual([
      "reference.unknown_skill/z",
      "reference.unknown_task/a",
      "reference.unknown_task/b",
    ]);
  });

  it("sorts a copy, leaving the caller's list alone", () => {
    const input = [diagnostic("warning", 1), diagnostic("error", 2)];

    sortCodeDiagnostics(input);

    expect(input.map((entry) => entry.severity)).toEqual(["warning", "error"]);
  });
});

describe("undeclared cycles", () => {
  it("finds none in the canvas, whose one cycle is its declared loop", () => {
    expect(checkUndeclaredCycles(validDocument(parseWorkflowCode(STANDARD_FIX).document))).toEqual(
      [],
    );
  });

  it("reports each cycle once, in document order, anchored at its first stage", () => {
    const document: WorkflowDocument = {
      ...minimal(),
      nodes: ["start", "a", "b", "c", "d"].map(infraNode),
      edges: [
        edge("start", "c"),
        edge("c", "d"),
        edge("d", "c", "branch"),
        edge("start", "a"),
        edge("a", "b"),
        edge("b", "a"),
        edge("b", "start", "loop"),
      ],
    };

    expect(checkUndeclaredCycles(document)).toEqual([
      expect.objectContaining({ code: CODE_UNDECLARED_CYCLE, path: "/nodes/1", node: "a" }),
      expect.objectContaining({ code: CODE_UNDECLARED_CYCLE, path: "/nodes/3", node: "c" }),
    ]);
  });

  it("ignores loop edges, so a loop declared with onFail is not a cycle", () => {
    const document: WorkflowDocument = {
      ...minimal(),
      nodes: ["start", "a", "b"].map(infraNode),
      edges: [edge("start", "a"), edge("a", "b"), edge("b", "a", "loop")],
    };

    expect(checkUndeclaredCycles(document)).toEqual([]);
  });

  it("walks a ten-thousand-stage cycle and chain without running out of stack", () => {
    const ids = Array.from({ length: 10_000 }, (_, index) => `s${index}`);
    const chain = ids.slice(1).map((id, index) => edge(ids[index], id));
    const base = { ...minimal(), nodes: ids.map(infraNode) };

    expect(checkUndeclaredCycles({ ...base, edges: chain })).toEqual([]);

    const [cycle] = checkUndeclaredCycles({ ...base, edges: [...chain, edge("s9999", "s0")] });
    expect(cycle).toMatchObject({ path: "/nodes/0", node: "s0" });
  });
});
