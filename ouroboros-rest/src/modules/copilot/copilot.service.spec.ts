import type { DatabaseService } from "../db/db.service";
import type {
  CopilotMessage,
  CopilotSession,
  DryRun,
  Workflow,
  WorkflowVersion,
} from "../db/schema";
import type { DryRunAftermath } from "../dry-runs/dry-runs.aftermath";
import type { DryRunPickerService } from "../dry-runs/dry-runs.picker.service";
import type { DryRunSuggestionsService } from "../dry-runs/suggestions.service";
import type { EngineClient } from "../engine/engine.client";
import type { EngineCopilotEvent, EngineCopilotTurnRequest } from "../engine/engine.copilot";
import { ENGINE_DRY_RUN_TIMEOUT_MS } from "../engine/engine.dryruns";
import { NotFoundError } from "../errors/error.envelope";
import { INVOCATION_GATEWAY_AVAILABLE } from "../internal/invoke.contract";
import type { ResolutionService } from "../routing/resolution.service";
import type { CopilotContextService } from "./copilot.context";
import { COPILOT_ERRORS } from "./copilot.errors";
import { SESSION_CLOSED_MID_REPLY } from "./copilot.exchange";
import type { CopilotRepository } from "./copilot.repository";
import {
  COPILOT_TASK_KIND,
  COPILOT_UNROUTED,
  DRY_RUN_RESULTS,
  CopilotService,
  MAX_TICKET_CANDIDATES,
  UNROUTED_PREFIX,
  transcriptOf,
  unroutedMessage,
} from "./copilot.service";
import type { CopilotStreamEvent } from "./copilot.stream";

const WORKSPACE = "acme-robotics-id";
const WORKFLOW = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const SESSION = "5eed008a-0000-4000-8000-000000000001";
const AT = new Date("2026-10-08T15:02:00.000Z");

const TRIGGER_NODE = {
  id: "issue-queued",
  type: "trigger",
  title: "Issue queued",
  position: { x: 0, y: 0 },
  config: {},
};
const REVIEW_NODE = {
  id: "review-primary",
  type: "llm",
  title: "Review",
  position: { x: 600, y: 0 },
  config: {
    mode: "prompt",
    prompt_template: "Review.",
    routing: { inherit_task: "review" },
    limits: { max_retries: 1, token_budget: 100000 },
    permissions: { push_fixup: false, touch_ci: false },
  },
};
const DRAFT_DOCUMENT = {
  dsl_version: "1.0",
  trigger: { event: "ticket_queued", conditions: {} },
  nodes: [TRIGGER_NODE],
  edges: [],
};

function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: WORKFLOW,
    organization_id: WORKSPACE,
    slug: "security-patch",
    name: "security-patch",
    status: "active",
    current_version: null,
    template_slug: null,
    template_version: null,
    draft_rev: 1,
    provenance_summary: { canvas: 1, code: 0, copilot: 0, suggestion: 0 },
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

function draftRow(definition: unknown, updatedAt = AT): WorkflowVersion {
  return {
    id: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9",
    workflow_id: WORKFLOW,
    version: null,
    definition,
    published_at: null,
    published_by: null,
    change_note: null,
    edited_in: "visual",
    created_at: AT,
    updated_at: updatedAt,
  };
}

function session(overrides: Partial<CopilotSession> = {}): CopilotSession {
  return {
    id: SESSION,
    organization_id: WORKSPACE,
    workflow_id: WORKFLOW,
    status: "active",
    model_provenance: [],
    draft_name: "security-patch",
    created_by: "user-1",
    created_at: AT,
    closed_at: null,
    last_seq: 0,
    ...overrides,
  };
}

function message(overrides: Partial<CopilotMessage>): CopilotMessage {
  return {
    id: "m-1",
    organization_id: WORKSPACE,
    session_id: SESSION,
    seq: 1,
    role: "user",
    body: "hi",
    choices: null,
    tool_trace: { operations: [], reads: [], dry_run_proposals: [] },
    tokens_in: null,
    tokens_out: null,
    cost_cents: null,
    status: "complete",
    created_at: AT,
    ...overrides,
  };
}

const RESOLUTION = {
  resolutionVersion: "z1-v1",
  taskKind: COPILOT_TASK_KIND,
  outcome: "resolved",
  chain: [
    { index: 0, alias: "coder-max", modelId: "claude-fable-5", decision: "kept" },
    { index: 1, alias: "coder-std", modelId: "gpt", decision: "dropped" },
  ],
  maxCostCents: 500,
  failure: null,
};

function harness(
  options: {
    turns?: EngineCopilotEvent[][];
    resolution?: unknown;
    routeError?: Error;
    messages?: CopilotMessage[];
    ranked?: unknown[];
  } = {},
) {
  let seq = (options.messages ?? []).length;
  const inserted: CopilotMessage[] = [];
  const finished: unknown[] = [];
  let draft: WorkflowVersion | undefined = draftRow(DRAFT_DOCUMENT);
  let rev = 1;
  const batches: unknown[] = [];

  const copilots = {
    workflow: jest.fn().mockImplementation(() => Promise.resolve(workflow({ draft_rev: rev }))),
    draftOf: jest.fn().mockImplementation(() => Promise.resolve(draft)),
    nodeProvenance: jest.fn().mockResolvedValue([]),
    revision: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ current_version: null, draft_rev: rev })),
    activeSession: jest.fn().mockResolvedValue(session()),
    lastClosedSession: jest.fn().mockResolvedValue(undefined),
    highestVersion: jest.fn().mockResolvedValue(null),
    openDryRun: jest.fn().mockResolvedValue(undefined),
    discardDraft: jest
      .fn()
      .mockResolvedValue({ draft_discarded: true, operations_removed: 3, session_id: SESSION }),
    session: jest.fn().mockResolvedValue(session()),
    sessionStatusLocked: jest.fn().mockResolvedValue("active"),
    createSession: jest.fn().mockResolvedValue(session()),
    appendProvenance: jest.fn().mockResolvedValue(undefined),
    messages: jest
      .fn()
      .mockImplementation(() => Promise.resolve([...(options.messages ?? []), ...inserted])),
    insertUserMessage: jest
      .fn()
      .mockImplementation(async (_org: string, _session: string, body: string) => {
        await Promise.resolve();
        seq += 1;
        const row = message({ id: `m-${seq}`, seq, role: "user", body });
        inserted.push(row);
        return row;
      }),
    insertStreamingReply: jest.fn().mockImplementation(() => {
      seq += 1;
      return Promise.resolve(
        message({ id: `m-${seq}`, seq, role: "copilot", body: "", status: "streaming" }),
      );
    }),
    finishReply: jest
      .fn()
      .mockImplementation(async (id: string, record: Record<string, unknown>) => {
        await Promise.resolve();
        finished.push({ id, ...record });
        return message({ id, seq, role: "copilot", ...(record as object) });
      }),
    answerQuestions: jest.fn().mockImplementation((id: string, choices: unknown) => {
      const reply = (options.messages ?? []).find((row) => row.id === id);
      return Promise.resolve({ ...(reply as CopilotMessage), choices });
    }),
    applyBatch: jest
      .fn()
      .mockImplementation(
        async (_org: string, _wf: string, _user: string, _session: string, ops: unknown[]) => {
          await Promise.resolve();
          batches.push(ops);
          rev += 1;
          draft = draftRow(
            { ...DRAFT_DOCUMENT, nodes: [...DRAFT_DOCUMENT.nodes, REVIEW_NODE] },
            new Date(AT.getTime() + rev),
          );
          return { draft_rev: rev, batch_id: `batch-${rev}` };
        },
      ),
  };

  const grounding = {
    grounding: jest.fn().mockResolvedValue({
      context: { catalog: [], skills: ["pr-etiquette"], tasks: ["review"], guards: [] },
      catalogue: { skills: ["pr-etiquette"], tasks: ["review"] },
    }),
    promotionCatalogue: jest
      .fn()
      .mockResolvedValue({ skills: ["pr-etiquette"], tasks: ["review"], aliases: ["coder-max"] }),
  };

  const routing = {
    resolve: jest.fn().mockImplementation(() => {
      if (options.routeError) return Promise.reject(options.routeError);
      return Promise.resolve(options.resolution ?? RESOLUTION);
    }),
  };

  const sent: unknown[] = [];
  const turns = options.turns ?? [];
  const engine = {
    copilotTurn: jest.fn().mockImplementation(async function* (request: EngineCopilotTurnRequest) {
      // A snapshot: the loop keeps appending to the transcript it sent.
      sent.push({ ...request, transcript: [...request.transcript] });
      await Promise.resolve();
      for (const event of turns[sent.length - 1] ?? [{ kind: "done", finishReason: "stop" }])
        yield event;
    }),
  };

  const picker = { rank: jest.fn().mockResolvedValue(options.ranked ?? []) };

  const suggestions = {
    propose: jest.fn().mockResolvedValue({ ok: true, suggestion: { id: "s-1" } }),
    debriefing: jest.fn().mockResolvedValue("[dry run results] exploit-verify: skipped"),
    draftSpendGuardCents: jest.fn().mockResolvedValue(null),
  };
  const aftermath = { register: jest.fn() };

  const trx = { transaction: "fake" };
  const database = {
    transaction: jest
      .fn()
      .mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(trx)),
  };

  const service = new CopilotService(
    copilots as unknown as CopilotRepository,
    grounding as unknown as CopilotContextService,
    routing as unknown as ResolutionService,
    engine as unknown as EngineClient,
    database as unknown as DatabaseService,
    picker as unknown as DryRunPickerService,
    suggestions as unknown as DryRunSuggestionsService,
    aftermath as unknown as DryRunAftermath,
  );

  return {
    service,
    suggestions,
    aftermath,
    copilots,
    picker,
    routing,
    engine,
    sent,
    finished,
    batches,
    grounding,
    database,
    trx,
    moveDraft: (row: WorkflowVersion | undefined) => (draft = row),
  };
}

async function collect(stream: AsyncGenerator<CopilotStreamEvent>): Promise<CopilotStreamEvent[]> {
  const events: CopilotStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("starting a session", () => {
  it("creates one named after the workflow's slug when no draft name is given", async () => {
    const { service, copilots } = harness();
    copilots.activeSession.mockResolvedValue(undefined);

    const started = await service.start(WORKSPACE, WORKFLOW, "user-1", {});

    expect(copilots.createSession).toHaveBeenCalledWith(
      WORKSPACE,
      WORKFLOW,
      "security-patch",
      "user-1",
    );
    expect(started).toMatchObject({ id: SESSION, draftName: "security-patch", status: "active" });
  });

  it("refuses a second active session, naming the first", async () => {
    const { service } = harness();

    await expect(
      service.start(WORKSPACE, WORKFLOW, "user-1", { draftName: "other" }),
    ).rejects.toMatchObject({
      code: COPILOT_ERRORS.sessionActive,
      details: { sessionId: SESSION },
    });
  });

  it("is a 404 for a workflow this caller cannot see", async () => {
    const { service, copilots } = harness();
    copilots.workflow.mockResolvedValue(undefined);

    await expect(service.start(WORKSPACE, WORKFLOW, "user-1", {})).rejects.toMatchObject({
      code: "workflow_not_found",
    });
  });
});

describe("the continuity read", () => {
  it("answers the active session, its messages and the draft with its warnings", async () => {
    const history = [
      message({ id: "m-1", seq: 1 }),
      message({ id: "m-2", seq: 2, role: "copilot", body: "Drafted." }),
    ];
    const { service, copilots } = harness({ messages: history });
    copilots.draftOf.mockResolvedValue(
      draftRow({
        ...DRAFT_DOCUMENT,
        nodes: [
          {
            ...REVIEW_NODE,
            id: "exploit-verify",
            config: { ...REVIEW_NODE.config, routing: { inherit_task: "exploit-verify" } },
          },
        ],
      }),
    );
    copilots.nodeProvenance.mockResolvedValue([
      { node_id: "exploit-verify", provenance: "copilot", added_rev: 1 },
    ]);

    const conversation = await service.conversation(WORKSPACE, WORKFLOW);

    expect(conversation.draft.nodeProvenance).toEqual([
      { nodeId: "exploit-verify", provenance: "copilot", addedRev: 1 },
    ]);
    expect(conversation.session.id).toBe(SESSION);
    expect(conversation.messages.map((row) => row.id)).toEqual(["m-1", "m-2"]);
    expect(conversation.draft.label).toBe("v0.1");
    expect(conversation.draft.etag).toHaveLength(64);
    expect(conversation.draft.warnings).toEqual([
      expect.objectContaining({ name: "exploit-verify", code: "reference.unknown_task" }) as object,
    ]);
    expect(conversation.draft.provenanceSummary).toEqual({
      canvas: 1,
      code: 0,
      copilot: 0,
      suggestion: 0,
    });
  });

  it("answers the conversation closed last, read-only, when none is active", async () => {
    const history = [message({ id: "m-1", seq: 1 }), message({ id: "m-2", seq: 2 })];
    const { service, copilots } = harness({ messages: history });
    const closed = session({
      id: "5eed008a-0000-4000-8000-000000000002",
      status: "discarded",
      closed_at: new Date("2026-10-09T09:00:00.000Z"),
      last_seq: 2,
    });
    copilots.activeSession.mockResolvedValue(undefined);
    copilots.lastClosedSession.mockResolvedValue(closed);
    // After a discard there is no draft beside the transcript.
    copilots.draftOf.mockResolvedValue(undefined);

    const conversation = await service.conversation(WORKSPACE, WORKFLOW);

    expect(copilots.lastClosedSession).toHaveBeenCalledWith(WORKSPACE, WORKFLOW);
    expect(conversation.session).toMatchObject({
      id: closed.id,
      status: "discarded",
      closedAt: "2026-10-09T09:00:00.000Z",
    });
    expect(copilots.messages).toHaveBeenCalledWith(closed.id);
    expect(conversation.messages.map((row) => row.id)).toEqual(["m-1", "m-2"]);
    expect(conversation.draft.definition).toBeNull();
    expect(conversation.draft.warnings).toEqual([]);
    expect(conversation.draft.nodeProvenance).toEqual([]);
  });

  it("prefers the active session to any closed one", async () => {
    const { service, copilots } = harness();
    copilots.lastClosedSession.mockResolvedValue(session({ id: "older", status: "promoted" }));

    const conversation = await service.conversation(WORKSPACE, WORKFLOW);

    expect(conversation.session).toMatchObject({ id: SESSION, status: "active" });
    expect(copilots.lastClosedSession).not.toHaveBeenCalled();
  });

  it("is a 404 when the workflow never had a session", async () => {
    const { service, copilots } = harness();
    copilots.activeSession.mockResolvedValue(undefined);

    await expect(service.conversation(WORKSPACE, WORKFLOW)).rejects.toMatchObject({
      code: COPILOT_ERRORS.sessionNotFound,
      details: { workflowId: WORKFLOW },
    });
  });
});

describe("what a promotion would publish", () => {
  const NEEDS_REVIEW = {
    id: "open-pr",
    type: "term",
    title: "Needs review",
    position: { x: 900, y: 0 },
    config: { action: "needs_review", options: {} },
  };
  const AUTOMERGE = {
    id: "merge",
    type: "term",
    title: "Auto-merge",
    position: { x: 900, y: 200 },
    config: {
      action: "open_pr_automerge",
      options: { merge_method: "squash", delete_branch: true },
    },
  };

  /** A draft of the trigger then each node, each joined to the next by a default edge. */
  function drafted(...nodes: ({ id: string } & Record<string, unknown>)[]) {
    const chain = [TRIGGER_NODE, ...nodes];
    return draftRow({
      ...DRAFT_DOCUMENT,
      nodes: chain,
      edges: chain
        .slice(1)
        .map((node, index) => ({ from: chain[index].id, to: node.id, kind: "default" })),
    });
  }

  it("names the next version, the draft, the session, the guards and the references", async () => {
    const { service, copilots, suggestions } = harness();
    copilots.workflow.mockResolvedValue(workflow({ draft_rev: 3 }));
    copilots.draftOf.mockResolvedValue(
      drafted(
        {
          ...REVIEW_NODE,
          id: "analyze",
          config: { ...REVIEW_NODE.config, mode: "skill", skill: "advisory-db" },
        },
        {
          ...REVIEW_NODE,
          id: "exploit-verify",
          config: { ...REVIEW_NODE.config, routing: { inherit_task: "exploit-verify" } },
        },
        NEEDS_REVIEW,
      ),
    );
    suggestions.draftSpendGuardCents.mockResolvedValue(500);

    const promotion = await service.promotion(WORKSPACE, WORKFLOW);

    expect(suggestions.draftSpendGuardCents).toHaveBeenCalledWith(WORKSPACE, WORKFLOW);
    expect(promotion).toEqual({
      workflow: { id: WORKFLOW, slug: "security-patch", name: "security-patch" },
      publishes: { version: 1, label: "security-patch v1" },
      draft: {
        present: true,
        label: "v0.3",
        etag: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      },
      session: { id: SESSION, status: "active" },
      guards: [
        expect.objectContaining({
          id: "never_auto_merge",
          source: "definition",
          enforcement: "enforced",
        }) as object,
        expect.objectContaining({
          id: "spend_guard",
          label: "spend cap $5.00/run",
          source: "conversation",
          enforcement: "dry_run_only",
        }) as object,
      ],
      references: [
        {
          code: "reference.unknown_skill",
          node: "analyze",
          name: "advisory-db",
          path: "/nodes/1/config/skill",
          message: "No skill named `advisory-db` is defined in this workspace yet.",
          blocking: false,
        },
        {
          code: "reference.unknown_task",
          node: "exploit-verify",
          name: "exploit-verify",
          path: "/nodes/2/config/routing/inherit_task",
          message: "No task route named `exploit-verify` exists in this workspace yet.",
          blocking: false,
        },
      ],
      blocked: false,
      blockedReasons: [],
    });
  });

  it("numbers the publish after the highest version, not the one in force", async () => {
    const { service, copilots } = harness();
    copilots.workflow.mockResolvedValue(workflow({ current_version: 2, draft_rev: 1 }));
    copilots.highestVersion.mockResolvedValue(3);

    const promotion = await service.promotion(WORKSPACE, WORKFLOW);

    expect(promotion.publishes).toEqual({ version: 4, label: "security-patch v4" });
    expect(promotion.draft.label).toBe("v2.1");
  });

  it("lists never auto-merge only while no ending auto-merges", async () => {
    const { service, copilots } = harness();

    copilots.draftOf.mockResolvedValue(drafted(NEEDS_REVIEW));
    expect((await service.promotion(WORKSPACE, WORKFLOW)).guards.map((guard) => guard.id)).toEqual([
      "never_auto_merge",
    ]);

    copilots.draftOf.mockResolvedValue(drafted(NEEDS_REVIEW, AUTOMERGE));
    expect((await service.promotion(WORKSPACE, WORKFLOW)).guards).toEqual([]);

    // No ending at all: the draft does not end yet, which is not a promise never to merge.
    copilots.draftOf.mockResolvedValue(drafted());
    expect((await service.promotion(WORKSPACE, WORKFLOW)).guards).toEqual([]);
  });

  it("lists the spend guard only when the conversation set one", async () => {
    const { service, copilots, suggestions } = harness();
    copilots.draftOf.mockResolvedValue(drafted(AUTOMERGE));

    expect((await service.promotion(WORKSPACE, WORKFLOW)).guards).toEqual([]);

    suggestions.draftSpendGuardCents.mockResolvedValue(1250);
    expect((await service.promotion(WORKSPACE, WORKFLOW)).guards).toEqual([
      expect.objectContaining({ id: "spend_guard", label: "spend cap $12.50/run" }) as object,
    ]);
  });

  it("is blocked by a pinned alias the registry does not have, and says which", async () => {
    const { service, copilots, grounding } = harness();
    copilots.draftOf.mockResolvedValue(
      drafted(
        {
          ...REVIEW_NODE,
          id: "analyze",
          config: { ...REVIEW_NODE.config, mode: "skill", skill: "advisory-db" },
        },
        {
          ...REVIEW_NODE,
          id: "review-second",
          config: { ...REVIEW_NODE.config, routing: { pinned_model: { alias: "second-opinion" } } },
        },
        NEEDS_REVIEW,
      ),
    );

    const promotion = await service.promotion(WORKSPACE, WORKFLOW);

    // The registry's aliases are what the pin is checked against — the publish gate's own list.
    expect(grounding.promotionCatalogue).toHaveBeenCalledWith(WORKSPACE);

    expect(promotion.references.map((reference) => [reference.code, reference.blocking])).toEqual([
      ["reference.unknown_skill", false],
      ["reference.unknown_alias", true],
    ]);
    expect(promotion.blocked).toBe(true);
    expect(promotion.blockedReasons).toEqual([
      "Stage `review-second` pins the alias `second-opinion`, which is not in this workspace's registry — publishing refuses it.",
    ]);
  });

  it("resolves a pinned alias the registry holds, and is not blocked by it", async () => {
    const { service, copilots } = harness();
    copilots.draftOf.mockResolvedValue(
      drafted(
        {
          ...REVIEW_NODE,
          id: "review-second",
          config: { ...REVIEW_NODE.config, routing: { pinned_model: { alias: "coder-max" } } },
        },
        NEEDS_REVIEW,
      ),
    );

    const promotion = await service.promotion(WORKSPACE, WORKFLOW);

    expect(promotion.references).toEqual([]);
    expect(promotion.blocked).toBe(false);
  });

  it("is blocked by a draft the validator refuses, naming each finding's stage (#1745)", async () => {
    const { service, copilots } = harness();
    // No ending, and a stage nothing reaches: the publish gate's first stage refuses both.
    const orphan = { ...REVIEW_NODE, id: "orphan" };
    const row = drafted(REVIEW_NODE);
    copilots.draftOf.mockResolvedValue(
      draftRow({ ...(row.definition as object), nodes: [TRIGGER_NODE, REVIEW_NODE, orphan] }),
    );

    const promotion = await service.promotion(WORKSPACE, WORKFLOW);

    expect(promotion.blocked).toBe(true);
    expect(promotion.blockedReasons).toEqual([
      "A workflow needs at least one terminal node; no path through this one ends.",
      expect.stringMatching(/^Stage `orphan`: /) as string,
    ]);
    // Validation is not a reference: the list W7 draws is unchanged by it.
    expect(promotion.references).toEqual([]);
  });

  it("lists the validator's findings before an unknown alias, both blocking", async () => {
    const { service, copilots } = harness();
    copilots.draftOf.mockResolvedValue(
      drafted({
        ...REVIEW_NODE,
        id: "review-second",
        config: { ...REVIEW_NODE.config, routing: { pinned_model: { alias: "no-such-alias" } } },
      }),
    );

    const promotion = await service.promotion(WORKSPACE, WORKFLOW);

    expect(promotion.blockedReasons).toEqual([
      "A workflow needs at least one terminal node; no path through this one ends.",
      "Stage `review-second` pins the alias `no-such-alias`, which is not in this workspace's registry — publishing refuses it.",
    ]);
  });

  it("is blocked with no draft, and names the conversation closed last", async () => {
    const { service, copilots } = harness();
    copilots.workflow.mockResolvedValue(workflow({ draft_rev: 0 }));
    copilots.draftOf.mockResolvedValue(undefined);
    copilots.activeSession.mockResolvedValue(undefined);
    copilots.lastClosedSession.mockResolvedValue(
      session({ status: "discarded", closed_at: new Date("2026-10-09T09:00:00.000Z") }),
    );

    const promotion = await service.promotion(WORKSPACE, WORKFLOW);

    expect(promotion).toMatchObject({
      draft: { present: false, label: "v0.0" },
      session: { id: SESSION, status: "discarded" },
      guards: [],
      references: [],
      blocked: true,
      blockedReasons: ["There is no draft to promote."],
    });
  });

  it("has no session to name on a workflow nobody talked to the copilot about", async () => {
    const { service, copilots } = harness();
    copilots.activeSession.mockResolvedValue(undefined);

    expect((await service.promotion(WORKSPACE, WORKFLOW)).session).toBeNull();
  });

  it("is a 404 for a workflow this caller cannot see", async () => {
    const { service, copilots } = harness();
    copilots.workflow.mockResolvedValue(undefined);

    await expect(service.promotion(WORKSPACE, WORKFLOW)).rejects.toMatchObject({
      code: "workflow_not_found",
    });
  });
});

describe("the draft read (#567)", () => {
  it("answers the draft with who each stage is by, in the document's order", async () => {
    const { service, copilots, grounding } = harness();
    copilots.workflow.mockResolvedValue(workflow({ draft_rev: 2 }));
    copilots.draftOf.mockResolvedValue(
      draftRow({ ...DRAFT_DOCUMENT, nodes: [TRIGGER_NODE, REVIEW_NODE] }),
    );
    // The view promises no order: here it answers the second stage first.
    copilots.nodeProvenance.mockResolvedValue([
      { node_id: REVIEW_NODE.id, provenance: "copilot", added_rev: 2 },
      { node_id: TRIGGER_NODE.id, provenance: "human", added_rev: 1 },
    ]);

    const draft = await service.draft(WORKSPACE, WORKFLOW);

    expect(copilots.workflow).toHaveBeenCalledWith(WORKSPACE, WORKFLOW);
    expect(copilots.nodeProvenance).toHaveBeenCalledWith(WORKFLOW);
    expect(grounding.grounding).toHaveBeenCalledWith(WORKSPACE);
    expect(draft.label).toBe("v0.2");
    expect(draft.etag).toHaveLength(64);
    expect(draft.definition).toMatchObject({ nodes: [TRIGGER_NODE, REVIEW_NODE] });
    expect(draft.nodeProvenance).toEqual([
      { nodeId: TRIGGER_NODE.id, provenance: "human", addedRev: 1 },
      { nodeId: REVIEW_NODE.id, provenance: "copilot", addedRev: 2 },
    ]);
  });

  it("needs no conversation", async () => {
    const { service, copilots } = harness();
    copilots.activeSession.mockResolvedValue(undefined);

    await expect(service.draft(WORKSPACE, WORKFLOW)).resolves.toMatchObject({ label: "v0.1" });
    expect(copilots.activeSession).not.toHaveBeenCalled();
    expect(copilots.lastClosedSession).not.toHaveBeenCalled();
  });

  it("answers no document and no stages for a workflow without a draft", async () => {
    const { service, copilots } = harness();
    copilots.workflow.mockResolvedValue(workflow({ current_version: 3, draft_rev: 0 }));
    copilots.draftOf.mockResolvedValue(undefined);

    await expect(service.draft(WORKSPACE, WORKFLOW)).resolves.toEqual({
      etag: "none",
      label: "v3.0",
      definition: null,
      provenanceSummary: workflow().provenance_summary,
      warnings: [],
      nodeProvenance: [],
    });
  });

  it("is a 404 for a workflow the workspace does not have, before anything is read", async () => {
    const { service, copilots, grounding } = harness();
    copilots.workflow.mockResolvedValue(undefined);

    await expect(service.draft(WORKSPACE, WORKFLOW)).rejects.toMatchObject({
      code: "workflow_not_found",
    });
    expect(grounding.grounding).not.toHaveBeenCalled();
    expect(copilots.draftOf).not.toHaveBeenCalled();
    expect(copilots.nodeProvenance).not.toHaveBeenCalled();
  });

  it("ends a reply's stream on the same provenance", async () => {
    const { service, copilots } = harness({
      turns: [
        [
          { kind: "delta", text: "Nothing to change." },
          { kind: "done", finishReason: "stop" },
        ],
      ],
    });
    copilots.nodeProvenance.mockResolvedValue([
      { node_id: TRIGGER_NODE.id, provenance: "published", added_rev: null },
    ]);

    const events = await collect(service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "hello"));

    expect(events.at(-1)).toMatchObject({
      kind: "done",
      draft: {
        nodeProvenance: [{ nodeId: TRIGGER_NODE.id, provenance: "published", addedRev: null }],
      },
    });
  });
});

describe("the readiness read (#566)", () => {
  it("reports the gateway, the alias a reply would be routed to, and no dry run", async () => {
    const { service, copilots, routing, engine, database } = harness();

    await expect(service.readiness(WORKSPACE, WORKFLOW)).resolves.toEqual({
      gateway: { available: INVOCATION_GATEWAY_AVAILABLE },
      route: {
        taskKind: COPILOT_TASK_KIND,
        resolved: true,
        alias: "coder-max",
        modelId: "claude-fable-5",
        reason: null,
      },
      dryRun: null,
    });

    expect(copilots.workflow).toHaveBeenCalledWith(WORKSPACE, WORKFLOW);
    expect(routing.resolve).toHaveBeenCalledWith(WORKSPACE, COPILOT_TASK_KIND);
    expect(copilots.openDryRun).toHaveBeenCalledWith(WORKFLOW);
    // A read: nobody is invoked and nothing is written.
    expect(engine.copilotTurn).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
    expect(copilots.appendProvenance).not.toHaveBeenCalled();
  });

  it("gives an unrouted workspace the reason the reply gives, without its prefix", async () => {
    const options = { routeError: new NotFoundError("route_not_found", "No route.") };
    const { service } = harness(options);

    const readiness = await service.readiness(WORKSPACE, WORKFLOW);

    expect(readiness.route).toEqual({
      taskKind: COPILOT_TASK_KIND,
      resolved: false,
      alias: null,
      modelId: null,
      reason:
        "this workspace has no route for the `copilot-workflow` task kind. Add one under Model routing and try again.",
    });

    // One function decides both: what the reply says is the prefix plus this reason.
    const replying = harness(options);
    const events = await collect(
      replying.service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "hello"),
    );
    const said = events.find((event) => event.kind === "error");
    expect(said).toMatchObject({ message: `${UNROUTED_PREFIX}${String(readiness.route.reason)}` });
    expect(said).toMatchObject({ message: unroutedMessage(String(readiness.route.reason)) });
    expect(said).toMatchObject({
      message:
        "I can't reach a model: this workspace has no route for the `copilot-workflow` task kind. Add one under Model routing and try again.",
    });
  });

  it("gives a route that does not resolve its explanation, the same way", async () => {
    const options = {
      resolution: {
        ...RESOLUTION,
        outcome: "fail_run",
        failure: { code: "floor", explanation: "every hop is below the floor" },
      },
    };
    const { service } = harness(options);

    const readiness = await service.readiness(WORKSPACE, WORKFLOW);

    expect(readiness.route).toMatchObject({
      resolved: false,
      alias: null,
      modelId: null,
      reason: "the `copilot-workflow` route did not resolve — every hop is below the floor",
    });

    const replying = harness(options);
    const events = await collect(
      replying.service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "hello"),
    );
    expect(events.find((event) => event.kind === "error")).toMatchObject({
      message:
        "I can't reach a model: the `copilot-workflow` route did not resolve — every hop is below the floor",
    });
  });

  it("is unresolved when the resolution keeps no hop, with the stock reason", async () => {
    const { service } = harness({
      resolution: {
        ...RESOLUTION,
        chain: [{ index: 0, alias: "a", modelId: "m", decision: "dropped" }],
      },
    });

    const readiness = await service.readiness(WORKSPACE, WORKFLOW);

    expect(readiness.route.reason).toBe(
      "the `copilot-workflow` route did not resolve — no provider in the chain can serve it right now",
    );
  });

  it("names the workflow's open dry run with its status", async () => {
    const { service, copilots } = harness();
    copilots.openDryRun.mockResolvedValue({
      id: "run-1",
      started_at: new Date(),
      status: "running",
    });

    await expect(service.readiness(WORKSPACE, WORKFLOW)).resolves.toMatchObject({
      dryRun: { id: "run-1", status: "running" },
    });
  });

  it("does not report a dry run past the harness deadline — nothing is relaying it any more", async () => {
    const { service, copilots } = harness();
    copilots.openDryRun.mockResolvedValue({ id: "run-1", started_at: AT, status: "running" });

    await expect(service.readiness(WORKSPACE, WORKFLOW)).resolves.toMatchObject({ dryRun: null });
  });

  it("is a 404 for a workflow the workspace does not have, before anything is resolved", async () => {
    const { service, copilots, routing } = harness();
    copilots.workflow.mockResolvedValue(undefined);

    await expect(service.readiness(WORKSPACE, WORKFLOW)).rejects.toMatchObject({
      code: "workflow_not_found",
    });
    expect(routing.resolve).not.toHaveBeenCalled();
    expect(copilots.openDryRun).not.toHaveBeenCalled();
  });

  it("lets a routing failure that is not 'no route' through", async () => {
    const { service } = harness({ routeError: new Error("database is down") });

    await expect(service.readiness(WORKSPACE, WORKFLOW)).rejects.toThrow("database is down");
  });
});

describe("a reply that outlives its conversation (#566)", () => {
  const ADD_REVIEW: EngineCopilotEvent = {
    kind: "tool_call",
    id: "call-1",
    tool: "add_stage",
    arguments: { node: REVIEW_NODE },
    error: null,
  };
  const SET_TRIGGER: EngineCopilotEvent = {
    kind: "tool_call",
    id: "call-2",
    tool: "set_trigger",
    arguments: { trigger: { event: "ticket_queued", conditions: { labels: ["security"] } } },
    error: null,
  };

  it("checks the session under the apply's transaction, after the draft lock and before the batch", async () => {
    const { service, copilots, trx } = harness({
      turns: [[ADD_REVIEW, { kind: "done", finishReason: "tool_calls" }]],
    });

    await collect(service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "add review"));

    expect(copilots.sessionStatusLocked).toHaveBeenCalledWith(WORKFLOW, SESSION, trx);
    const locked = copilots.draftOf.mock.calls.findIndex((args: unknown[]) => args[2] === true);
    expect(copilots.sessionStatusLocked.mock.invocationCallOrder[0]).toBeGreaterThan(
      copilots.draftOf.mock.invocationCallOrder[locked],
    );
    expect(copilots.sessionStatusLocked.mock.invocationCallOrder[0]).toBeLessThan(
      copilots.applyBatch.mock.invocationCallOrder[0],
    );
  });

  it.each(["discarded", "promoted", undefined] as const)(
    "applies nothing once the session is %s: no further turn, interrupted, error before done",
    async (status) => {
      const { service, copilots, engine, batches, finished } = harness({
        turns: [
          [
            { kind: "delta", text: "Adding a review stage." },
            ADD_REVIEW,
            { kind: "done", finishReason: "tool_calls" },
          ],
          [SET_TRIGGER, { kind: "done", finishReason: "tool_calls" }],
          [
            { kind: "delta", text: "Never asked for." },
            { kind: "done", finishReason: "stop" },
          ],
        ],
      });
      // Open for the first operation; closed by the time the second is applied.
      copilots.sessionStatusLocked.mockResolvedValueOnce("active").mockResolvedValue(status);

      const events = await collect(
        service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "add review, then the trigger"),
      );

      expect(batches).toHaveLength(1);
      expect(copilots.applyBatch).toHaveBeenCalledTimes(1);
      expect(engine.copilotTurn).toHaveBeenCalledTimes(2);
      expect(events.map((event) => event.kind)).toEqual([
        "accepted",
        "delta",
        "operation",
        "delta",
        "usage",
        "error",
        "done",
      ]);
      expect(events.at(-2)).toEqual({
        kind: "error",
        code: COPILOT_ERRORS.sessionClosed,
        message: SESSION_CLOSED_MID_REPLY,
      });
      expect(finished[0]).toMatchObject({
        status: "interrupted",
        body: `Adding a review stage.\n${SESSION_CLOSED_MID_REPLY}`,
        tool_trace: { operations: [{ outcome: "applied" }] },
      });
      expect(events.at(-1)).toMatchObject({ kind: "done", message: { status: "interrupted" } });
    },
  );

  it("does not mistake a discarded draft for a canvas edit: closed is answered before the etag", async () => {
    const { service, copilots, engine, batches, moveDraft } = harness({
      turns: [
        [ADD_REVIEW, { kind: "done", finishReason: "tool_calls" }],
        [
          { kind: "delta", text: "Re-planned." },
          { kind: "done", finishReason: "stop" },
        ],
      ],
    });
    // The loop reads the draft; then the discard removes it and closes the session.
    copilots.draftOf.mockImplementationOnce(() => Promise.resolve(draftRow(DRAFT_DOCUMENT)));
    moveDraft(undefined);
    copilots.sessionStatusLocked.mockResolvedValue("discarded");

    const events = await collect(
      service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "add review"),
    );

    expect(batches).toEqual([]);
    expect(events.some((event) => event.kind === "conflict")).toBe(false);
    expect(engine.copilotTurn).toHaveBeenCalledTimes(1);
    expect(events.at(-2)).toMatchObject({ kind: "error", code: COPILOT_ERRORS.sessionClosed });
    expect(events.at(-1)).toMatchObject({ kind: "done", draft: { definition: null } });
  });

  it("guards the debrief exchange the same way", async () => {
    const { service, copilots, engine, batches, finished } = harness({
      messages: [message({ id: "m-1", seq: 1, role: "user", body: "dry run #489" })],
      turns: [
        [ADD_REVIEW, { kind: "done", finishReason: "tool_calls" }],
        [
          { kind: "delta", text: "Never asked for." },
          { kind: "done", finishReason: "stop" },
        ],
      ],
    });
    copilots.sessionStatusLocked.mockResolvedValue("promoted");

    await service.debrief({
      id: "5eed008b-0000-4000-8000-000000000001",
      organization_id: WORKSPACE,
      workflow_id: WORKFLOW,
      session_id: SESSION,
      status: "complete",
    } as DryRun);

    expect(batches).toEqual([]);
    expect(engine.copilotTurn).toHaveBeenCalledTimes(1);
    expect(finished[0]).toMatchObject({ status: "interrupted", body: SESSION_CLOSED_MID_REPLY });
  });
});

describe("discarding the draft", () => {
  const CLOSED_AT = new Date("2026-10-11T09:30:00.000Z");

  it("drops the draft and closes the conversation in one transaction, under the draft's lock", async () => {
    const { service, copilots, database, trx } = harness();
    copilots.session.mockResolvedValue(session({ status: "discarded", closed_at: CLOSED_AT }));

    const discarded = await service.discard(WORKSPACE, WORKFLOW);

    expect(database.transaction).toHaveBeenCalledTimes(1);
    // The draft lock first, as every draft writer takes it.
    expect(copilots.draftOf).toHaveBeenCalledWith(WORKFLOW, trx, true);
    expect(copilots.activeSession).toHaveBeenCalledWith(WORKSPACE, WORKFLOW, trx);
    expect(copilots.discardDraft).toHaveBeenCalledWith(WORKSPACE, WORKFLOW, trx);
    expect(copilots.session).toHaveBeenCalledWith(WORKSPACE, WORKFLOW, SESSION);
    expect(discarded).toEqual({
      workflowId: WORKFLOW,
      draftDiscarded: true,
      session: expect.objectContaining({
        id: SESSION,
        status: "discarded",
        closedAt: CLOSED_AT.toISOString(),
      }) as object,
    });
  });

  it("discards a draft nobody was talking about", async () => {
    const { service, copilots } = harness();
    copilots.activeSession.mockResolvedValue(undefined);
    copilots.discardDraft.mockResolvedValue({
      draft_discarded: true,
      operations_removed: 0,
      session_id: null,
    });

    await expect(service.discard(WORKSPACE, WORKFLOW)).resolves.toEqual({
      workflowId: WORKFLOW,
      draftDiscarded: true,
      session: null,
    });
    expect(copilots.session).not.toHaveBeenCalled();
  });

  it("closes a conversation that never produced a draft", async () => {
    const { service, copilots } = harness();
    copilots.draftOf.mockResolvedValue(undefined);
    copilots.discardDraft.mockResolvedValue({
      draft_discarded: false,
      operations_removed: 0,
      session_id: SESSION,
    });
    copilots.session.mockResolvedValue(session({ status: "discarded", closed_at: CLOSED_AT }));

    await expect(service.discard(WORKSPACE, WORKFLOW)).resolves.toMatchObject({
      draftDiscarded: false,
      session: { id: SESSION, status: "discarded" },
    });
  });

  it("is a 409 with neither a draft nor an active session, and writes nothing", async () => {
    const { service, copilots } = harness();
    copilots.draftOf.mockResolvedValue(undefined);
    copilots.activeSession.mockResolvedValue(undefined);

    await expect(service.discard(WORKSPACE, WORKFLOW)).rejects.toMatchObject({
      code: COPILOT_ERRORS.nothingToDiscard,
      details: { workflowId: WORKFLOW },
    });
    expect(copilots.discardDraft).not.toHaveBeenCalled();
  });

  it("refuses while a dry run of the workflow is in progress, naming it", async () => {
    const { service, copilots, database } = harness();
    copilots.openDryRun.mockResolvedValue({ id: "run-1", started_at: new Date() });

    await expect(service.discard(WORKSPACE, WORKFLOW)).rejects.toMatchObject({
      code: "dry_run_in_progress",
      details: { dryRunId: "run-1" },
    });
    expect(copilots.openDryRun).toHaveBeenCalledWith(WORKFLOW);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("is not held up by a dry run left open past the harness's deadline", async () => {
    const { service, copilots } = harness();
    copilots.openDryRun.mockResolvedValue({
      id: "run-abandoned",
      started_at: new Date(Date.now() - ENGINE_DRY_RUN_TIMEOUT_MS - 60_000),
    });

    await expect(service.discard(WORKSPACE, WORKFLOW)).resolves.toMatchObject({
      draftDiscarded: true,
    });
  });

  it("is a 404 for a workflow this caller cannot see", async () => {
    const { service, copilots } = harness();
    copilots.workflow.mockResolvedValue(undefined);

    await expect(service.discard(WORKSPACE, WORKFLOW)).rejects.toMatchObject({
      code: "workflow_not_found",
    });
    expect(copilots.discardDraft).not.toHaveBeenCalled();
  });
});

describe("an exchange", () => {
  it("records the message, routes, runs the loop, applies under the etag and records the reply", async () => {
    const { service, copilots, sent, finished, batches } = harness({
      turns: [
        [
          { kind: "delta", text: "Adding a review stage." },
          {
            kind: "tool_call",
            id: "call-1",
            tool: "add_stage",
            arguments: { node: REVIEW_NODE },
            error: null,
          },
          {
            kind: "usage",
            inputTokens: 100,
            outputTokens: 10,
            costCents: 2,
            model: "claude-fable-5",
            connection: "c1",
          },
          { kind: "done", finishReason: "stop" },
        ],
        [{ kind: "done", finishReason: "stop" }],
      ],
    });

    const events = await collect(
      service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "second review please"),
    );

    expect(events.map((event) => event.kind)).toEqual([
      "accepted",
      "delta",
      "operation",
      "usage",
      "done",
    ]);
    expect(events[0]).toMatchObject({
      kind: "accepted",
      message: { body: "second review please", role: "user" },
      replySeq: 2,
    });
    expect(copilots.appendProvenance).toHaveBeenCalledWith(SESSION, {
      seq: 2,
      alias: "coder-max",
      model_id: "claude-fable-5",
    });
    expect(sent[0]).toMatchObject({
      alias: "coder-max",
      session: SESSION,
      resolutionVersion: "z1-v1",
      costCapCents: 500,
    });
    expect((sent[0] as { transcript: unknown[] }).transcript).toEqual([
      { role: "user", text: "second review please" },
    ]);
    expect(batches).toEqual([[{ kind: "add_stage", params: { node: REVIEW_NODE } }]]);
    expect(copilots.applyBatch).toHaveBeenCalledWith(
      WORKSPACE,
      WORKFLOW,
      "user-1",
      SESSION,
      expect.any(Array),
      expect.anything(),
    );
    expect(events[2]).toMatchObject({ kind: "operation", outcome: "applied", draftRev: 2 });
    expect(finished[0]).toMatchObject({
      body: "Adding a review stage.",
      status: "complete",
      tokens_in: 100,
      tokens_out: 10,
      cost_cents: 2,
      tool_trace: { operations: [{ outcome: "applied" }] },
    });
    expect(events[4]).toMatchObject({ kind: "done", draft: { label: "v0.2" } });
  });

  it("draws its dry-run candidates from the edge-case picker, ranked against the draft as it stands", async () => {
    const { service, picker, sent } = harness({
      ranked: [
        {
          ticket: { key: "#489", title: "CAN arbitration storm", labels: ["bug", "can-bus"] },
          reason: "no `security` label (trigger) — outside the trigger.",
        },
      ],
      turns: [
        [
          {
            kind: "tool_call",
            id: "call-1",
            tool: "lookup_tickets",
            arguments: { query: "can", limit: 99 },
            error: null,
          },
          { kind: "done", finishReason: "tool_calls" },
        ],
        [{ kind: "done", finishReason: "stop" }],
      ],
    });

    await collect(service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "which issue?"));

    // The scorer the dry-run menu uses (CD.4, #562), over the stored draft, bounded.
    expect(picker.rank).toHaveBeenCalledWith(WORKSPACE, DRAFT_DOCUMENT, {
      limit: MAX_TICKET_CANDIDATES,
      query: "can",
    });
    const second = sent[1] as EngineCopilotTurnRequest;
    const result = second.transcript.find((entry) => entry.role === "tool");
    expect(result).toMatchObject({
      content: expect.stringContaining(
        '"key":"#489","title":"CAN arbitration storm","labels":["bug","can-bus"],"reason":"no `security` label',
      ) as string,
    });
    expect(result).toMatchObject({
      content: expect.stringContaining("ranked for edge cases") as string,
    });
  });

  it("answers the unrouted workspace honestly: an interrupted reply, no invocation, no cost", async () => {
    const { service, engine, finished } = harness({
      routeError: new NotFoundError("route_not_found", "No route."),
    });

    const events = await collect(service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "hello"));

    expect(events.map((event) => event.kind)).toEqual(["accepted", "delta", "error", "done"]);
    expect(events[2]).toMatchObject({
      kind: "error",
      code: COPILOT_UNROUTED,
      message: expect.stringContaining(COPILOT_TASK_KIND) as string,
    });
    expect(engine.copilotTurn).not.toHaveBeenCalled();
    expect(finished[0]).toMatchObject({ status: "interrupted", cost_cents: null, tokens_in: null });
  });

  it("answers a resolution that fails the run the same way", async () => {
    const { service, engine } = harness({
      resolution: {
        ...RESOLUTION,
        outcome: "fail_run",
        failure: { code: "floor", explanation: "every hop is below the floor" },
      },
    });

    const events = await collect(service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "hello"));

    expect(events[2]).toMatchObject({
      kind: "error",
      code: COPILOT_UNROUTED,
      message: expect.stringContaining("every hop is below the floor") as string,
    });
    expect(engine.copilotTurn).not.toHaveBeenCalled();
  });

  it("refuses a closed session, a session of another workflow, and a reply still streaming", async () => {
    const closed = harness();
    closed.copilots.session.mockResolvedValue(session({ status: "promoted", closed_at: AT }));
    await expect(
      collect(closed.service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "x")),
    ).rejects.toMatchObject({
      code: COPILOT_ERRORS.sessionClosed,
    });

    const foreign = harness();
    foreign.copilots.session.mockResolvedValue(undefined);
    await expect(
      collect(foreign.service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "x")),
    ).rejects.toMatchObject({
      code: COPILOT_ERRORS.sessionNotFound,
    });

    const busy = harness({
      messages: [message({ id: "m-1", role: "copilot", status: "streaming", body: "" })],
    });
    await expect(
      collect(busy.service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "x")),
    ).rejects.toMatchObject({
      code: COPILOT_ERRORS.exchangeBusy,
    });
  });

  it("does not overwrite a canvas edit: the etag check fails, the draft is re-read, the reply explains", async () => {
    const { service, copilots, batches, moveDraft } = harness({
      turns: [
        [
          {
            kind: "tool_call",
            id: "call-1",
            tool: "add_stage",
            arguments: { node: REVIEW_NODE },
            error: null,
          },
          { kind: "done", finishReason: "stop" },
        ],
        [
          { kind: "delta", text: "Re-planned." },
          { kind: "done", finishReason: "stop" },
        ],
      ],
    });
    // The loop reads the draft, then the canvas saves before the operation is applied.
    copilots.draftOf.mockImplementationOnce(() => Promise.resolve(draftRow(DRAFT_DOCUMENT)));
    moveDraft(
      draftRow(
        { ...DRAFT_DOCUMENT, nodes: [TRIGGER_NODE, { ...TRIGGER_NODE, id: "moved" }] },
        new Date(AT.getTime() + 1000),
      ),
    );

    const events = await collect(
      service.send(WORKSPACE, WORKFLOW, SESSION, "user-1", "add review"),
    );

    expect(batches).toEqual([]);
    expect(events.find((event) => event.kind === "conflict")).toMatchObject({
      message: expect.stringContaining("visual editor") as string,
    });
    expect(events.at(-1)).toMatchObject({
      kind: "done",
      message: { body: expect.stringContaining("I re-read it") as string },
    });
  });

  it("answers a chip: records the selection and re-enters the loop with the answer", async () => {
    const asked = message({
      id: "m-2",
      seq: 2,
      role: "copilot",
      body: "Two questions:",
      choices: [
        {
          prompt: "What triggers it?",
          options: ["label:security", "CVE pattern in title"],
          selected: null,
          answered_at: null,
        },
      ],
    });
    const { service, copilots, sent } = harness({
      messages: [message({ id: "m-1", seq: 1, body: "security patches" }), asked],
      turns: [
        [
          { kind: "delta", text: "Set the trigger." },
          { kind: "done", finishReason: "stop" },
        ],
      ],
    });

    const events = await collect(
      service.answer(WORKSPACE, WORKFLOW, SESSION, "m-2", "user-1", {
        question: 0,
        selected: "label:security",
      }),
    );

    expect(copilots.answerQuestions).toHaveBeenCalledWith("m-2", [
      expect.objectContaining({
        selected: "label:security",
        answered_at: expect.any(String) as string,
      }),
    ]);
    expect(events[0]).toMatchObject({
      kind: "accepted",
      message: { body: "What triggers it? → label:security" },
    });
    const transcript = (sent[0] as { transcript: { role: string; text?: string }[] }).transcript;
    expect(transcript.map((entry) => entry.role)).toEqual(["user", "copilot", "user"]);
    expect(transcript[1].text).toContain(
      "[asked: What triggers it? (label:security / CVE pattern in title) → label:security]",
    );
    expect(transcript[2]).toEqual({ role: "user", text: "What triggers it? → label:security" });
  });

  it("refuses an answer to a question the reply did not ask, an option it did not offer, or one already answered", async () => {
    const asked = message({
      id: "m-2",
      seq: 2,
      role: "copilot",
      body: "Q",
      choices: [
        {
          prompt: "Yes?",
          options: ["Yes", "No"],
          selected: "Yes",
          answered_at: "2026-10-08T15:04:00Z",
        },
      ],
    });
    const { service } = harness({ messages: [asked] });

    await expect(
      collect(
        service.answer(WORKSPACE, WORKFLOW, SESSION, "m-2", "u", { question: 3, selected: "Yes" }),
      ),
    ).rejects.toMatchObject({
      code: COPILOT_ERRORS.answerInvalid,
    });
    await expect(
      collect(
        service.answer(WORKSPACE, WORKFLOW, SESSION, "m-2", "u", { question: 0, selected: "Yes" }),
      ),
    ).rejects.toMatchObject({
      message: "That question was already answered.",
    });
    await expect(
      collect(
        service.answer(WORKSPACE, WORKFLOW, SESSION, "m-9", "u", { question: 0, selected: "Yes" }),
      ),
    ).rejects.toMatchObject({
      code: COPILOT_ERRORS.messageNotFound,
    });
  });
});

describe("a finished dry run's results reaching the conversation (#563)", () => {
  const RUN = {
    id: "5eed008b-0000-4000-8000-000000000001",
    organization_id: WORKSPACE,
    workflow_id: WORKFLOW,
    session_id: SESSION,
    status: "complete",
  } as DryRun;

  it("registers to be told when a dry run ends", async () => {
    const { service, aftermath, suggestions } = harness({ turns: [] });

    service.onModuleInit();

    expect(aftermath.register).toHaveBeenCalledTimes(1);
    const [debriefer] = aftermath.register.mock.calls[0] as [(run: DryRun) => Promise<void>];
    await debriefer(RUN);
    expect(suggestions.debriefing).toHaveBeenCalledWith(RUN);
  });

  it("runs one exchange on the results, records only the copilot's reply, and files what it proposes", async () => {
    const ops = [{ kind: "remove_stage", params: { id: "test" } }];
    const { service, copilots, suggestions, sent, finished } = harness({
      messages: [message({ id: "m-1", seq: 1, role: "user", body: "dry run #489" })],
      turns: [
        [
          {
            kind: "tool_call",
            id: "call-1",
            tool: "propose_suggestion",
            arguments: { title: "Drop test", body: "It never ran.", ops },
            error: null,
          },
          { kind: "done", finishReason: "tool_calls" },
        ],
        [
          { kind: "delta", text: "Dry run finished — one more suggestion below." },
          { kind: "done", finishReason: "stop" },
        ],
      ],
    });

    await service.debrief(RUN);

    // The results are the turn's input, never a message the person typed.
    expect(copilots.insertUserMessage).not.toHaveBeenCalled();
    expect(copilots.insertStreamingReply).toHaveBeenCalledTimes(1);
    const first = sent[0] as EngineCopilotTurnRequest;
    expect(first.transcript).toEqual([
      { role: "user", text: "dry run #489" },
      { role: "user", text: "[dry run results] exploit-verify: skipped" },
    ]);
    expect(suggestions.propose).toHaveBeenCalledWith(
      WORKSPACE,
      WORKFLOW,
      { title: "Drop test", body: "It never ran.", ops },
      { sessionId: SESSION, alias: "coder-max", resolutionVersion: "z1-v1" },
    );
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      body: "Dry run finished — one more suggestion below.",
      status: "complete",
      tool_trace: {
        operations: [
          {
            op: { kind: "propose_suggestion", params: { title: "Drop test" } },
            outcome: "proposed",
          },
        ],
        reads: [{ tool: DRY_RUN_RESULTS }],
        dry_run_proposals: [],
      },
    });
  });

  it("tells the model when a proposal was refused, and records the bounce", async () => {
    const { service, suggestions, finished } = harness({
      turns: [
        [
          {
            kind: "tool_call",
            id: "call-1",
            tool: "propose_suggestion",
            arguments: { title: "Drop ghost", body: "It is gone.", ops: [] },
            error: null,
          },
          { kind: "done", finishReason: "tool_calls" },
        ],
        [{ kind: "done", finishReason: "stop" }],
      ],
    });
    suggestions.propose.mockResolvedValue({ ok: false, message: "no stage named ghost." });

    await service.debrief(RUN);

    expect(finished[0]).toMatchObject({
      tool_trace: {
        operations: [
          {
            op: { kind: "propose_suggestion", params: { title: "Drop ghost" } },
            outcome: "bounced",
            validator_message: "no stage named ghost.",
          },
        ],
      },
    });
  });

  it("stays silent when there is no conversation to receive it", async () => {
    const withoutSession = harness({ turns: [] });
    await withoutSession.service.debrief({ ...RUN, session_id: null });
    expect(withoutSession.suggestions.debriefing).not.toHaveBeenCalled();

    const withoutResults = harness({ turns: [] });
    withoutResults.suggestions.debriefing.mockResolvedValue(undefined);
    await withoutResults.service.debrief(RUN);

    const withoutWorkflow = harness({ turns: [] });
    withoutWorkflow.copilots.workflow.mockResolvedValue(undefined);
    await withoutWorkflow.service.debrief(RUN);

    const closed = harness({ turns: [] });
    closed.copilots.session.mockResolvedValue(session({ status: "promoted" }));
    await closed.service.debrief(RUN);

    const swept = harness({ turns: [] });
    swept.copilots.session.mockResolvedValue(undefined);
    await swept.service.debrief(RUN);

    const busy = harness({
      turns: [],
      messages: [message({ id: "m-9", seq: 1, role: "copilot", body: "", status: "streaming" })],
    });
    await busy.service.debrief(RUN);

    for (const bench of [withoutSession, withoutResults, withoutWorkflow, closed, swept, busy]) {
      expect(bench.copilots.insertStreamingReply).not.toHaveBeenCalled();
      expect(bench.engine.copilotTurn).not.toHaveBeenCalled();
    }
  });
});

describe("the stored transcript", () => {
  it("renders replies with what they did and asked, and skips a reply still streaming", () => {
    const rows = [
      message({ id: "m-1", seq: 1, body: "security patches" }),
      message({
        id: "m-2",
        seq: 2,
        role: "copilot",
        body: "Drafted.",
        tool_trace: {
          operations: [
            {
              op: { kind: "add_stage", params: { node: { id: "exploit-verify" } } },
              outcome: "applied",
            },
            {
              op: { kind: "add_edge", params: { edge: { from: "test", to: "exploit_verify" } } },
              outcome: "bounced",
              validator_message: "x",
            },
            { op: { kind: "set_guard", params: { guard: "spend_guard" } }, outcome: "proposed" },
          ],
          reads: [],
          dry_run_proposals: [],
        },
        choices: [
          { prompt: "What triggers it?", options: ["a", "b"], selected: "a", answered_at: "t" },
        ],
      }),
      message({ id: "m-3", seq: 3, role: "copilot", body: "", status: "streaming" }),
    ];

    expect(transcriptOf(rows)).toEqual([
      { role: "user", text: "security patches" },
      {
        role: "copilot",
        text:
          "Drafted.\n[operations: add_stage exploit-verify → applied; add_edge test → exploit_verify → bounced; set_guard  → proposed]\n" +
          "[asked: What triggers it? (a / b) → a]",
        toolCalls: [],
      },
    ]);
  });
});
