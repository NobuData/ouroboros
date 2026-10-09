import {
  EMPTY_DRAFT,
  GUARD_KIND,
  OPERATION_KINDS,
  WRITE_KINDS,
  applyOperation,
  asDraftDocument,
  checkOperation,
  nearest,
  operationFromCall,
  suggest,
  type DraftDocument,
  type DraftOperation,
} from "./copilot.operations";

const LLM_NODE = {
  id: "exploit-verify",
  type: "llm" as const,
  title: "Exploit verify",
  position: { x: 640, y: 200 },
  config: {
    mode: "prompt",
    prompt_template: "Re-run the CVE proof of concept against the patched build.",
    routing: { inherit_task: "exploit-verify" },
    limits: { max_retries: 1, token_budget: 200_000 },
    permissions: { push_fixup: false, touch_ci: false },
  },
};

const TEST_NODE = {
  id: "test",
  type: "infra" as const,
  title: "Test",
  position: { x: 300, y: 200 },
  config: {},
};

const TRIGGER = { event: "ticket_queued", conditions: { labels: ["security"] } };

const DRAFT: DraftDocument = {
  dsl_version: "1.0",
  trigger: TRIGGER,
  nodes: [TEST_NODE, LLM_NODE],
  edges: [{ from: "test", to: "exploit-verify", kind: "default" }],
};

describe("the operation vocabulary", () => {
  it("is V110's six kinds, and set_guard is a proposal beside them", () => {
    expect([...OPERATION_KINDS]).toEqual([
      "add_stage",
      "set_stage",
      "remove_stage",
      "add_edge",
      "remove_edge",
      "set_trigger",
    ]);
    expect(WRITE_KINDS).toEqual([...OPERATION_KINDS, GUARD_KIND]);
  });

  it("turns an operation tool's arguments into the operation, and nothing else into one", () => {
    expect(operationFromCall("add_stage", { node: LLM_NODE })).toEqual({
      kind: "add_stage",
      params: { node: LLM_NODE },
    });
    expect(operationFromCall("remove_edge", { from: "a", to: "b" })).toEqual({
      kind: "remove_edge",
      params: { from: "a", to: "b" },
    });
    expect(operationFromCall("ask_user", { prompt: "?" })).toBeUndefined();
    expect(operationFromCall(GUARD_KIND, { guard: "spend_guard" })).toBeUndefined();
  });

  it("reads a stored document loosely and an absent one as the empty base", () => {
    expect(asDraftDocument(null)).toEqual(EMPTY_DRAFT);
    expect(asDraftDocument({ dsl_version: "1.0", nodes: "no" })).toEqual({
      dsl_version: "1.0",
      nodes: [],
      edges: [],
    });
    expect(asDraftDocument(DRAFT)).toEqual(DRAFT);
  });
});

describe("checking an operation", () => {
  it("applies a well-formed add_stage and reports the whole document's state", () => {
    const check = checkOperation(
      { ...DRAFT, nodes: [TEST_NODE], edges: [] },
      { kind: "add_stage", params: { node: LLM_NODE } },
      { tasks: ["review"] },
    );

    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.document.nodes).toHaveLength(2);
    expect(check.operation.kind).toBe("add_stage");
    expect(typeof check.documentValid).toBe("boolean");
  });

  it("bounces a shape the vocabulary does not know, naming the key", () => {
    const check = checkOperation(DRAFT, { kind: "add_stage", params: { stage: LLM_NODE } });

    expect(check).toMatchObject({ ok: false });
    if (check.ok) return;
    expect(check.message).toContain("does not validate");
    expect(check.message).toContain("params");
  });

  it("bounces an unknown kind", () => {
    const check = checkOperation(DRAFT, { kind: "set_stage_config", params: {} });

    expect(check.ok).toBe(false);
  });

  it("bounces a node whose typed config does not parse, with the validator's own message", () => {
    const check = checkOperation(DRAFT, {
      kind: "add_stage",
      params: {
        node: {
          ...LLM_NODE,
          id: "review-second",
          config: { ...LLM_NODE.config, approvers: 2 },
        },
      },
    });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toContain("approvers");
  });

  it("bounces an edge to a stage that is not there, suggesting the near miss", () => {
    const check = checkOperation(DRAFT, {
      kind: "add_edge",
      params: { edge: { from: "test", to: "exploit_verify", kind: "default" } },
    });

    expect(check).toEqual({
      ok: false,
      message: 'edge.to "exploit_verify" names no stage — did you mean "exploit-verify".',
    });
  });

  it("bounces a duplicate stage, a duplicate edge, and removals of what is not there", () => {
    const messages = [
      checkOperation(DRAFT, { kind: "add_stage", params: { node: TEST_NODE } }),
      checkOperation(DRAFT, {
        kind: "add_edge",
        params: { edge: { from: "test", to: "exploit-verify", kind: "default" } },
      }),
      checkOperation(DRAFT, { kind: "remove_stage", params: { id: "plan" } }),
      checkOperation(DRAFT, { kind: "remove_edge", params: { from: "test", to: "plan" } }),
      checkOperation(DRAFT, { kind: "set_stage", params: { node: { ...TEST_NODE, id: "tets" } } }),
    ].map((check) => (check.ok ? "applied" : check.message));

    expect(messages[0]).toContain("already exists");
    expect(messages[1]).toContain("already joined");
    expect(messages[2]).toBe('remove_stage: no stage "plan".');
    expect(messages[3]).toBe('edge.to "plan" names no stage.');
    expect(messages[4]).toBe(
      'set_stage: no stage "tets" — did you mean "test" — use add_stage to add one.',
    );
  });

  it("sets the trigger, replacing the old one whole", () => {
    const check = checkOperation(DRAFT, {
      kind: "set_trigger",
      params: { trigger: { event: "ticket_queued", conditions: { labels: ["security", "cve"] } } },
    });

    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.document.trigger).toEqual({
      event: "ticket_queued",
      conditions: { labels: ["security", "cve"] },
    });
  });

  it("bounces a trigger with a condition the DSL does not know", () => {
    const check = checkOperation(DRAFT, {
      kind: "set_trigger",
      params: { trigger: { event: "ticket_queued", conditions: { cve: true } } },
    });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toContain("cve");
  });

  it("does not bounce because the draft as a whole is unfinished", () => {
    const check = checkOperation(null, { kind: "add_stage", params: { node: TEST_NODE } });

    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.documentValid).toBe(false);
    expect(check.documentErrors.length).toBeGreaterThan(0);
  });
});

describe("applying an operation", () => {
  it("removes a stage with every edge touching it", () => {
    const operation: DraftOperation = { kind: "remove_stage", params: { id: "exploit-verify" } };
    const applied = applyOperation(DRAFT, operation);

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.document.nodes).toEqual([TEST_NODE]);
    expect(applied.document.edges).toEqual([]);
  });

  it("replaces a stage in place", () => {
    const renamed = { ...TEST_NODE, title: "Tests" };
    const applied = applyOperation(DRAFT, { kind: "set_stage", params: { node: renamed } });

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.document.nodes).toEqual([renamed, LLM_NODE]);
  });

  it("removes exactly the named edge", () => {
    const applied = applyOperation(DRAFT, {
      kind: "remove_edge",
      params: { from: "test", to: "exploit-verify" },
    });

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.document.edges).toEqual([]);
  });

  it("leaves everything else in the document as it was", () => {
    const applied = applyOperation(
      { ...DRAFT, extra: "kept" },
      { kind: "add_edge", params: { edge: { from: "exploit-verify", to: "test", kind: "loop" } } },
    );

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.document.extra).toBe("kept");
    expect(applied.document.edges).toHaveLength(2);
  });
});

describe("the suggestion", () => {
  it("prefers the underscore/hyphen spelling, then the nearest within two edits", () => {
    expect(nearest("exploit_verify", ["test", "exploit-verify"])).toBe("exploit-verify");
    expect(nearest("tets", ["test", "plan"])).toBe("test");
    expect(nearest("deploy", ["test", "plan"])).toBeUndefined();
    expect(suggest("deploy", ["test"])).toBe("");
  });
});
