import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { LoopCheckRow, NodeSpan } from "@/app/api/workflows";
import { anchoredSpan } from "@/app/workflows/code/code-diagnostics";
import {
  LOOP_CHECK_IDS,
  backEdgeNote,
  checksStale,
  drawnCheckRows,
  jumpToStageTitle,
  loopTargetsIn,
  outlineRows,
  rowNumber,
  stageReveal,
} from "@/app/workflows/code/code-panel";

import { STANDARD_FIX } from "../../helpers/code-symbols";
import { codeChecks } from "../../helpers/workflow-code";

/**
 * The right panel's decisions (V.5, #173), against the shared golden files: the printer's
 * `standard-fix.loop.ts` and the span map `ouroboros-rest` asserts it serves for it
 * (`fixtures/code-intelligence/spans.json`), so a printer change turns this suite red rather than
 * leaving it asserting a stale copy.
 */

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "..", "schemas", "workflow-dsl", "fixtures");

/** The golden span map for the seeded `standard-fix` v14, the draft the code view opens. */
const SPANS = (
  JSON.parse(readFileSync(join(FIXTURES, "code-intelligence", "spans.json"), "utf8")) as {
    cases: Record<string, NodeSpan[]>;
  }
).cases.standard_fix_v14;

/** The golden Loop Checks rows, by case. */
const CHECKS = (
  JSON.parse(readFileSync(join(FIXTURES, "code-intelligence", "checks.json"), "utf8")) as {
    cases: Record<string, LoopCheckRow[]>;
  }
).cases;

/**
 * A span map over hand-written lines.
 *
 * @param node The stage.
 * @param startLine Its first line.
 * @param endLine Its last line.
 * @returns The span.
 */
function span(node: string, startLine: number, endLine: number): NodeSpan {
  return { node, startLine, endLine };
}

describe("the Loop Checks rows", () => {
  it("draws every row the service derives for the seeds, in its order", () => {
    for (const [name, rows] of Object.entries(CHECKS)) {
      expect(drawnCheckRows(codeChecks({ rows })), name).toEqual(rows);
    }
  });

  it("knows no infra row (decision C7)", () => {
    expect(LOOP_CHECK_IDS).toEqual(["graph", "references"]);
  });

  it("drops a row it does not know, such as mockup 05's pool-a warning, rather than drawing it", () => {
    const infra = { id: "infra", status: "warn", title: "pool-a has 1 runner offline — builds may queue" };
    const rows = [...codeChecks().rows, infra as unknown as LoopCheckRow];

    expect(drawnCheckRows(codeChecks({ rows }))).toEqual(codeChecks().rows);
  });

  it("is stale once a save has moved the draft past the file the rows are about", () => {
    const checks = codeChecks({ etag: "etag-1" });

    expect(checksStale(checks, "etag-1")).toBe(false);
    expect(checksStale(checks, "etag-2")).toBe(true);
    expect(checksStale(checks, null)).toBe(false);
  });
});

describe("the outline of the seeded file", () => {
  const rows = outlineRows({ anchor: STANDARD_FIX, spans: SPANS });

  it("has one numbered row per stage call, in the document's node order", () => {
    expect(rows.map((row) => `${row.number} ${row.node}`)).toEqual([
      "01 issue-queued",
      "02 analyze",
      "03 effort-recheck",
      "04 plan",
      "05 split",
      "06 back-to-queue",
      "07 implement",
      "08 build",
      "09 test",
      "10 review",
      "11 checks-green",
      "12 open-pr",
    ]);
  });

  it("makes the gate — the one stage with `onFail` — the only loopback row, returning to implement", () => {
    const loopbacks = rows.filter((row) => row.loop !== null);

    expect(loopbacks).toEqual([
      { number: "11", node: "checks-green", startLine: 114, loop: [{ node: "implement", number: "07" }] },
    ]);
    expect(backEdgeNote(loopbacks[0].loop ?? [])).toBe("back-edge → 07");
  });

  it("carries each row's first line from the span map, which is the stage call's own line", () => {
    const lines = STANDARD_FIX.split("\n");

    for (const row of rows) {
      expect(lines[row.startLine - 1], row.node).toContain(`("${row.node}", {`);
    }
  });
});

describe("loop edges", () => {
  it("reads the list form, each `to` in the order written", () => {
    const lines = [
      "    gate(\"g\", {",
      "      title: \"G\",",
      "      onFail: [",
      "        { to: \"a\" },",
      "        { to: \"b\", when: (i) => i.checks.anyFailed([\"build\"]) },",
      "      ],",
      "    }), // the loop bites its tail",
    ];

    expect(loopTargetsIn(lines, span("g", 1, 7))).toEqual(["a", "b"]);
  });

  it("ignores `onFail:` inside a prompt, whose lines keep no indentation of the call's", () => {
    const lines = [
      "    llm(\"write\", {",
      "      prompt: `Explain the option.",
      "onFail: \"nowhere\"",
      "Keep it short.`,",
      "      next: \"done\",",
      "    }),",
    ];

    expect(loopTargetsIn(lines, span("write", 1, 6))).toEqual([]);
  });

  it("reads nothing for a span outside the file", () => {
    expect(loopTargetsIn(["only one line"], span("gone", 5, 9))).toEqual([]);
  });

  it("numbers a target by its first row when an id repeats, and names one no row has", () => {
    const anchor = [
      "    llm(\"a\", {",
      "    }),",
      "    llm(\"a\", {",
      "    }),",
      "    gate(\"g\", {",
      "      onFail: [",
      "        { to: \"a\" },",
      "        { to: \"missing\" },",
      "      ],",
      "    }),",
    ].join("\n");

    const [, , gate] = outlineRows({ anchor, spans: [span("a", 1, 2), span("a", 3, 4), span("g", 5, 10)] });

    expect(gate.loop).toEqual([
      { node: "a", number: "01" },
      { node: "missing", number: null },
    ]);
    expect(backEdgeNote(gate.loop ?? [])).toBe("back-edge → 01 · missing");
  });

  it("draws no rows for a file with no stages", () => {
    expect(outlineRows({ anchor: "", spans: [] })).toEqual([]);
  });
});

describe("row numbers and words", () => {
  it("pads to two digits and no further", () => {
    expect([rowNumber(0), rowNumber(11), rowNumber(99)]).toEqual(["01", "12", "100"]);
  });

  it("names the stage a row goes to", () => {
    expect(jumpToStageTitle("implement")).toBe("Go to implement in the file");
  });
});

describe("the jump to a stage", () => {
  const outline = { anchor: STANDARD_FIX, spans: SPANS };
  const rows = outlineRows(outline);

  it("puts the cursor at the first column of the stage call's line — the loopback row included", () => {
    for (const row of rows) {
      const request = stageReveal(outline, row);
      const placed = anchoredSpan(request.anchor, STANDARD_FIX, request.range);
      const lineStart = STANDARD_FIX.split("\n").slice(0, row.startLine - 1).join("\n").length + 1;

      expect(placed, row.node).toEqual({ from: lineStart, to: lineStart });
    }
  });

  it("follows the stage into a text typed since the spans were counted", () => {
    const gate = rows.find((row) => row.node === "checks-green");
    const typed = `// a new first line\n${STANDARD_FIX}`;
    const request = stageReveal(outline, gate ?? rows[0]);
    const placed = anchoredSpan(request.anchor, typed, request.range);

    expect(typed.slice(placed.from)).toMatch(/^ {4}gate\("checks-green", \{/);
  });

  it("clamps a line past the end of the text to its last line, and is a new request each time", () => {
    const anchor = "one\ntwo";
    const row = { number: "01", node: "x", startLine: 40, loop: null };

    expect(stageReveal({ anchor, spans: [] }, row).range).toEqual({ line: 2, column: 1, endLine: 2, endColumn: 1 });
    expect(stageReveal({ anchor, spans: [] }, row)).not.toBe(stageReveal({ anchor, spans: [] }, row));
  });
});
