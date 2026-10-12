/**
 * Every decision the conversation card makes, as functions with inputs and outputs (CE.2,
 * [#566](https://github.com/NobuData/ouroboros/issues/566)) — mockup 20's `c-5` card.
 *
 * The card is where the page earns or loses trust, and most of that happens while a reply is
 * arriving. So almost everything it does is a judgement that has to be right in every state:
 * what a stream's bytes mean, what an operation is called, when a chip may be pressed, why the
 * composer cannot send, where the scroller should be. Each is here, so its acceptance criterion
 * is a unit test on a small value rather than an assertion about a rendered page.
 *
 * **Framework-free and pure**, the way `copilot-view.ts` is: nothing here imports React, `next/*`
 * or the server-only client — the API types are type-only imports, erased before the card's
 * Client Component could pull them in.
 *
 * ### The order of things is the stream's
 *
 * A reply is built from events in the order the model produced them: text, then *adding stage
 * exploit-verify… ✓*, then more text. {@link chatReducer} keeps that order as a list of
 * {@link Segment}s and the card draws the list, so cause and effect read the way they happened.
 * A reply read back from the service has lost that interleaving — its text is one string and its
 * operations a trace — so it is drawn as the text over a one-line summary that opens to the list.
 *
 * ### Nothing is rendered as markup
 *
 * {@link parseReply} reads a small, closed subset — `**bold**`, `` `code` ``, fenced blocks,
 * paragraphs and line breaks — into plain values the card draws as elements. There is no HTML
 * path: a reply spelling a tag is a reply whose text has angle brackets in it.
 */

import type {
  CopilotChoice,
  CopilotConversation,
  CopilotDraft,
  CopilotMessage,
  CopilotReadiness,
  CopilotSession,
  CopilotStreamEvent,
  CopilotToolTrace,
  CopilotWarning,
} from "@/app/api/workflow-copilot";
import { moneyOfCents } from "@/app/format";
import { MODELS_PATH, PROVIDERS_PATH, ROUTING_MATRIX_HASH } from "@/app/paths";

import { ROLE_TRANSCRIPT_NOTE } from "./copilot-view";

/* ------------------------------------------------------------------ copy */

/** The composer's placeholder, verbatim from the issue. */
export const COMPOSER_PLACEHOLDER = "Refine the workflow — or ask for a dry run…";

/** The composer's accessible name. */
export const COMPOSER_LABEL = "Message the copilot";

/** The longest message the service takes — its `MESSAGE_MAX_LENGTH`. */
export const MESSAGE_MAX_LENGTH = 20_000;

/** Why **Send** cannot act on an empty box — the button's tooltip; the box itself is live. */
export const NOTHING_TO_SEND = "Write a message to send.";

/** The send button. */
export const SEND_LABEL = "Send";

/** The caption under the card, verbatim from mockup 20. */
export const CONVERSATION_CAPTION =
  "Copilot edits compile to the same graph as the canvas and the code editor — nothing is a special case.";

/** The scroller's accessible name. */
export const MESSAGES_LABEL = "Messages";

/** The control that prepends the previous page of messages. */
export const SHOW_EARLIER_LABEL = "Show earlier messages";

/** The control that returns a reader who scrolled up to the newest message. */
export const NEW_MESSAGES_LABEL = "New messages ↓";

/** The retry button under a failed reply. */
export const RETRY_LABEL = "Retry";

/** The button that leaves a closed conversation for a new one. */
export const NEW_CONVERSATION_LABEL = "Start a new conversation";

/** The bubble's stand-in while a reply has not said anything yet. */
export const THINKING = "Thinking…";

/** What a pending message says under it until the service has recorded it. */
export const SENDING = "Sending…";

/**
 * The head's draft tag — `draft: security-patch`.
 *
 * @param name The session's draft name, or the workflow's slug before there is a session.
 * @returns The tag's text.
 */
export function draftTag(name: string): string {
  return `draft: ${name}`;
}

/* ------------------------------------------------------------------ the empty state */

/** The invitation's title. */
export const EMPTY_TITLE = "Describe the workflow you want";

/** The invitation's note. */
export const EMPTY_NOTE =
  "Say what it should do in your own words. The copilot drafts the stages, asks instead of guessing, and changes only the draft — nothing runs until you promote it.";

/** The heading over the example briefs. */
export const EXAMPLES_LABEL = "Example briefs";

/** What the examples say they do. */
export const EXAMPLES_NOTE = "Pick one to put it in the box below — it is not sent until you send it.";

/** The example briefs. Pressing one fills the composer; none is sent. */
export const EXAMPLE_BRIEFS: readonly string[] = [
  "Create a workflow for security patches: always get a second model's review, never auto-merge, and prove the CVE is actually fixed.",
  "Build a docs-only workflow: skip the build and test stages, and open the pull request as a draft.",
  "Start from the default loop, and require a person's approval before anything merges.",
];

/** The empty state's title for a reader who may not start a conversation. */
export const EMPTY_READER_TITLE = "No conversation yet";

/** …and its note. */
export const EMPTY_READER_NOTE =
  "Nobody has described this workflow to the copilot yet. A workspace owner or admin can start the conversation; it will be readable here.";

/* ------------------------------------------------------------------ the stream's framing */

/** One server-sent event, as framed: its `event:` name and its `data:` lines joined. */
export interface SseFrame {
  /** The `event:` field, or `message` when the frame names none. */
  readonly event: string;
  /** The `data:` lines, joined by a line feed. */
  readonly data: string;
}

/** A parser fed the stream's text a chunk at a time. */
export interface SseParser {
  /**
   * Take the next chunk.
   *
   * @param chunk Text as it arrived — a frame may be split across chunks anywhere.
   * @returns Every frame the chunk completed, in order.
   */
  push(chunk: string): SseFrame[];
  /**
   * The stream has ended.
   *
   * @returns The frame left unterminated, if it carried data — a server that closed without the
   *   final blank line still sent it.
   */
  flush(): SseFrame[];
}

/**
 * Read one complete frame's lines.
 *
 * @param block The frame's text, without its terminating blank line.
 * @returns The frame, or `null` for one that carried no data (a comment, a keep-alive).
 */
function frameOf(block: string): SseFrame | null {
  let event = "message";
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // The protocol drops one space after the colon, and only one.
    const raw = colon === -1 ? "" : line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;

    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }

  return data.length === 0 ? null : { event, data: data.join("\n") };
}

/**
 * Make a parser for one stream.
 *
 * Frames end at a blank line; line endings may be `\n`, `\r\n` or `\r`, and a `\r\n` may itself
 * be split across two chunks — so a trailing `\r` is held until the next chunk says what it was.
 *
 * @returns The parser.
 */
export function createSseParser(): SseParser {
  let buffer = "";

  /** Cut every complete frame off the front of the buffer. */
  function drain(): SseFrame[] {
    const frames: SseFrame[] = [];

    for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
      const frame = frameOf(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (frame !== null) frames.push(frame);
    }

    return frames;
  }

  return {
    push(chunk) {
      const text = buffer + chunk;
      // A lone trailing `\r` may be half of a `\r\n`: leave it for the next chunk.
      const held = text.endsWith("\r") ? "\r" : "";
      const settled = held === "" ? text : text.slice(0, -1);

      buffer = settled.replace(/\r\n?/g, "\n");
      const frames = drain();
      buffer += held;

      return frames;
    },

    flush() {
      buffer = buffer.replace(/\r\n?/g, "\n");
      const frames = drain();
      const last = buffer.trim() === "" ? null : frameOf(buffer);
      buffer = "";

      return last === null ? frames : [...frames, last];
    },
  };
}

/** The event kinds the service names. */
export const STREAM_EVENT_KINDS = [
  "accepted",
  "delta",
  "operation",
  "read",
  "question",
  "dry_run_proposal",
  "conflict",
  "usage",
  "error",
  "done",
] as const;

/**
 * Read one frame as an event of the exchange.
 *
 * @param frame The frame.
 * @returns The event, or `null` for a frame whose data is not a JSON object naming a known kind
 *   — a kind added later is skipped rather than drawn wrongly.
 */
export function readStreamEvent(frame: SseFrame): CopilotStreamEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const kind = (parsed as { kind?: unknown }).kind;

  return typeof kind === "string" && (STREAM_EVENT_KINDS as readonly string[]).includes(kind)
    ? (parsed as CopilotStreamEvent)
    : null;
}

/* ------------------------------------------------------------------ a reply's text */

/** A run of a line: plain, bold, or inline code. */
export interface Inline {
  readonly kind: "text" | "bold" | "code";
  readonly text: string;
}

/** A block of a reply: a paragraph of lines, or a fenced block of code. */
export type Block =
  | { readonly kind: "paragraph"; readonly lines: readonly (readonly Inline[])[] }
  | { readonly kind: "code"; readonly text: string };

/** The fence that opens and closes a block of code. */
const FENCE = "```";

/**
 * Read one line's inline runs.
 *
 * A marker with no partner on the same line is text: `2 ** 3` and a lone backtick stay as
 * written, which is also what a reply still arriving looks like mid-word.
 *
 * @param line The line.
 * @returns Its runs, adjacent text merged.
 */
export function parseInline(line: string): Inline[] {
  const runs: Inline[] = [];
  let text = "";

  /** Close the pending run of text. */
  const flush = (): void => {
    if (text !== "") runs.push({ kind: "text", text });
    text = "";
  };

  for (let at = 0; at < line.length; ) {
    if (line[at] === "`") {
      const close = line.indexOf("`", at + 1);
      if (close > at + 1) {
        flush();
        runs.push({ kind: "code", text: line.slice(at + 1, close) });
        at = close + 1;
        continue;
      }
    } else if (line.startsWith("**", at)) {
      const close = line.indexOf("**", at + 2);
      if (close > at + 2) {
        flush();
        runs.push({ kind: "bold", text: line.slice(at + 2, close) });
        at = close + 2;
        continue;
      }
    }

    text += line[at];
    at += 1;
  }
  flush();

  return runs;
}

/**
 * Read a reply's text into blocks.
 *
 * The subset is closed: paragraphs (a blank line apart), line breaks inside them, `**bold**`,
 * `` `code` `` and fenced blocks. Everything else — headings, links, HTML — is text, drawn as
 * written. A fence still open at the end is a block to the end, which is how one looks while it
 * streams.
 *
 * @param text The reply's text.
 * @returns The blocks, in order. Empty for text that is only whitespace.
 */
export function parseReply(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] = [];
  let code: string[] | null = null;

  /** Close the pending paragraph. */
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (code !== null) {
      if (line.trimStart().startsWith(FENCE)) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(line);
      }
    } else if (line.trimStart().startsWith(FENCE)) {
      flush();
      code = [];
    } else if (line.trim() === "") {
      flush();
    } else {
      paragraph.push(parseInline(line));
    }
  }

  if (code !== null) blocks.push({ kind: "code", text: code.join("\n") });
  flush();

  return blocks;
}

/* ------------------------------------------------------------------ operation markers */

/** An operation as a reply proposed it. */
export interface OperationShape {
  readonly kind: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** What became of an operation. */
export type OperationOutcome = "applied" | "bounced" | "proposed";

/**
 * A value as a short string, or `null` when it is not one.
 *
 * @param value Anything.
 * @returns The string, for a non-empty string.
 */
function word(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * A value as an object to read keys of.
 *
 * @param value Anything.
 * @returns The object, or an empty one.
 */
function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * The stage an operation names — spelled `node.id` by the service and `id` by an older trace.
 *
 * @param params The operation's params.
 * @returns The stage's id, or `null`.
 */
function stageOf(params: Readonly<Record<string, unknown>>): string | null {
  return word(record(params.node).id) ?? word(params.id);
}

/**
 * The edge an operation names — `edge.from`/`edge.to`, or `from`/`to` beside the kind.
 *
 * @param params The operation's params.
 * @returns `test → exploit-verify`, or `null` when either end is missing.
 */
function edgeOf(params: Readonly<Record<string, unknown>>): string | null {
  const edge = record(params.edge);
  const from = word(edge.from) ?? word(params.from);
  const to = word(edge.to) ?? word(params.to);

  return from === null || to === null ? null : `${from} → ${to}`;
}

/**
 * What a guard is called — *spend cap $5.00/run*.
 *
 * @param params The `set_guard` params.
 * @returns The guard's words.
 */
function guardOf(params: Readonly<Record<string, unknown>>): string {
  if (typeof params.spend_cap_cents === "number") {
    return `spend cap ${moneyOfCents(params.spend_cap_cents)}/${word(params.per) ?? "run"}`;
  }
  // The live proposal spells it the engine's way: `{guard: "spend_guard", params: {per_run_cap_cents}}`.
  const inner = params.params;
  if (params.guard === "spend_guard" && typeof inner === "object" && inner !== null) {
    const cap = (inner as Readonly<Record<string, unknown>>).per_run_cap_cents;
    if (typeof cap === "number") return `spend cap ${moneyOfCents(cap)}/run`;
  }
  if (params.never_auto_merge === true) return "never auto-merge guard";

  return "guard";
}

/**
 * What an operation does, in the card's quiet words — without its outcome.
 *
 * @param op The operation.
 * @returns *adding stage exploit-verify*, *set trigger*, *set spend cap $5.00/run*. A kind this
 *   table does not know is named as the service spells it.
 */
export function operationPhrase(op: OperationShape): string {
  const params = op.params ?? {};
  const stage = stageOf(params);
  const edge = edgeOf(params);

  switch (op.kind) {
    case "add_stage":
      return stage === null ? "adding a stage" : `adding stage ${stage}`;
    case "set_stage":
      return stage === null ? "updating a stage" : `updating stage ${stage}`;
    case "remove_stage":
      return stage === null ? "removing a stage" : `removing stage ${stage}`;
    case "add_edge":
      return edge === null ? "connecting stages" : `connecting ${edge}`;
    case "remove_edge":
      return edge === null ? "disconnecting stages" : `disconnecting ${edge}`;
    case "set_trigger":
      return "set trigger";
    case "set_guard":
      return `set ${guardOf(params)}`;
    default:
      return op.kind;
  }
}

/** What follows an operation that was applied to the draft. */
export const APPLIED_MARK = "✓";

/** What follows an operation that was recorded and not applied — a guard. Never the ✓. */
export const PROPOSED_MARK = "proposed, not applied";

/**
 * One operation's marker — *adding stage exploit-verify… ✓*.
 *
 * @param op The operation.
 * @param outcome What became of it. A `proposed` guard is worded as proposed — it is recorded
 *   beside the draft and is not part of it. A `bounced` one has no mark; its line is the
 *   validator's ({@link bounceLine}).
 * @returns The line.
 */
export function operationLine(op: OperationShape, outcome: OperationOutcome): string {
  const phrase = `${operationPhrase(op)}…`;

  if (outcome === "applied") return `${phrase} ${APPLIED_MARK}`;
  if (outcome === "proposed") return `${phrase} ${PROPOSED_MARK}`;

  return phrase;
}

/** What stands in for a validator that bounced an operation and said nothing. */
export const BOUNCE_UNEXPLAINED = "The validator refused it without a message.";

/**
 * One bounced operation, with the validator's message.
 *
 * @param op The operation.
 * @param validatorMessage What the validator said.
 * @returns *connecting test → exploit_verify — edge.to "exploit_verify" names no stage…*.
 */
export function bounceLine(op: OperationShape, validatorMessage: string | null): string {
  return `${operationPhrase(op)} — ${validatorMessage ?? BOUNCE_UNEXPLAINED}`;
}

/**
 * The quiet line over bounced operations.
 *
 * @param count How many; at least one.
 * @returns *1 operation corrected* or *3 operations corrected*.
 */
export function correctedWords(count: number): string {
  return count === 1 ? "1 operation corrected" : `${count} operations corrected`;
}

/**
 * A W7 warning an operation introduced, as a small note.
 *
 * @param warning The warning.
 * @returns *⚠ exploit-verify: No skill called … is registered.*
 */
export function warningLine(warning: Pick<CopilotWarning, "node" | "message">): string {
  return `⚠ ${warning.node}: ${warning.message}`;
}

/**
 * A read the reply made.
 *
 * @param tool What it read — `draft`, `catalog`, `skills`, `tickets`.
 * @returns *read catalog*.
 */
export function readLine(tool: string): string {
  return `read ${tool.replaceAll("_", " ")}`;
}

/**
 * A dry run the reply proposed.
 *
 * @param ticket The ticket it would run against.
 * @param reason Why that one, when the reply said.
 * @returns *proposed a dry run on #489 — exercises the skip path*.
 */
export function proposalLine(ticket: string, reason?: string | null): string {
  const base = `proposed a dry run on ${ticket}`;

  return reason == null || reason === "" ? base : `${base} — ${reason}`;
}

/**
 * The draft changed under the conversation and the copilot re-read it.
 *
 * @param message The service's sentence.
 * @returns The line.
 */
export function conflictLine(message: string): string {
  return `draft changed elsewhere — ${message}`;
}

/**
 * A count and its noun.
 *
 * @param count How many.
 * @param noun The singular.
 * @returns *1 operation*, *5 operations*.
 */
function counted(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * A stored reply's trace in one line — *applied 5 operations · 1 corrected*.
 *
 * @param trace The reply's trace.
 * @returns The summary, or `null` for a reply that proposed no operation and no dry run — a
 *   reply that only read has nothing here worth a line.
 */
export function traceSummary(trace: CopilotToolTrace): string | null {
  const count = (outcome: OperationOutcome): number =>
    trace.operations.filter((operation) => operation.outcome === outcome).length;
  const parts: string[] = [];

  if (count("applied") > 0) parts.push(`applied ${counted(count("applied"), "operation")}`);
  if (count("proposed") > 0) parts.push(`${count("proposed")} proposed`);
  if (count("bounced") > 0) parts.push(`${count("bounced")} corrected`);
  if (trace.dryRunProposals.length > 0) parts.push(counted(trace.dryRunProposals.length, "dry run") + " proposed");

  return parts.length === 0 ? null : parts.join(" · ");
}

/** One line of an opened trace. */
export interface TraceLine {
  /** What kind of line — the card dims a read and marks a correction. */
  readonly tone: "applied" | "proposed" | "bounced" | "note";
  readonly text: string;
}

/**
 * A stored reply's trace, as the list its summary opens to — reads first, then the operations in
 * the order they were proposed, then the dry runs suggested.
 *
 * @param trace The reply's trace.
 * @returns The lines.
 */
export function traceLines(trace: CopilotToolTrace): TraceLine[] {
  return [
    ...trace.reads.map((read): TraceLine => ({ tone: "note", text: readLine(read.tool) })),
    ...trace.operations.map(
      (operation): TraceLine =>
        operation.outcome === "bounced"
          ? { tone: "bounced", text: `corrected: ${bounceLine(operation.op, operation.validatorMessage)}` }
          : { tone: operation.outcome, text: operationLine(operation.op, operation.outcome) },
    ),
    ...trace.dryRunProposals.map(
      (proposal): TraceLine => ({ tone: "note", text: proposalLine(proposal.ticket, proposal.reason) }),
    ),
  ];
}

/* ------------------------------------------------------------------ the meta line and the head */

/**
 * A reply's cost, for its meta line.
 *
 * @param costCents What the exchange cost, or `null` when it was not priced.
 * @returns `$0.12` — and `$0.00` for a priced exchange that cost nothing — or `null` for an
 *   unpriced one, which draws nothing at all: an absent price is never a zero.
 */
export function costAffix(costCents: number | null | undefined): string | null {
  return costCents == null ? null : moneyOfCents(costCents);
}

/**
 * A message's time of day, as its reader's locale prints it.
 *
 * @param at The instant, ISO 8601.
 * @param timeZone The zone to print it in. Omitted, the runtime's — the reader's, in a browser.
 * @param locale The locale. Omitted, the runtime's.
 * @returns `15:02`, or `""` for a value that is not an instant.
 */
export function clockOf(at: string, timeZone?: string, locale?: string): string {
  const instant = new Date(at);
  if (Number.isNaN(instant.getTime())) return "";

  return instant.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone });
}

/** The head's model pill. */
export interface ModelPill {
  /** The model's id — the pill's text. */
  readonly modelId: string;
  /** The alias it was resolved through — the pill's tooltip. */
  readonly alias: string;
}

/**
 * The model the conversation's newest reply was routed to.
 *
 * @param session The session, or `null`.
 * @returns The newest provenance entry — by the reply's `seq` — or `null` before the first
 *   recorded exchange. Never a default: an exchange that recorded nothing has no pill.
 */
export function modelPill(session: Pick<CopilotSession, "modelProvenance"> | null): ModelPill | null {
  const newest = (session?.modelProvenance ?? []).reduce<CopilotSession["modelProvenance"][number] | null>(
    (latest, entry) => (latest === null || entry.seq >= latest.seq ? entry : latest),
    null,
  );

  return newest === null ? null : { modelId: newest.modelId, alias: newest.alias };
}

/**
 * The pill's tooltip.
 *
 * @param pill The pill.
 * @returns *Routed through the alias coder-max*.
 */
export function modelPillTitle(pill: ModelPill): string {
  return `Routed through the alias ${pill.alias}`;
}

/* ------------------------------------------------------------------ the conversation's state */

/** One piece of a reply, in the order it arrived. */
export type Segment =
  /** Reply text — consecutive deltas, joined. */
  | { readonly kind: "text"; readonly text: string }
  /** An operation that was applied, or a guard that was proposed. */
  | {
      readonly kind: "operation";
      readonly op: OperationShape;
      readonly outcome: "applied" | "proposed";
      readonly warnings: readonly CopilotWarning[];
    }
  /** Operations the validator bounced, consecutive ones together — one quiet line. */
  | {
      readonly kind: "bounced";
      readonly bounces: readonly { readonly op: OperationShape; readonly validatorMessage: string | null }[];
    }
  /** A read, a proposed dry run, or a conflict — a quiet line. */
  | { readonly kind: "note"; readonly text: string };

/** Why a reply did not finish. */
export interface ReplyFailure {
  readonly code: string;
  readonly message: string;
}

/** What started an exchange. */
export type ExchangeOrigin =
  /** A message typed and sent. */
  | { readonly kind: "message"; readonly text: string }
  /** A chip pressed. */
  | { readonly kind: "answer"; readonly messageId: string; readonly question: number; readonly selected: string };

/** The reply that is arriving. */
export interface LiveReply {
  /** What started it. */
  readonly origin: ExchangeOrigin;
  /** The person's message as the service recorded it — `null` until `accepted`. */
  readonly user: CopilotMessage | null;
  /** The reply's id — `null` until `accepted`. */
  readonly replyId: string | null;
  /** The reply's place in the conversation. */
  readonly replySeq: number | null;
  /** What has arrived, in order. */
  readonly segments: readonly Segment[];
  /** The questions asked so far, by position. */
  readonly choices: readonly CopilotChoice[];
  /** What the exchange cost — `undefined` until `usage`, `null` when unpriced. */
  readonly costCents: number | null | undefined;
  /** The error the stream carried, if it did. */
  readonly failure: ReplyFailure | null;
}

/** What the card remembers of a reply it watched arrive. */
export interface ReplyRecord {
  /** The reply's pieces, in the order they arrived. */
  readonly segments: readonly Segment[];
  /** Why it did not finish, or `null`. */
  readonly failure: ReplyFailure | null;
}

/** The card's own state — what this page session added to what the server read. */
export interface ChatState {
  /** A conversation started here, before the page has read it back. */
  readonly session: CopilotSession | null;
  /** The closed conversation the reader left for a new one — its messages are no longer drawn. */
  readonly detachedFrom: string | null;
  /** Messages that arrived through a stream here, by id. */
  readonly messages: Readonly<Record<string, CopilotMessage>>;
  /** What was watched of each reply that streamed here, by the reply's id. */
  readonly records: Readonly<Record<string, ReplyRecord>>;
  /** Answers given here, by reply id then question position. */
  readonly answers: Readonly<Record<string, Readonly<Record<number, string>>>>;
  /** The reply arriving now, or `null`. */
  readonly live: LiveReply | null;
  /** Why the last send was refused before a reply started, or `null`. */
  readonly refusal: string | null;
  /** The draft as the last finished reply left it, or `null` before one finished here. */
  readonly draft: CopilotDraft | null;
}

/** The state a card starts in. */
export const INITIAL_CHAT: ChatState = {
  session: null,
  detachedFrom: null,
  messages: {},
  records: {},
  answers: {},
  live: null,
  refusal: null,
  draft: null,
};

/** What can happen to the card's state. */
export type ChatAction =
  /** A conversation was started. */
  | { readonly type: "session"; readonly session: CopilotSession }
  /** A send or an answer left the page. */
  | { readonly type: "start"; readonly origin: ExchangeOrigin }
  /** The service refused it before a reply started. */
  | { readonly type: "refused"; readonly message: string }
  /** An event of the exchange arrived. */
  | { readonly type: "event"; readonly event: CopilotStreamEvent }
  /** The stream closed. */
  | { readonly type: "ended" }
  /** The refusal was read. */
  | { readonly type: "dismiss" }
  /** The reader left a closed conversation for a new one. */
  | { readonly type: "detach"; readonly sessionId: string };

/** The code of a reply the service stopped because its conversation was closed under it. */
export const SESSION_CLOSED_CODE = "copilot_session_closed";

/** The code this card gives a reply whose stream ended without the service's last word. */
export const CONNECTION_LOST_CODE = "connection_lost";

/** What a reply whose stream ended early says. */
export const CONNECTION_LOST =
  "The connection was lost before the reply finished. What it had already applied to the draft is kept.";

/** What a send whose stream ended before the service recorded anything says. */
export const NOTHING_SENT = "The connection was lost before the message was recorded. Nothing was sent.";

/** The code this card gives a stored reply recorded as interrupted. */
export const INTERRUPTED_CODE = "interrupted";

/** What a stored reply recorded as interrupted says — the service keeps no reason for it. */
export const INTERRUPTED_REPLY =
  "This reply was interrupted before it finished. What it had already applied to the draft is kept.";

/**
 * The text a reply's segments spell.
 *
 * @param segments The segments.
 * @returns Every text segment, joined.
 */
export function segmentsText(segments: readonly Segment[]): string {
  return segments.map((segment) => (segment.kind === "text" ? segment.text : "")).join("");
}

/**
 * Add one piece to a reply, joining it to the last where the two are one thing.
 *
 * @param segments What has arrived.
 * @param next The piece.
 * @returns The list with it — consecutive text joined, consecutive bounces counted together.
 */
function appended(segments: readonly Segment[], next: Segment): Segment[] {
  const last = segments.at(-1);

  if (last?.kind === "text" && next.kind === "text") {
    return [...segments.slice(0, -1), { kind: "text", text: last.text + next.text }];
  }
  if (last?.kind === "bounced" && next.kind === "bounced") {
    return [...segments.slice(0, -1), { kind: "bounced", bounces: [...last.bounces, ...next.bounces] }];
  }

  return [...segments, next];
}

/**
 * What one event adds to the reply that is arriving.
 *
 * @param live The reply so far.
 * @param event The event — any but `done`.
 * @returns The reply with it.
 */
function received(live: LiveReply, event: Exclude<CopilotStreamEvent, { kind: "done" }>): LiveReply {
  switch (event.kind) {
    case "accepted":
      return { ...live, user: event.message, replyId: event.replyId, replySeq: event.replySeq };
    case "delta":
      return { ...live, segments: appended(live.segments, { kind: "text", text: event.text }) };
    case "operation":
      return {
        ...live,
        segments: appended(
          live.segments,
          event.outcome === "bounced"
            ? { kind: "bounced", bounces: [{ op: event.op, validatorMessage: event.validatorMessage }] }
            : { kind: "operation", op: event.op, outcome: event.outcome, warnings: event.warnings ?? [] },
        ),
      };
    case "read":
      return { ...live, segments: appended(live.segments, { kind: "note", text: `${readLine(event.tool)}…` }) };
    case "dry_run_proposal":
      return {
        ...live,
        segments: appended(live.segments, { kind: "note", text: proposalLine(event.ticket, event.reason) }),
      };
    case "conflict":
      return { ...live, segments: appended(live.segments, { kind: "note", text: conflictLine(event.message) }) };
    case "question": {
      const choices = [...live.choices];
      choices[event.index] = { prompt: event.prompt, options: [...event.options], selected: null, answeredAt: null };

      return { ...live, choices };
    }
    case "usage":
      return { ...live, costCents: event.costCents };
    case "error":
      return { ...live, failure: { code: event.code, message: event.message } };
  }
}

/**
 * Settle the reply that was arriving into the conversation.
 *
 * @param state The state.
 * @param live The reply that was arriving, accepted by the service.
 * @param reply The reply as it stands — the service's record, or what the card saw of it.
 * @param failure Why it did not finish, or `null`.
 * @param draft The draft afterwards, when the service said.
 * @returns The state with the exchange in its messages and nothing arriving.
 */
function settled(
  state: ChatState,
  live: LiveReply,
  reply: CopilotMessage,
  failure: ReplyFailure | null,
  draft: CopilotDraft | null,
): ChatState {
  const messages = { ...state.messages, [reply.id]: reply };
  if (live.user !== null) messages[live.user.id] = live.user;

  return {
    ...state,
    messages,
    records: { ...state.records, [reply.id]: { segments: live.segments, failure } },
    live: null,
    draft: draft ?? state.draft,
  };
}

/**
 * The card's state after one thing happened.
 *
 * @param state The state.
 * @param action What happened.
 * @returns The next state.
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "session":
      return { ...state, session: action.session };

    case "start":
      return {
        ...state,
        refusal: null,
        live: {
          origin: action.origin,
          user: null,
          replyId: null,
          replySeq: null,
          segments: [],
          choices: [],
          costCents: undefined,
          failure: null,
        },
      };

    case "refused":
      return { ...state, live: null, refusal: action.message };

    case "dismiss":
      return { ...state, refusal: null };

    case "detach":
      return { ...INITIAL_CHAT, detachedFrom: action.sessionId };

    case "event": {
      const { live } = state;
      const { event } = action;
      if (live === null) return state;

      if (event.kind === "done") {
        return settled(state, live, event.message, live.failure, event.draft);
      }

      const next = received(live, event);
      // The answer is on the reply the moment the service accepts the exchange it started.
      const answers =
        event.kind === "accepted" && live.origin.kind === "answer"
          ? {
              ...state.answers,
              [live.origin.messageId]: {
                ...state.answers[live.origin.messageId],
                [live.origin.question]: live.origin.selected,
              },
            }
          : state.answers;

      return { ...state, answers, live: next };
    }

    case "ended": {
      const { live } = state;
      if (live === null) return state;

      // Nothing was recorded: it is a send that did not happen, not a reply that failed.
      if (live.user === null || live.replyId === null) return { ...state, live: null, refusal: NOTHING_SENT };

      const reply: CopilotMessage = {
        id: live.replyId,
        seq: live.replySeq ?? live.user.seq + 1,
        role: "copilot",
        body: segmentsText(live.segments),
        choices: live.choices.length === 0 ? null : [...live.choices],
        toolTrace: { operations: [], reads: [], dryRunProposals: [] },
        tokensIn: null,
        tokensOut: null,
        costCents: live.costCents ?? null,
        status: "interrupted",
        createdAt: live.user.createdAt,
      };

      return settled(
        state,
        live,
        reply,
        live.failure ?? { code: CONNECTION_LOST_CODE, message: CONNECTION_LOST },
        null,
      );
    }
  }
}

/**
 * The conversation the server read, unless the reader has left it for a new one.
 *
 * @param server What the page read — `null` for a workflow with no conversation.
 * @param state The card's state.
 * @returns The conversation the card draws on top of, or `null`.
 */
export function baseConversation(server: CopilotConversation | null, state: ChatState): CopilotConversation | null {
  return server !== null && server.session.id === state.detachedFrom ? null : server;
}

/**
 * The session the card is in.
 *
 * @param server What the page read.
 * @param state The card's state.
 * @returns The server's, else the one started here, else `null` — no conversation yet.
 */
export function chatSession(server: CopilotConversation | null, state: ChatState): CopilotSession | null {
  return baseConversation(server, state)?.session ?? state.session;
}

/** One message as the card draws it. */
export interface ChatMessage {
  /** The message, its choices carrying any answer given here. */
  readonly message: CopilotMessage;
  /** What the card watched of it arriving, or `null` for one read back from the service. */
  readonly record: ReplyRecord | null;
}

/**
 * Every settled message, in the order they were said.
 *
 * The server's copy of a message wins over the one a stream delivered — it is the later reading
 * — while what the card watched of a reply (its interleaved pieces, the error it ended on) is
 * kept beside it, because the service's record does not carry those.
 *
 * @param server What the page read.
 * @param state The card's state.
 * @returns The messages, by `seq`.
 */
export function chatMessages(server: CopilotConversation | null, state: ChatState): ChatMessage[] {
  const byId = new Map<string, CopilotMessage>(Object.entries(state.messages));
  for (const message of baseConversation(server, state)?.messages ?? []) byId.set(message.id, message);

  return [...byId.values()]
    .sort((a, b) => a.seq - b.seq)
    .map((message) => {
      const given = state.answers[message.id];
      const choices =
        message.choices === null || given === undefined
          ? message.choices
          : message.choices.map((choice, index) =>
              choice.selected === null && given[index] !== undefined ? { ...choice, selected: given[index] } : choice,
            );

      return { message: { ...message, choices }, record: state.records[message.id] ?? null };
    });
}

/**
 * Why a settled reply did not finish.
 *
 * @param entry The message.
 * @returns What the card watched it end on; else, for a reply the service recorded as
 *   interrupted, {@link INTERRUPTED_REPLY}; else `null`.
 */
export function replyFailure(entry: ChatMessage): ReplyFailure | null {
  if (entry.message.role !== "copilot") return null;
  if (entry.record?.failure != null) return entry.record.failure;

  return entry.message.status === "interrupted" ? { code: INTERRUPTED_CODE, message: INTERRUPTED_REPLY } : null;
}

/** The heading over a reply the service stopped because its conversation was closed. */
export const CLOSED_MID_REPLY_TITLE = "The conversation was closed while this reply was arriving";

/** The heading over any other reply that did not finish. */
export const REPLY_FAILED_TITLE = "This reply did not finish";

/**
 * What a closed-mid-reply ending says. The service's own sentence is already the reply's last
 * words, in the bubble above — so it is not printed a second time here.
 */
export const CLOSED_MID_REPLY_NOTE =
  "The draft was promoted or discarded during the reply, so nothing further was applied. There is nothing to retry here.";

/**
 * The text a Retry sends: what the person said that the failed reply was answering.
 *
 * @param messages The conversation.
 * @param index The failed reply's position.
 * @returns The nearest earlier message of the person's, or `null` when there is none.
 */
export function retryText(messages: readonly ChatMessage[], index: number): string | null {
  for (let at = index - 1; at >= 0; at -= 1) {
    const candidate = messages[at]?.message;
    if (candidate?.role === "user") return candidate.body.trim() === "" ? null : candidate.body;
  }

  return null;
}

/**
 * Whether a failed reply offers Retry.
 *
 * @param failure Why it failed.
 * @param newest Whether it is the conversation's last message — retrying an older one would
 *   answer a question the conversation has moved on from.
 * @param gate Why the composer cannot send, or `null`.
 * @param text What a retry would send, or `null`.
 * @returns True when pressing Retry would send.
 */
export function mayRetry(
  failure: ReplyFailure,
  newest: boolean,
  gate: ComposerGate | null,
  text: string | null,
): boolean {
  return failure.code !== SESSION_CLOSED_CODE && newest && gate === null && text !== null;
}

/* ------------------------------------------------------------------ the composer's gate */

/** Why the composer cannot send. */
export type GateKind =
  /** The conversation was promoted or discarded. */
  | "closed"
  /** The reader's role may not write. */
  | "role"
  /** A reply is arriving here. */
  | "streaming"
  /** A reply the page did not start is recorded as still arriving. */
  | "pending"
  /** A dry run of the draft has not ended — it is in its precheck, or running. */
  | "dry_run"
  /** The deployment has no invocation gateway. */
  | "gateway"
  /** The copilot's task kind has no route. */
  | "unrouted";

/** The composer's gate, decided. */
export interface ComposerGate {
  readonly kind: GateKind;
  /** The reason, as the composer says it. */
  readonly message: string;
}

/** Why the composer cannot send while a reply is arriving. */
export const STREAMING_REASON = "The copilot is replying — you can send again when the reply finishes.";

/** Why the composer cannot send while a reply started elsewhere is still arriving. */
export const PENDING_REASON =
  "A reply is still arriving in this conversation, started from another page. Reload to read it, then send.";

/** Why the composer cannot send while a dry run holds the draft. */
export const DRY_RUN_REASON =
  "A dry run is in progress — the draft is held still until it finishes. You can send again then.";

/** Why the composer cannot send on a deployment without the gateway. */
export const GATEWAY_REASON = "The copilot cannot reply: this deployment has no invocation gateway.";

/** Why the composer cannot send while the copilot has no route. */
export const UNROUTED_REASON = "The copilot cannot reply: no model is routed for it yet.";

/** Why a reader whose role may not write has no composer — the frame's own sentence. */
export const ROLE_REASON = ROLE_TRANSCRIPT_NOTE;

/** What the page knows when it decides the composer. */
export interface GateFacts {
  /** The session's status, or `null` when there is no conversation yet. */
  readonly status: CopilotSession["status"] | null;
  /** Whether the reader's role may write — `mayAdminister`. */
  readonly mayAdminister: boolean;
  /** Whether a reply is arriving here. */
  readonly streaming: boolean;
  /** Whether the conversation's last message is recorded as still streaming, and not by this page. */
  readonly pending: boolean;
  /** The service's readiness, or `null` when it could not be read — which gates nothing. */
  readonly readiness: CopilotReadiness | null;
  /** What a closed conversation says of itself — `copilot-view.ts`' `transcriptNote`. */
  readonly closedNote: string;
}

/**
 * Decide the composer.
 *
 * The order is from what cannot change to what will pass by itself: a closed conversation; a
 * role that may not write; a reply arriving; a dry run in the way; and the two hard
 * prerequisites, which somebody has to go and fix. Readiness that could not be read gates
 * nothing — the service still refuses what it must, and the card says so when it does.
 *
 * @param facts What the page knows.
 * @returns The gate, or `null` when a message may be sent.
 */
export function composerGate(facts: GateFacts): ComposerGate | null {
  const { status, mayAdminister, streaming, pending, readiness, closedNote } = facts;

  if (status === "promoted" || status === "discarded") return { kind: "closed", message: closedNote };
  if (!mayAdminister) return { kind: "role", message: ROLE_REASON };
  if (streaming) return { kind: "streaming", message: STREAMING_REASON };
  if (pending) return { kind: "pending", message: PENDING_REASON };
  if (readiness !== null && readiness.dryRun !== null) return { kind: "dry_run", message: DRY_RUN_REASON };
  if (readiness !== null && !readiness.gateway.available) return { kind: "gateway", message: GATEWAY_REASON };
  if (readiness !== null && !readiness.route.resolved) return { kind: "unrouted", message: UNROUTED_REASON };

  return null;
}

/**
 * Whether the gate removes the composer rather than switching it off.
 *
 * @param gate The gate.
 * @returns True for a closed conversation and for a role that may not write — states no waiting
 *   changes, where an input would only be a promise the page cannot keep.
 */
export function composerAbsent(gate: ComposerGate | null): boolean {
  return gate?.kind === "closed" || gate?.kind === "role";
}

/**
 * Whether pressing a key in the composer sends.
 *
 * @param event The key event's facts.
 * @returns True for a bare Enter — not with Shift (a new line), and not while an input method is
 *   composing, where Enter confirms the candidate rather than the message.
 */
export function sendsOnKey(event: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode?: number;
}): boolean {
  // 229 is what a composing input method reports on browsers that clear `isComposing` early.
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

/* ------------------------------------------------------------------ the hard prerequisites */

/** The notice for a prerequisite the copilot cannot reply without. */
export interface PrerequisiteNotice {
  readonly kind: "gateway" | "unrouted";
  readonly title: string;
  readonly text: string;
  readonly linkLabel: string;
  readonly href: string;
}

/** The gateway notice's title. */
export const GATEWAY_NOTICE_TITLE = "The copilot needs the invocation gateway";

/** …and what it says. */
export const GATEWAY_NOTICE_TEXT =
  "This deployment has no invocation gateway, so no model can be called and the copilot cannot reply. What was already said stays readable.";

/** …and its link. */
export const GATEWAY_NOTICE_LINK = "See Providers";

/** The unrouted notice's title. */
export const UNROUTED_NOTICE_TITLE = "The copilot has no model route";

/** What the unrouted notice says when the service gave no reason. */
export const UNROUTED_NOTICE_FALLBACK = "No model is routed for the copilot's task kind.";

/** What follows the service's reason. */
export const UNROUTED_NOTICE_STILL = "What was already said stays readable.";

/** …and its link. */
export const UNROUTED_NOTICE_LINK = "Open Model routing";

/** Where the unrouted notice leads: the routing matrix. */
export const MODEL_ROUTING_HREF = `${MODELS_PATH}#${ROUTING_MATRIX_HASH}`;

/**
 * A sentence starting with a capital — the service's route reason is the tail of another.
 *
 * @param text The text.
 * @returns It, its first letter raised.
 */
function sentence(text: string): string {
  return text === "" ? text : text[0]!.toUpperCase() + text.slice(1);
}

/**
 * The notice the card wears when the copilot cannot reply at all.
 *
 * @param readiness The service's readiness, or `null` when it could not be read.
 * @returns Which prerequisite is missing, said precisely — the gateway first, because without
 *   it a route would change nothing — or `null`.
 */
export function prerequisiteNotice(readiness: CopilotReadiness | null): PrerequisiteNotice | null {
  if (readiness === null) return null;

  if (!readiness.gateway.available) {
    return {
      kind: "gateway",
      title: GATEWAY_NOTICE_TITLE,
      text: GATEWAY_NOTICE_TEXT,
      linkLabel: GATEWAY_NOTICE_LINK,
      href: PROVIDERS_PATH,
    };
  }
  if (!readiness.route.resolved) {
    return {
      kind: "unrouted",
      title: UNROUTED_NOTICE_TITLE,
      text: `${sentence(readiness.route.reason ?? UNROUTED_NOTICE_FALLBACK)} ${UNROUTED_NOTICE_STILL}`,
      linkLabel: UNROUTED_NOTICE_LINK,
      href: MODEL_ROUTING_HREF,
    };
  }

  return null;
}

/* ------------------------------------------------------------------ the chips */

/** The circled ordinals a multi-question reply numbers its questions with. */
const ORDINALS = "①②③④⑤⑥⑦⑧⑨⑩";

/**
 * The mark before a question's prompt.
 *
 * @param index The question's position, from 0.
 * @param total How many questions the reply asked.
 * @returns `①`, `②`… when it asked more than one — and `(11)` past the tenth; `""` for a single
 *   question, which needs no number.
 */
export function ordinalOf(index: number, total: number): string {
  if (total <= 1) return "";

  return ORDINALS[index] ?? `(${index + 1})`;
}

/** The mark an answered chip carries. */
export const ANSWERED_MARK = "✓";

/**
 * The reply whose questions may be answered now.
 *
 * @param messages The conversation.
 * @returns The id of the newest reply with a question still open, or `null`. An older reply's
 *   open question stays inert: the conversation has moved on from it.
 */
export function answerableId(messages: readonly ChatMessage[]): string | null {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const { message } = messages[at]!;
    if (message.role === "copilot" && (message.choices ?? []).some((choice) => choice.selected === null)) {
      return message.id;
    }
  }

  return null;
}

/**
 * Whether one question's chips may be pressed.
 *
 * @param choice The question.
 * @param onAnswerable Whether its reply is the one {@link answerableId} names.
 * @param gate Why the composer cannot send, or `null` — a chip re-enters the same loop a message
 *   does, so whatever stops a send stops an answer.
 * @returns True when pressing an option would post it.
 */
export function chipsLive(choice: CopilotChoice, onAnswerable: boolean, gate: ComposerGate | null): boolean {
  return choice.selected === null && onAnswerable && gate === null;
}

/* ------------------------------------------------------------------ history and the scroller */

/** How many messages a page of history is. */
export const HISTORY_PAGE = 30;

/**
 * How many of the oldest messages start hidden.
 *
 * @param total How many messages there are.
 * @param page The page size.
 * @returns The count above the newest page.
 */
export function initialHidden(total: number, page: number = HISTORY_PAGE): number {
  return Math.max(0, total - page);
}

/**
 * How many stay hidden after one more page is shown.
 *
 * @param hidden How many are hidden now.
 * @param page The page size.
 * @returns The count, never below zero.
 */
export function revealEarlier(hidden: number, page: number = HISTORY_PAGE): number {
  return Math.max(0, hidden - page);
}

/**
 * The messages on show.
 *
 * @param messages Every message.
 * @param hidden How many of the oldest are hidden.
 * @returns The rest. A count past the end — the conversation was replaced by a shorter one —
 *   hides nothing.
 */
export function shownMessages<T>(messages: readonly T[], hidden: number): readonly T[] {
  return hidden >= messages.length ? messages : messages.slice(hidden);
}

/** How near the end, in CSS pixels, still counts as *at the bottom*. */
export const BOTTOM_THRESHOLD = 48;

/** The scroller's three measurements. */
export interface ScrollBox {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * Whether the reader is at the newest message, or near enough that following it moves nothing
 * they were reading.
 *
 * @param box The scroller.
 * @param threshold How near counts.
 * @returns True within the threshold of the end — and for a scroller with nothing to scroll.
 */
export function isAtBottom(box: ScrollBox, threshold: number = BOTTOM_THRESHOLD): boolean {
  return box.scrollHeight - box.clientHeight - box.scrollTop <= threshold;
}

/** One message's place in the scroller. */
export interface Placed {
  readonly id: string;
  /** Its top edge, from the top of the scrolled content. */
  readonly top: number;
  /** Its bottom edge, likewise. */
  readonly bottom: number;
}

/**
 * The message the reader is looking at: the first with any part in view.
 *
 * @param placed Every message's place, top to bottom.
 * @param scrollTop How far the scroller is scrolled.
 * @returns It, or `null` for an empty scroller.
 */
export function firstVisible(placed: readonly Placed[], scrollTop: number): Placed | null {
  return placed.find((item) => item.bottom > scrollTop) ?? placed.at(-1) ?? null;
}

/**
 * Where to scroll so the message the reader was looking at has not moved.
 *
 * @param scrollTop Where the scroller was.
 * @param before The anchor's top before earlier messages were added above it.
 * @param after Its top afterwards.
 * @returns The scroll position that keeps it where it was on screen.
 */
export function anchoredScrollTop(scrollTop: number, before: number, after: number): number {
  return Math.max(0, scrollTop + (after - before));
}

/**
 * Whether the *New messages* control is showing.
 *
 * @param atBottom Whether the reader is at the bottom.
 * @param leftAt The content's version when they left it.
 * @param version The content's version now.
 * @returns True when something arrived since a reader scrolled away — who is not moved, and is told.
 */
export function hasUnseen(atBottom: boolean, leftAt: string, version: string): boolean {
  return !atBottom && leftAt !== version;
}

/**
 * A value that changes whenever the conversation's content does.
 *
 * @param settledCount How many settled messages there are.
 * @param live The reply arriving, or `null`.
 * @returns The version.
 */
export function contentVersion(settledCount: number, live: LiveReply | null): string {
  if (live === null) return `${settledCount}`;

  return `${settledCount}+${live.segments.length}:${segmentsText(live.segments).length}:${live.choices.length}`;
}

/* ------------------------------------------------------------------ announcing */

/** How much of a reply the live region reads out. */
export const ANNOUNCE_LIMIT = 240;

/**
 * What the live region says when a reply settles — once, not per token.
 *
 * @param text The reply's text.
 * @param failure Why it did not finish, or `null`.
 * @returns *Copilot replied: …*, cut at a readable length, or the failure.
 */
export function announcement(text: string, failure: ReplyFailure | null): string {
  if (failure !== null) {
    // A close's sentence is the reply's own last words; the heading alone says what happened.
    return failure.code === SESSION_CLOSED_CODE
      ? `${CLOSED_MID_REPLY_TITLE}. ${CLOSED_MID_REPLY_NOTE}`
      : `${REPLY_FAILED_TITLE}. ${failure.message}`;
  }

  const flat = text.replace(/\s+/g, " ").trim();
  const cut = flat.length > ANNOUNCE_LIMIT ? `${flat.slice(0, ANNOUNCE_LIMIT).trimEnd()}…` : flat;

  return cut === "" ? "Copilot replied." : `Copilot replied: ${cut}`;
}
