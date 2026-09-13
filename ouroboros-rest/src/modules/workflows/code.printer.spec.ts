/**
 * The printer — U.1 ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * The issue's acceptance criteria, each asserted over every valid golden document and then over
 * constructed documents that reach what the goldens do not:
 *
 * * **The golden fixture.** Every valid document prints exactly the `.loop.ts` committed beside
 *   it under `schemas/workflow-dsl/fixtures/code/`, so a change that reformats the code view is
 *   a diff a reviewer sees. `standard-fix.loop.ts` is the seeded canvas against mockup 05.
 * * **Determinism.** Repeated prints are byte-identical, and so are prints of the same document
 *   whose keys arrived in a different order.
 * * **Positions and edge kinds round-trip.** The compiler reads the printed text back
 *   (`code.recover.fixture.ts`), and the graph it recovers — every position, every edge's kind,
 *   condition and label, in the document's order, the gate's back-edge included — is the
 *   document's graph.
 * * **It is TypeScript.** Every print is parsed by the compiler and produces no syntax error.
 * * **It reads back.** Every constructed document's print is parsed by `code.parser.ts` (U.2,
 *   [#166](https://github.com/NobuData/ouroboros/issues/166)) into that same document.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  LOOP_COMMENT,
  ROUND_TRIP_COMMENT,
  STAGE_CALLEES,
  STAGE_OPTIONS,
  type StageCallee,
} from "./code.grammar";
import { parseWorkflowCode } from "./code.parser";
import { calleeFor, printWorkflowCode, WorkflowCodePrintError } from "./code.printer";
import {
  compilerLineCount,
  graphOf,
  recoverGraph,
  recoverWorkflowCode,
  sdkReferences,
  syntaxErrors,
  validDocument,
} from "./code.recover.fixture";
import { FIXTURES_DIR, readExpectedCases, readFixture } from "./dsl.golden.fixture";
import type { WorkflowDocument, WorkflowNode } from "./dsl.schema";

/** Every document the fixture set records as valid, once each. */
const VALID_DOCUMENTS = [
  ...new Set(
    readExpectedCases()
      .filter((entry) => entry.valid)
      .map((entry) => entry.document),
  ),
];

/** U+2028 and U+2029, built from their code points so this file never holds them raw. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * The same value with every object's keys in reverse order, arrays untouched.
 *
 * @param value - A JSON value.
 * @returns The re-keyed copy.
 */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, member]) => [key, reversedKeys(member)]),
  );
}

/**
 * Assert everything the printer promises about one document, and return what it printed.
 *
 * @param slug - The slug to print under.
 * @param document - A valid document.
 * @returns The printed text.
 */
function printLosslessly(slug: string, document: WorkflowDocument): string {
  const { text } = printWorkflowCode(slug, document);

  expect(syntaxErrors(text)).toEqual([]);
  expect(recoverGraph(text)).toStrictEqual(graphOf(document));
  expect(compilerLineCount(text)).toBe(text.split("\n").length);
  expect(parseWorkflowCode(text)).toStrictEqual({ slug, document, errors: [] });

  return text;
}

describe.each(VALID_DOCUMENTS)("%s", (relativePath) => {
  const name = relativePath.replace(/^valid\//, "").replace(/\.json$/, "");
  const document = validDocument(readFixture(relativePath));
  const printed = printWorkflowCode(name, document);

  it("prints exactly the projection committed beside it", () => {
    const committed = readFileSync(join(FIXTURES_DIR, "code", `${name}.loop.ts`), "utf8");
    expect(printed.text).toBe(committed);
  });

  it("is TypeScript the compiler reads without a syntax error", () => {
    expect(syntaxErrors(printed.text)).toEqual([]);
  });

  it("prints byte-identical output every time", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(printWorkflowCode(name, document)).toStrictEqual(printed);
    }
  });

  it("prints the same bytes whatever order the document's keys arrived in", () => {
    const rekeyed = validDocument(reversedKeys(readFixture(relativePath)));
    expect(printWorkflowCode(name, rekeyed).text).toBe(printed.text);
  });

  it("carries every position, and every edge's kind, condition, label and place in the order", () => {
    expect(recoverGraph(printed.text)).toStrictEqual(graphOf(document));
  });

  it("carries the slug, the language version and the trigger", () => {
    const recovered = recoverWorkflowCode(printed.text);

    expect(recovered.slug).toBe(name);
    expect(recovered.dslVersion).toBe(document.dsl_version);
    expect(recovered.trigger).toStrictEqual(document.trigger);
  });

  it("carries every title, description and prompt verbatim, and every flow predicate", () => {
    const { stages } = recoverWorkflowCode(printed.text);

    expect(stages.map((stage) => stage.id)).toStrictEqual(document.nodes.map((node) => node.id));
    document.nodes.forEach((node, index) => {
      expect(stages[index].title).toBe(node.title);
      expect(stages[index].description).toBe(node.description);
      expect(stages[index].prompt).toBe(
        node.type === "llm" ? node.config.prompt_template : undefined,
      );
      expect(stages[index].predicate).toStrictEqual(
        node.type === "flow" ? node.config.predicate : undefined,
      );
    });
  });

  it("writes each stage's options in the order the grammar fixes", () => {
    for (const stage of recoverWorkflowCode(printed.text).stages) {
      const order: readonly string[] = STAGE_OPTIONS[stage.callee as StageCallee];
      expect(stage.optionKeys).toStrictEqual(order.filter((key) => stage.optionKeys.includes(key)));
    }
  });

  it("imports exactly the SDK names it uses, in the grammar's order", () => {
    expect(recoverWorkflowCode(printed.text).imports).toStrictEqual(sdkReferences(printed.text));
  });

  it("maps every node to the lines of its own stage call", () => {
    const lines = printed.text.split("\n");

    expect(printed.spans.map((span) => span.node)).toStrictEqual(
      document.nodes.map((node) => node.id),
    );
    expect(lines[printed.spans[0].startLine - 2]).toBe("  stages: [");
    printed.spans.forEach((span, index) => {
      const node = document.nodes[index];
      expect(lines[span.startLine - 1]).toBe(
        `    ${calleeFor(node)}(${JSON.stringify(node.id)}, {`,
      );
      expect(lines[span.endLine - 1]).toMatch(/^ {4}\}\),( \/\/ .*)?$/);
      if (index > 0) expect(span.startLine).toBe(printed.spans[index - 1].endLine + 1);
    });
    expect(lines[printed.spans.at(-1)!.endLine]).toBe("  ],");
  });
});

describe("the seeded standard-fix, against mockup 05's listing", () => {
  const document = validDocument(readFixture("valid/standard-fix.json"));
  const { text, spans } = printWorkflowCode("standard-fix", document);
  const lines = text.split("\n");

  it.each([
    ['export default defineLoop("standard-fix", {'],
    ["  trigger: {"],
    ['    on: "issue.queued",'],
    ["    when: (i) => i.effort.lte(effort.M),"],
    ["  },"],
    ["  stages: ["],
    ['      skill: "zephyr-conventions",'],
    ['      model: route.task("implement"),'],
    ["      retries: 2,"],
    ["      tokenBudget: 400_000,"],
    ['      farm: "pool-a",'],
    ['      cmd: "twister -p native_sim",'],
    ['      require: ["build", "test", "review"],'],
    ['      onFail: "implement",'],
    ['      merge: "squash",'],
    ["      deleteBranch: true,"],
    ["  ],"],
    ["});"],
  ])("writes the mockup's idiom %s", (line) => {
    expect(lines).toContain(line);
  });

  it("closes the gate, and only the gate, with the loop comment", () => {
    const gate = spans.find((span) => span.node === "checks-green");

    expect(lines.filter((line) => line.includes(LOOP_COMMENT))).toHaveLength(1);
    expect(lines[gate!.endLine - 1]).toBe(`    }), ${LOOP_COMMENT}`);
  });

  it("follows the call with the round-trip comment block", () => {
    const close = lines.indexOf("});");
    expect(lines.slice(close + 2, close + 2 + ROUND_TRIP_COMMENT.length)).toStrictEqual([
      ...ROUND_TRIP_COMMENT,
    ]);
  });

  it("round-trips the back-edge that makes the loop bite its tail", () => {
    const { edges } = recoverGraph(text);
    expect(edges).toContainEqual({
      from: "checks-green",
      to: "implement",
      kind: "loop",
      label: "fail ↺",
      condition: { kind: "checks", op: "any_failed" },
    });
  });
});

describe("constructs the golden fixtures do not reach", () => {
  const LLM = {
    mode: "prompt",
    prompt_template: "Do the work.",
    routing: { inherit_task: "implement" },
    limits: { max_retries: 1, token_budget: 10000 },
    permissions: { push_fixup: false, touch_ci: false },
  };

  /**
   * One node, positioned at the origin and titled for its id.
   *
   * @param id - The node id.
   * @param type - The node type.
   * @param config - Its config.
   * @param extra - Anything to add or override.
   * @returns The node.
   */
  const stage = (
    id: string,
    type: string,
    config: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({ id, type, title: `Stage ${id}`, position: { x: 0, y: 0 }, config, ...extra });

  const START = stage("start", "trigger", {});
  const DONE = stage("done", "term", { action: "needs_review", options: {} });
  const GATE = stage("gate", "flow", {
    kind: "gate",
    predicate: { kind: "checks", op: "all_passed" },
  });
  const PASS = {
    from: "gate",
    to: "done",
    kind: "branch",
    condition: { kind: "checks", op: "all_passed" },
  };

  /**
   * A valid document from nodes, edges and trigger conditions.
   *
   * @param nodes - The nodes.
   * @param edges - The edges.
   * @param conditions - The trigger's conditions.
   * @returns The typed document.
   */
  const workflow = (
    nodes: unknown[],
    edges: unknown[],
    conditions: Record<string, unknown> = {},
  ): WorkflowDocument =>
    validDocument({
      dsl_version: "1.0",
      trigger: { event: "ticket_queued", conditions },
      nodes,
      edges,
    });

  it("lists several default edges from one stage in one next", () => {
    const text = printLosslessly(
      "fan-out",
      workflow(
        [
          START,
          stage("a", "infra", {}),
          DONE,
          stage("other", "term", { action: "back_to_queue", options: {} }),
        ],
        [
          { from: "start", to: "a", kind: "default" },
          { from: "a", to: "done", kind: "default" },
          { from: "a", to: "other", kind: "default" },
        ],
      ),
    );

    expect(text).toContain('      next: ["done", "other"],\n');
  });

  it("writes an unconditioned loop edge as an entry with no when", () => {
    const text = printLosslessly(
      "bare-loop",
      workflow(
        [START, stage("a", "infra", {}), GATE, DONE],
        [
          { from: "start", to: "a", kind: "default" },
          { from: "a", to: "gate", kind: "default" },
          PASS,
          { from: "gate", to: "a", kind: "loop" },
        ],
      ),
    );

    expect(text).toContain("      when: (i) => i.checks.allPassed(),\n");
    expect(text).toContain(
      '      onFail: [\n        { to: "a" },\n      ],\n    }), // the loop bites its tail\n',
    );
  });

  it("writes a loop on named failures as an entry with its when", () => {
    const text = printLosslessly(
      "named-loop",
      workflow(
        [START, stage("a", "infra", {}), GATE, DONE],
        [
          { from: "start", to: "a", kind: "default" },
          { from: "a", to: "gate", kind: "default" },
          PASS,
          {
            from: "gate",
            to: "a",
            kind: "loop",
            condition: { kind: "checks", op: "any_failed", names: ["build"] },
          },
        ],
      ),
    );

    expect(text).toContain('        { to: "a", when: (i) => i.checks.anyFailed(["build"]) },\n');
  });

  it("writes two loop edges as a list even when both are plain failures", () => {
    const failed = { kind: "checks", op: "any_failed" };
    const text = printLosslessly(
      "two-loops",
      workflow(
        [START, stage("a", "infra", {}), stage("b", "infra", {}), GATE, DONE],
        [
          { from: "start", to: "a", kind: "default" },
          { from: "a", to: "b", kind: "default" },
          { from: "b", to: "gate", kind: "default" },
          PASS,
          { from: "gate", to: "a", kind: "loop", condition: failed },
          { from: "gate", to: "b", kind: "loop", condition: failed },
        ],
      ),
    );

    expect(text).toContain(
      '      onFail: [\n        { to: "a", when: (i) => i.checks.anyFailed() },\n        { to: "b", when: (i) => i.checks.anyFailed() },\n      ],\n',
    );
    expect(text).not.toContain('onFail: "');
  });

  it("imports effort when only a decision compares one", () => {
    const text = printLosslessly(
      "effort-decision",
      workflow(
        [
          START,
          stage("route", "flow", {
            kind: "decision",
            predicate: { kind: "effort", op: "gte", value: "l" },
          }),
          DONE,
        ],
        [
          { from: "start", to: "route", kind: "default" },
          { from: "route", to: "done", kind: "branch", condition: { kind: "always" } },
        ],
      ),
    );

    expect(text.split("\n")[0]).toBe(
      'import { defineLoop, effort, trigger, decision, needsReview } from "@ouroboros/sdk";',
    );
    expect(text).toContain("      when: (i) => i.effort.gte(effort.L),\n");
    // The trigger has no conditions, so no `when` at the trigger's four-space depth.
    expect(text).toContain('  trigger: {\n    on: "issue.queued",\n  },\n');
  });

  it("spells both routings and both modes of a model stage", () => {
    const text = printLosslessly(
      "routes",
      workflow(
        [
          START,
          stage("pinned", "llm", { ...LLM, routing: { pinned_model: "claude-fable-5" } }),
          stage("skilled", "llm", { ...LLM, mode: "skill", skill: "repo-map" }),
          DONE,
        ],
        [
          { from: "start", to: "pinned", kind: "default" },
          { from: "pinned", to: "skilled", kind: "default" },
          { from: "skilled", to: "done", kind: "default" },
        ],
      ),
    );
    const [pinned, skilled] = text.split('    llm("').slice(1);

    expect(pinned).toContain('      model: route.model("claude-fable-5"),\n');
    expect(pinned).not.toContain("skill:");
    expect(skilled).toContain('      skill: "repo-map",\n      model: route.task("implement"),\n');
    expect(text).toContain("      tokenBudget: 10_000,\n");
    expect(text).toContain("      permissions: { pushFixup: false, touchCi: false },\n");
  });

  it("spells an infra stage with only a command, and a terminal's merge options", () => {
    const text = printLosslessly(
      "infra-command",
      workflow(
        [
          START,
          stage("lint", "infra", { command: "vale docs/" }),
          stage("ship", "term", {
            action: "open_pr_automerge",
            options: { merge_method: "rebase", delete_branch: false },
          }),
        ],
        [
          { from: "start", to: "lint", kind: "default" },
          { from: "lint", to: "ship", kind: "default" },
        ],
      ),
    );

    expect(text).toContain('      cmd: "vale docs/",\n');
    expect(text).not.toContain("farm:");
    expect(text).toContain('      merge: "rebase",\n      deleteBranch: false,\n');
  });

  it("spells a trigger with every condition, and one with none", () => {
    const edges = [{ from: "start", to: "done", kind: "default" }];
    const all = printLosslessly(
      "all-conditions",
      workflow([START, DONE], edges, { source: "gitlab", labels: ["bug"], effort_lte: "xs" }),
    );
    const none = printLosslessly("no-conditions", workflow([START, DONE], edges));

    expect(all).toContain(
      '    when: (i) => i.effort.lte(effort.XS) && i.labels.all(["bug"]) && i.source.is("gitlab"),\n',
    );
    expect(none).toContain('  trigger: {\n    on: "issue.queued",\n  },\n');
  });

  it("carries strings no raw literal can hold, without adding a line break the compiler counts", () => {
    const title = `say "hi"\nthen ${LINE_SEPARATOR} leave`;
    const description = `back\\slash ${PARAGRAPH_SEPARATOR} end`;
    const prompt = `Run \`make\` with \${target}\r\nthen {{issue.title}} ${LINE_SEPARATOR} ${String.fromCharCode(0xd800)} done`;
    const document = workflow(
      [
        START,
        stage("hostile", "llm", { ...LLM, prompt_template: prompt }, { title, description }),
        DONE,
      ],
      [
        { from: "start", to: "hostile", kind: "default" },
        { from: "hostile", to: "done", kind: "default" },
      ],
    );
    const text = printLosslessly("hostile", document);
    const hostile = recoverWorkflowCode(text).stages[1];

    expect(hostile).toMatchObject({ title, description, prompt });
    expect(text).not.toContain("\r");
    expect(text).not.toContain(LINE_SEPARATOR);
  });

  it("carries negative zero and fractional positions", () => {
    const text = printLosslessly(
      "positions",
      workflow(
        [
          { ...START, position: { x: -0, y: 12.5 } },
          { ...DONE, position: { x: -99999.25, y: 100000 } },
        ],
        [{ from: "start", to: "done", kind: "default" }],
      ),
    );
    const [start, done] = recoverGraph(text).nodes;

    expect(Object.is(start.x, -0)).toBe(true);
    expect(start.y).toBe(12.5);
    expect(done).toMatchObject({ x: -99999.25, y: 100000 });
  });
});

describe("calleeFor", () => {
  const node = (type: string, config: Record<string, unknown>) =>
    ({ id: "n", type, title: "N", position: { x: 0, y: 0 }, config }) as unknown as WorkflowNode;

  it.each([
    [node("trigger", {}), "trigger"],
    [node("llm", {}), "llm"],
    [node("infra", {}), "infra"],
    [node("flow", { kind: "decision" }), "decision"],
    [node("flow", { kind: "gate" }), "gate"],
    [node("term", { action: "open_pr_automerge" }), "openPr"],
    [node("term", { action: "back_to_queue" }), "backToQueue"],
    [node("term", { action: "needs_review" }), "needsReview"],
  ])("names %j as %s", (subject, callee) => {
    expect(calleeFor(subject)).toBe(callee);
  });

  it("reaches every callee the grammar declares", () => {
    const reached = [
      "trigger",
      "llm",
      "infra",
      "decision",
      "gate",
      "openPr",
      "backToQueue",
      "needsReview",
    ];
    expect([...STAGE_CALLEES].sort()).toEqual(reached.sort());
  });
});

describe("what the printer refuses", () => {
  const minimal = validDocument(readFixture("valid/minimal.json"));
  const standardFix = validDocument(readFixture("valid/standard-fix.json"));

  it.each(["", "Standard Fix", "-leading", "trailing-", "under_score", "a".repeat(65)])(
    "refuses the slug %p",
    (slug) => {
      expect(() => printWorkflowCode(slug, minimal)).toThrow(WorkflowCodePrintError);
    },
  );

  it("accepts a slug of exactly 64 characters", () => {
    expect(printWorkflowCode("a".repeat(64), minimal).text).toContain(
      `defineLoop("${"a".repeat(64)}"`,
    );
  });

  /**
   * A copy of standard-fix with one invariant broken, as an unvalidated draft could have it.
   *
   * @param breakIt - The edit.
   * @returns The broken document.
   */
  const broken = (breakIt: (document: WorkflowDocument) => void): WorkflowDocument => {
    const document = structuredClone(standardFix);
    breakIt(document);
    return document;
  };

  /**
   * A model stage of the copy, by id.
   *
   * @param document - The copy.
   * @param id - The node id.
   * @returns The stage's config.
   */
  const llmConfig = (document: WorkflowDocument, id: string) => {
    const node = document.nodes.find((candidate) => candidate.id === id);
    if (node?.type !== "llm") throw new Error(`${id} is not a model stage`);
    return node.config;
  };

  it.each([
    [
      "a model stage that routes by a task and a model",
      broken((document) => {
        llmConfig(document, "implement").routing.pinned_model = "claude-fable-5";
      }),
    ],
    [
      "a model stage that routes by neither",
      broken((document) => {
        llmConfig(document, "implement").routing = {};
      }),
    ],
    [
      "a skill-mode stage with no skill",
      broken((document) => {
        delete llmConfig(document, "implement").skill;
      }),
    ],
    [
      "a prompt-mode stage with a skill",
      broken((document) => {
        llmConfig(document, "plan").skill = "repo-map";
      }),
    ],
    [
      "a branch edge with no condition",
      broken((document) => {
        delete document.edges[2].condition;
      }),
    ],
    [
      "a default edge with a condition",
      broken((document) => {
        document.edges[0].condition = { kind: "always" };
      }),
    ],
    [
      "an edge from a node the document does not have",
      broken((document) => {
        document.edges.push({ from: "ghost", to: "analyze", kind: "default" });
      }),
    ],
    [
      "an edge out of a terminal",
      broken((document) => {
        document.edges.push({ from: "open-pr", to: "analyze", kind: "default" });
      }),
    ],
  ])("refuses %s rather than printing something it is not", (_, document) => {
    expect(() => printWorkflowCode("standard-fix", document)).toThrow(WorkflowCodePrintError);
  });
});
