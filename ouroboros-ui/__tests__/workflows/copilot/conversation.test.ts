import { describe, expect, it } from "vitest";

import type { CopilotStreamEvent } from "@/app/api/workflow-copilot";
import { MODELS_PATH, PROVIDERS_PATH, ROUTING_MATRIX_HASH } from "@/app/paths";
import {
  ANNOUNCE_LIMIT,
  BOUNCE_UNEXPLAINED,
  CLOSED_MID_REPLY_NOTE,
  CLOSED_MID_REPLY_TITLE,
  COMPOSER_PLACEHOLDER,
  CONNECTION_LOST,
  CONNECTION_LOST_CODE,
  CONVERSATION_CAPTION,
  type ChatAction,
  type ChatState,
  DRY_RUN_REASON,
  GATEWAY_NOTICE_TITLE,
  GATEWAY_REASON,
  type GateFacts,
  HISTORY_PAGE,
  INITIAL_CHAT,
  INTERRUPTED_CODE,
  INTERRUPTED_REPLY,
  NOTHING_SENT,
  PENDING_REASON,
  REPLY_FAILED_TITLE,
  ROLE_REASON,
  SESSION_CLOSED_CODE,
  STREAMING_REASON,
  UNROUTED_NOTICE_FALLBACK,
  UNROUTED_NOTICE_STILL,
  UNROUTED_NOTICE_TITLE,
  UNROUTED_REASON,
  anchoredScrollTop,
  announcement,
  answerableId,
  baseConversation,
  bounceLine,
  chatMessages,
  chatReducer,
  chatSession,
  chipsLive,
  clockOf,
  composerAbsent,
  composerGate,
  conflictLine,
  contentVersion,
  correctedWords,
  costAffix,
  createSseParser,
  draftTag,
  firstVisible,
  hasUnseen,
  initialHidden,
  isAtBottom,
  mayRetry,
  modelPill,
  modelPillTitle,
  operationLine,
  operationPhrase,
  ordinalOf,
  parseInline,
  parseReply,
  prerequisiteNotice,
  proposalLine,
  readLine,
  readStreamEvent,
  replyFailure,
  retryText,
  revealEarlier,
  segmentsText,
  sendsOnKey,
  shownMessages,
  traceLines,
  traceSummary,
  warningLine,
} from "@/app/workflows/copilot/conversation";
import { ROLE_TRANSCRIPT_NOTE } from "@/app/workflows/copilot/copilot-view";

import {
  DRY_RUNNING,
  LIVE_REPLY_ID,
  LIVE_USER_ID,
  NO_GATEWAY,
  SEEDED_BOUNCE,
  SEEDED_IDS,
  SESSION_ID,
  UNROUTED,
  UNROUTED_REASON_TEXT,
  closedConversation,
  copilotConversation,
  copilotMessage,
  copilotReadiness,
  copilotSession,
  exchangeScript,
  operationEvent,
  seededConversation,
  seededMessages,
} from "../../helpers/workflow-copilot";

/**
 * The conversation card's judgements (CE.2, #566), each on a small value: what a stream's bytes
 * mean at every place a chunk can split them, what the events make of a reply, what each
 * operation is called, when a chip and the composer may act and why not, and where the scroller
 * should be.
 */

/** Frame events the way the service does. */
function framed(events: readonly CopilotStreamEvent[]): string {
  return events.map((event) => `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

/** Run actions over the initial state. */
function reduce(actions: readonly ChatAction[], from: ChatState = INITIAL_CHAT): ChatState {
  return actions.reduce(chatReducer, from);
}

/** A whole exchange as actions: the send, each event, the stream's close. */
function exchanged(events: readonly CopilotStreamEvent[], text = "add a stage"): ChatAction[] {
  return [
    { type: "start", origin: { kind: "message", text } },
    ...events.map((event): ChatAction => ({ type: "event", event })),
    { type: "ended" },
  ];
}

describe("the copy", () => {
  it("is the issue's placeholder and the mockup's caption, verbatim", () => {
    expect(COMPOSER_PLACEHOLDER).toBe("Refine the workflow — or ask for a dry run…");
    expect(CONVERSATION_CAPTION).toBe(
      "Copilot edits compile to the same graph as the canvas and the code editor — nothing is a special case.",
    );
    expect(draftTag("security-patch")).toBe("draft: security-patch");
  });
});

describe("createSseParser", () => {
  const SCRIPT = exchangeScript("add a stage", [
    { kind: "delta", text: "Drafted — é 🚀\nsecond line" },
    operationEvent("add_stage", { node: { id: "exploit-verify" } }),
  ]);
  const TEXT = framed(SCRIPT);

  it("reads a whole stream given at once", () => {
    const parser = createSseParser();
    const frames = [...parser.push(TEXT), ...parser.flush()];

    expect(frames.map((frame) => frame.event)).toEqual(SCRIPT.map((event) => event.kind));
    expect(frames.map(readStreamEvent)).toEqual(SCRIPT);
  });

  it("reads the same events wherever one chunk ends and the next begins", () => {
    for (let cut = 0; cut <= TEXT.length; cut += 1) {
      const parser = createSseParser();
      const frames = [...parser.push(TEXT.slice(0, cut)), ...parser.push(TEXT.slice(cut)), ...parser.flush()];

      expect(frames.map(readStreamEvent), `split at ${cut}`).toEqual(SCRIPT);
    }
  });

  it("reads them a character at a time", () => {
    const parser = createSseParser();
    const frames = [...TEXT].flatMap((character) => parser.push(character));

    expect([...frames, ...parser.flush()].map(readStreamEvent)).toEqual(SCRIPT);
  });

  it("takes CRLF and bare CR line endings, split anywhere — even between the CR and the LF", () => {
    for (const ending of ["\r\n", "\r"]) {
      const text = TEXT.replaceAll("\n", ending);

      for (let cut = 0; cut <= text.length; cut += 1) {
        const parser = createSseParser();
        const frames = [...parser.push(text.slice(0, cut)), ...parser.push(text.slice(cut)), ...parser.flush()];

        expect(frames.map(readStreamEvent), `${JSON.stringify(ending)} split at ${cut}`).toEqual(SCRIPT);
      }
    }
  });

  it("joins several data lines, drops one space after the colon, and skips comments and keep-alives", () => {
    const parser = createSseParser();

    expect(parser.push(": keep-alive\n\nevent: note\ndata:one\ndata:  two\nid: 7\n\n")).toEqual([
      { event: "note", data: "one\n two" },
    ]);
  });

  it("names a frame with no event field `message`", () => {
    expect(createSseParser().push("data: {}\n\n")).toEqual([{ event: "message", data: "{}" }]);
  });

  it("hands back on flush a last frame the server never terminated, and nothing for trailing blank space", () => {
    const parser = createSseParser();

    expect(parser.push('event: done\ndata: {"kind":"done"}')).toEqual([]);
    expect(parser.flush()).toEqual([{ event: "done", data: '{"kind":"done"}' }]);
    expect(parser.flush()).toEqual([]);

    const blank = createSseParser();
    blank.push("\n\n\n");
    expect(blank.flush()).toEqual([]);
  });
});

describe("readStreamEvent", () => {
  it("reads a known kind's data whole", () => {
    expect(readStreamEvent({ event: "delta", data: '{"kind":"delta","text":"hi"}' })).toEqual({
      kind: "delta",
      text: "hi",
    });
  });

  it.each([
    ["not JSON", "{oops"],
    ["a JSON string", '"delta"'],
    ["null", "null"],
    ["an object with no kind", '{"text":"hi"}'],
    ["a kind added later", '{"kind":"telemetry","n":1}'],
  ])("skips %s rather than drawing it wrongly", (_what, data) => {
    expect(readStreamEvent({ event: "delta", data })).toBeNull();
  });
});

describe("parseReply", () => {
  it("reads paragraphs, a blank line apart, with their line breaks", () => {
    expect(parseReply("one\ntwo\n\nthree")).toEqual([
      { kind: "paragraph", lines: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]] },
      { kind: "paragraph", lines: [[{ kind: "text", text: "three" }]] },
    ]);
  });

  it("reads bold and inline code inside a line", () => {
    expect(parseInline("Drafted **security-patch** with `exploit-verify` in it")).toEqual([
      { kind: "text", text: "Drafted " },
      { kind: "bold", text: "security-patch" },
      { kind: "text", text: " with " },
      { kind: "code", text: "exploit-verify" },
      { kind: "text", text: " in it" },
    ]);
  });

  it("leaves a marker with no partner as text — arithmetic, a lone backtick, a word still arriving", () => {
    expect(parseInline("2 ** 3")).toEqual([{ kind: "text", text: "2 ** 3" }]);
    expect(parseInline("a ` b")).toEqual([{ kind: "text", text: "a ` b" }]);
    expect(parseInline("**bol")).toEqual([{ kind: "text", text: "**bol" }]);
    expect(parseInline("****")).toEqual([{ kind: "text", text: "****" }]);
    expect(parseInline("``")).toEqual([{ kind: "text", text: "``" }]);
  });

  it("does not read markers inside inline code", () => {
    expect(parseInline("`**kept**`")).toEqual([{ kind: "code", text: "**kept**" }]);
  });

  it("reads a fenced block as written, its markers and blank lines untouched", () => {
    expect(parseReply("Before\n```yaml\nstages:\n\n  - **plan**\n```\nAfter")).toEqual([
      { kind: "paragraph", lines: [[{ kind: "text", text: "Before" }]] },
      { kind: "code", text: "stages:\n\n  - **plan**" },
      { kind: "paragraph", lines: [[{ kind: "text", text: "After" }]] },
    ]);
  });

  it("reads a fence still open at the end as a block to the end — how one looks while it streams", () => {
    expect(parseReply("```\nhalf")).toEqual([{ kind: "code", text: "half" }]);
  });

  it("takes CRLF text, and reads only-whitespace as nothing", () => {
    expect(parseReply("a\r\nb")).toEqual([
      { kind: "paragraph", lines: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]] },
    ]);
    expect(parseReply("  \n\n ")).toEqual([]);
    expect(parseReply("")).toEqual([]);
  });

  it("keeps hostile input as text: tags, links, headings and entities are characters, nothing more", () => {
    const hostile = '<img src=x onerror="alert(1)"> [x](javascript:alert(1)) # h &lt;b&gt; <script>1</script>';

    expect(parseReply(hostile)).toEqual([{ kind: "paragraph", lines: [[{ kind: "text", text: hostile }]] }]);
    expect(parseInline("**<b>x</b>**")).toEqual([{ kind: "bold", text: "<b>x</b>" }]);
  });
});

describe("operation markers", () => {
  it.each([
    ["add_stage", { node: { id: "exploit-verify" } }, "adding stage exploit-verify… ✓"],
    ["add_stage", { id: "exploit-verify" }, "adding stage exploit-verify… ✓"],
    ["add_stage", {}, "adding a stage… ✓"],
    ["set_stage", { node: { id: "plan" } }, "updating stage plan… ✓"],
    ["set_stage", {}, "updating a stage… ✓"],
    ["remove_stage", { id: "lint" }, "removing stage lint… ✓"],
    ["remove_stage", {}, "removing a stage… ✓"],
    ["add_edge", { edge: { from: "test", to: "exploit-verify", kind: "default" } }, "connecting test → exploit-verify… ✓"],
    ["add_edge", { from: "test", to: "exploit-verify" }, "connecting test → exploit-verify… ✓"],
    ["add_edge", { edge: { from: "test" } }, "connecting stages… ✓"],
    ["remove_edge", { from: "test", to: "review-primary" }, "disconnecting test → review-primary… ✓"],
    ["remove_edge", {}, "disconnecting stages… ✓"],
    ["set_trigger", { trigger: { event: "ticket_queued" } }, "set trigger… ✓"],
    ["rename_everything", { a: 1 }, "rename_everything… ✓"],
  ])("words an applied %s %j", (kind, params, line) => {
    expect(operationLine({ kind, params }, "applied")).toBe(line);
  });

  it("words a guard as proposed and not applied — never with the ✓", () => {
    const guard = { kind: "set_guard", params: { spend_cap_cents: 500, per: "run" } };

    expect(operationPhrase(guard)).toBe("set spend cap $5.00/run");
    expect(operationLine(guard, "proposed")).toBe("set spend cap $5.00/run… proposed, not applied");
    expect(operationLine(guard, "proposed")).not.toContain("✓");
    expect(operationPhrase({ kind: "set_guard", params: { spend_cap_cents: 1250 } })).toBe("set spend cap $12.50/run");
    // The live proposal's shape, as the engine's tool spells it.
    expect(
      operationPhrase({ kind: "set_guard", params: { guard: "spend_guard", params: { per_run_cap_cents: 500 } } }),
    ).toBe("set spend cap $5.00/run");
    expect(operationPhrase({ kind: "set_guard", params: { never_auto_merge: true } })).toBe(
      "set never auto-merge guard",
    );
    expect(operationPhrase({ kind: "set_guard", params: {} })).toBe("set guard");
    expect(operationPhrase({ kind: "set_guard" })).toBe("set guard");
  });

  it("gives a bounced operation no mark, and a line carrying the validator's message", () => {
    const op = { kind: "add_edge", params: { from: "test", to: "exploit_verify" } };

    expect(operationLine(op, "bounced")).toBe("connecting test → exploit_verify…");
    expect(bounceLine(op, SEEDED_BOUNCE)).toBe(`connecting test → exploit_verify — ${SEEDED_BOUNCE}`);
    expect(bounceLine(op, null)).toBe(`connecting test → exploit_verify — ${BOUNCE_UNEXPLAINED}`);
  });

  it("counts corrections in one quiet line", () => {
    expect(correctedWords(1)).toBe("1 operation corrected");
    expect(correctedWords(3)).toBe("3 operations corrected");
  });

  it("words a W7 warning, a read, a proposed dry run and a conflict as quiet lines", () => {
    expect(warningLine({ node: "exploit-verify", message: "No skill called poc-runner is registered." })).toBe(
      "⚠ exploit-verify: No skill called poc-runner is registered.",
    );
    expect(readLine("catalog")).toBe("read catalog");
    expect(readLine("dry_run_results")).toBe("read dry run results");
    expect(proposalLine("#489", "exercises the skip path")).toBe("proposed a dry run on #489 — exercises the skip path");
    expect(proposalLine("#489")).toBe("proposed a dry run on #489");
    expect(proposalLine("#489", "")).toBe("proposed a dry run on #489");
    expect(conflictLine("The canvas saved first; I re-read the draft.")).toBe(
      "draft changed elsewhere — The canvas saved first; I re-read the draft.",
    );
  });
});

describe("a stored reply's trace", () => {
  const [, first, , second, , third] = seededMessages();

  it("summarises the seeded first reply as six applied and one corrected", () => {
    expect(traceSummary(first!.toolTrace)).toBe("applied 6 operations · 1 corrected");
  });

  it("counts a proposed guard and a proposed dry run apart from what was applied", () => {
    expect(traceSummary(second!.toolTrace)).toBe("applied 1 operation · 1 proposed · 1 dry run proposed");
  });

  it("has no line for a reply that only read", () => {
    expect(traceSummary(third!.toolTrace)).toBeNull();
    expect(traceSummary({ operations: [], reads: [], dryRunProposals: [] })).toBeNull();
  });

  it("summarises corrections alone when nothing was applied", () => {
    const trace = { ...first!.toolTrace, operations: first!.toolTrace.operations.filter((op) => op.outcome === "bounced") };

    expect(traceSummary(trace)).toBe("1 corrected");
  });

  it("opens to the reads, then every operation in order with the validator's message on the bounce", () => {
    const lines = traceLines(first!.toolTrace);

    expect(lines.map((line) => line.text)).toEqual([
      "read catalog",
      "read skills",
      "read draft",
      "adding stage exploit-verify… ✓",
      "disconnecting test → review-primary… ✓",
      "disconnecting test → review-second… ✓",
      `corrected: connecting test → exploit_verify — ${SEEDED_BOUNCE}`,
      "connecting test → exploit-verify… ✓",
      "connecting exploit-verify → review-primary… ✓",
      "connecting exploit-verify → review-second… ✓",
    ]);
    expect(lines.filter((line) => line.tone === "bounced")).toHaveLength(1);
  });

  it("lists the proposed guard as proposed and the dry run last", () => {
    expect(traceLines(second!.toolTrace)).toEqual([
      { tone: "note", text: "read tickets" },
      { tone: "applied", text: "set trigger… ✓" },
      { tone: "proposed", text: "set spend cap $5.00/run… proposed, not applied" },
      { tone: "note", text: "proposed a dry run on #489 — security workflow × no-CVE issue — exercises the skip path" },
    ]);
  });
});

describe("the meta line and the head", () => {
  it("prints a priced exchange's cost, a real zero as $0.00, and nothing at all for an unpriced one", () => {
    expect(costAffix(12)).toBe("$0.12");
    expect(costAffix(0)).toBe("$0.00");
    expect(costAffix(1234)).toBe("$12.34");
    expect(costAffix(null)).toBeNull();
    expect(costAffix(undefined)).toBeNull();
  });

  it("prints a time of day in the zone and locale it is given", () => {
    expect(clockOf("2026-09-13T15:02:00.000Z", "UTC", "en-GB")).toBe("15:02");
    expect(clockOf("2026-09-13T15:02:00.000Z", "Asia/Tokyo", "en-GB")).toBe("00:02");
    expect(clockOf("not a date")).toBe("");
  });

  it("takes the model pill from the newest recorded resolution — never a constant", () => {
    const session = copilotSession({
      modelProvenance: [
        { seq: 4, alias: "coder-max", modelId: "claude-fable-5" },
        { seq: 6, alias: "planner", modelId: "gpt-next" },
        { seq: 2, alias: "coder-fast", modelId: "small-1" },
      ],
    });

    expect(modelPill(session)).toEqual({ modelId: "gpt-next", alias: "planner" });
    expect(modelPillTitle({ modelId: "gpt-next", alias: "planner" })).toBe("Routed through the alias planner");
  });

  it("has no pill before the first recorded exchange, or with no session", () => {
    expect(modelPill(copilotSession({ modelProvenance: [] }))).toBeNull();
    expect(modelPill(null)).toBeNull();
  });
});

describe("chatReducer", () => {
  const SCRIPT = exchangeScript(
    "add exploit verification",
    [
      { kind: "read", tool: "catalog" },
      { kind: "delta", text: "Drafted " },
      { kind: "delta", text: "**security-patch**." },
      operationEvent("add_stage", { node: { id: "exploit-verify" } }, "applied", {
        warnings: [{ code: "reference.unknown_skill", node: "exploit-verify", name: "poc", path: "/x", message: "No skill called poc." }],
      }),
      operationEvent("add_edge", { edge: { from: "test", to: "exploit_verify" } }, "bounced", { validatorMessage: SEEDED_BOUNCE }),
      operationEvent("add_edge", { edge: { from: "a", to: "nowhere" } }, "bounced", { validatorMessage: "No such stage." }),
      operationEvent("add_edge", { edge: { from: "test", to: "exploit-verify" } }),
      operationEvent("set_guard", { spend_cap_cents: 500, per: "run" }, "proposed"),
      { kind: "conflict", message: "The canvas saved first.", etag: "etag-5" },
      { kind: "dry_run_proposal", ticket: "#489", reason: "closest open issue" },
      { kind: "delta", text: " Two questions:" },
      { kind: "question", index: 0, prompt: "What triggers it?", options: ["label:security", "CVE pattern in title"] },
      { kind: "question", index: 1, prompt: "May it read the Advisory DB?", options: ["Yes", "No"] },
    ],
    { costCents: 12 },
  );

  it("shows the message as pending the moment it is sent", () => {
    const state = reduce([{ type: "start", origin: { kind: "message", text: "hello" } }]);

    expect(state.live).toMatchObject({ origin: { kind: "message", text: "hello" }, user: null, replyId: null, segments: [] });
    expect(state.live?.costCents).toBeUndefined();
  });

  it("keeps a reply's pieces in the order the stream delivered them", () => {
    const state = reduce(exchanged(SCRIPT.slice(0, -1)).slice(0, -1));

    expect(state.live?.user?.id).toBe(LIVE_USER_ID);
    expect(state.live?.replyId).toBe(LIVE_REPLY_ID);
    expect(state.live?.segments.map((segment) => segment.kind)).toEqual([
      "note",
      "text",
      "operation",
      "bounced",
      "operation",
      "operation",
      "note",
      "note",
      "text",
    ]);
    expect(state.live?.segments[0]).toEqual({ kind: "note", text: "read catalog…" });
    expect(state.live?.segments[1]).toEqual({ kind: "text", text: "Drafted **security-patch**." });
    expect(state.live?.costCents).toBe(12);
  });

  it("counts consecutive bounces together, and carries each operation's warnings", () => {
    const { live } = reduce(exchanged(SCRIPT.slice(0, -1)).slice(0, -1));
    const bounced = live?.segments[3];
    const added = live?.segments[2];

    expect(bounced).toMatchObject({ kind: "bounced", bounces: [{ validatorMessage: SEEDED_BOUNCE }, { validatorMessage: "No such stage." }] });
    expect(added).toMatchObject({ kind: "operation", outcome: "applied", warnings: [{ node: "exploit-verify" }] });
    expect(live?.segments[5]).toMatchObject({ kind: "operation", outcome: "proposed" });
  });

  it("collects the questions by position as they are asked", () => {
    const { live } = reduce(exchanged(SCRIPT.slice(0, -1)).slice(0, -1));

    expect(live?.choices).toEqual([
      { prompt: "What triggers it?", options: ["label:security", "CVE pattern in title"], selected: null, answeredAt: null },
      { prompt: "May it read the Advisory DB?", options: ["Yes", "No"], selected: null, answeredAt: null },
    ]);
  });

  it("settles on done: both messages recorded, the pieces kept, the draft taken, nothing arriving", () => {
    const state = reduce(exchanged(SCRIPT));

    expect(state.live).toBeNull();
    expect(Object.keys(state.messages).sort()).toEqual([LIVE_USER_ID, LIVE_REPLY_ID].sort());
    expect(state.records[LIVE_REPLY_ID]?.segments).toHaveLength(9);
    expect(state.records[LIVE_REPLY_ID]?.failure).toBeNull();
    expect(state.draft).toEqual(copilotConversation().draft);
    expect(state.refusal).toBeNull();
  });

  it("treats the stream's close after done as nothing more", () => {
    const done = reduce(exchanged(SCRIPT).slice(0, -1));

    expect(chatReducer(done, { type: "ended" })).toBe(done);
  });

  it("keeps the error a reply ended on beside it — the service's code and words", () => {
    const failed = exchangeScript("hello", [{ kind: "delta", text: "Half a" }], {
      error: { code: "engine_unavailable", message: "The engine stopped answering." },
    });
    const state = reduce(exchanged(failed));

    expect(state.records[LIVE_REPLY_ID]?.failure).toEqual({
      code: "engine_unavailable",
      message: "The engine stopped answering.",
    });
    expect(state.messages[LIVE_REPLY_ID]?.status).toBe("interrupted");
  });

  it("keeps a closed-mid-reply ending under its own code", () => {
    const closed = exchangeScript("hello", [operationEvent("add_stage", { node: { id: "a" } })], {
      error: { code: SESSION_CLOSED_CODE, message: "The conversation was promoted while the reply was arriving." },
    });

    expect(reduce(exchanged(closed)).records[LIVE_REPLY_ID]?.failure?.code).toBe(SESSION_CLOSED_CODE);
  });

  it("settles a stream that closed with no done as a reply that did not finish, keeping what arrived", () => {
    const cut = SCRIPT.slice(0, 4);
    const state = reduce(exchanged(cut));
    const reply = state.messages[LIVE_REPLY_ID];

    expect(state.live).toBeNull();
    expect(reply).toMatchObject({ role: "copilot", status: "interrupted", body: "Drafted **security-patch**.", seq: 8 });
    expect(reply?.costCents).toBeNull();
    expect(state.records[LIVE_REPLY_ID]?.failure).toEqual({ code: CONNECTION_LOST_CODE, message: CONNECTION_LOST });
    expect(state.draft).toBeNull();
  });

  it("prefers the service's error over its own when the stream then closes without done", () => {
    const events: CopilotStreamEvent[] = [SCRIPT[0]!, { kind: "error", code: "gateway_unavailable", message: "No gateway." }];

    expect(reduce(exchanged(events)).records[LIVE_REPLY_ID]?.failure?.code).toBe("gateway_unavailable");
  });

  it("treats a stream that closed before the service recorded anything as a send that did not happen", () => {
    const state = reduce(exchanged([]));

    expect(state.live).toBeNull();
    expect(state.messages).toEqual({});
    expect(state.refusal).toBe(NOTHING_SENT);
  });

  it("records a refusal, drops the pending message, and clears it on the next send or on dismiss", () => {
    const refused = reduce([
      { type: "start", origin: { kind: "message", text: "hello" } },
      { type: "refused", message: "That conversation is closed." },
    ]);

    expect(refused.live).toBeNull();
    expect(refused.refusal).toBe("That conversation is closed.");
    expect(chatReducer(refused, { type: "dismiss" }).refusal).toBeNull();
    expect(chatReducer(refused, { type: "start", origin: { kind: "message", text: "again" } }).refusal).toBeNull();
  });

  it("marks a chip answered once the service accepts the exchange it started — not before", () => {
    const origin = { kind: "answer", messageId: "reply-1", question: 1, selected: "Yes" } as const;
    const started = reduce([{ type: "start", origin }]);

    expect(started.answers).toEqual({});

    const accepted = chatReducer(started, { type: "event", event: SCRIPT[0]! });

    expect(accepted.answers).toEqual({ "reply-1": { 1: "Yes" } });

    const second = reduce(
      [{ type: "event", event: SCRIPT.at(-1)! }, { type: "start", origin: { ...origin, question: 0, selected: "label:security" } }, { type: "event", event: SCRIPT[0]! }],
      accepted,
    );

    expect(second.answers).toEqual({ "reply-1": { 0: "label:security", 1: "Yes" } });
  });

  it("ignores events and a close when nothing is arriving", () => {
    expect(chatReducer(INITIAL_CHAT, { type: "event", event: { kind: "delta", text: "stray" } })).toBe(INITIAL_CHAT);
    expect(chatReducer(INITIAL_CHAT, { type: "ended" })).toBe(INITIAL_CHAT);
  });

  it("remembers a conversation started here, and forgets everything on leaving a closed one", () => {
    const session = copilotSession({ id: "new-session", lastSeq: 0, modelProvenance: [] });
    const started = reduce([...exchanged(SCRIPT), { type: "session", session }]);

    expect(started.session).toBe(session);
    expect(chatReducer(started, { type: "detach", sessionId: SESSION_ID })).toEqual({
      ...INITIAL_CHAT,
      detachedFrom: SESSION_ID,
    });
  });

  it("joins a reply's text for the record", () => {
    expect(segmentsText(reduce(exchanged(SCRIPT)).records[LIVE_REPLY_ID]!.segments)).toBe(
      "Drafted **security-patch**. Two questions:",
    );
  });
});

describe("the conversation the card draws", () => {
  const SCRIPT = exchangeScript("one more", [{ kind: "delta", text: "Done." }]);

  it("is the server's, with what streamed here added in order", () => {
    const state = reduce(exchanged(SCRIPT));
    const messages = chatMessages(seededConversation(), state);

    expect(messages.map((entry) => entry.message.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(messages.at(-1)?.record?.segments).toEqual([{ kind: "text", text: "Done." }]);
    expect(messages[1]?.record).toBeNull();
  });

  it("lets the server's later reading of a message win, and keeps what was watched beside it", () => {
    const state = reduce(exchanged(SCRIPT));
    const reread = copilotMessage({ id: LIVE_REPLY_ID, seq: 8, role: "copilot", body: "Done.", costCents: 9 });
    const messages = chatMessages(seededConversation({ messages: [...seededMessages(), reread] }), state);
    const last = messages.at(-1);

    expect(messages).toHaveLength(8);
    expect(last?.message.costCents).toBe(9);
    expect(last?.record?.segments).toEqual([{ kind: "text", text: "Done." }]);
  });

  it("sorts by seq whatever order the messages arrived in", () => {
    const shuffled = seededConversation({ messages: [...seededMessages()].reverse() });

    expect(chatMessages(shuffled, INITIAL_CHAT).map((entry) => entry.message.id)).toEqual(SEEDED_IDS);
  });

  it("overlays an answer given here on a question the server still shows open — and never over a recorded one", () => {
    const open = seededMessages().map((message) =>
      message.id === SEEDED_IDS[1]
        ? { ...message, choices: message.choices!.map((choice, at) => (at === 1 ? { ...choice, selected: null } : choice)) }
        : message,
    );
    const state: ChatState = { ...INITIAL_CHAT, answers: { [SEEDED_IDS[1]!]: { 0: "CVE pattern in title", 1: "No" } } };
    const [, reply] = chatMessages(seededConversation({ messages: open }), state);

    expect(reply?.message.choices?.map((choice) => choice.selected)).toEqual(["label:security", "No"]);
  });

  it("draws nothing of a closed conversation the reader has left, and the new one once it is read", () => {
    const closed = closedConversation("discarded");
    const state: ChatState = { ...INITIAL_CHAT, detachedFrom: closed.session.id };

    expect(baseConversation(closed, state)).toBeNull();
    expect(chatMessages(closed, state)).toEqual([]);
    expect(chatSession(closed, state)).toBeNull();

    const fresh = copilotConversation({ session: copilotSession({ id: "new-session" }) });

    expect(baseConversation(fresh, state)).toBe(fresh);
    expect(chatSession(fresh, state)?.id).toBe("new-session");
  });

  it("is in the server's session, else the one started here, else none", () => {
    const local = copilotSession({ id: "local" });

    expect(chatSession(copilotConversation(), { ...INITIAL_CHAT, session: local })?.id).toBe(SESSION_ID);
    expect(chatSession(null, { ...INITIAL_CHAT, session: local })?.id).toBe("local");
    expect(chatSession(null, INITIAL_CHAT)).toBeNull();
  });
});

describe("a reply that did not finish", () => {
  const user = { message: copilotMessage({ body: "do it" }), record: null };
  const reply = (overrides = {}) => ({
    message: copilotMessage({ id: "r", seq: 2, role: "copilot", body: "", ...overrides }),
    record: null,
  });

  it("is what the card watched it end on", () => {
    const failure = { code: "engine_unavailable", message: "Down." };

    expect(replyFailure({ ...reply(), record: { segments: [], failure } })).toBe(failure);
  });

  it("is the stored interruption, in this card's words, when nothing was watched", () => {
    expect(replyFailure(reply({ status: "interrupted" }))).toEqual({ code: INTERRUPTED_CODE, message: INTERRUPTED_REPLY });
  });

  it("is nothing for a complete reply, and never for the person's message", () => {
    expect(replyFailure(reply())).toBeNull();
    expect(replyFailure({ message: copilotMessage({ status: "interrupted" }), record: null })).toBeNull();
  });

  it("retries with what the person said before it", () => {
    const messages = [user, reply(), { message: copilotMessage({ id: "u2", seq: 3, body: "and this" }), record: null }, reply({ id: "r2", seq: 4 })];

    expect(retryText(messages, 3)).toBe("and this");
    expect(retryText(messages, 1)).toBe("do it");
    expect(retryText(messages, 0)).toBeNull();
    expect(retryText([{ message: copilotMessage({ body: "  " }), record: null }, reply()], 1)).toBeNull();
  });

  it("offers Retry only on the newest reply, when a message could be sent, and never after a close", () => {
    const failure = { code: "engine_unavailable", message: "Down." };
    const gate = { kind: "streaming", message: STREAMING_REASON } as const;

    expect(mayRetry(failure, true, null, "do it")).toBe(true);
    expect(mayRetry(failure, false, null, "do it")).toBe(false);
    expect(mayRetry(failure, true, gate, "do it")).toBe(false);
    expect(mayRetry(failure, true, null, null)).toBe(false);
    expect(mayRetry({ code: SESSION_CLOSED_CODE, message: "Closed." }, true, null, "do it")).toBe(false);
  });
});

describe("composerGate", () => {
  const FREE: GateFacts = {
    status: "active",
    mayAdminister: true,
    streaming: false,
    pending: false,
    readiness: copilotReadiness(),
    closedNote: "Closed.",
  };

  it("lets an owner send in an open conversation, and before there is one", () => {
    expect(composerGate(FREE)).toBeNull();
    expect(composerGate({ ...FREE, status: null })).toBeNull();
  });

  it.each([
    ["a reply arriving", { streaming: true }, "streaming", STREAMING_REASON],
    ["a reply still arriving from elsewhere", { pending: true }, "pending", PENDING_REASON],
    ["a dry run in progress", { readiness: DRY_RUNNING }, "dry_run", DRY_RUN_REASON],
    ["no gateway", { readiness: NO_GATEWAY }, "gateway", GATEWAY_REASON],
    ["no route", { readiness: UNROUTED }, "unrouted", UNROUTED_REASON],
    ["a role that may not write", { mayAdminister: false }, "role", ROLE_REASON],
    ["a promoted conversation", { status: "promoted" as const }, "closed", "Closed."],
    ["a discarded conversation", { status: "discarded" as const }, "closed", "Closed."],
  ])("stops for %s, with its reason", (_what, facts, kind, message) => {
    expect(composerGate({ ...FREE, ...facts })).toEqual({ kind, message });
  });

  it("says each reason in the page's words", () => {
    expect(STREAMING_REASON).toBe("The copilot is replying — you can send again when the reply finishes.");
    expect(DRY_RUN_REASON).toMatch(/^A dry run is in progress — /);
    expect(GATEWAY_REASON).toBe("The copilot cannot reply: this deployment has no invocation gateway.");
    expect(UNROUTED_REASON).toBe("The copilot cannot reply: no model is routed for it yet.");
    expect(ROLE_REASON).toBe(ROLE_TRANSCRIPT_NOTE);
  });

  it("decides in order: closed, role, streaming, pending, dry run, gateway, route", () => {
    const everything: GateFacts = {
      status: "discarded",
      mayAdminister: false,
      streaming: true,
      pending: true,
      readiness: { ...NO_GATEWAY, dryRun: DRY_RUNNING.dryRun },
      closedNote: "Closed.",
    };
    const order: string[] = [];
    const lifts: Partial<GateFacts>[] = [
      {},
      { status: "active" },
      { mayAdminister: true },
      { streaming: false },
      { pending: false },
      { readiness: NO_GATEWAY },
      { readiness: UNROUTED },
      { readiness: copilotReadiness() },
    ];

    let facts = everything;
    for (const lift of lifts) {
      facts = { ...facts, ...lift };
      order.push(composerGate(facts)?.kind ?? "free");
    }

    expect(order).toEqual(["closed", "role", "streaming", "pending", "dry_run", "gateway", "unrouted", "free"]);
  });

  it("gates nothing on readiness that could not be read", () => {
    expect(composerGate({ ...FREE, readiness: null })).toBeNull();
  });

  it("removes the composer for a closed conversation and a reader's role, and only switches it off otherwise", () => {
    expect(composerAbsent({ kind: "closed", message: "" })).toBe(true);
    expect(composerAbsent({ kind: "role", message: "" })).toBe(true);
    expect(composerAbsent({ kind: "streaming", message: "" })).toBe(false);
    expect(composerAbsent({ kind: "gateway", message: "" })).toBe(false);
    expect(composerAbsent(null)).toBe(false);
  });
});

describe("sendsOnKey", () => {
  const ENTER = { key: "Enter", shiftKey: false, isComposing: false };

  it("sends on a bare Enter", () => {
    expect(sendsOnKey(ENTER)).toBe(true);
  });

  it("writes a line on Shift+Enter, and leaves Enter to an input method that is composing", () => {
    expect(sendsOnKey({ ...ENTER, shiftKey: true })).toBe(false);
    expect(sendsOnKey({ ...ENTER, isComposing: true })).toBe(false);
    expect(sendsOnKey({ ...ENTER, keyCode: 229 })).toBe(false);
    expect(sendsOnKey({ ...ENTER, key: "a" })).toBe(false);
  });
});

describe("prerequisiteNotice", () => {
  it("is nothing when the copilot can reply, or readiness could not be read", () => {
    expect(prerequisiteNotice(copilotReadiness())).toBeNull();
    expect(prerequisiteNotice(DRY_RUNNING)).toBeNull();
    expect(prerequisiteNotice(null)).toBeNull();
  });

  it("names the missing gateway first, and links to Providers", () => {
    expect(prerequisiteNotice(NO_GATEWAY)).toMatchObject({
      kind: "gateway",
      title: GATEWAY_NOTICE_TITLE,
      linkLabel: "See Providers",
      href: PROVIDERS_PATH,
    });
  });

  it("says the missing route in the service's words, and links to Model routing", () => {
    const notice = prerequisiteNotice(UNROUTED);

    expect(notice).toMatchObject({
      kind: "unrouted",
      title: UNROUTED_NOTICE_TITLE,
      linkLabel: "Open Model routing",
      href: `${MODELS_PATH}#${ROUTING_MATRIX_HASH}`,
    });
    expect(notice?.text).toBe(`T${UNROUTED_REASON_TEXT.slice(1)} ${UNROUTED_NOTICE_STILL}`);
  });

  it("has its own words for a route the service did not explain", () => {
    const silent = copilotReadiness({ route: { ...UNROUTED.route, reason: null } });

    expect(prerequisiteNotice(silent)?.text).toBe(`${UNROUTED_NOTICE_FALLBACK} ${UNROUTED_NOTICE_STILL}`);
  });
});

describe("the chips", () => {
  it("numbers the questions of a reply that asked more than one", () => {
    expect(ordinalOf(0, 2)).toBe("①");
    expect(ordinalOf(1, 2)).toBe("②");
    expect(ordinalOf(9, 11)).toBe("⑩");
    expect(ordinalOf(10, 11)).toBe("(11)");
    expect(ordinalOf(0, 1)).toBe("");
  });

  it("finds the newest reply with a question still open", () => {
    const entries = chatMessages(seededConversation(), INITIAL_CHAT);

    expect(answerableId(entries)).toBeNull();

    const open = (id: string) => ({
      message: copilotMessage({
        id,
        role: "copilot",
        choices: [{ prompt: "Which?", options: ["a", "b"], selected: null, answeredAt: null }],
      }),
      record: null,
    });

    expect(answerableId([open("old"), ...entries, open("new"), entries[0]!])).toBe("new");
  });

  it("makes a row live only when it is open, on that reply, and a message could be sent", () => {
    const open = { prompt: "Which?", options: ["a", "b"], selected: null, answeredAt: null };
    const gate = { kind: "dry_run", message: DRY_RUN_REASON } as const;

    expect(chipsLive(open, true, null)).toBe(true);
    expect(chipsLive(open, false, null)).toBe(false);
    expect(chipsLive(open, true, gate)).toBe(false);
    expect(chipsLive({ ...open, selected: "a" }, true, null)).toBe(false);
  });
});

describe("history", () => {
  it("starts on the newest page", () => {
    expect(HISTORY_PAGE).toBe(30);
    expect(initialHidden(6)).toBe(0);
    expect(initialHidden(30)).toBe(0);
    expect(initialHidden(31)).toBe(1);
    expect(initialHidden(95)).toBe(65);
  });

  it("shows one more page at a time, down to none hidden", () => {
    expect(revealEarlier(65)).toBe(35);
    expect(revealEarlier(35)).toBe(5);
    expect(revealEarlier(5)).toBe(0);
    expect(revealEarlier(0)).toBe(0);
  });

  it("slices from the hidden count, and hides nothing of a conversation shorter than it", () => {
    expect(shownMessages([1, 2, 3, 4], 1)).toEqual([2, 3, 4]);
    expect(shownMessages([1, 2, 3, 4], 0)).toEqual([1, 2, 3, 4]);
    expect(shownMessages([1, 2], 5)).toEqual([1, 2]);
    expect(shownMessages([], 0)).toEqual([]);
  });
});

describe("the scroller", () => {
  it("is at the bottom within the threshold of the end, and when there is nothing to scroll", () => {
    expect(isAtBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollTop: 552, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollTop: 551, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
    expect(isAtBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(true);
    expect(isAtBottom({ scrollTop: 590, scrollHeight: 1000, clientHeight: 400 }, 0)).toBe(false);
  });

  it("anchors on the first message with any part in view", () => {
    const placed = [
      { id: "a", top: 0, bottom: 100 },
      { id: "b", top: 100, bottom: 260 },
      { id: "c", top: 260, bottom: 400 },
    ];

    expect(firstVisible(placed, 0)?.id).toBe("a");
    expect(firstVisible(placed, 99)?.id).toBe("a");
    expect(firstVisible(placed, 100)?.id).toBe("b");
    expect(firstVisible(placed, 9999)?.id).toBe("c");
    expect(firstVisible([], 0)).toBeNull();
  });

  it("puts the anchor back where it was after earlier messages are added above it", () => {
    // The anchor was 100 from the content's top, 60 below the viewport's; 900 of history arrives above.
    expect(anchoredScrollTop(40, 100, 1000)).toBe(940);
    expect(anchoredScrollTop(40, 100, 100)).toBe(40);
    expect(anchoredScrollTop(10, 500, 100)).toBe(0);
  });

  it("offers New messages only to a reader who left the bottom before something arrived", () => {
    expect(hasUnseen(true, "6", "6+1:4:0")).toBe(false);
    expect(hasUnseen(false, "6", "6")).toBe(false);
    expect(hasUnseen(false, "6", "6+1:4:0")).toBe(true);
  });

  it("changes the content's version with every message, piece, character and question", () => {
    const live = reduce([{ type: "start", origin: { kind: "message", text: "x" } }]).live!;
    const versions = [
      contentVersion(6, null),
      contentVersion(7, null),
      contentVersion(6, live),
      contentVersion(6, { ...live, segments: [{ kind: "text", text: "a" }] }),
      contentVersion(6, { ...live, segments: [{ kind: "text", text: "ab" }] }),
      contentVersion(6, { ...live, segments: [{ kind: "text", text: "ab" }, { kind: "note", text: "n" }] }),
      contentVersion(6, { ...live, choices: [{ prompt: "?", options: [], selected: null, answeredAt: null }] }),
    ];

    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe("announcement", () => {
  it("says a reply once, flattened to a line", () => {
    expect(announcement("Drafted.\n\nTwo  questions:", null)).toBe("Copilot replied: Drafted. Two questions:");
  });

  it("cuts a long reply at a readable length", () => {
    const said = announcement("word ".repeat(200), null);

    expect(said.length).toBeLessThanOrEqual("Copilot replied: ".length + ANNOUNCE_LIMIT + 1);
    expect(said.endsWith("…")).toBe(true);
  });

  it("says a reply with no text plainly", () => {
    expect(announcement("  ", null)).toBe("Copilot replied.");
  });

  it("says a failure, and a close, each under its own heading with the service's words", () => {
    expect(announcement("half", { code: "engine_unavailable", message: "Down." })).toBe(`${REPLY_FAILED_TITLE}. Down.`);
    // A close's sentence is already the reply's last words: it is not read out twice.
    expect(announcement("half", { code: SESSION_CLOSED_CODE, message: "Promoted." })).toBe(
      `${CLOSED_MID_REPLY_TITLE}. ${CLOSED_MID_REPLY_NOTE}`,
    );
  });
});
