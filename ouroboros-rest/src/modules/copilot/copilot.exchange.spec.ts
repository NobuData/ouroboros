import { UpstreamError } from "../errors/error.envelope";
import type { EngineCopilotEvent, EngineCopilotTurnRequest } from "../engine/engine.copilot";
import {
  MAX_BOUNCES,
  MAX_TURNS,
  runExchange,
  type ApplyResult,
  type DraftPort,
  type DraftState,
  type ExchangeInput,
  type ExchangeOutcome,
  type TurnPort,
} from "./copilot.exchange";
import { applyOperation, asDraftDocument, type DraftOperation } from "./copilot.operations";
import type { CopilotExchangeEvent } from "./copilot.stream";

const SESSION = "5eed008a-0000-4000-8000-000000000001";

const TRIGGER_NODE = {
  id: "issue-queued",
  type: "trigger",
  title: "Issue queued",
  position: { x: 0, y: 0 },
  config: {},
};
const TEST_NODE = {
  id: "test",
  type: "infra",
  title: "Test",
  position: { x: 300, y: 0 },
  config: {},
};
const REVIEW_NODE = {
  id: "review-primary",
  type: "llm",
  title: "Review",
  position: { x: 600, y: 0 },
  config: {
    mode: "prompt",
    prompt_template: "Review the change.",
    routing: { inherit_task: "review" },
    limits: { max_retries: 1, token_budget: 100000 },
    permissions: { push_fixup: false, touch_ci: false },
  },
};
const EXPLOIT_NODE = {
  ...REVIEW_NODE,
  id: "exploit-verify",
  title: "Exploit verify",
  config: { ...REVIEW_NODE.config, routing: { inherit_task: "exploit-verify" } },
};

const INITIAL: DraftState = {
  document: {
    dsl_version: "1.0",
    trigger: { event: "ticket_queued", conditions: {} },
    nodes: [TRIGGER_NODE, TEST_NODE],
    edges: [{ from: "issue-queued", to: "test", kind: "default" }],
  },
  etag: "etag-0",
  label: "v0.0",
};

function input(overrides: Partial<ExchangeInput> = {}): ExchangeInput {
  return {
    session: SESSION,
    alias: "coder-max",
    resolutionVersion: "z1-v1",
    costCapCents: 500,
    context: {
      catalog: [{ type: "llm", label: "Model stage", summary: "" }],
      skills: ["pr-etiquette"],
      tasks: ["review", "implement"],
      guards: [{ name: "spend_guard", description: "cap" }],
    },
    catalogue: { skills: ["pr-etiquette"], tasks: ["review", "implement"] },
    history: [{ role: "user", text: "security patches: second review" }],
    draft: INITIAL,
    ...overrides,
  };
}

function call(
  id: string,
  tool: string,
  args: Record<string, unknown> | null,
  error: string | null = null,
): EngineCopilotEvent {
  return { kind: "tool_call", id, tool, arguments: args, error };
}

const USAGE: EngineCopilotEvent = {
  kind: "usage",
  inputTokens: 100,
  outputTokens: 20,
  costCents: 1.4,
  model: "claude-fable-5",
  connection: "c1",
};

/** An engine answering scripted turns, recording what it was sent. */
function engine(...turns: EngineCopilotEvent[][]): TurnPort & { sent: EngineCopilotTurnRequest[] } {
  const sent: EngineCopilotTurnRequest[] = [];
  return {
    sent,
    async *copilotTurn(request) {
      await Promise.resolve();
      // A snapshot: the loop keeps appending to the transcript it sent.
      sent.push({ ...request, transcript: [...request.transcript] });
      const turn = turns[sent.length - 1];
      if (turn === undefined) throw new Error(`no scripted turn ${sent.length}`);
      for (const event of turn) {
        if (event.kind === "error" && event.code === "__throw__") {
          throw new UpstreamError("engine_unavailable", event.message);
        }
        yield event;
      }
    },
  };
}

/** A draft that applies for real, in memory, with a controllable etag. */
function drafts(initial: DraftState = INITIAL) {
  let state = initial;
  let rev = 0;
  const applied: DraftOperation[] = [];
  const port: DraftPort & {
    state(): DraftState;
    move(editedIn: string | null): void;
    applied: DraftOperation[];
  } = {
    applied,
    state: () => state,
    move(editedIn) {
      state = { ...state, etag: `moved-${rev}`, label: `v0.${rev}` };
      moved = editedIn;
    },
    async apply(operation, expectedEtag): Promise<ApplyResult> {
      await Promise.resolve();
      if (expectedEtag !== state.etag) {
        const current = state;
        const by = moved;
        moved = undefined;
        return { ok: false, draft: current, editedIn: by ?? null };
      }
      const result = applyOperation(asDraftDocument(state.document), operation);
      if (!result.ok) throw new Error(`unexpected refusal: ${result.message}`);
      rev += 1;
      applied.push(operation);
      state = { document: result.document, etag: `etag-${rev}`, label: `v0.${rev}` };
      return { ok: true, draftRev: rev, draft: state };
    },
    async lookupTickets() {
      await Promise.resolve();
      return [{ key: "#489", title: "CAN arbitration storm", labels: ["bug"] }];
    },
  };
  let moved: string | null | undefined;
  return port;
}

async function run(exchange: ExchangeInput, turns: TurnPort, port: DraftPort) {
  const events: CopilotExchangeEvent[] = [];
  const loop = runExchange(exchange, turns, port);
  let outcome: ExchangeOutcome;
  for (;;) {
    const next = await loop.next();
    if (next.done === true) {
      outcome = next.value;
      break;
    }
    events.push(next.value);
  }
  return { events, outcome };
}

describe("the exchange loop", () => {
  it("streams the reply, applies the operations in order, and records the trace and the cost", async () => {
    const port = drafts();
    const turns = engine(
      [
        { kind: "delta", text: "Drafted security-patch.\n" },
        call("call-1", "add_stage", { node: REVIEW_NODE }),
        call("call-2", "add_edge", {
          edge: { from: "test", to: "review-primary", kind: "default" },
        }),
        USAGE,
        { kind: "done", finishReason: "stop" },
      ],
      [{ kind: "delta", text: "Done." }, USAGE, { kind: "done", finishReason: "stop" }],
    );

    const { events, outcome } = await run(input(), turns, port);

    expect(events.map((event) => event.kind)).toEqual(["delta", "operation", "operation", "delta"]);
    expect(events[1]).toMatchObject({
      kind: "operation",
      outcome: "applied",
      draftRev: 1,
      etag: "etag-1",
    });
    expect(events[2]).toMatchObject({
      kind: "operation",
      outcome: "applied",
      draftRev: 2,
      etag: "etag-2",
    });
    expect(port.applied.map((operation) => operation.kind)).toEqual(["add_stage", "add_edge"]);

    expect(outcome.status).toBe("complete");
    expect(outcome.body).toBe("Drafted security-patch.\nDone.");
    expect(outcome.trace.operations.map((entry) => entry.outcome)).toEqual(["applied", "applied"]);
    expect(outcome.tokensIn).toBe(200);
    expect(outcome.tokensOut).toBe(40);
    expect(outcome.costCents).toBe(3);
    expect(outcome.draft.label).toBe("v0.2");

    // The second turn carried the first turn's calls and their results, in order.
    const second = turns.sent[1];
    expect(second.transcript.map((entry) => entry.role)).toEqual([
      "user",
      "copilot",
      "tool",
      "tool",
    ]);
    expect(second.transcript[2]).toMatchObject({ role: "tool", callId: "call-1", ok: true });
    expect(second.context.draftLabel).toBe("v0.2");
  });

  it("bounces an invalid operation with the validator's message and lets the model correct it", async () => {
    const port = drafts();
    const turns = engine(
      [
        call("call-1", "add_stage", { node: REVIEW_NODE }),
        call("call-2", "add_edge", {
          edge: { from: "test", to: "review_primary", kind: "default" },
        }),
        { kind: "done", finishReason: "stop" },
      ],
      [
        { kind: "delta", text: "Fixed the edge." },
        call("call-1", "add_edge", {
          edge: { from: "test", to: "review-primary", kind: "default" },
        }),
        { kind: "done", finishReason: "stop" },
      ],
      [
        { kind: "delta", text: " All set." },
        { kind: "done", finishReason: "stop" },
      ],
    );

    const { events, outcome } = await run(input(), turns, port);

    const bounced = events.find(
      (event) => event.kind === "operation" && event.outcome === "bounced",
    );
    expect(bounced).toMatchObject({
      validatorMessage: 'edge.to "review_primary" names no stage — did you mean "review-primary".',
    });
    expect(turns.sent[1].transcript.at(-1)).toMatchObject({
      role: "tool",
      callId: "call-2",
      ok: false,
      content: expect.stringContaining('did you mean "review-primary"') as string,
    });
    expect(outcome.trace.operations.map((entry) => entry.outcome)).toEqual([
      "applied",
      "bounced",
      "applied",
    ]);
    expect(outcome.trace.operations[1]).toMatchObject({
      validator_message: expect.any(String) as string,
    });
    expect(outcome.trace.operations[0]).not.toHaveProperty("validator_message");
    expect(port.applied).toHaveLength(2);
    expect(outcome.status).toBe("complete");
  });

  it("stops honestly when the bounce budget is exhausted", async () => {
    const port = drafts();
    const badTurn = (): EngineCopilotEvent[] => [
      call("call-1", "remove_stage", { id: "nowhere" }),
      { kind: "done", finishReason: "stop" },
    ];
    const turns = engine(...Array.from({ length: MAX_BOUNCES + 1 }, badTurn));

    const { events, outcome } = await run(input(), turns, port);

    expect(outcome.status).toBe("complete");
    expect(outcome.body).toContain(
      `I could not produce a valid change after ${MAX_BOUNCES + 1} attempts`,
    );
    expect(outcome.body).toContain('remove_stage: no stage "nowhere".');
    expect(turns.sent).toHaveLength(MAX_BOUNCES + 1);
    expect(events.filter((event) => event.kind === "operation")).toHaveLength(MAX_BOUNCES + 1);
    expect(port.applied).toHaveLength(0);
  });

  it("treats a call the engine could not validate as a bounce", async () => {
    const port = drafts();
    const turns = engine(
      [
        call("call-1", "add_stage", null, "add_stage arguments are invalid — node: Field required"),
        { kind: "done", finishReason: "stop" },
      ],
      [
        { kind: "delta", text: "Sorry." },
        { kind: "done", finishReason: "stop" },
      ],
    );

    const { events, outcome } = await run(input(), turns, port);

    expect(events[0]).toMatchObject({
      kind: "operation",
      outcome: "bounced",
      op: { kind: "add_stage" },
    });
    expect(turns.sent[1].transcript.at(-1)).toMatchObject({
      ok: false,
      content: expect.stringContaining("node: Field required") as string,
    });
    expect(outcome.trace.operations[0]).toMatchObject({ outcome: "bounced" });
  });

  it("turns ask_user into a chip row and ends the exchange to wait for the answer", async () => {
    const port = drafts();
    const turns = engine([
      { kind: "delta", text: "Two questions:" },
      call("call-1", "ask_user", {
        prompt: "What triggers it?",
        options: ["label:security", "CVE pattern in title"],
      }),
      call("call-2", "ask_user", {
        prompt: "May it read the GitHub Advisory DB?",
        options: ["Yes", "No"],
      }),
      { kind: "done", finishReason: "stop" },
    ]);

    const { events, outcome } = await run(input(), turns, port);

    expect(events.filter((event) => event.kind === "question")).toEqual([
      {
        kind: "question",
        index: 0,
        prompt: "What triggers it?",
        options: ["label:security", "CVE pattern in title"],
      },
      {
        kind: "question",
        index: 1,
        prompt: "May it read the GitHub Advisory DB?",
        options: ["Yes", "No"],
      },
    ]);
    expect(outcome.choices).toEqual([
      {
        prompt: "What triggers it?",
        options: ["label:security", "CVE pattern in title"],
        selected: null,
        answered_at: null,
      },
      {
        prompt: "May it read the GitHub Advisory DB?",
        options: ["Yes", "No"],
        selected: null,
        answered_at: null,
      },
    ]);
    expect(turns.sent).toHaveLength(1);
    expect(outcome.status).toBe("complete");
  });

  it("names what the copilot invented when its prose did not (W7)", async () => {
    const port = drafts();
    const turns = engine(
      [
        { kind: "delta", text: "Added a verification stage." },
        call("call-1", "add_stage", { node: EXPLOIT_NODE }),
        { kind: "done", finishReason: "stop" },
      ],
      [{ kind: "done", finishReason: "stop" }],
    );

    const { events, outcome } = await run(input(), turns, port);

    const applied = events.find((event) => event.kind === "operation");
    expect(applied).toMatchObject({
      warnings: [
        { code: "reference.unknown_task", node: "exploit-verify", name: "exploit-verify" },
      ],
    });
    expect(turns.sent[1].transcript.at(-1)).toMatchObject({
      ok: true,
      content: expect.stringContaining("No task route named `exploit-verify` exists") as string,
    });
    expect(outcome.body).toBe(
      "Added a verification stage.\nNote: task route `exploit-verify` does not exist in this workspace yet, " +
        "so the draft carries an unresolved-reference warning and cannot run until it exists.",
    );
    expect(outcome.introduced.map((reference) => reference.name)).toEqual(["exploit-verify"]);
  });

  it("does not repeat the W7 note when the reply already names the invention", async () => {
    const port = drafts();
    const turns = engine(
      [
        { kind: "delta", text: "I added exploit-verify — that task kind does not exist yet." },
        call("call-1", "add_stage", { node: EXPLOIT_NODE }),
        { kind: "done", finishReason: "stop" },
      ],
      [{ kind: "done", finishReason: "stop" }],
    );

    const { outcome } = await run(input(), turns, port);

    expect(outcome.body).toBe("I added exploit-verify — that task kind does not exist yet.");
  });

  it("handles a canvas edit mid-conversation by re-reading and explaining, never clobbering", async () => {
    const port = drafts();
    const turns = engine(
      [call("call-1", "add_stage", { node: REVIEW_NODE }), { kind: "done", finishReason: "stop" }],
      [
        { kind: "delta", text: "Re-planned from your edit." },
        call("call-1", "add_stage", { node: REVIEW_NODE }),
        { kind: "done", finishReason: "stop" },
      ],
      [{ kind: "done", finishReason: "stop" }],
    );
    port.move("visual");

    const { events, outcome } = await run(input(), turns, port);

    expect(events[0]).toMatchObject({ kind: "conflict", etag: "moved-0" });
    expect(events[1]).toMatchObject({
      kind: "delta",
      text: expect.stringContaining("changed the draft in the visual editor") as string,
    });
    expect(turns.sent[1].transcript.at(-1)).toMatchObject({
      ok: false,
      content: expect.stringContaining("the draft changed while you were working") as string,
    });
    expect(turns.sent[1].context.draftLabel).toBe("v0.0");
    expect(port.applied).toHaveLength(1);
    expect(outcome.trace.operations).toEqual([
      { op: expect.objectContaining({ kind: "add_stage" }) as object, outcome: "applied" },
    ]);
    expect(outcome.body).toContain("I re-read it");
    expect(outcome.body).toContain("Re-planned from your edit.");
  });

  it("records a guard as a proposal and bounces one the planes do not honour", async () => {
    const port = drafts();
    const turns = engine(
      [
        { kind: "delta", text: "Capped spend." },
        call("call-1", "set_guard", { guard: "spend_guard", params: { per_run_cap_cents: 500 } }),
        call("call-2", "set_guard", { guard: "time_guard", params: {} }),
        { kind: "done", finishReason: "stop" },
      ],
      [{ kind: "done", finishReason: "stop" }],
    );

    const { events, outcome } = await run(input(), turns, port);

    expect(events[1]).toMatchObject({
      kind: "operation",
      outcome: "proposed",
      op: { kind: "set_guard" },
    });
    expect(events[2]).toMatchObject({
      kind: "operation",
      outcome: "bounced",
      validatorMessage: 'no guard named "time_guard" — this workspace honours: spend_guard.',
    });
    expect(outcome.trace.operations).toEqual([
      {
        op: {
          kind: "set_guard",
          params: { guard: "spend_guard", params: { per_run_cap_cents: 500 } },
        },
        outcome: "proposed",
      },
      {
        op: { kind: "set_guard", params: { guard: "time_guard", params: {} } },
        outcome: "bounced",
        validator_message: expect.any(String) as string,
      },
    ]);
    expect(port.applied).toHaveLength(0);
    expect(turns.sent[1].transcript[2]).toMatchObject({
      ok: true,
      content: expect.stringContaining("proposed, not enforced") as string,
    });
  });

  it("serves the reads and the dry-run proposal, tracing each", async () => {
    const port = drafts();
    const turns = engine(
      [
        call("call-1", "read_draft", {}),
        call("call-2", "read_catalog", {}),
        call("call-3", "read_skills", {}),
        call("call-4", "lookup_tickets", { query: "security", limit: 3 }),
        { kind: "done", finishReason: "stop" },
      ],
      [
        { kind: "delta", text: "Want a dry run? #489 has no CVE — a useful edge case." },
        call("call-1", "propose_dry_run", {
          ticket: "#489",
          reason: "no CVE — exercises the skip path",
        }),
        { kind: "done", finishReason: "stop" },
      ],
      [{ kind: "done", finishReason: "stop" }],
    );

    const { events, outcome } = await run(input(), turns, port);

    expect(
      events
        .filter((event) => event.kind === "read")
        .map((event) => (event as { tool: string }).tool),
    ).toEqual(["draft", "catalog", "skills", "tickets"]);
    expect(events.find((event) => event.kind === "dry_run_proposal")).toEqual({
      kind: "dry_run_proposal",
      ticket: "#489",
      reason: "no CVE — exercises the skip path",
    });
    expect(outcome.trace.reads).toEqual([
      { tool: "draft" },
      { tool: "catalog" },
      { tool: "skills" },
      { tool: "tickets", query: "security" },
    ]);
    expect(outcome.trace.dry_run_proposals).toEqual([
      { ticket: "#489", reason: "no CVE — exercises the skip path" },
    ]);
    const results = turns.sent[1].transcript.filter((entry) => entry.role === "tool");
    expect(results[0]).toMatchObject({
      content: expect.stringContaining('"issue-queued"') as string,
    });
    expect(results[3]).toMatchObject({ content: expect.stringContaining("#489") as string });
    expect(results[3]).toMatchObject({ content: expect.stringContaining("not ranked") as string });
  });

  it("records an unpriced exchange as null cost, never zero", async () => {
    const port = drafts();
    const turns = engine([
      { kind: "delta", text: "Hi." },
      { ...USAGE, costCents: null },
      { kind: "done", finishReason: "stop" },
    ]);

    const { outcome } = await run(input(), turns, port);

    expect(outcome.tokensIn).toBe(100);
    expect(outcome.costCents).toBeNull();
  });

  it("records an unmetered exchange with null tokens", async () => {
    const { outcome } = await run(
      input(),
      engine([
        { kind: "delta", text: "Hi." },
        { kind: "done", finishReason: "stop" },
      ]),
      drafts(),
    );

    expect(outcome.tokensIn).toBeNull();
    expect(outcome.tokensOut).toBeNull();
    expect(outcome.costCents).toBeNull();
  });

  it("interrupts honestly when the gateway is unavailable, keeping what streamed", async () => {
    const turns = engine([
      { kind: "delta", text: "Starting." },
      {
        kind: "error",
        code: "gateway_unavailable",
        message: "nothing implements model invocation yet",
      },
    ]);

    const { events, outcome } = await run(input(), turns, drafts());

    expect(outcome.status).toBe("interrupted");
    expect(outcome.failure).toEqual({
      code: "gateway_unavailable",
      message: "nothing implements model invocation yet",
    });
    expect(outcome.body).toBe(
      "Starting.\nI could not finish this reply: nothing implements model invocation yet",
    );
    expect(events.at(-1)).toMatchObject({
      kind: "delta",
      text: expect.stringContaining("could not finish") as string,
    });
  });

  it("interrupts when the engine itself is unavailable", async () => {
    const turns = engine([{ kind: "error", code: "__throw__", message: "down" }]);

    const { outcome } = await run(input(), turns, drafts());

    expect(outcome.status).toBe("interrupted");
    expect(outcome.failure).toEqual({ code: "engine_unavailable", message: "down" });
  });

  it("stops after the turn budget and says so", async () => {
    const chatty = (): EngineCopilotEvent[] => [
      call("call-1", "read_draft", {}),
      { kind: "done", finishReason: "stop" },
    ];
    const turns = engine(...Array.from({ length: MAX_TURNS }, chatty));

    const { outcome } = await run(input(), turns, drafts());

    expect(turns.sent).toHaveLength(MAX_TURNS);
    expect(outcome.body).toContain(`I stopped after ${MAX_TURNS} rounds`);
  });

  it("gives a reply that only acted a body, so the record is never blank", async () => {
    const turns = engine(
      [call("call-1", "add_stage", { node: REVIEW_NODE }), { kind: "done", finishReason: "stop" }],
      [{ kind: "done", finishReason: "stop" }],
    );

    const { outcome } = await run(input(), turns, drafts());

    expect(outcome.body).toBe("Applied 1 change; the draft is v0.1.");
  });

  it("sends the routed alias, the session and the grounding on every turn", async () => {
    const turns = engine([{ kind: "done", finishReason: "stop" }]);

    await run(input(), turns, drafts());

    expect(turns.sent[0]).toMatchObject({
      alias: "coder-max",
      session: SESSION,
      resolutionVersion: "z1-v1",
      costCapCents: 500,
      context: { draftLabel: "v0.0", skills: ["pr-etiquette"], tasks: ["review", "implement"] },
    });
  });
});
