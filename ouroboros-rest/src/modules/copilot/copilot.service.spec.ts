import type { DatabaseService } from "../db/db.service";
import type { CopilotMessage, CopilotSession, Workflow, WorkflowVersion } from "../db/schema";
import type { EngineClient } from "../engine/engine.client";
import type { EngineCopilotEvent, EngineCopilotTurnRequest } from "../engine/engine.copilot";
import { NotFoundError } from "../errors/error.envelope";
import type { ResolutionService } from "../routing/resolution.service";
import type { CopilotContextService } from "./copilot.context";
import { COPILOT_ERRORS } from "./copilot.errors";
import type { CopilotRepository } from "./copilot.repository";
import {
  COPILOT_TASK_KIND,
  COPILOT_UNROUTED,
  CopilotService,
  transcriptOf,
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
    revision: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ current_version: null, draft_rev: rev })),
    activeSession: jest.fn().mockResolvedValue(session()),
    session: jest.fn().mockResolvedValue(session()),
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
    openTickets: jest.fn().mockResolvedValue([]),
  };

  const grounding = {
    grounding: jest.fn().mockResolvedValue({
      context: { catalog: [], skills: ["pr-etiquette"], tasks: ["review"], guards: [] },
      catalogue: { skills: ["pr-etiquette"], tasks: ["review"] },
    }),
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
  );

  return {
    service,
    copilots,
    routing,
    engine,
    sent,
    finished,
    batches,
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

    const conversation = await service.conversation(WORKSPACE, WORKFLOW);

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

  it("is a 404 when no session is active", async () => {
    const { service, copilots } = harness();
    copilots.activeSession.mockResolvedValue(undefined);

    await expect(service.conversation(WORKSPACE, WORKFLOW)).rejects.toMatchObject({
      code: COPILOT_ERRORS.sessionNotFound,
    });
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
