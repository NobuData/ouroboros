import { pinnedTaskKinds } from "./admission.pin";

/** A model stage routed one of the two ways. */
function llm(id: string, routing: Record<string, unknown>) {
  return {
    id,
    type: "llm",
    title: id,
    position: { x: 0, y: 0 },
    config: {
      mode: "prompt",
      prompt_template: "Do the work.",
      routing,
      limits: { max_retries: 1, token_budget: 200000 },
      permissions: { push_fixup: false, touch_ci: false },
    },
  };
}

/** A workflow document over these nodes. */
function document(nodes: unknown[]) {
  return {
    dsl_version: "1.0",
    trigger: { event: "ticket_queued", conditions: {} },
    nodes,
    edges: [],
  };
}

const TRIGGER = {
  id: "trigger",
  type: "trigger",
  title: "trigger",
  position: { x: 0, y: 0 },
  config: {},
};

describe("the task kinds a pinned workflow inherits", () => {
  it("names each inherited task kind once, in document order", () => {
    expect(
      pinnedTaskKinds(
        document([
          TRIGGER,
          llm("plan", { inherit_task: "plan" }),
          llm("implement", { inherit_task: "implement" }),
          llm("again", { inherit_task: "plan" }),
        ]),
      ),
    ).toEqual(["plan", "implement"]);
  });

  it("asks no route of a stage pinned to a model alias", () => {
    expect(
      pinnedTaskKinds(document([TRIGGER, llm("review", { pinned_model: { alias: "coder-max" } })])),
    ).toEqual([]);
  });

  it("answers an empty list for a workflow with no model stage", () => {
    expect(pinnedTaskKinds(document([TRIGGER]))).toEqual([]);
  });

  it.each([
    ["not a workflow document", { hello: "world" }],
    ["null", null],
    ["a document with no nodes", document([])],
    ["a node that is not a node", document([{ id: "Bad Id!", type: "llm" }])],
    [
      "a model stage whose config does not parse",
      document([
        { ...llm("implement", { inherit_task: "implement" }), config: { mode: "prompt" } },
      ]),
    ],
  ])("answers undefined for %s", (_label, definition) => {
    expect(pinnedTaskKinds(definition)).toBeUndefined();
  });
});
