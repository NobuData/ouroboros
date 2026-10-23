import { firstModelStageKey } from "./first-loop.stages";

/** A DSL node. */
function node(id: string, type: string) {
  return { id, type, title: id, position: { x: 0, y: 0 }, config: {} };
}

/** A document over these nodes. */
function document(nodes: unknown[]) {
  return {
    dsl_version: "1.0",
    trigger: { event: "ticket_queued", conditions: {} },
    nodes,
    edges: [],
  };
}

describe("firstModelStageKey (BD.1, #396)", () => {
  it("names the first model stage in document order", () => {
    expect(
      firstModelStageKey(
        document([node("start", "trigger"), node("plan", "llm"), node("code", "llm")]),
      ),
    ).toBe("plan");
  });

  it("names none for a document without a model stage, or one that does not read", () => {
    expect(
      firstModelStageKey(document([node("start", "trigger"), node("build", "infra")])),
    ).toBeUndefined();
    expect(firstModelStageKey({})).toBeUndefined();
    expect(firstModelStageKey(null)).toBeUndefined();
  });

  it("skips a node it cannot read and keeps looking", () => {
    expect(firstModelStageKey(document([{ id: "Bad Id", type: "llm" }, node("plan", "llm")]))).toBe(
      "plan",
    );
  });
});
