/**
 * The layout block — U.1 ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * Positions and edge labels are presentation, and they ride at the foot of a `.loop.ts` file as
 * structured trivia. These tests hold the block to three things: it records every position and
 * every edge in the document's own order, what it records reads back exactly — negative zero
 * and labels full of line breaks included — and a line it cannot read is reported with its
 * line number rather than thrown or silently dropped.
 */

import { LAYOUT_MARKER } from "./code.grammar";
import { printLayout, readLayout } from "./code.layout";
import { validDocument } from "./code.recover.fixture";
import { readFixture } from "./dsl.golden.fixture";

/** The seeded canvas: twelve nodes, twelve edges, four of them labelled. */
const standardFix = validDocument(readFixture("valid/standard-fix.json"));

/** U+2028, built from its code point so this file never holds it raw. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);

/**
 * The minimal fixture, with its one edge labelled and its nodes placed.
 *
 * @param label - The edge's label.
 * @param start - The trigger's position.
 * @param done - The terminal's position.
 * @returns A valid document.
 */
function minimalWith(
  label: string,
  start = { x: 0, y: 0 },
  done = { x: 240, y: 0 },
): ReturnType<typeof validDocument> {
  const document = readFixture("valid/minimal.json") as {
    nodes: { position: { x: number; y: number } }[];
    edges: Record<string, unknown>[];
  };
  document.nodes[0].position = start;
  document.nodes[1].position = done;
  document.edges[0].label = label;

  return validDocument(document);
}

describe("printLayout", () => {
  const lines = printLayout(standardFix);

  it("opens with the marker", () => {
    expect(lines[0]).toBe(LAYOUT_MARKER);
  });

  it("records one node per line, in node order", () => {
    expect(lines.slice(1, 13)).toStrictEqual(
      standardFix.nodes.map((node) => `// node ${node.id} ${node.position.x} ${node.position.y}`),
    );
  });

  it("records every edge, in the document's order, with its label as JSON", () => {
    expect(lines).toHaveLength(1 + standardFix.nodes.length + standardFix.edges.length);
    expect(lines[13]).toBe("// edge issue-queued analyze");
    expect(lines[15]).toBe('// edge effort-recheck plan "≤ M ↓"');
    expect(lines[16]).toBe('// edge effort-recheck split "> M ↘"');
    expect(lines.at(-1)).toBe('// edge checks-green implement "fail ↺"');
  });

  it("keeps split → back-to-queue ahead of plan → implement, as the document lists them", () => {
    // Grouping edges under their source stage would put plan's edge first — plan precedes split
    // in the node list — and this block is what keeps the document's order anyway.
    expect(lines.indexOf("// edge split back-to-queue")).toBeLessThan(
      lines.indexOf("// edge plan implement"),
    );
  });

  it("keeps every label on its own line whatever it contains", () => {
    const label = `a "b"\n${LINE_SEPARATOR}// c`;
    const printed = printLayout(minimalWith(label));

    expect(printed.join("\n").split("\n")).toHaveLength(printed.length);
    expect(printed.at(-1)).not.toContain(LINE_SEPARATOR);
  });
});

describe("readLayout", () => {
  it("reads back exactly what printLayout wrote", () => {
    expect(readLayout(printLayout(standardFix).join("\n"))).toStrictEqual({
      found: true,
      nodes: standardFix.nodes.map((node) => ({ id: node.id, ...node.position })),
      edges: standardFix.edges.map(({ from, to, label }) =>
        label === undefined ? { from, to } : { from, to, label },
      ),
      malformed: [],
    });
  });

  it("finds the block at the foot of a whole file", () => {
    const text = [
      'import { defineLoop } from "@ouroboros/sdk";',
      "",
      ...printLayout(standardFix),
      "",
    ];
    const read = readLayout(text.join("\n"));

    expect(read.found).toBe(true);
    expect(read.nodes).toHaveLength(12);
    expect(read.edges).toHaveLength(12);
    expect(read.malformed).toEqual([]);
  });

  it("says so when a file has no block", () => {
    expect(readLayout('export default defineLoop("x", {});\n')).toStrictEqual({
      found: false,
      nodes: [],
      edges: [],
      malformed: [],
    });
  });

  it("reads back a label full of quotes and line breaks", () => {
    const label = `a "b"\n${LINE_SEPARATOR}// c`;
    const [edge] = readLayout(printLayout(minimalWith(label)).join("\n")).edges;

    expect(edge).toStrictEqual({ from: "start", to: "done", label });
  });

  it("reads back negative zero and fractional coordinates exactly", () => {
    const document = minimalWith("x", { x: -0, y: 12.5 }, { x: -100000, y: 99999.75 });
    const [start, done] = readLayout(printLayout(document).join("\n")).nodes;

    expect(Object.is(start.x, -0)).toBe(true);
    expect(start.y).toBe(12.5);
    expect(done).toStrictEqual({ id: "done", x: -100000, y: 99999.75 });
  });

  it("reads an empty label as an empty label, not as none", () => {
    const text = [LAYOUT_MARKER, '// edge a b ""'].join("\n");
    expect(readLayout(text).edges).toStrictEqual([{ from: "a", to: "b", label: "" }]);
  });

  it("skips blank lines inside the block", () => {
    const text = [LAYOUT_MARKER, "", "// node a 1 2", "   ", "// edge a b", ""].join("\n");
    const read = readLayout(text);

    expect(read.nodes).toStrictEqual([{ id: "a", x: 1, y: 2 }]);
    expect(read.edges).toStrictEqual([{ from: "a", to: "b" }]);
    expect(read.malformed).toEqual([]);
  });

  it.each([
    ["// node Bad-Id 1 2", "a node id the DSL refuses"],
    ["// node a 1", "a missing coordinate"],
    ["// node a 1 2 3", "an extra token"],
    ["// node a x 2", "a coordinate that is not a number"],
    ["// node a  2", "an empty coordinate"],
    ["// node a Infinity 2", "an infinite coordinate"],
    ["// edge a", "an edge with one end"],
    ["// edge a B", "an edge end the DSL refuses"],
    ["// edge a b label", "a label that is not JSON"],
    ["// edge a b 42", "a label that is JSON but not a string"],
    ['// edge a b "x" "y"', "two labels"],
    ["// edge a b ", "a trailing space with no label"],
    ["// arrow a b", "a line of an unknown kind"],
    ["node a 1 2", "a line that is not a comment"],
  ])("reports %s — %s — with its line number", (line) => {
    const read = readLayout([LAYOUT_MARKER, "// node ok 0 0", line, ""].join("\n"));

    expect(read.malformed).toStrictEqual([{ line: 3, text: line }]);
    expect(read.nodes).toStrictEqual([{ id: "ok", x: 0, y: 0 }]);
  });
});
