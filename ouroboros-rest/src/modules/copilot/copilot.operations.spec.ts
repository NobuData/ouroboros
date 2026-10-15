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

  describe("reads a stored draft as apply_draft_batch() does — over the empty document (#1744)", () => {
    it("reads a blank {} as the empty document, dsl_version included", () => {
      expect(asDraftDocument({})).toEqual({ dsl_version: "1.0", nodes: [], edges: [] });
    });

    it("keeps what the stored draft carries, even a dsl_version the validator refuses", () => {
      // No in-memory default the stored row lacks: the database keeps "2.0", so REST judges "2.0".
      expect(asDraftDocument({ dsl_version: "2.0", note: "kept" })).toEqual({
        dsl_version: "2.0",
        note: "kept",
        nodes: [],
        edges: [],
      });
      expect(asDraftDocument({ dsl_version: 1 }).dsl_version).toBe(1);
    });

    it("does not let one read change the empty document another reads", () => {
      const read = asDraftDocument({});
      (read.nodes as unknown[]).push(TEST_NODE);

      expect(EMPTY_DRAFT.nodes).toEqual([]);
      expect(asDraftDocument({}).nodes).toEqual([]);
    });
  });
});

describe("building on a blank workflow's draft (#1744)", () => {
  const START = {
    id: "start",
    type: "trigger" as const,
    title: "Queued",
    position: { x: 0, y: 200 },
    config: {},
  };
  const DONE = {
    id: "done",
    type: "term" as const,
    title: "Needs review",
    position: { x: 600, y: 200 },
    config: { action: "needs_review", options: {} },
  };

  /** Fold proposals over a stored draft as the exchange does, each one required to apply. */
  function build(stored: unknown, proposals: { kind: string; params: Record<string, unknown> }[]) {
    let document: unknown = stored;
    let last: ReturnType<typeof checkOperation> | undefined;
    for (const proposal of proposals) {
      last = checkOperation(document, proposal);
      if (!last.ok) throw new Error(last.message);
      document = last.document;
    }
    if (last === undefined || !last.ok) throw new Error("nothing applied");
    return last;
  }

  it("tells the model a trigger stage is missing after the issue's four operations", () => {
    const check = build({}, [
      { kind: "set_trigger", params: { trigger: TRIGGER } },
      { kind: "add_stage", params: { node: TEST_NODE } },
      { kind: "add_stage", params: { node: DONE } },
      { kind: "add_edge", params: { edge: { from: "test", to: "done", kind: "default" } } },
    ]);

    expect(check.document.dsl_version).toBe("1.0");
    expect(check.documentValid).toBe(false);
    expect(check.documentErrors.map((error) => error.code)).toContain("document.no_trigger");
  });

  it("validates once a stage of type trigger is added through add_stage", () => {
    const check = build({}, [
      { kind: "set_trigger", params: { trigger: TRIGGER } },
      { kind: "add_stage", params: { node: START } },
      { kind: "add_stage", params: { node: TEST_NODE } },
      { kind: "add_stage", params: { node: DONE } },
      { kind: "add_edge", params: { edge: { from: "start", to: "test", kind: "default" } } },
      { kind: "add_edge", params: { edge: { from: "test", to: "done", kind: "default" } } },
    ]);

    expect(check.documentErrors).toEqual([]);
    expect(check.documentValid).toBe(true);
    expect(check.document).toEqual({
      dsl_version: "1.0",
      trigger: TRIGGER,
      nodes: [START, TEST_NODE, DONE],
      edges: [
        { from: "start", to: "test", kind: "default" },
        { from: "test", to: "done", kind: "default" },
      ],
    });
  });

  it("does not validate a draft whose stored dsl_version the database keeps unsupported", () => {
    const check = build({ dsl_version: "9.9", nodes: [], edges: [] }, [
      { kind: "set_trigger", params: { trigger: TRIGGER } },
      { kind: "add_stage", params: { node: START } },
      { kind: "add_stage", params: { node: DONE } },
      { kind: "add_edge", params: { edge: { from: "start", to: "done", kind: "default" } } },
    ]);

    expect(check.documentValid).toBe(false);
    expect(check.documentErrors.some((error) => error.path === "/dsl_version")).toBe(true);
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
