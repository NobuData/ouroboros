import { DslWarningCode } from "./dsl.errors";
import { checkReferences } from "./dsl.references";
import type { LlmConfig, WorkflowDocument, WorkflowNode } from "./dsl.schema";

const llm = (id: string, config: Partial<LlmConfig>): WorkflowNode => ({
  id,
  type: "llm",
  title: id,
  position: { x: 0, y: 0 },
  config: {
    mode: "prompt",
    prompt_template: "Do the thing.",
    routing: { inherit_task: "implement" },
    limits: { max_retries: 1, token_budget: 10000 },
    permissions: { push_fixup: false, touch_ci: false },
    ...config,
  },
});

const document = (nodes: WorkflowNode[]): WorkflowDocument => ({
  dsl_version: "1.0",
  trigger: { event: "ticket_queued", conditions: {} },
  nodes,
  edges: [],
});

describe("checkReferences", () => {
  const doc = document([
    llm("a", { mode: "skill", skill: "repo-map", routing: { pinned_model: "claude-sonnet-5" } }),
    llm("b", { routing: { inherit_task: "plan" } }),
  ]);

  it("reports nothing when the caller supplies no catalogue", () => {
    // Decision P7: nothing in the system knows which skills exist, so nothing here claims to.
    expect(checkReferences(doc, undefined)).toEqual([]);
  });

  it("reports nothing when every reference is in the catalogue", () => {
    expect(
      checkReferences(doc, {
        skills: ["repo-map"],
        models: ["claude-sonnet-5"],
        tasks: ["plan"],
      }),
    ).toEqual([]);
  });

  it("reports each kind of reference the catalogue does not list, anchored at the field", () => {
    expect(checkReferences(doc, { skills: [], models: [], tasks: [] })).toEqual([
      {
        code: DslWarningCode.REFERENCE_UNKNOWN_SKILL,
        path: "/nodes/0/config/skill",
        node: "a",
        message: expect.stringContaining("repo-map") as string,
      },
      {
        code: DslWarningCode.REFERENCE_UNKNOWN_MODEL,
        path: "/nodes/0/config/routing/pinned_model",
        node: "a",
        message: expect.stringContaining("claude-sonnet-5") as string,
      },
      {
        code: DslWarningCode.REFERENCE_UNKNOWN_TASK,
        path: "/nodes/1/config/routing/inherit_task",
        node: "b",
        message: expect.stringContaining("plan") as string,
      },
    ]);
  });

  it("treats an absent member list as not checked, which is not the same as empty", () => {
    // A caller that can enumerate skills but not models says so by supplying only `skills`.
    const warnings = checkReferences(doc, { skills: [] });
    expect(warnings.map((w) => w.code)).toEqual([DslWarningCode.REFERENCE_UNKNOWN_SKILL]);
  });

  it("says nothing about a node that is not a model stage", () => {
    const infra: WorkflowNode = {
      id: "build",
      type: "infra",
      title: "Build",
      position: { x: 0, y: 0 },
      // `runner_pool` is a property of a deployment's build farm, not of the workspace's
      // catalogues, so it is deliberately outside decision P7's question.
      config: { runner_pool: "pool-nobody-has" },
    };
    expect(checkReferences(document([infra]), { skills: [], models: [], tasks: [] })).toEqual([]);
  });

  it("says nothing about a prompt-mode stage that names no skill", () => {
    expect(
      checkReferences(document([llm("a", { routing: { inherit_task: "plan" } })]), {
        skills: [],
        tasks: ["plan"],
      }),
    ).toEqual([]);
  });
});
