/**
 * The copilot's session flows, certified through HTTP over the development seeds and a scripted
 * engine (CD.6, [#564](https://github.com/NobuData/ouroboros/issues/564)).
 *
 * The exchange loop has unit specs over ports; what they cannot show is the composed promise —
 * that the route, the SSE writer, the engine client's NDJSON reader, the etag guard, the batch
 * function and the stored reply all tell one story. Each case here scripts what the model says,
 * speaks to the real route, and then reads three witnesses that must agree: **the stream** the
 * browser was sent, **the next turn request** the engine received (what the model is told), and
 * **the rows** the conversation left behind.
 *
 * - **Chips.** `ask_user` ends the exchange with a question; the answer re-enters as the
 *   person's next turn, is refused when it names an option nobody offered, and only once.
 * - **Bounces.** An operation the validator refuses comes back to the model as a failed tool
 *   result carrying the validator's sentence; a corrected one is applied; and the budget —
 *   {@link MAX_BOUNCES} bounces, {@link MAX_TURNS} turns — ends an exchange with a sentence and
 *   an untouched draft rather than a loop.
 * - **Etag conflicts.** A studio save landing between two turns moves the etag; the copilot's
 *   stale operation is not applied, the studio's edit survives, and the model is told to re-plan
 *   from the draft as it now stands.
 * - **A conversation closed mid-reply** (CE.2, #566). A discard landing between two turns of one
 *   exchange closes the session; the operation the next turn proposes is not applied, no further
 *   turn is asked for, and the reply ends `interrupted` with `copilot_session_closed`.
 * - **Cost and provenance.** Tokens and cost are summed over the turns, cost is `null` as soon as
 *   one turn was unpriced, and the session and the operation log record what was routed to and
 *   who applied what.
 * - **Streaming order.** `accepted` first, `done` last, and in between the text of a turn before
 *   the markers of the calls that turn made, turn after turn.
 */

import { EngineClient } from "../../engine/engine.client";
import { ENGINE_COPILOT_ROUTE } from "../../engine/engine.copilot";
import { SCHEMA_NAME } from "../../db/schema";
import { readFixture } from "../../workflows/dsl.golden.fixture";
import { validateWorkflowDocument } from "../../workflows/dsl.validator";
import type { Person } from "../../../testing/harness.fixture";
import { COPILOT_ERRORS } from "../copilot.errors";
import { MAX_BOUNCES, MAX_TURNS, SESSION_CLOSED_MID_REPLY } from "../copilot.exchange";
import { asDraftDocument, checkOperation } from "../copilot.operations";
import type { CopilotConversationResource } from "../copilot.resources";
import { COPILOT_TASK_KIND, COPILOT_UNROUTED } from "../copilot.service";
import type { CopilotStreamEvent } from "../copilot.stream";
import {
  COPILOT_ALIAS,
  IMPLEMENT_NODE,
  TEST_NODE,
  TRIGGER,
  eventsOf,
  kindsOf,
  ofKind,
  startCopilotStage,
  type CopilotStage,
  type Exchange,
  type StagedWorkflow,
} from "./certification.fixture";
import {
  delta,
  done,
  toolCall,
  usage,
  type WireEvent,
  type WireRequest,
} from "./scripted-engine.fixture";

/** One entry of a turn request's transcript, in the engine's names. */
interface WireEntry {
  readonly role: "user" | "copilot" | "tool";
  readonly text?: string;
  readonly tool_calls?: readonly { id: string; tool: string; arguments: unknown }[];
  readonly call_id?: string;
  readonly ok?: boolean;
  readonly content?: string;
}

/** A copilot reply, as `copilot_messages` holds it. */
interface StoredReply {
  readonly body: string;
  readonly status: string;
  readonly choices:
    | { prompt: string; options: string[]; selected: string | null; answered_at: string | null }[]
    | null;
  readonly tool_trace: {
    operations: { op: unknown; outcome: string; validator_message?: string }[];
    reads: { tool: string }[];
  };
  readonly tokens_in: number | null;
  readonly tokens_out: number | null;
  readonly cost_cents: number | null;
}

/** One row of the operation log. */
interface LoggedOperation {
  readonly actor: string;
  readonly actor_user_id: string | null;
  readonly session_id: string | null;
  readonly draft_rev: number;
  readonly seq: number;
  readonly op: unknown;
}

/** A model stage the node probe refuses: its config has no prompt. */
const PROMPTLESS_NODE = {
  ...IMPLEMENT_NODE,
  config: {
    mode: "prompt",
    routing: { inherit_task: "implement" },
    limits: { max_retries: 1, token_budget: 200_000 },
    permissions: { push_fixup: false, touch_ci: false },
  },
};

/**
 * The one element of a list that must hold exactly one.
 *
 * @param items - The list.
 * @param what - What it holds, for the failure.
 * @returns The element.
 * @throws {Error} When the list holds none or several.
 */
function only<T>(items: readonly T[], what: string): T {
  const [first] = items;
  if (items.length !== 1 || first === undefined) {
    throw new Error(`Expected exactly one ${what}, found ${String(items.length)}.`);
  }
  return first;
}

/** The transcript a turn request carried. */
function transcriptOf(turn: WireRequest | undefined): WireEntry[] {
  if (turn === undefined) throw new Error("The engine was not asked that turn.");
  return turn.transcript as WireEntry[];
}

/** The draft a turn request carried as context. */
function contextOf(turn: WireRequest | undefined): { draft: unknown; draft_label: string } {
  if (turn === undefined) throw new Error("The engine was not asked that turn.");
  return turn.context as { draft: unknown; draft_label: string };
}

/** The text of a stream's `delta` events, in order. */
function textOf(events: readonly CopilotStreamEvent[]): string[] {
  return ofKind(events, "delta").map((event) => event.text);
}

describe("copilot certification — session flows (#564)", () => {
  let stage: CopilotStage;
  let serial = 0;
  /** Every engine route called that the copilot plane has no business calling, across the suite. */
  const strays: string[] = [];

  /** A fresh workflow with a conversation open on it. */
  async function conversationOn(
    name: string,
  ): Promise<{ workflow: StagedWorkflow; session: string }> {
    serial += 1;
    const workflow = await stage.workflow(`Sessions cert ${String(serial)} ${name}`);

    return { workflow, session: await stage.session(workflow.id) };
  }

  /** Choose a chip and read the reply's stream to its end. */
  async function answer(
    workflowId: string,
    sessionId: string,
    messageId: string,
    body: { question: number; selected: string },
  ): Promise<Exchange> {
    const answered = await stage
      .as(
        stage.people.owner,
        "post",
        `/api/v1/workflows/${workflowId}/copilot/sessions/${sessionId}/messages/${messageId}/answers`,
      )
      .send(body);
    const streamed = answered.status < 300 && answered.text.startsWith("event: ");

    return {
      status: answered.status,
      events: streamed ? eventsOf(answered.text) : [],
      refusal: streamed ? null : (answered.body as Exchange["refusal"]),
    };
  }

  /** A reply's row. */
  async function stored(replyId: string): Promise<StoredReply> {
    const row = await stage.one<StoredReply>(
      `select body, status, choices, tool_trace, tokens_in, tokens_out, cost_cents
         from ${SCHEMA_NAME}.copilot_messages where id = $1`,
      [replyId],
    );
    if (row === undefined) throw new Error(`No copilot message ${replyId}.`);

    return row;
  }

  /** The operation log of a workflow's draft, oldest first. */
  async function logged(workflowId: string): Promise<LoggedOperation[]> {
    const { rows } = await stage.api.sql.query<LoggedOperation>(
      `select actor, actor_user_id, session_id, draft_rev, seq, op
         from ${SCHEMA_NAME}.draft_operations where workflow_id = $1
        order by draft_rev, seq`,
      [workflowId],
    );

    return rows;
  }

  /** How many messages a session holds. */
  async function messageCount(sessionId: string): Promise<number> {
    const row = await stage.one<{ count: string }>(
      `select count(*) as count from ${SCHEMA_NAME}.copilot_messages where session_id = $1`,
      [sessionId],
    );

    return Number(row?.count ?? 0);
  }

  /** The conversation read — the session with its provenance, the messages, the draft. */
  async function conversation(workflowId: string): Promise<CopilotConversationResource> {
    const read = await stage
      .as(stage.people.owner, "get", `/api/v1/workflows/${workflowId}/copilot/conversation`)
      .expect(200);

    return read.body as CopilotConversationResource;
  }

  beforeAll(async () => {
    stage = await startCopilotStage();
  });

  afterAll(async () => {
    await stage.close();
  });

  beforeEach(() => {
    stage.engine.reset();
  });

  afterEach(() => {
    strays.push(...stage.engine.strays);
  });

  describe("streaming order", () => {
    it("sends accepted first and done last, and each turn's text before the markers of the calls it made", async () => {
      const { workflow, session } = await conversationOn("order");

      // The engine writes a turn's lines in the order the model produced them — here a tool call
      // *between* two fragments of text. Text is forwarded as it arrives and calls are acted on
      // once the turn has ended, so a marker follows all of its own turn's text and precedes the
      // next turn's.
      stage.engine.script(
        [
          delta("Reading the draft. "),
          toolCall("a1", "read_draft", {}),
          toolCall("a2", "set_trigger", { trigger: TRIGGER }),
          delta("Then the trigger. "),
          usage(10, 2, 1),
          done("tool_use"),
        ],
        [
          delta("Now a test stage. "),
          toolCall("b1", "add_stage", { node: TEST_NODE }),
          toolCall("b2", "read_catalog", {}),
          done("tool_use"),
        ],
        [
          delta("One question."),
          toolCall("c1", "ask_user", { prompt: "Merge how?", options: ["squash", "rebase"] }),
          done("tool_use"),
        ],
      );

      const exchange = await stage.say(workflow.id, session, "Build me a loop.");

      expect(exchange.status).toBe(201);
      expect(kindsOf(exchange.events)).toEqual([
        "accepted",
        "delta",
        "delta",
        "read",
        "operation",
        "delta",
        "operation",
        "read",
        "delta",
        "question",
        "usage",
        "done",
      ]);
      expect(textOf(exchange.events)).toEqual([
        "Reading the draft. ",
        "Then the trigger. ",
        "Now a test stage. ",
        "One question.",
      ]);
      expect(ofKind(exchange.events, "read").map((event) => event.tool)).toEqual([
        "draft",
        "catalog",
      ]);
      expect(ofKind(exchange.events, "operation").map((event) => event.op.kind)).toEqual([
        "set_trigger",
        "add_stage",
      ]);

      // An operation marker is sent once the operation is applied: each carries the revision it
      // produced, and the last one's etag is the etag the stream ends on.
      const operations = ofKind(exchange.events, "operation");
      expect(operations.map((event) => event.outcome)).toEqual(["applied", "applied"]);
      expect(operations.map((event) => event.draftRev)).toEqual([1, 2]);

      const accepted = only(ofKind(exchange.events, "accepted"), "accepted event");
      const finished = only(ofKind(exchange.events, "done"), "done event");
      expect(accepted.message).toMatchObject({ role: "user", body: "Build me a loop." });
      expect(finished.message.id).toBe(accepted.replyId);
      expect(finished.message.seq).toBe(accepted.replySeq);
      expect(finished.message.body).toBe(textOf(exchange.events).join(""));
      expect(finished.draft.etag).toBe(operations[1]?.etag);
      expect(finished.draft.definition).toMatchObject({ trigger: TRIGGER, nodes: [TEST_NODE] });

      // The question ended the exchange: three turns were asked for, and no fourth.
      expect(stage.engine.turns).toHaveLength(3);
    });
  });

  describe("round trip through the draft slot", () => {
    it("builds a golden document by operations into a stored draft that validates clean", async () => {
      // The unit parity suite proves this over `applyOperation`; here the same operations go
      // through the route and `apply_draft_batch()`, so it is the *stored* document that is held
      // to the validator. The workflow is created with a name only, on the blank canvas: the
      // operations alone make the document (#1744).
      const target = asDraftDocument(readFixture("valid/standard-fix.json"));
      serial += 1;
      const workflow = await stage.workflow(`Sessions cert ${String(serial)} round trip`);
      const session = await stage.session(workflow.id);
      const calls = [
        toolCall("t", "set_trigger", { trigger: target.trigger }),
        ...target.nodes.map((node, index) => toolCall(`n${String(index)}`, "add_stage", { node })),
        ...target.edges.map((edge, index) => toolCall(`e${String(index)}`, "add_edge", { edge })),
      ];

      stage.engine.script([...calls, done("tool_use")], [delta("Built."), done()]);
      const exchange = await stage.say(workflow.id, session, "Build the standard fix loop.");

      expect(ofKind(exchange.events, "operation").map((event) => event.outcome)).toEqual(
        calls.map(() => "applied"),
      );
      const draft = await stage.draft(workflow.id);
      expect(draft.draftRev).toBe(calls.length);
      expect(draft.definition).toEqual(target);
      expect(validateWorkflowDocument(draft.definition).errors).toEqual([]);

      // The model was told, after the last operation and not before, that the draft is whole.
      const results = transcriptOf(stage.engine.turns[1]).filter((entry) => entry.role === "tool");
      expect(results).toHaveLength(calls.length);
      expect(results[0]?.content).toMatch(/The draft as a whole does not validate yet/);
      expect(results.at(-1)?.content).toBe(
        `applied — the draft is now v0.${String(calls.length)}.`,
      );
    });
  });

  describe("chip round-trip", () => {
    it("asks, refuses an answer nobody offered, takes one answer and hands it to the next turn", async () => {
      const { workflow, session } = await conversationOn("chips");
      const prompt = "Which merge method?";

      stage.engine.script([
        delta("Before I add the ending: "),
        toolCall("q1", "ask_user", { prompt, options: ["squash", "rebase"] }),
        usage(40, 8, 1),
        done("tool_use"),
      ]);
      const asked = await stage.say(workflow.id, session, "End with an auto-merge.");

      const question = only(ofKind(asked.events, "question"), "question event");
      expect(question).toEqual({
        kind: "question",
        index: 0,
        prompt,
        options: ["squash", "rebase"],
      });
      const reply = only(ofKind(asked.events, "done"), "done event").message;
      expect(reply.choices).toEqual([
        { prompt, options: ["squash", "rebase"], selected: null, answeredAt: null },
      ]);
      expect((await stored(reply.id)).choices).toEqual([
        { prompt, options: ["squash", "rebase"], selected: null, answered_at: null },
      ]);
      expect(stage.engine.turns).toHaveLength(1);

      // Three answers the reply cannot take, none of which reaches the engine or the transcript.
      const before = await messageCount(session);
      const notOffered = await answer(workflow.id, session, reply.id, {
        question: 0,
        selected: "merge",
      });
      expect(notOffered.status).toBe(422);
      expect(notOffered.refusal).toMatchObject({
        code: COPILOT_ERRORS.answerInvalid,
        message: '"merge" is not one of the options offered.',
      });
      const notAsked = await answer(workflow.id, session, reply.id, {
        question: 1,
        selected: "squash",
      });
      expect(notAsked.status).toBe(422);
      expect(notAsked.refusal?.code).toBe(COPILOT_ERRORS.answerInvalid);
      const accepted = only(ofKind(asked.events, "accepted"), "accepted event");
      const notAReply = await answer(workflow.id, session, accepted.message.id, {
        question: 0,
        selected: "squash",
      });
      expect(notAReply.status).toBe(404);
      expect(notAReply.refusal?.code).toBe(COPILOT_ERRORS.messageNotFound);
      expect(stage.engine.turns).toHaveLength(1);
      expect(await messageCount(session)).toBe(before);
      expect((await stored(reply.id)).choices?.[0]?.selected).toBeNull();

      // The answer: recorded on the reply that asked, and the next turn's input.
      stage.engine.script([delta("Squash it is."), usage(60, 4, 1), done()]);
      const answered = await answer(workflow.id, session, reply.id, {
        question: 0,
        selected: "squash",
      });

      expect(answered.status).toBe(201);
      expect(kindsOf(answered.events)).toEqual(["accepted", "delta", "usage", "done"]);
      expect(only(ofKind(answered.events, "accepted"), "accepted event").message).toMatchObject({
        role: "user",
        body: `${prompt} → squash`,
      });

      const choice = (await stored(reply.id)).choices?.[0];
      expect(choice).toMatchObject({ prompt, selected: "squash" });
      expect(Number.isNaN(Date.parse(choice?.answered_at ?? ""))).toBe(false);

      expect(stage.engine.turns).toHaveLength(2);
      const transcript = transcriptOf(stage.engine.turns[1]);
      expect(transcript.map((entry) => entry.role)).toEqual(["user", "copilot", "user"]);
      expect(transcript[0]).toEqual({ role: "user", text: "End with an auto-merge." });
      expect(transcript[1]?.text).toBe(
        `Before I add the ending: \n[asked: ${prompt} (squash / rebase) → squash]`,
      );
      expect(transcript[2]).toEqual({ role: "user", text: `${prompt} → squash` });

      // And once only.
      const again = await answer(workflow.id, session, reply.id, {
        question: 0,
        selected: "rebase",
      });
      expect(again.status).toBe(422);
      expect(again.refusal).toMatchObject({
        code: COPILOT_ERRORS.answerInvalid,
        message: "That question was already answered.",
      });
      expect((await stored(reply.id)).choices?.[0]?.selected).toBe("squash");
      expect(stage.engine.turns).toHaveLength(2);

      const read = await conversation(workflow.id);
      expect(read.messages.map((message) => message.role)).toEqual([
        "user",
        "copilot",
        "user",
        "copilot",
      ]);
      expect(read.messages[1]?.choices?.[0]?.selected).toBe("squash");
    });
  });

  describe("bounced operations", () => {
    it("tells the model the validator's sentence, and applies the corrected operation", async () => {
      const { workflow, session } = await conversationOn("bounce");
      const bad = { kind: "add_stage", params: { node: PROMPTLESS_NODE } };
      const good = { kind: "add_stage", params: { node: IMPLEMENT_NODE } };
      const verdict = checkOperation(null, bad);
      const sentence = verdict.ok ? "" : verdict.message;
      expect(sentence).toMatch(/prompt_template/);

      stage.engine.script(
        [delta("Adding the stage. "), toolCall("c1", "add_stage", bad.params), done("tool_use")],
        [delta("Corrected. "), toolCall("c2", "add_stage", good.params), done("tool_use")],
        [delta("Done."), done()],
      );

      const before = await stage.draft(workflow.id);
      const exchange = await stage.say(workflow.id, session, "Add an implement stage.");

      const [bounced, applied] = ofKind(exchange.events, "operation");
      expect(ofKind(exchange.events, "operation")).toHaveLength(2);
      expect(bounced).toMatchObject({
        op: bad,
        outcome: "bounced",
        validatorMessage: sentence,
        draftRev: null,
        etag: null,
      });
      expect(applied).toMatchObject({
        op: good,
        outcome: "applied",
        validatorMessage: null,
        draftRev: 1,
      });

      // What the model was told: turn two opens on the bounce, turn three on the application.
      expect(stage.engine.turns).toHaveLength(3);
      expect(contextOf(stage.engine.turns[1]).draft).toEqual(before.definition);
      expect(transcriptOf(stage.engine.turns[1]).slice(-2)).toEqual([
        {
          role: "copilot",
          text: "Adding the stage. ",
          tool_calls: [{ id: "c1", tool: "add_stage", arguments: bad.params }],
        },
        { role: "tool", call_id: "c1", ok: false, content: sentence },
      ]);
      const told = only(
        transcriptOf(stage.engine.turns[2]).filter((entry) => entry.call_id === "c2"),
        "result for the corrected call",
      );
      expect(told.ok).toBe(true);
      expect(told.content).toMatch(/^applied — the draft is now v0\.1\./);
      expect(contextOf(stage.engine.turns[2])).toMatchObject({
        draft: { nodes: [IMPLEMENT_NODE] },
        draft_label: "v0.1",
      });

      // What was kept: both attempts on the reply's trace, one operation in the log and the draft.
      const reply = only(ofKind(exchange.events, "done"), "done event").message;
      expect(reply.status).toBe("complete");
      expect((await stored(reply.id)).tool_trace.operations).toEqual([
        { op: bad, outcome: "bounced", validator_message: sentence },
        { op: good, outcome: "applied" },
      ]);
      expect((await logged(workflow.id)).map((row) => row.op)).toEqual([good]);
      expect(await stage.draft(workflow.id)).toMatchObject({
        definition: { nodes: [IMPLEMENT_NODE] },
        draftRev: 1,
      });
    });

    it("stops after the bounce budget with a sentence, an untouched draft and no further turn", async () => {
      const { workflow, session } = await conversationOn("exhaustion");
      const ghost = (turn: number): Record<string, unknown> => ({
        edge: { from: `ghost-${String(turn)}`, to: "nowhere", kind: "default" },
      });
      const sentences = Array.from({ length: MAX_BOUNCES + 1 }, (_, index) => {
        const verdict = checkOperation(null, { kind: "add_edge", params: ghost(index + 1) });
        return verdict.ok ? "" : verdict.message;
      });
      expect(sentences[0]).toBe('edge.from "ghost-1" names no stage.');

      // Three more bad turns are queued than the budget allows: were the loop to keep asking,
      // the engine would have them to give.
      stage.engine.script(
        ...Array.from({ length: MAX_BOUNCES + 4 }, (_, index): WireEvent[] => [
          toolCall(`g${String(index + 1)}`, "add_edge", ghost(index + 1)),
          usage(10, 1, 1),
          done("tool_use"),
        ]),
      );

      const before = await stage.draft(workflow.id);
      const exchange = await stage.say(workflow.id, session, "Join the stages.");

      expect(stage.engine.turns).toHaveLength(MAX_BOUNCES + 1);
      const operations = ofKind(exchange.events, "operation");
      expect(operations.map((event) => event.outcome)).toEqual(
        Array.from({ length: MAX_BOUNCES + 1 }, () => "bounced"),
      );
      expect(operations.map((event) => event.validatorMessage)).toEqual(sentences);

      // It ends by saying so — the last text of the stream, then `usage` and `done`, no `error`.
      const gaveUp =
        `I could not produce a valid change after ${String(MAX_BOUNCES + 1)} attempts, so I have stopped here. ` +
        `The last validation message was: ${sentences[MAX_BOUNCES] ?? ""}`;
      expect(textOf(exchange.events)).toEqual([gaveUp]);
      expect(kindsOf(exchange.events).slice(-3)).toEqual(["delta", "usage", "done"]);
      expect(ofKind(exchange.events, "error")).toEqual([]);

      const reply = only(ofKind(exchange.events, "done"), "done event").message;
      expect(reply).toMatchObject({ status: "complete", body: gaveUp });
      const row = await stored(reply.id);
      expect(row.status).toBe("complete");
      expect(row.tool_trace.operations.map((entry) => entry.outcome)).toEqual(
        operations.map((event) => event.outcome),
      );
      // Every turn asked for is paid for, the abandoned ones included.
      expect(row).toMatchObject({
        tokens_in: 10 * (MAX_BOUNCES + 1),
        tokens_out: MAX_BOUNCES + 1,
        cost_cents: MAX_BOUNCES + 1,
      });

      expect(before.draftRev).toBe(0);
      expect(await stage.draft(workflow.id)).toEqual(before);
      expect(await logged(workflow.id)).toEqual([]);
    });

    it("counts the budget per exchange and per bounce: one turn can spend it, and the last allowed bounce still leaves room to correct", async () => {
      const { workflow, session } = await conversationOn("budget");
      const ghosts = (count: number, prefix: string): WireEvent[] =>
        Array.from({ length: count }, (_, index) =>
          toolCall(`${prefix}${String(index)}`, "remove_stage", { id: `ghost-${String(index)}` }),
        );

      // One turn making one bounce more than the budget: the exchange ends on that turn.
      stage.engine.script(
        [...ghosts(MAX_BOUNCES + 1, "x"), done("tool_use")],
        [delta("Unreached.")],
      );
      const spent = await stage.say(workflow.id, session, "Remove the stages.");

      expect(stage.engine.turns).toHaveLength(1);
      expect(ofKind(spent.events, "operation")).toHaveLength(MAX_BOUNCES + 1);
      expect(only(textOf(spent.events), "delta")).toMatch(
        /^I could not produce a valid change after \d+ attempts, so I have stopped here\./,
      );

      // A new message starts a new budget; exactly the budget in bounces is survivable.
      stage.engine.reset();
      stage.engine.script(
        [...ghosts(MAX_BOUNCES, "y"), done("tool_use")],
        [toolCall("ok", "add_stage", { node: TEST_NODE }), done("tool_use")],
        [delta("Added the test stage."), done()],
      );
      const corrected = await stage.say(workflow.id, session, "Then add a test stage.");

      expect(stage.engine.turns).toHaveLength(3);
      expect(ofKind(corrected.events, "operation").map((event) => event.outcome)).toEqual([
        ...Array.from({ length: MAX_BOUNCES }, () => "bounced"),
        "applied",
      ]);
      expect(textOf(corrected.events)).toEqual(["Added the test stage."]);
      expect((await stage.draft(workflow.id)).definition).toMatchObject({ nodes: [TEST_NODE] });
    });

    it("stops after the turn budget when the model never stops calling tools", async () => {
      const { workflow, session } = await conversationOn("turns");

      stage.engine.script(
        ...Array.from({ length: MAX_TURNS + 3 }, (_, index): WireEvent[] => [
          delta(`Round ${String(index + 1)}. `),
          toolCall(`r${String(index + 1)}`, "read_draft", {}),
          done("tool_use"),
        ]),
      );

      const before = await stage.draft(workflow.id);
      const exchange = await stage.say(workflow.id, session, "Keep reading.");

      expect(stage.engine.turns).toHaveLength(MAX_TURNS);
      expect(ofKind(exchange.events, "read")).toHaveLength(MAX_TURNS);
      expect(textOf(exchange.events).slice(-1)).toEqual([
        `I stopped after ${String(MAX_TURNS)} rounds of changes without finishing; the draft is v0.0 — tell me how to continue.`,
      ]);
      expect(kindsOf(exchange.events).slice(-3)).toEqual(["delta", "usage", "done"]);

      const reply = only(ofKind(exchange.events, "done"), "done event").message;
      expect(reply.status).toBe("complete");
      expect((await stored(reply.id)).tool_trace.reads).toHaveLength(MAX_TURNS);
      expect(await stage.draft(workflow.id)).toEqual(before);
    });
  });

  describe("who each stage is by", () => {
    it("reports the stages a conversation added as the copilot's, in the document's order, on every read of the draft", async () => {
      const { workflow, session } = await conversationOn("provenance");
      const path = `/api/v1/workflows/${workflow.id}/copilot`;

      // Before anything is said the draft is the blank canvas: a document with no stages.
      const blank = await stage.as(stage.people.viewer, "get", `${path}/draft`).expect(200);
      expect(blank.body).toMatchObject({ label: "v0.0", nodeProvenance: [] });

      stage.engine.script(
        [
          toolCall("p1", "set_trigger", { trigger: TRIGGER }),
          toolCall("p2", "add_stage", { node: IMPLEMENT_NODE }),
          toolCall("p3", "add_stage", { node: TEST_NODE }),
          done("tool_use"),
        ],
        [delta("Drafted."), done()],
      );
      const exchange = await stage.say(workflow.id, session, "Start a bug loop.");
      const added = ofKind(exchange.events, "operation").filter(
        (event) => event.op.kind === "add_stage",
      );
      const expected = [
        { nodeId: IMPLEMENT_NODE.id, provenance: "copilot", addedRev: added[0]?.draftRev },
        { nodeId: TEST_NODE.id, provenance: "copilot", addedRev: added[1]?.draftRev },
      ];
      expect(expected.map((entry) => entry.addedRev)).toEqual([2, 3]);

      // The stream's last word, the stage list's own read — a viewer's — and the conversation
      // read all say the same thing about the same draft.
      const finished = only(ofKind(exchange.events, "done"), "done event").draft;
      expect(finished.nodeProvenance).toEqual(expected);

      const read = await stage.as(stage.people.viewer, "get", `${path}/draft`).expect(200);
      expect(read.body).toEqual(finished);
      expect((read.body as { definition: unknown }).definition).toMatchObject({
        nodes: [IMPLEMENT_NODE, TEST_NODE],
      });

      const conversation = await stage
        .as(stage.people.viewer, "get", `${path}/conversation`)
        .expect(200);
      expect((conversation.body as { draft: unknown }).draft).toEqual(finished);
    });
  });

  describe("etag conflict during a conversation", () => {
    it("does not apply over a studio save made between two turns, and tells the model to re-plan from it", async () => {
      const { workflow, session } = await conversationOn("conflict");

      // The conversation builds a draft the studio then opens.
      stage.engine.script(
        [
          toolCall("s1", "set_trigger", { trigger: TRIGGER }),
          toolCall("s2", "add_stage", { node: IMPLEMENT_NODE }),
          done("tool_use"),
        ],
        [delta("Started."), done()],
      );
      const opened = await stage.say(workflow.id, session, "Start a bug loop.");
      const shared = only(ofKind(opened.events, "done"), "done event").draft;
      const studioDocument = {
        dsl_version: "1.0",
        trigger: TRIGGER,
        nodes: [{ ...IMPLEMENT_NODE, title: "Implement (renamed in the studio)" }],
        edges: [],
      };

      // The studio saves *between two turns of one exchange*: the loop has already read the
      // draft and been answered once when the save — made under the etag the conversation itself
      // handed out — lands, and only then is the second turn sent. The engine client is the
      // real one; it is merely made to wait for the save before that one request.
      stage.engine.reset();
      stage.engine.script(
        [delta("Let me look. "), toolCall("r1", "read_draft", {}), done("tool_use")],
        [
          delta("Adding a test stage. "),
          toolCall("stale", "add_stage", { node: TEST_NODE }),
          done("tool_use"),
        ],
        [toolCall("fresh", "add_stage", { node: TEST_NODE }), done("tool_use")],
        [delta("Added after your edit."), done()],
      );
      const client = stage.api.nest.get(EngineClient);
      const turn = client.copilotTurn.bind(client);
      let save: { status: number; etag: string } | undefined;
      let asked = 0;
      const between = jest
        .spyOn(client, "copilotTurn")
        .mockImplementation(async function* (request) {
          asked += 1;
          if (asked === 2) {
            const response = await stage
              .as(stage.people.owner, "put", `/api/v1/workflows/${workflow.id}/draft`)
              .set("If-Match", shared.etag)
              .send({ definition: studioDocument });
            save = { status: response.status, etag: (response.body as { etag: string }).etag };
          }
          yield* turn(request);
        });

      let exchange: Exchange;
      try {
        exchange = await stage.say(workflow.id, session, "Add a test stage.");
      } finally {
        between.mockRestore();
      }
      const staleTurn = 1;

      // The studio's save was a clean one: it matched the etag the conversation showed.
      expect(save).toMatchObject({ status: 200 });
      expect(save?.etag).not.toBe(shared.etag);
      expect(stage.engine.turns).toHaveLength(4);

      // The stream: a conflict naming the new etag, the sentence for the person, and exactly one
      // operation marker — the retry's. The stale proposal produced none.
      const conflict = only(ofKind(exchange.events, "conflict"), "conflict event");
      expect(conflict.etag).toBe(save?.etag);
      expect(conflict.message).toMatch(
        /^Someone changed the draft in the visual editor while we were talking; I re-read it \(v0\.\d+\) before continuing\.$/,
      );
      expect(textOf(exchange.events)).toContain(conflict.message);
      const marker = only(ofKind(exchange.events, "operation"), "operation event");
      expect(marker).toMatchObject({
        outcome: "applied",
        op: { kind: "add_stage", params: { node: TEST_NODE } },
      });
      expect(exchange.events.indexOf(conflict)).toBeLessThan(exchange.events.indexOf(marker));

      // The model: the stale call failed, with the draft to re-plan from — the studio's.
      const replan = stage.engine.turns[staleTurn + 1];
      const refused = only(
        transcriptOf(replan).filter((entry) => entry.call_id === "stale"),
        "result for the stale call",
      );
      expect(refused.ok).toBe(false);
      expect(refused.content).toMatch(
        /^the draft changed while you were working \(it is now v0\.\d+\) — your operation was not applied\. Re-plan from the current draft: /,
      );
      expect(
        JSON.parse((refused.content ?? "").split("Re-plan from the current draft: ")[1] ?? "null"),
      ).toEqual(studioDocument);
      expect(contextOf(replan).draft).toEqual(studioDocument);
      // …where the turn that proposed it had still been shown the draft the loop started with.
      expect(contextOf(stage.engine.turns[staleTurn]).draft).toEqual(shared.definition);

      // The rows: the studio's edit survived, and the copilot's stage is on top of it.
      const after = await stage.draft(workflow.id);
      expect(after.definition).toEqual({
        ...studioDocument,
        nodes: [...studioDocument.nodes, TEST_NODE],
      });
      const reply = only(ofKind(exchange.events, "done"), "done event");
      expect(reply.draft.definition).toEqual(after.definition);
      expect(reply.draft.etag).toBe(marker.etag);
      expect((await stored(reply.message.id)).tool_trace.operations).toEqual([
        { op: { kind: "add_stage", params: { node: TEST_NODE } }, outcome: "applied" },
      ]);
    });
  });

  describe("a conversation closed during a reply (#566)", () => {
    it("applies nothing after a discard made between two turns, asks no further turn, and says so", async () => {
      const { workflow, session } = await conversationOn("closed mid-reply");

      // Three turns are scripted; the third must never be asked for. The discard — the real
      // route, as the owner — lands after the first turn's operation was applied and before the
      // second turn is sent, exactly as the etag case stages its studio save.
      stage.engine.script(
        [
          delta("Setting the trigger. "),
          toolCall("open", "set_trigger", { trigger: TRIGGER }),
          usage(100, 10, 1),
          done("tool_use"),
        ],
        [
          toolCall("late", "add_stage", { node: IMPLEMENT_NODE }),
          usage(50, 5, 1),
          done("tool_use"),
        ],
        [delta("Never asked for."), done()],
      );
      const client = stage.api.nest.get(EngineClient);
      const turn = client.copilotTurn.bind(client);
      let discard: { status: number; body: unknown } | undefined;
      let rowsAtDiscard = -1;
      let asked = 0;
      const between = jest
        .spyOn(client, "copilotTurn")
        .mockImplementation(async function* (request) {
          asked += 1;
          if (asked === 2) {
            rowsAtDiscard = (await logged(workflow.id)).length;
            const response = await stage.as(
              stage.people.owner,
              "post",
              `/api/v1/workflows/${workflow.id}/copilot/discard`,
            );
            discard = { status: response.status, body: response.body };
          }
          yield* turn(request);
        });

      let exchange: Exchange;
      try {
        exchange = await stage.say(workflow.id, session, "A bug loop, please.");
      } finally {
        between.mockRestore();
      }

      // The discard was an ordinary one, of a draft the first turn had really written.
      expect(rowsAtDiscard).toBe(1);
      expect(discard).toMatchObject({
        status: 200,
        body: { draftDiscarded: true, session: { id: session, status: "discarded" } },
      });

      // The engine: the turn in flight was answered, and no other was asked for.
      expect(asked).toBe(2);
      expect(stage.engine.turns).toHaveLength(2);

      // The stream: one operation marker — the one applied while the conversation was open —
      // then the sentence, and the error before the final done.
      expect(exchange.status).toBe(201);
      expect(kindsOf(exchange.events).slice(-4)).toEqual(["delta", "usage", "error", "done"]);
      const marker = only(ofKind(exchange.events, "operation"), "operation event");
      expect(marker).toMatchObject({ outcome: "applied", op: { kind: "set_trigger" } });
      expect(only(ofKind(exchange.events, "error"), "error event")).toEqual({
        kind: "error",
        code: COPILOT_ERRORS.sessionClosed,
        message: SESSION_CLOSED_MID_REPLY,
      });
      expect(textOf(exchange.events).at(-1)).toBe(SESSION_CLOSED_MID_REPLY);

      // The rows: no draft and no log — the late operation wrote neither — and a reply recorded
      // interrupted, with only what was applied on its trace and what was metered as its cost.
      expect(await stage.draft(workflow.id)).toEqual({ definition: null, draftRev: 0 });
      expect(await logged(workflow.id)).toEqual([]);
      const reply = only(ofKind(exchange.events, "done"), "done event");
      expect(reply.draft.definition).toBeNull();
      expect(reply.message.status).toBe("interrupted");
      const row = await stored(reply.message.id);
      expect(row.status).toBe("interrupted");
      expect(row.body).toBe(`Setting the trigger. \n${SESSION_CLOSED_MID_REPLY}`);
      expect(row.tool_trace.operations).toEqual([
        { op: { kind: "set_trigger", params: { trigger: TRIGGER } }, outcome: "applied" },
      ]);
      expect(row.tokens_in).toBe(150);

      // The conversation stays closed and readable, and takes nothing more.
      const read = await conversation(workflow.id);
      expect(read.session).toMatchObject({ id: session, status: "discarded" });
      expect(read.messages.at(-1)).toMatchObject({ id: reply.message.id, status: "interrupted" });
      const refused = await stage.say(workflow.id, session, "Still there?");
      expect(refused.refusal).toMatchObject({ code: COPILOT_ERRORS.sessionClosed });
    });
  });

  describe("cost and provenance", () => {
    it("sums tokens and cost over the turns of a reply, and agrees with itself in three places", async () => {
      const { workflow, session } = await conversationOn("cost");

      stage.engine.script(
        [toolCall("t1", "set_trigger", { trigger: TRIGGER }), usage(1200, 80, 4), done("tool_use")],
        [toolCall("t2", "add_stage", { node: TEST_NODE }), usage(900, 40, 3), done("tool_use")],
        [delta("Built."), usage(300, 12, 1), done()],
      );

      const exchange = await stage.say(workflow.id, session, "A loop with a test stage.");

      const metered = only(ofKind(exchange.events, "usage"), "usage event");
      expect(metered).toEqual({ kind: "usage", tokensIn: 2400, tokensOut: 132, costCents: 8 });
      const reply = only(ofKind(exchange.events, "done"), "done event").message;
      expect(reply).toMatchObject({ tokensIn: 2400, tokensOut: 132, costCents: 8 });
      expect(await stored(reply.id)).toMatchObject({
        tokens_in: 2400,
        tokens_out: 132,
        cost_cents: 8,
        status: "complete",
      });
    });

    it("records no cost — not a partial one — when a turn was unpriced, and nothing when nothing was metered", async () => {
      const { workflow, session } = await conversationOn("unpriced");

      stage.engine.script(
        [toolCall("u1", "read_draft", {}), usage(500, 30, 2), done("tool_use")],
        [delta("Empty so far."), usage(250, 10, null), done()],
      );
      const unpriced = await stage.say(workflow.id, session, "What is in the draft?");

      expect(only(ofKind(unpriced.events, "usage"), "usage event")).toEqual({
        kind: "usage",
        tokensIn: 750,
        tokensOut: 40,
        costCents: null,
      });
      const first = only(ofKind(unpriced.events, "done"), "done event").message;
      expect(await stored(first.id)).toMatchObject({
        tokens_in: 750,
        tokens_out: 40,
        cost_cents: null,
      });

      stage.engine.reset();
      stage.engine.script([delta("Still empty."), done()]);
      const unmetered = await stage.say(workflow.id, session, "And now?");

      expect(only(ofKind(unmetered.events, "usage"), "usage event")).toEqual({
        kind: "usage",
        tokensIn: null,
        tokensOut: null,
        costCents: null,
      });
      const second = only(ofKind(unmetered.events, "done"), "done event").message;
      expect(await stored(second.id)).toMatchObject({
        tokens_in: null,
        tokens_out: null,
        cost_cents: null,
      });
    });

    it("records which alias and model each reply was routed to, and who applied each operation", async () => {
      const { workflow, session } = await conversationOn("provenance");
      const alias = await stage.one<{ model_id: string }>(
        `select model_id from ${SCHEMA_NAME}.model_aliases where organization_id = $1 and alias = $2`,
        [stage.workspace.id, COPILOT_ALIAS],
      );
      if (alias === undefined) throw new Error(`The seeds hold no ${COPILOT_ALIAS} alias.`);

      stage.engine.script(
        [
          toolCall("p1", "set_trigger", { trigger: TRIGGER }),
          toolCall("p2", "add_stage", { node: TEST_NODE }),
          done("tool_use"),
        ],
        [delta("Two changes."), done()],
      );
      const first = await stage.say(workflow.id, session, "Trigger and a test stage.");
      stage.engine.script(
        [toolCall("p3", "remove_stage", { id: TEST_NODE.id }), done("tool_use")],
        [delta("Removed."), done()],
      );
      const second = await stage.say(workflow.id, session, "Remove the test stage.");

      // The engine was asked as the alias the route resolved to, for this session.
      expect(stage.engine.turns).toHaveLength(4);
      for (const turn of stage.engine.turns) {
        expect(turn).toMatchObject({ alias: COPILOT_ALIAS, session });
        expect(typeof turn.resolution_version).toBe("string");
      }

      // The session: one provenance entry per reply, by the reply's seq.
      const replies = [first, second].map(
        (exchange) => only(ofKind(exchange.events, "accepted"), "accepted event").replySeq,
      );
      const read = await conversation(workflow.id);
      expect(read.session.modelProvenance).toEqual(
        replies.map((seq) => ({ seq, alias: COPILOT_ALIAS, modelId: alias.model_id })),
      );

      // The log: every operation as the copilot's, behind the person speaking, in this session —
      // one batch, and so one revision, per operation.
      expect(await logged(workflow.id)).toEqual([
        {
          actor: "copilot",
          actor_user_id: stage.people.owner.id,
          session_id: session,
          draft_rev: 1,
          seq: 1,
          op: { kind: "set_trigger", params: { trigger: TRIGGER } },
        },
        {
          actor: "copilot",
          actor_user_id: stage.people.owner.id,
          session_id: session,
          draft_rev: 2,
          seq: 1,
          op: { kind: "add_stage", params: { node: TEST_NODE } },
        },
        {
          actor: "copilot",
          actor_user_id: stage.people.owner.id,
          session_id: session,
          draft_rev: 3,
          seq: 1,
          op: { kind: "remove_stage", params: { id: TEST_NODE.id } },
        },
      ]);
      expect(only(ofKind(second.events, "done"), "done event").draft).toMatchObject({
        label: "v0.3",
        provenanceSummary: { canvas: 0, code: 0, copilot: 3, suggestion: 0 },
      });
    });
  });

  describe("who may hold a conversation", () => {
    it.each(["member", "viewer"] as const)(
      "refuses a %s who tries to start a session or post a message",
      async (role) => {
        const { workflow, session } = await conversationOn(`roles ${role}`);
        const person: Person = stage.people[role];
        const other = await stage.workflow(`Sessions cert roles ${role} second`);
        const before = await messageCount(session);

        await stage
          .as(person, "post", `/api/v1/workflows/${other.id}/copilot/sessions`)
          .send({})
          .expect(403);
        const said = await stage.say(workflow.id, session, "Add a stage.", person);

        expect(said.status).toBe(403);
        expect(said.events).toEqual([]);
        expect(stage.engine.turns).toEqual([]);
        expect(await messageCount(session)).toBe(before);
        expect(
          await stage.one(`select id from ${SCHEMA_NAME}.copilot_sessions where workflow_id = $1`, [
            other.id,
          ]),
        ).toBeUndefined();
      },
    );
  });

  describe("a workspace that routes the copilot nowhere", () => {
    it("says so in the reply, marks it interrupted and asks the engine nothing", async () => {
      const { workflow, session } = await conversationOn("unrouted");
      const rename = (from: string, to: string): Promise<unknown> =>
        stage.api.sql.query(
          `update ${SCHEMA_NAME}.task_kinds set name = $2 where organization_id = $1 and name = $3`,
          [stage.workspace.id, to, from],
        );

      // The route is taken away by renaming its task kind, and given back whatever happens.
      await rename(COPILOT_TASK_KIND, `${COPILOT_TASK_KIND}-away`);
      let exchange: Exchange;
      try {
        exchange = await stage.say(workflow.id, session, "Add a stage.");
      } finally {
        await rename(`${COPILOT_TASK_KIND}-away`, COPILOT_TASK_KIND);
      }

      expect(exchange.status).toBe(201);
      expect(kindsOf(exchange.events)).toEqual(["accepted", "delta", "error", "done"]);
      const failed = only(ofKind(exchange.events, "error"), "error event");
      expect(failed.code).toBe(COPILOT_UNROUTED);
      expect(failed.message).toContain(`no route for the \`${COPILOT_TASK_KIND}\` task kind`);
      const reply = only(ofKind(exchange.events, "done"), "done event").message;
      expect(reply).toMatchObject({ status: "interrupted", body: failed.message, costCents: null });
      expect(stage.engine.turns).toEqual([]);
      expect((await conversation(workflow.id)).session.modelProvenance).toEqual([]);

      // Given back: the same conversation answers again.
      stage.engine.script([delta("Back."), done()]);
      const again = await stage.say(workflow.id, session, "And now?");
      expect(textOf(again.events)).toEqual(["Back."]);
    });
  });

  it("called the engine for turns and for nothing else", () => {
    expect(ENGINE_COPILOT_ROUTE).toBe("v0/copilot-workflow");
    expect(strays).toEqual([]);
  });
});
