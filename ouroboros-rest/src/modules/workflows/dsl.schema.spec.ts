/**
 * The bounds themselves.
 *
 * `dsl.parity.spec.ts` proves the whole verdict for one document per rule and
 * `dsl.conformance.spec.ts` proves the published schema agrees with these; what neither does
 * is stand at the edge of each bound and check which side of it is accepted. An off-by-one in
 * a `maximum` is invisible to a fixture set that never sits on the boundary, and it is the
 * kind of mistake a schema keeps for years.
 */

import {
  EdgeSchema,
  InfraConfigSchema,
  LlmConfigSchema,
  NODE_CONFIG_SCHEMAS,
  NodeIdSchema,
  NodeShapeSchema,
  PREDICATE_KINDS,
  PREDICATE_SCHEMAS,
  PositionSchema,
  SUPPORTED_DSL_VERSIONS,
  TERM_ACTIONS,
  TERM_OPTION_SCHEMAS,
  TriggerSchema,
  WorkflowRootSchema,
} from "./dsl.schema";

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe("NodeIdSchema", () => {
  it.each(["a", "0", "standard-fix", "a-b-c", "x".repeat(64)])("accepts %p", (id) => {
    expect(accepts(NodeIdSchema, id)).toBe(true);
  });

  it.each([
    ["the empty string", ""],
    ["a leading hyphen", "-a"],
    ["a trailing hyphen", "a-"],
    ["an upper-case letter", "Implement"],
    ["a space", "back to queue"],
    ["an underscore", "back_to_queue"],
    ["65 characters", "x".repeat(65)],
  ])("refuses %s", (_label, id) => {
    expect(accepts(NodeIdSchema, id)).toBe(false);
  });
});

describe("PositionSchema", () => {
  it("accepts a fractional coordinate, because dragging produces one", () => {
    expect(accepts(PositionSchema, { x: 12.5, y: -3.25 })).toBe(true);
  });

  it("accepts each bound and refuses the value past it", () => {
    expect(accepts(PositionSchema, { x: -100000, y: 100000 })).toBe(true);
    expect(accepts(PositionSchema, { x: -100001, y: 0 })).toBe(false);
    expect(accepts(PositionSchema, { x: 0, y: 100001 })).toBe(false);
  });

  it("refuses a coordinate that is not a number, and one that is missing", () => {
    expect(accepts(PositionSchema, { x: "0", y: 0 })).toBe(false);
    expect(accepts(PositionSchema, { x: 0 })).toBe(false);
  });
});

describe("TriggerSchema", () => {
  it("accepts an empty conditions object — a trigger that fires on every occurrence", () => {
    expect(accepts(TriggerSchema, { event: "ticket_queued", conditions: {} })).toBe(true);
  });

  it("accepts decision P8's three conditions together", () => {
    expect(
      accepts(TriggerSchema, {
        event: "ticket_queued",
        conditions: { effort_lte: "m", labels: ["bug"], source: "github" },
      }),
    ).toBe(true);
  });

  it("refuses an empty label list, which would mean nothing rather than everything", () => {
    expect(accepts(TriggerSchema, { event: "ticket_queued", conditions: { labels: [] } })).toBe(
      false,
    );
  });

  it("refuses conditions it does not declare", () => {
    expect(accepts(TriggerSchema, { event: "ticket_queued", conditions: { assignee: "me" } })).toBe(
      false,
    );
  });
});

describe("the predicate grammar", () => {
  it("is the five kinds the DSL publishes, and its keys are those kinds", () => {
    expect(PREDICATE_KINDS).toEqual(["always", "effort", "labels", "source", "checks"]);
    for (const kind of PREDICATE_KINDS) {
      expect(accepts(PREDICATE_SCHEMAS[kind], { kind })).toBe(kind === "always");
    }
  });

  it("accepts every effort operator against every effort value", () => {
    for (const op of ["lt", "lte", "eq", "gte", "gt"]) {
      for (const value of ["xs", "s", "m", "l", "xl"]) {
        expect(accepts(PREDICATE_SCHEMAS.effort, { kind: "effort", op, value })).toBe(true);
      }
    }
  });

  it("makes a gate's `names` optional — absent means every check the run produced", () => {
    expect(accepts(PREDICATE_SCHEMAS.checks, { kind: "checks", op: "all_passed" })).toBe(true);
    expect(accepts(PREDICATE_SCHEMAS.checks, { kind: "checks", op: "all_passed", names: [] })).toBe(
      false,
    );
  });

  it("refuses a source outside the trackers the intake model knows", () => {
    expect(
      accepts(PREDICATE_SCHEMAS.source, { kind: "source", op: "in", values: ["github"] }),
    ).toBe(true);
    expect(
      accepts(PREDICATE_SCHEMAS.source, { kind: "source", op: "in", values: ["bugzilla"] }),
    ).toBe(false);
  });

  it("refuses a member another kind declares", () => {
    // The grammar is closed per kind, not per predicate: `value` belongs to `effort` alone.
    expect(accepts(PREDICATE_SCHEMAS.always, { kind: "always", value: "m" })).toBe(false);
  });
});

describe("LlmConfigSchema", () => {
  const valid = {
    mode: "prompt",
    prompt_template: "Do the thing.",
    routing: { inherit_task: "implement" },
    limits: { max_retries: 2, token_budget: 400000 },
    permissions: { push_fixup: true, touch_ci: false },
  };

  it("accepts the inspector's field set", () => {
    expect(accepts(LlmConfigSchema, valid)).toBe(true);
  });

  it("requires a prompt template in skill mode too, because the skill precedes the prompt", () => {
    const { prompt_template: _dropped, ...withoutTemplate } = valid;
    expect(accepts(LlmConfigSchema, { ...withoutTemplate, mode: "skill", skill: "repo-map" })).toBe(
      false,
    );
  });

  it("accepts each retry bound and refuses the value past it", () => {
    for (const [max_retries, expected] of [
      [0, true],
      [10, true],
      [-1, false],
      [11, false],
      [1.5, false],
    ] as const) {
      expect(
        accepts(LlmConfigSchema, { ...valid, limits: { max_retries, token_budget: 400000 } }),
      ).toBe(expected);
    }
  });

  it("accepts each token budget bound and refuses the value past it", () => {
    for (const [token_budget, expected] of [
      [1000, true],
      [10000000, true],
      [999, false],
      [10000001, false],
    ] as const) {
      expect(accepts(LlmConfigSchema, { ...valid, limits: { max_retries: 2, token_budget } })).toBe(
        expected,
      );
    }
  });

  it("requires both permissions, because one nobody decided binds nobody (decision P9)", () => {
    expect(accepts(LlmConfigSchema, { ...valid, permissions: { push_fixup: true } })).toBe(false);
    expect(accepts(LlmConfigSchema, { ...valid, permissions: {} })).toBe(false);
  });

  it("refuses an empty prompt template", () => {
    expect(accepts(LlmConfigSchema, { ...valid, prompt_template: "" })).toBe(false);
  });

  it("leaves the routing exclusivity to the validator, which has two codes for it", () => {
    // The shape accepts both members and neither; `dsl.validator.ts` is what tells
    // *neither* from *both*, because they are two different mistakes an author makes.
    expect(accepts(LlmConfigSchema, { ...valid, routing: {} })).toBe(true);
    expect(
      accepts(LlmConfigSchema, {
        ...valid,
        routing: { inherit_task: "implement", pinned_model: "claude-fable-5" },
      }),
    ).toBe(true);
    expect(accepts(LlmConfigSchema, { ...valid, routing: { model: "claude-fable-5" } })).toBe(
      false,
    );
  });
});

describe("InfraConfigSchema", () => {
  it("accepts a stage with neither a pool nor a command", () => {
    expect(accepts(InfraConfigSchema, {})).toBe(true);
  });

  it("accepts either or both", () => {
    expect(accepts(InfraConfigSchema, { runner_pool: "pool-a" })).toBe(true);
    expect(accepts(InfraConfigSchema, { command: "twister -p native_sim" })).toBe(true);
    expect(accepts(InfraConfigSchema, { runner_pool: "pool-a", command: "make" })).toBe(true);
  });

  it("refuses an empty command, which is not the same as no command", () => {
    expect(accepts(InfraConfigSchema, { command: "" })).toBe(false);
  });
});

describe("the terminal actions", () => {
  it("are the three the issue specifies", () => {
    expect(TERM_ACTIONS).toEqual(["open_pr_automerge", "back_to_queue", "needs_review"]);
  });

  it("give auto-merge the two options the mockup's chip prints, both required", () => {
    expect(
      accepts(TERM_OPTION_SCHEMAS.open_pr_automerge, {
        merge_method: "squash",
        delete_branch: true,
      }),
    ).toBe(true);
    expect(accepts(TERM_OPTION_SCHEMAS.open_pr_automerge, { merge_method: "squash" })).toBe(false);
    expect(accepts(TERM_OPTION_SCHEMAS.open_pr_automerge, {})).toBe(false);
  });

  it("give the other two no options at all, so adding one is an edit to the schema", () => {
    expect(accepts(TERM_OPTION_SCHEMAS.back_to_queue, {})).toBe(true);
    expect(accepts(TERM_OPTION_SCHEMAS.needs_review, {})).toBe(true);
    expect(accepts(TERM_OPTION_SCHEMAS.back_to_queue, { priority: "high" })).toBe(false);
  });
});

describe("NodeShapeSchema and EdgeSchema", () => {
  const node = {
    id: "implement",
    type: "llm",
    title: "Code the change",
    position: { x: 0, y: 0 },
    config: {},
  };

  it("leaves the config opaque, for the dispatch to judge", () => {
    expect(accepts(NodeShapeSchema, { ...node, config: { anything: true } })).toBe(true);
  });

  it("makes the description optional and bounds it", () => {
    expect(accepts(NodeShapeSchema, { ...node, description: "x".repeat(400) })).toBe(true);
    expect(accepts(NodeShapeSchema, { ...node, description: "x".repeat(401) })).toBe(false);
  });

  it("refuses an empty title and one past the bound", () => {
    expect(accepts(NodeShapeSchema, { ...node, title: "" })).toBe(false);
    expect(accepts(NodeShapeSchema, { ...node, title: "x".repeat(80) })).toBe(true);
    expect(accepts(NodeShapeSchema, { ...node, title: "x".repeat(81) })).toBe(false);
  });

  it("declares a config schema for every node type it accepts", () => {
    expect(Object.keys(NODE_CONFIG_SCHEMAS).sort()).toEqual(
      ["flow", "infra", "llm", "term", "trigger"].sort(),
    );
  });

  it("makes an edge's label and condition optional and bounds the label", () => {
    const edge = { from: "a", to: "b", kind: "default" };
    expect(accepts(EdgeSchema, edge)).toBe(true);
    expect(accepts(EdgeSchema, { ...edge, label: "x".repeat(40) })).toBe(true);
    expect(accepts(EdgeSchema, { ...edge, label: "x".repeat(41) })).toBe(false);
    expect(accepts(EdgeSchema, { ...edge, label: "" })).toBe(false);
  });

  it("gives an edge no id, because its ordered pair is its identity", () => {
    expect(accepts(EdgeSchema, { from: "a", to: "b", kind: "default", id: "e1" })).toBe(false);
  });
});

describe("WorkflowRootSchema", () => {
  const root = {
    dsl_version: "1.0",
    trigger: { event: "ticket_queued", conditions: {} },
    nodes: [{}],
    edges: [],
  };

  it("accepts exactly the minors this build implements", () => {
    expect(SUPPORTED_DSL_VERSIONS).toEqual(["1.0"]);
    expect(accepts(WorkflowRootSchema, root)).toBe(true);
    expect(accepts(WorkflowRootSchema, { ...root, dsl_version: "1.1" })).toBe(false);
  });

  it("refuses a workflow with no stages, and one with more than the canvas can hold", () => {
    expect(accepts(WorkflowRootSchema, { ...root, nodes: [] })).toBe(false);
    expect(accepts(WorkflowRootSchema, { ...root, nodes: new Array(200).fill({}) })).toBe(true);
    expect(accepts(WorkflowRootSchema, { ...root, nodes: new Array(201).fill({}) })).toBe(false);
  });

  it("accepts a workflow with no edges at the frame, and leaves the graph to the rules", () => {
    // A single unreachable terminal is a structural failure, not a frame one; keeping the
    // two apart is what lets `checkStructure` report the rule rather than the array length.
    expect(accepts(WorkflowRootSchema, { ...root, edges: [] })).toBe(true);
    expect(accepts(WorkflowRootSchema, { ...root, edges: new Array(401).fill({}) })).toBe(false);
  });

  it("leaves the elements of both collections opaque", () => {
    expect(accepts(WorkflowRootSchema, { ...root, nodes: [1], edges: ["x"] })).toBe(true);
  });
});
