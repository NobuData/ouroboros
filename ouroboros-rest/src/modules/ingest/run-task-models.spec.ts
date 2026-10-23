import type { Resolution } from "../routing/resolution";
import { inheritedTasks, routeAlias, taskModels } from "./run-task-models";

/** A resolution with the hops given, as far as these functions read one. */
function resolution(
  hops: { alias: string; decision: string; provider: unknown }[],
  outcome = "resolved",
): Resolution {
  return { outcome, chain: hops } as unknown as Resolution;
}

describe("inheritedTasks", () => {
  it("names each inherited task of an llm stage once, in stage order", () => {
    expect(
      inheritedTasks({
        nodes: [
          { type: "llm", config: { routing: { inherit_task: "plan" } } },
          { type: "llm", config: { routing: { inherit_task: "implement" } } },
          { type: "llm", config: { routing: { inherit_task: "plan" } } },
        ],
      }),
    ).toEqual(["plan", "implement"]);
  });

  it("ignores a pinned stage, a non-model stage and a blank task", () => {
    expect(
      inheritedTasks({
        nodes: [
          { type: "llm", config: { routing: { pinned_model: { alias: "x" } } } },
          { type: "infra", config: { routing: { inherit_task: "build" } } },
          { type: "llm", config: { routing: { inherit_task: "" } } },
        ],
      }),
    ).toEqual([]);
  });

  it("answers nothing for a document without nodes", () => {
    expect(inheritedTasks(null)).toEqual([]);
    expect(inheritedTasks({ nodes: "no" })).toEqual([]);
  });
});

describe("routeAlias", () => {
  it("is the first kept hop with a provider — the hop the facade calls first", () => {
    expect(
      routeAlias(
        resolution([
          { alias: "dropped", decision: "dropped", provider: { id: "p" } },
          { alias: "no-provider", decision: "kept", provider: null },
          { alias: "coder", decision: "kept", provider: { id: "p" } },
        ]),
      ),
    ).toBe("coder");
  });

  it("is null when routing refused the run or kept nothing callable", () => {
    expect(
      routeAlias(resolution([{ alias: "a", decision: "kept", provider: {} }], "fail_run")),
    ).toBeNull();
    expect(routeAlias(resolution([]))).toBeNull();
  });
});

describe("taskModels", () => {
  it("maps each routed task to its alias and leaves out the unrouted", async () => {
    const document = {
      nodes: [
        { type: "llm", config: { routing: { inherit_task: "plan" } } },
        { type: "llm", config: { routing: { inherit_task: "implement" } } },
      ],
    };

    const models = await taskModels(document, (kind) =>
      Promise.resolve(
        kind === "implement"
          ? resolution([{ alias: "slice-coder", decision: "kept", provider: { id: "p" } }])
          : null,
      ),
    );

    expect(models).toEqual({ implement: "slice-coder" });
  });
});
