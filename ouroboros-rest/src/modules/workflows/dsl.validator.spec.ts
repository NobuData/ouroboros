import { DslErrorCode, DslWarningCode } from "./dsl.errors";
import { readFixture } from "./dsl.golden.fixture";
import { validateWorkflowDocument } from "./dsl.validator";

/** The smallest legal document, as a fresh object each call so a test may mutate it. */
const minimal = (): Record<string, unknown> => ({
  dsl_version: "1.0",
  trigger: { event: "ticket_queued", conditions: {} },
  nodes: [
    { id: "start", type: "trigger", title: "Issue queued", position: { x: 0, y: 0 }, config: {} },
    {
      id: "done",
      type: "term",
      title: "Needs review",
      position: { x: 240, y: 0 },
      config: { action: "needs_review", options: {} },
    },
  ],
  edges: [{ from: "start", to: "done", kind: "default" }],
});

/** The codes reported as errors, in the order the verdict gives them. */
const codes = (input: unknown) => validateWorkflowDocument(input).errors.map((e) => e.code);

describe("validateWorkflowDocument — the input it is handed", () => {
  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "dsl_version: 1.0"],
    ["a number", 7],
  ])("refuses %s with one anchored diagnostic rather than throwing", (_label, input) => {
    expect(validateWorkflowDocument(input)).toEqual({
      valid: false,
      errors: [
        { code: DslErrorCode.DOCUMENT_MALFORMED, path: "", message: expect.any(String) as string },
      ],
      warnings: [],
    });
  });

  it("does not assert this build's rules against a document written in a later language", () => {
    // The rules it would report against are not the rules the document was written to. So a
    // version it does not implement is the whole answer, and the graph is not walked at all.
    const doc = { ...minimal(), dsl_version: "2.0", nodes: [] };
    const verdict = validateWorkflowDocument(doc);
    expect(verdict.errors).toEqual([
      {
        code: DslErrorCode.DOCUMENT_DSL_VERSION_UNSUPPORTED,
        path: "/dsl_version",
        message: expect.stringContaining("2.0") as string,
      },
    ]);
  });

  it("calls an absent version required rather than unsupported", () => {
    const doc = minimal();
    delete doc.dsl_version;
    expect(codes(doc)).toEqual([DslErrorCode.SCHEMA_REQUIRED]);
  });

  it("calls a non-string version a vocabulary failure rather than unsupported", () => {
    // The short-circuit is for a *later language*, which is a thing a string can name. The
    // number 1 is not a version at all, so it is the schema's closed vocabulary that
    // refuses it — which is also what pydantic's `Literal` answers, so the two agree.
    expect(codes({ ...minimal(), dsl_version: 1 })).toEqual([DslErrorCode.SCHEMA_ENUM]);
  });

  it("refuses an undeclared property at the document root", () => {
    const verdict = validateWorkflowDocument({ ...minimal(), name: "standard-fix" });
    expect(verdict.errors).toEqual([
      expect.objectContaining({ code: DslErrorCode.SCHEMA_UNKNOWN_PROPERTY, path: "/name" }),
    ]);
  });
});

describe("validateWorkflowDocument — the stages, and their order", () => {
  it("reports a mistake in each node rather than only the first", () => {
    // A canvas that reports one error, is corrected, and then reports another is a canvas an
    // author stops trusting — so the element schemas are applied one node at a time.
    const doc = minimal();
    (doc.nodes as Record<string, unknown>[])[0].title = 4;
    (doc.nodes as Record<string, unknown>[])[1].position = { x: 0 };
    expect(validateWorkflowDocument(doc).errors).toEqual([
      expect.objectContaining({ path: "/nodes/0/title", code: DslErrorCode.SCHEMA_TYPE }),
      expect.objectContaining({ path: "/nodes/1/position/y", code: DslErrorCode.SCHEMA_REQUIRED }),
    ]);
  });

  it("calls a config that is not an object a type failure, not an empty one", () => {
    // `z.record` and pydantic's `dict[str, object]` both refuse an array here, and both call
    // it a type failure at the config itself. A validator that read `[]` as *no properties*
    // would then report whatever the type's own schema requires, which is a different
    // diagnostic about a document nobody wrote.
    const doc = minimal();
    (doc.nodes as Record<string, unknown>[])[1].config = [];
    expect(validateWorkflowDocument(doc).errors).toEqual([
      {
        code: DslErrorCode.SCHEMA_TYPE,
        path: "/nodes/1/config",
        node: "done",
        message: expect.any(String) as string,
      },
    ]);
  });

  it("does not walk the graph when the frame of the document is wrong", () => {
    // `nodes` is not a collection, so there is no graph to have rules about.
    expect(codes({ ...minimal(), nodes: {} })).toEqual([DslErrorCode.SCHEMA_TYPE]);
  });

  it("does not walk the graph when a node's config did not parse", () => {
    // The graph would be one node short, and every answer about it would be about the
    // validator's guesses rather than about the author's document.
    const doc = minimal();
    (doc.nodes as Record<string, unknown>[])[1].config = { action: "close_issue", options: {} };
    doc.edges = [];
    expect(codes(doc)).toEqual([DslErrorCode.SCHEMA_ENUM]);
  });

  it("reports the structural rules once the schema stage is clean", () => {
    const doc = minimal();
    doc.edges = [];
    expect(codes(doc)).toEqual([DslErrorCode.NODE_UNREACHABLE]);
  });

  it("holds warnings back until the document is otherwise valid", () => {
    // An unknown reference is advice about a document somebody can save. Advising on one
    // they cannot would bury the reason they cannot.
    const doc = minimal();
    doc.edges = [];
    const verdict = validateWorkflowDocument(doc, { catalogue: { skills: [] } });
    expect(verdict.valid).toBe(false);
    expect(verdict.warnings).toEqual([]);
  });

  it("anchors a node's schema failure to the id the document gave it", () => {
    // Including when the id is the thing that is wrong: the canvas keys nodes by it.
    const doc = minimal();
    (doc.nodes as Record<string, unknown>[])[1].id = "Needs Review";
    expect(validateWorkflowDocument(doc).errors[0]).toEqual({
      code: DslErrorCode.SCHEMA_PATTERN,
      path: "/nodes/1/id",
      node: "Needs Review",
      message: expect.any(String) as string,
    });
  });

  it("anchors an edge's schema failure to both its endpoints", () => {
    const doc = minimal();
    (doc.edges as Record<string, unknown>[])[0].kind = "maybe";
    expect(validateWorkflowDocument(doc).errors[0]).toEqual({
      code: DslErrorCode.SCHEMA_ENUM,
      path: "/edges/0/kind",
      edge: { from: "start", to: "done" },
      message: expect.any(String) as string,
    });
  });
});

describe("validateWorkflowDocument — the dispatch", () => {
  it("anchors an unknown node type at the type rather than at the node", () => {
    const doc = minimal();
    (doc.nodes as Record<string, unknown>[])[1].type = "notify";
    expect(validateWorkflowDocument(doc).errors[0]).toEqual(
      expect.objectContaining({ code: DslErrorCode.SCHEMA_ENUM, path: "/nodes/1/type" }),
    );
  });

  it("anchors an unknown predicate kind at the kind", () => {
    const doc = minimal();
    (doc.nodes as Record<string, unknown>[]).splice(1, 0, {
      id: "fork",
      type: "flow",
      title: "Decide",
      position: { x: 120, y: 0 },
      config: { kind: "decision", predicate: { kind: "assignee" } },
    });
    expect(validateWorkflowDocument(doc).errors[0]).toEqual(
      expect.objectContaining({
        code: DslErrorCode.SCHEMA_ENUM,
        path: "/nodes/1/config/predicate/kind",
        node: "fork",
      }),
    );
  });

  it("anchors an absent predicate kind at the kind, and calls it required", () => {
    const doc = minimal();
    (doc.edges as Record<string, unknown>[])[0] = {
      from: "start",
      to: "done",
      kind: "branch",
      condition: {},
    };
    expect(validateWorkflowDocument(doc).errors[0]).toEqual(
      expect.objectContaining({
        code: DslErrorCode.SCHEMA_REQUIRED,
        path: "/edges/0/condition/kind",
        edge: { from: "start", to: "done" },
      }),
    );
  });

  it("validates a terminal's options against its own action", () => {
    const doc = minimal();
    (doc.nodes as Record<string, unknown>[])[1].config = {
      action: "needs_review",
      options: { merge_method: "squash" },
    };
    expect(validateWorkflowDocument(doc).errors[0]).toEqual(
      expect.objectContaining({
        code: DslErrorCode.SCHEMA_UNKNOWN_PROPERTY,
        path: "/nodes/1/config/options/merge_method",
      }),
    );
  });

  it("reports both routing mistakes at the same field under different codes", () => {
    const withNeither = minimal();
    const withBoth = minimal();
    for (const [doc, routing] of [
      [withNeither, {}],
      [withBoth, { inherit_task: "implement", pinned_model: "claude-fable-5" }],
    ] as const) {
      (doc.nodes as Record<string, unknown>[]).splice(1, 0, {
        id: "stage",
        type: "llm",
        title: "Code the change",
        position: { x: 120, y: 0 },
        config: {
          mode: "prompt",
          prompt_template: "Do the thing.",
          routing,
          limits: { max_retries: 1, token_budget: 10000 },
          permissions: { push_fixup: false, touch_ci: false },
        },
      });
    }
    expect(codes(withNeither)).toEqual([DslErrorCode.CONFIG_ROUTING_MISSING]);
    expect(codes(withBoth)).toEqual([DslErrorCode.CONFIG_ROUTING_AMBIGUOUS]);
  });
});

describe("validateWorkflowDocument — what a caller gets back", () => {
  it("hands back the typed document for a valid one, and nothing for an invalid one", () => {
    expect(validateWorkflowDocument(minimal()).document).toBeDefined();
    expect(validateWorkflowDocument({ ...minimal(), edges: [] }).document).toBeUndefined();
  });

  it("parses rather than rewrites: the typed document is the document it was handed", () => {
    // Decision P3 makes the stored JSON the canonical artifact. A validator that quietly
    // added a default or dropped a field would make the thing the canvas saved and the thing
    // the engine ran two different documents.
    const source = readFixture("valid/standard-fix.json");
    expect(validateWorkflowDocument(source).document).toEqual(source);
  });

  it("carries no warnings when the caller supplies no catalogue", () => {
    const verdict = validateWorkflowDocument(readFixture("valid/standard-fix.json"));
    expect(verdict).toEqual(expect.objectContaining({ valid: true, errors: [], warnings: [] }));
  });

  it("saves a document whose references are unknown, and says so", () => {
    // The issue's last acceptance criterion, and decision P7 in one assertion.
    const verdict = validateWorkflowDocument(readFixture("valid/standard-fix.json"), {
      catalogue: { skills: [], models: [], tasks: [] },
    });
    expect(verdict.valid).toBe(true);
    expect(verdict.errors).toEqual([]);
    expect(new Set(verdict.warnings.map((w) => w.code))).toEqual(
      new Set([
        DslWarningCode.REFERENCE_UNKNOWN_SKILL,
        DslWarningCode.REFERENCE_UNKNOWN_MODEL,
        DslWarningCode.REFERENCE_UNKNOWN_TASK,
      ]),
    );
  });

  it("never answers with an unanchored diagnostic", () => {
    // The issue's second acceptance criterion: never a bare "invalid document". Every
    // diagnostic carries a pointer, and every one but the handful that are about the
    // document as a whole carries a node or an edge as well.
    const doc = minimal();
    (doc.nodes as Record<string, unknown>[])[1].config = {};
    for (const diagnostic of validateWorkflowDocument(doc).errors) {
      expect(typeof diagnostic.path).toBe("string");
      expect(diagnostic.node ?? diagnostic.edge).toBeDefined();
      expect(diagnostic.message.length).toBeGreaterThan(0);
    }
  });
});
