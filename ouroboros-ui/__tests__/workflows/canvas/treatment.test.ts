import { describe, expect, it } from "vitest";

import { type Connection, type Stage, readConnections, readStages } from "@/app/workflows/canvas/graph";
import {
  EDGE_VARIANTS,
  PROMPT_TEMPLATE_CHIP,
  ROUTED_BY_TASK_CHIP,
  edgeVariant,
  isPill,
  labelAnchor,
  labelTone,
  predicateWords,
  roleOf,
  stageChips,
  stageRole,
} from "@/app/workflows/canvas/treatment";

import { standardFixDefinition } from "../../helpers/workflows";

/**
 * What each stage and each edge looks like, decided (#149): the type line, the chip row, the
 * mini pill, and an edge's variant, label tone and label placement.
 *
 * Every case is a judgement about values — the seeded `standard-fix` in, the mockup's words
 * out — because *chips derive from config* is a property of the derivation and not of a page.
 * That the node and the edge draw what is decided here is `studio-canvas.test.tsx`'s and
 * `stage-node.test.tsx`'s; that the treatments are the mockup's colours is
 * `canvas-styles.test.ts`'s.
 */

/** The seeded document. */
const SEEDED = standardFixDefinition();

/** Its twelve stages. */
const STAGES = readStages(SEEDED);

/** Its twelve connections. */
const CONNECTIONS = readConnections(SEEDED, STAGES);

/**
 * One seeded stage.
 *
 * @param id The node's id.
 * @returns The stage, as the canvas reads it.
 */
function seeded(id: string): Stage {
  const found = STAGES.find((stage) => stage.id === id);
  if (found === undefined) throw new Error(`no seeded stage ${id}`);
  return found;
}

/**
 * A stage built by hand, for the cases the seed does not hold.
 *
 * @param kind Which type.
 * @param config Its config.
 * @returns The stage.
 */
function stageOf(kind: Stage["kind"], config: Record<string, unknown>): Stage {
  return { id: "stage", kind, title: "Stage", position: { x: 0, y: 0 }, config };
}

/**
 * What a stage's chips print.
 *
 * @param stage The stage.
 * @param trigger The document's root trigger, for the trigger node.
 * @returns The texts, in order.
 */
function texts(stage: Stage, trigger?: unknown): string[] {
  return stageChips(stage, trigger).map((chip) => chip.text);
}

/**
 * A connection built by hand.
 *
 * @param kind Its kind.
 * @param condition Its condition.
 * @param label What it prints — deliberately not what its tone is read from.
 * @returns The connection.
 */
function connection(
  kind: Connection["kind"],
  condition: Connection["condition"],
  label: string | null = "pass →",
): Connection {
  return { from: "a", to: "b", kind, label, condition };
}

describe("the type line", () => {
  it("prints the mockup's word for every seeded stage that has a type line", () => {
    expect(STAGES.filter((stage) => !isPill(stage)).map((stage) => [stage.id, stageRole(stage)])).toEqual([
      ["issue-queued", "Trigger"],
      ["analyze", "Analyze"],
      ["effort-recheck", "Decision"],
      ["plan", "Plan"],
      ["split", "Split"],
      ["implement", "Implement"],
      ["build", "Build"],
      ["test", "Test"],
      ["review", "Review"],
      ["checks-green", "Gate"],
      ["open-pr", "Terminal"],
    ]);
  });

  it("reads a flow node's word from its kind, and says Flow for a kind it does not know", () => {
    expect(stageRole(stageOf("flow", { kind: "gate" }))).toBe("Gate");
    expect(stageRole(stageOf("flow", { kind: "decision" }))).toBe("Decision");
    expect(stageRole(stageOf("flow", { kind: "fork" }))).toBe("Flow");
    expect(stageRole(stageOf("flow", {}))).toBe("Flow");
  });

  it("reads a model or infra stage's role from the id its author gave it", () => {
    expect(roleOf("analyze")).toBe("Analyze");
    expect(roleOf("effort-recheck")).toBe("Effort recheck");
    expect(roleOf("run--tests-")).toBe("Run tests");
    expect(roleOf("-")).toBe("-");
    expect(stageRole({ ...stageOf("infra", {}), id: "build-arm64" })).toBe("Build arm64");
    // A trigger's or a terminal's id is not its role: its type is.
    expect(stageRole({ ...stageOf("term", {}), id: "open-pr" })).toBe("Terminal");
  });
});

describe("the mini pill", () => {
  it("is Back to queue, and no other seeded stage", () => {
    expect(STAGES.filter(isPill).map((stage) => stage.id)).toEqual(["back-to-queue"]);
  });

  it("is a back_to_queue terminal and nothing else", () => {
    expect(isPill(stageOf("term", { action: "needs_review", options: {} }))).toBe(false);
    expect(isPill(stageOf("term", { action: "open_pr_automerge" }))).toBe(false);
    expect(isPill(stageOf("term", {}))).toBe(false);
    expect(isPill(stageOf("llm", { action: "back_to_queue" }))).toBe(false);
  });
});

describe("the chips on the seeded graph", () => {
  it("derives every stage's chips from its config", () => {
    // The mockup's chips, as the seed's configs say them — see treatment.ts on the four places
    // the document and the picture disagree (aliases, 3 checks, the two sentences, the pool).
    expect(Object.fromEntries(STAGES.map((stage) => [stage.id, texts(stage, SEEDED.trigger)]))).toEqual({
      "issue-queued": ["effort ≤ M"],
      analyze: ["skill:repo-map", "coder-std"],
      "effort-recheck": ["effort ≤ M"],
      plan: [PROMPT_TEMPLATE_CHIP, "coder-max"],
      split: [PROMPT_TEMPLATE_CHIP, ROUTED_BY_TASK_CHIP],
      "back-to-queue": [],
      implement: ["skill:zephyr-conventions", ROUTED_BY_TASK_CHIP],
      build: ["runner pool-a"],
      test: ["twister -p native_sim", "runner pool-a"],
      review: [PROMPT_TEMPLATE_CHIP, "coder-max"],
      "checks-green": ["required checks: 3"],
      "open-pr": ["squash · delete branch"],
    });
  });

  it("names what each chip reports, once per stage, so it can key the chip", () => {
    expect(stageChips(seeded("implement")).map((chip) => chip.kind)).toEqual(["skill", "route"]);
    expect(stageChips(seeded("analyze")).map((chip) => chip.kind)).toEqual(["skill", "model"]);
    expect(stageChips(seeded("test")).map((chip) => chip.kind)).toEqual(["command", "runner"]);

    for (const stage of STAGES) {
      const kinds = stageChips(stage, SEEDED.trigger).map((chip) => chip.kind);
      expect(new Set(kinds).size, stage.id).toBe(kinds.length);
    }
  });
});

describe("chips follow the config", () => {
  it("prints the new skill when a stage's skill is edited", () => {
    const implement = seeded("implement");

    expect(texts({ ...implement, config: { ...implement.config, skill: "rust-conventions" } })).toEqual([
      "skill:rust-conventions",
      ROUTED_BY_TASK_CHIP,
    ]);
  });

  it("swaps the skill for the prompt, and the route for the alias, when the stage is switched over", () => {
    const implement = seeded("implement");
    const edited = {
      ...implement,
      config: { ...implement.config, mode: "prompt", routing: { pinned_model: { alias: "coder-max" } } },
    };

    expect(texts(edited)).toEqual([PROMPT_TEMPLATE_CHIP, "coder-max"]);
  });

  it("prints the trigger's conditions from the document's root, not from the node's empty config", () => {
    const trigger = seeded("issue-queued");

    expect(
      texts(trigger, {
        event: "ticket_queued",
        conditions: { effort_lte: "s", labels: ["docs", "deps"], source: "github" },
      }),
    ).toEqual(["effort ≤ S", "labels: docs, deps", "source: github"]);
    expect(texts(trigger, { event: "ticket_queued", conditions: {} })).toEqual([]);
    expect(texts(trigger)).toEqual([]);
    expect(texts(trigger, "not a trigger")).toEqual([]);
  });

  it("counts a gate's checks as its predicate names them", () => {
    const gate = seeded("checks-green");
    const names = Array.from({ length: 14 }, (_, index) => `check-${index}`);

    expect(texts({ ...gate, config: { kind: "gate", predicate: { kind: "checks", op: "all_passed", names } } })).toEqual([
      "required checks: 14",
    ]);
  });
});

describe("a config that is not yet valid", () => {
  it("prints what it can read and leaves out the rest, rather than throwing", () => {
    expect(texts(stageOf("llm", {}))).toEqual([]);
    expect(texts(stageOf("llm", { mode: "skill" }))).toEqual([]);
    expect(texts(stageOf("llm", { mode: "skill", skill: "" }))).toEqual([]);
    // A raw model id where the alias object belongs is `config.routing_raw_model`: no chip.
    expect(texts(stageOf("llm", { mode: "prompt", routing: { pinned_model: "claude-fable-5" } }))).toEqual([
      PROMPT_TEMPLATE_CHIP,
    ]);
    expect(texts(stageOf("llm", { routing: "implement" }))).toEqual([]);
    expect(texts(stageOf("infra", {}))).toEqual([]);
    expect(texts(stageOf("infra", { command: 7, runner_pool: ["a"] }))).toEqual([]);
    expect(texts(stageOf("flow", { kind: "gate" }))).toEqual([]);
    expect(texts(stageOf("flow", { kind: "gate", predicate: { kind: "vibes" } }))).toEqual([]);
    expect(texts(stageOf("term", { action: "open_pr_automerge" }))).toEqual([]);
    expect(texts(stageOf("term", { action: "open_pr_automerge", options: { merge_method: "rebase" } }))).toEqual([
      "rebase",
    ]);
    expect(
      texts(stageOf("term", { action: "open_pr_automerge", options: { merge_method: "merge", delete_branch: false } })),
    ).toEqual(["merge · keep branch"]);
    expect(texts(stageOf("term", { action: "needs_review", options: {} }))).toEqual([]);
  });
});

describe("a predicate in a chip's words", () => {
  it.each([
    [{ kind: "always" }, "always"],
    [{ kind: "effort", op: "lt", value: "l" }, "effort < L"],
    [{ kind: "effort", op: "lte", value: "m" }, "effort ≤ M"],
    [{ kind: "effort", op: "eq", value: "xs" }, "effort = XS"],
    [{ kind: "effort", op: "gte", value: "xl" }, "effort ≥ XL"],
    [{ kind: "effort", op: "gt", value: "m" }, "effort > M"],
    [{ kind: "labels", op: "any", values: ["docs", "deps"] }, "labels any: docs, deps"],
    [{ kind: "labels", op: "none", values: ["wip"] }, "labels none: wip"],
    [{ kind: "source", op: "in", values: ["github"] }, "source in: github"],
    [{ kind: "source", op: "not_in", values: ["jira", "linear"] }, "source not in: jira, linear"],
    [{ kind: "checks", op: "all_passed", names: ["build", "test", "review"] }, "required checks: 3"],
    [{ kind: "checks", op: "all_passed" }, "all checks passed"],
    [{ kind: "checks", op: "any_failed", names: ["build"] }, "failed checks: any of 1"],
    [{ kind: "checks", op: "any_failed" }, "any check failed"],
  ])("reads %j as %s", (predicate, words) => {
    expect(predicateWords(predicate)).toBe(words);
  });

  it("reads nothing out of a predicate it cannot", () => {
    for (const predicate of [
      null,
      {},
      { kind: "effort", op: "lte" },
      { kind: "effort", op: "about", value: "m" },
      { kind: "effort", op: "lte", value: "huge" },
      { kind: "effort", op: "toString", value: "m" },
      { kind: "labels", op: "any", values: [] },
      { kind: "labels", op: "some", values: ["a"] },
      { kind: "source", op: "in" },
      { kind: "checks", op: "some_passed" },
      { kind: "checks" },
    ]) {
      expect(predicateWords(predicate), JSON.stringify(predicate)).toBeNull();
    }
  });
});

describe("an edge's label", () => {
  it("takes the mockup's four tones on the seeded graph, read from the conditions", () => {
    expect(CONNECTIONS.filter((c) => c.label !== null).map((c) => [c.label, labelTone(c)])).toEqual([
      ["≤ M ↓", "accent"],
      ["> M ↘", "warn"],
      ["pass →", "ok"],
      ["fail ↺", "err"],
    ]);
    expect(new Set(CONNECTIONS.filter((c) => c.label === null).map(labelTone))).toEqual(new Set(["plain"]));
  });

  it("reads the tone from the condition, never from the label's text", () => {
    // Every case below prints `pass →`; only the condition decides.
    expect(labelTone(connection("branch", { kind: "checks", op: "any_failed" }))).toBe("err");
    expect(labelTone(connection("branch", { kind: "checks", op: "all_passed" }))).toBe("ok");
    expect(labelTone(connection("branch", { kind: "effort", op: "gte", value: "l" }))).toBe("warn");
    expect(labelTone(connection("branch", { kind: "effort", op: "gt", value: "l" }))).toBe("warn");
    expect(labelTone(connection("branch", { kind: "effort", op: "eq", value: "s" }))).toBe("accent");
    expect(labelTone(connection("branch", { kind: "effort", op: "lt", value: "s" }))).toBe("accent");
    expect(labelTone(connection("branch", { kind: "labels", op: "any", values: ["docs"] }))).toBe("plain");
    expect(labelTone(connection("branch", { kind: "checks", op: "unknown" }))).toBe("plain");
    expect(labelTone(connection("default", null))).toBe("plain");
  });

  it("colours a loop whose condition names no outcome as the return it is", () => {
    expect(labelTone(connection("loop", null))).toBe("err");
    expect(labelTone(connection("loop", { kind: "always" }))).toBe("err");
    expect(labelTone(connection("loop", { kind: "effort", op: "gt", value: "m" }))).toBe("warn");
  });

  it("sits above a row's edge, beside a column's, and on a curve", () => {
    expect(labelAnchor({ x: 510, y: 682 }, { x: 588, y: 682 })).toBe("above");
    expect(labelAnchor({ x: 690, y: 144.4 }, { x: 690.3, y: 230 })).toBe("beside");
    expect(labelAnchor({ x: 408, y: 630 }, { x: 690, y: 524 })).toBe("on");
    expect(labelAnchor({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe("above");
  });
});

describe("an edge's line", () => {
  it("is plain or a loop, and active whenever the path takes it — a loop included", () => {
    expect(EDGE_VARIANTS).toEqual(["plain", "active", "loop"]);
    expect(edgeVariant({ kind: "default" }, false)).toBe("plain");
    expect(edgeVariant({ kind: "branch" }, false)).toBe("plain");
    expect(edgeVariant({ kind: "loop" }, false)).toBe("loop");
    expect(edgeVariant({ kind: "default" }, true)).toBe("active");
    expect(edgeVariant({ kind: "loop" }, true)).toBe("active");
  });
});
