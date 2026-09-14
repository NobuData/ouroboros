import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LOOP_CHECK_IDS, loopCheckRows, type LoopCheckRow } from "./code.checks";
import { CODE_UNDECLARED_CYCLE, diagnoseDocument, type CodeDiagnostic } from "./code.diagnostics";
import { printWorkflowCode } from "./code.printer";
import { validDocument } from "./code.recover.fixture";
import { readExpectedCases, readFixture } from "./dsl.golden.fixture";
import type { DslCatalogue } from "./dsl.references";
import type { WorkflowDocument } from "./dsl.schema";
import { SEED_DOCUMENT_TAGS, seededDocuments, seededTaskKinds } from "./dsl.seed.fixture";

/**
 * Mockup 05's Loop Checks rows — W.2 ([#178](https://github.com/NobuData/ouroboros/issues/178)).
 *
 * * **A clean seed reproduces the mockup's first two rows**, read out of the mockup's own HTML
 *   rather than copied into this file.
 * * **No infra row in MVP (decision C7)**, over every seeded and fixture document, with and without a
 *   routing matrix — verified, not merely intended.
 * * Every other state a row can be in, and the rows that are left out because nothing checked them.
 */

/** Mockup 05, where the panel's rows are drawn. */
const MOCKUP_PATH = resolve(__dirname, "../../../../docs/mockups/05-workflow-code.html");

/** A workspace that names every skill and task route the seeded canvas uses. */
const ROUTED: DslCatalogue = {
  skills: ["repo-map", "zephyr-conventions"],
  tasks: ["split", "implement"],
};

/** The mockup's rows, as their visible text. */
interface MockupRow {
  /** Whether the row is drawn as a warning. */
  readonly warn: boolean;
  /** The row's sentence. */
  readonly title: string;
  /** Its `<small>` text, when it has one. */
  readonly note?: string;
}

/**
 * Read the Loop Checks rows out of mockup 05.
 *
 * @returns Each `.ck` row, in the panel's order.
 */
function mockupRows(): MockupRow[] {
  const html = readFileSync(MOCKUP_PATH, "utf8");

  return [...html.matchAll(/<div class="ck( warn)?">.*?<span>(.*?)<\/span><\/div>/g)].map(
    (match) => {
      const [, title, note] = /^(.*?)(?: <small>(.*)<\/small>)?$/.exec(match[2]) ?? [];
      return note === undefined
        ? { warn: match[1] !== undefined, title }
        : { warn: match[1] !== undefined, title, note };
    },
  );
}

/**
 * The rows for a document, as the code view would compute them.
 *
 * @param document - A stored document; printed under `standard-fix`.
 * @param catalogue - The workspace's names, or `undefined` for none.
 * @returns The rows.
 */
function rowsFor(document: unknown, catalogue: DslCatalogue | undefined): LoopCheckRow[] {
  const { text, spans } = printWorkflowCode("standard-fix", document as WorkflowDocument);
  const diagnosis = diagnoseDocument({
    text,
    spans,
    document,
    ...(catalogue === undefined ? {} : { catalogue }),
  });

  return loopCheckRows({
    diagnostics: diagnosis.diagnostics,
    tasksChecked: catalogue?.tasks !== undefined,
    ...(diagnosis.document === undefined ? {} : { document: diagnosis.document }),
  });
}

/** The seeded `standard-fix` v14 — mockup 04's canvas, and the draft the code view opens. */
function seededCanvas(): WorkflowDocument {
  return validDocument(seededDocuments("standard_fix_v14")[0]);
}

/** The minimal fixture: a trigger and a terminal, no model stage and no loop. */
function minimal(): WorkflowDocument {
  return structuredClone(validDocument(readFixture("valid/minimal.json")));
}

/** A stage-anchored diagnostic, for rows derived from a hand-built stream. */
function diagnostic(code: string, node: string, severity: CodeDiagnostic["severity"] = "warning") {
  return {
    severity,
    code,
    node,
    message: `${code} on ${node}.`,
    range: { line: 1, column: 1, endLine: 1, endColumn: 1 },
  } satisfies CodeDiagnostic;
}

describe("a clean seed", () => {
  it("reproduces the mockup's first two rows", () => {
    const mockup = mockupRows();
    const rows = rowsFor(seededCanvas(), ROUTED);

    expect(rows).toEqual([
      { id: "graph", status: "ok", title: "Graph acyclic except declared gate loop" },
      {
        id: "references",
        status: "ok",
        title: "All task routes resolve",
        note: "models configured for analyze · plan · split · implement · review",
      },
    ]);
    expect(rows.map((row) => row.title)).toEqual(mockup.slice(0, 2).map((row) => row.title));
    expect(mockup.slice(0, 2).map((row) => row.warn)).toEqual([false, false]);
    // The mockup's note lists its four model stages; the seed has a fifth, `split`
    // (docs/WORKFLOW_CODE_DSL.md §10), so the phrase is held and the list is the seed's own.
    expect(mockup[1].note).toMatch(/^models configured for /);
  });

  it("shows the unrouted `split` against the seed's real routing matrix, rather than a ✓", () => {
    // The routing matrix a fresh development database has, read from R__dev_seed_routing.sql.
    // `split` is not among its kinds.
    expect(rowsFor(seededCanvas(), { ...ROUTED, tasks: seededTaskKinds() })).toEqual([
      { id: "graph", status: "ok", title: "Graph acyclic except declared gate loop" },
      {
        id: "references",
        status: "warn",
        title: "1 reference does not resolve",
        note: "unresolved in split",
      },
    ]);
  });
});

describe("no infra row in MVP (C7)", () => {
  it("omits the mockup's third row, the runner-pool line, which nothing here observes", () => {
    const [, , infra] = mockupRows();
    const titles = rowsFor(seededCanvas(), ROUTED).map((row) => row.title);

    expect(infra).toMatchObject({
      warn: true,
      title: expect.stringContaining("runner offline") as string,
    });
    expect(titles).not.toContain(infra.title);
  });

  it("can only build the graph and references rows", () => {
    expect(LOOP_CHECK_IDS).toEqual(["graph", "references"]);
  });

  const DOCUMENTS = [
    ...SEED_DOCUMENT_TAGS.map(([tag]) => [`seed ${tag}`, seededDocuments(tag)[0]] as const),
    ...[
      ...new Set(
        readExpectedCases()
          .filter((entry) => entry.valid)
          .map((entry) => entry.document),
      ),
    ].map((path) => [`fixture ${path}`, readFixture(path)] as const),
  ];

  it.each(
    DOCUMENTS.flatMap(([name, document]) => [
      [name, "a routing matrix", document, ROUTED],
      [name, "no routing matrix", document, undefined],
    ]),
  )(
    "says nothing about pools or runners for %s, with %s",
    (_name, _matrix, document, catalogue) => {
      const rows = rowsFor(document, catalogue);

      for (const row of rows) {
        expect(LOOP_CHECK_IDS).toContain(row.id);
        expect(`${row.title} ${row.note ?? ""}`).not.toMatch(/pool|runner|offline|farm/i);
      }
    },
  );
});

describe("the graph row", () => {
  it("is an error counting the validator's errors, with the first as its note, and stands alone", () => {
    const document = minimal();
    document.nodes = document.nodes.filter((node) => node.type !== "term");
    document.edges = [];

    expect(rowsFor(document, ROUTED)).toEqual([
      {
        id: "graph",
        status: "err",
        title: "1 validation error",
        note: "A workflow needs at least one terminal node; no path through this one ends.",
      },
    ]);
  });

  it("counts several errors", () => {
    const rows = loopCheckRows({
      diagnostics: [
        diagnostic("node.unreachable", "a", "error"),
        diagnostic("node.unreachable", "b", "error"),
      ],
      document: minimal(),
      tasksChecked: true,
    });

    expect(rows).toEqual([
      { id: "graph", status: "err", title: "2 validation errors", note: "node.unreachable on a." },
    ]);
  });

  it("does not claim a check it could not make", () => {
    expect(loopCheckRows({ diagnostics: [], tasksChecked: true })).toEqual([
      { id: "graph", status: "err", title: "Graph could not be checked" },
    ]);
  });

  it("warns of an undeclared cycle, naming where it starts", () => {
    expect(
      loopCheckRows({
        diagnostics: [diagnostic(CODE_UNDECLARED_CYCLE, "build")],
        document: minimal(),
        tasksChecked: false,
      }),
    ).toEqual([
      {
        id: "graph",
        status: "warn",
        title: "Graph has an undeclared cycle",
        note: "through build",
      },
    ]);
  });

  it("counts several undeclared cycles", () => {
    const [row] = loopCheckRows({
      diagnostics: [diagnostic(CODE_UNDECLARED_CYCLE, "a"), diagnostic(CODE_UNDECLARED_CYCLE, "c")],
      document: minimal(),
      tasksChecked: false,
    });

    expect(row).toEqual({
      id: "graph",
      status: "warn",
      title: "Graph has 2 undeclared cycles",
      note: "through a · c",
    });
  });

  it("is titled by the declared loops: none, one named for its stage, or a count", () => {
    const twoLoops = structuredClone(seededCanvas());
    twoLoops.edges.push({
      from: "review",
      to: "implement",
      kind: "loop",
      condition: { kind: "checks", op: "any_failed" },
    });

    expect(rowsFor(minimal(), undefined)[0].title).toBe("Graph acyclic");
    expect(rowsFor(seededCanvas(), undefined)[0].title).toBe(
      "Graph acyclic except declared gate loop",
    );
    expect(rowsFor(validDocument(twoLoops), undefined)[0].title).toBe(
      "Graph acyclic except 2 declared loops",
    );
  });
});

describe("the references row", () => {
  it("is left out when nothing checked task routes, since a ✓ would be invented", () => {
    expect(rowsFor(seededCanvas(), { skills: ["repo-map", "zephyr-conventions"] })).toEqual([
      { id: "graph", status: "ok", title: "Graph acyclic except declared gate loop" },
    ]);
  });

  it("still warns of a reference that failed, whatever else was checked", () => {
    const rows = rowsFor(seededCanvas(), { skills: ["repo-map"] });

    expect(rows[1]).toEqual({
      id: "references",
      status: "warn",
      title: "1 reference does not resolve",
      note: "unresolved in implement",
    });
  });

  it("counts several unresolved references, naming each stage once", () => {
    const [, row] = loopCheckRows({
      diagnostics: [
        diagnostic("reference.unknown_skill", "implement"),
        diagnostic("reference.unknown_task", "implement"),
        diagnostic("reference.unknown_task", "split"),
      ],
      document: seededCanvas(),
      tasksChecked: true,
    });

    expect(row).toEqual({
      id: "references",
      status: "warn",
      title: "3 references do not resolve",
      note: "unresolved in implement · split",
    });
  });

  it("has no note for a workflow with no model stage", () => {
    expect(rowsFor(minimal(), { tasks: ["implement"] })).toEqual([
      { id: "graph", status: "ok", title: "Graph acyclic" },
      { id: "references", status: "ok", title: "All task routes resolve" },
    ]);
  });
});
