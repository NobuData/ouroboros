/**
 * The agent transcript, as data ([#312](https://github.com/NobuData/ouroboros/issues/312)) —
 * mockup 10's `c-7` card, decided here and drawn by `transcript-card.tsx`.
 *
 * **Typed, not a log** (decision R3). The store carries the structure — an actor, a tool tag, a
 * model id, a diff's hunks, a test's severity, a progress fraction — so every treatment here is
 * a reading of a field rather than a guess at a sentence: a result is amber because its payload
 * says `severity: "warn"`, not because it contains the word *flaked*.
 *
 * **Payloads are checked where they are drawn.** `payload` is `unknown` in the contract — its
 * shape varies by entry — so each reader below accepts only the shape it knows and answers
 * `null` for anything else, and an entry with a payload nobody recognises is drawn without it
 * rather than with a guess.
 *
 * **Steering is optimistic, then honest.** A steer the reader sends is drawn at once as a `USER`
 * entry marked with its delivery chip; the service mirrors the steer into the transcript as a
 * real `user` entry, and when that arrives it takes the optimistic one's place and the chip moves
 * onto it (see {@link placeSteers}).
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { RunControl, RunEventElision, RunEventEntry } from "@/app/api/runs";

import { type DeliveryChip, deliveryChip } from "./controls";

/** The card's title — the mockup's `AGENT TRANSCRIPT`. */
export const TRANSCRIPT_TITLE = "Agent transcript";

/** The pill that says the transcript is still moving. */
export const STREAMING = "streaming";

/** The export action. */
export const RAW_JSONL = "Raw JSONL ↗";

/** The scroll box's accessible name. */
export const ENTRIES_LABEL = "Transcript entries";

/** What the card says before the run has written anything. */
export const NO_ENTRIES = "Nothing has been written to this transcript yet.";

/** What the card says while its first page is on its way. */
export const LOADING_ENTRIES = "Reading the transcript…";

/** The filter note's way out. */
export const SHOW_ALL = "Show all";

/**
 * What the card says while the stepper's filter is on.
 *
 * @param stage The stage's label.
 * @param shown How many entries the filter keeps.
 * @param total How many are held.
 * @returns `Showing Implement only — 6 of 9 entries.`
 */
export function filterNote(stage: string, shown: number, total: number): string {
  return `Showing ${stage} only — ${shown} of ${total} ${total === 1 ? "entry" : "entries"}.`;
}

/** The affordance that goes back to following the tail. */
export const JUMP_TO_LATEST = "Jump to latest ↓";

/** The steering input's label — it has no visible one; the placeholder is an example. */
export const STEER_LABEL = "Steer the loop";

/** The steering input's placeholder — the mockup's, verbatim. */
export const STEER_PLACEHOLDER =
  'Steer the loop — e.g. "prefer a fix inside the ISR; do not touch the test timeouts"';

/** The steering button. */
export const STEER_SEND = "Send";

/**
 * The caption under the steering box.
 *
 * Decision **R9**: the mockup's second sentence — *"Works from the Slack thread too."* — is not
 * true until the ChatOps integration exists, and #318 is the change that adds it. Until then the
 * caption says only what is true.
 */
export const STEER_CAPTION = "Steering nudges the current attempt without pausing it.";

/** Why the steering box is closed on a run that has ended. */
export const STEER_ENDED =
  "This run has ended, so there is no loop left to steer. The transcript stays readable.";

/** Why the steering box is closed to a viewer. */
export const STEER_READ_ONLY = "Viewers can read the transcript but cannot steer the loop.";

/** Why Send cannot be pressed with nothing typed. */
export const STEER_EMPTY = "Type what the loop should do differently.";

/** Why Send cannot be pressed while a steer is on its way. */
export const STEER_SENDING = "Sending…";

/** Each actor's treatment. */
export type ActorTone = RunEventEntry["actor"];

/** Each actor's chip — the model's is its id, uppercased, so these are the other five. */
export const ACTOR_LABEL: Readonly<Record<Exclude<ActorTone, "model">, string>> = {
  plan: "PLAN",
  tool: "TOOL",
  gate: "GATE",
  user: "USER",
  system: "SYSTEM",
};

/** A model entry with no id — which the contract forbids, drawn honestly if it ever happens. */
export const UNNAMED_MODEL = "MODEL";

/** How an entry's body line is set. */
export type BodyStyle = "plain" | "faint" | "reason" | "mono" | "warn";

/** Each actor's body style, before the payload is looked at. */
const BODY_STYLE: Readonly<Record<ActorTone, BodyStyle>> = {
  plan: "faint",
  tool: "mono",
  model: "reason",
  gate: "warn",
  user: "plain",
  system: "plain",
};

/** One line of a diff block. */
export interface DiffLine {
  /** `ctx`, `del` or `add`. */
  readonly kind: "ctx" | "del" | "add";
  /** The mark the line is drawn with — `−`, `+`, or a space. */
  readonly mark: string;
  /** The code, as stored: the mark is not part of it. */
  readonly text: string;
}

/** The marks, by kind — the mockup's `−` is a minus sign, not a hyphen. */
const DIFF_MARK: Readonly<Record<DiffLine["kind"], string>> = { ctx: " ", del: "−", add: "+" };

/** A tool result's line. */
export interface ResultLine {
  /** The tool's own result text. */
  readonly text: string;
  /** The hue its stored severity names. */
  readonly tone: "ok" | "warn" | "err" | "neutral";
}

/** A progress fraction. */
export interface ProgressLine {
  /** `running… 47/63 cases`. */
  readonly text: string;
  /** `74` — the meter's width, divided here from the stored fraction. */
  readonly percent: number;
}

/** One entry, ready to draw. */
export interface EntryView {
  /** The entry's `seq` — the React key — or a negative number for an optimistic steer. */
  readonly key: number;
  /** `14:04:40`, in the reader's local time. */
  readonly time: string;
  /** The machine-readable instant, for `<time dateTime>`. */
  readonly dateTime: string;
  /** Which treatment the chip takes. */
  readonly actor: ActorTone;
  /** `TOOL`, `CLAUDE-FABLE-5`. */
  readonly actorLabel: string;
  /** The tool's tag, or `null`. */
  readonly tag: string | null;
  /** A faint mono note in the head — the edited file, the command a meter is running. */
  readonly headNote: string | null;
  /** The body line, or `null` when the entry's content is its payload. */
  readonly body: string | null;
  /** How the body is set. */
  readonly bodyStyle: BodyStyle;
  /** The diff block, or `null`. */
  readonly diff: readonly DiffLine[] | null;
  /** The result line, or `null`. */
  readonly result: ResultLine | null;
  /** The meter, or `null`. */
  readonly progress: ProgressLine | null;
  /** What an elision marker says, or `null` for an entry that is content. */
  readonly elision: string | null;
  /** Whether this is the live entry: the newest, still running. */
  readonly live: boolean;
  /** The steer's delivery chip, or `null`. */
  readonly chip: DeliveryChip | null;
  /** `14:04:40, TOOL edit_file` — the entry's name for a screen reader. */
  readonly accessibleName: string;
}

/** A steer this page sent, as the card remembers it. */
export interface SentSteer {
  /** Local and negative, so it never collides with a `seq`. */
  readonly localId: number;
  /** What was typed, trimmed — also what the mirrored entry's body will be. */
  readonly text: string;
  /** When it was sent. */
  readonly sentAt: string;
  /** The last `seq` held when it was sent; the mirrored entry comes after it. */
  readonly afterSeq: number;
  /** The control as the submission returned it, or `null` while sending. */
  readonly control: RunControl | null;
  /** Why it was refused before being queued, or `null`. */
  readonly failure: string | null;
}

/**
 * An instant as the transcript prints it.
 *
 * @param iso The instant.
 * @returns `14:04:40` in the reader's local time, or `""` for one that cannot be read.
 */
export function clockTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  return [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/**
 * A plain object's field.
 *
 * @param value Anything.
 * @param key The field.
 * @returns The field's value, or `undefined` when `value` is not an object.
 */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * A diff's lines, from a payload's `hunks`.
 *
 * @param payload The entry's payload.
 * @returns The lines, or `null` unless every hunk is `{kind: ctx|del|add, text: string}`.
 */
export function readHunks(payload: unknown): DiffLine[] | null {
  const hunks = field(payload, "hunks");
  if (!Array.isArray(hunks) || hunks.length === 0) return null;

  const lines: DiffLine[] = [];
  for (const hunk of hunks) {
    const kind = field(hunk, "kind");
    const text = field(hunk, "text");
    if ((kind !== "ctx" && kind !== "del" && kind !== "add") || typeof text !== "string") return null;
    lines.push({ kind, mark: DIFF_MARK[kind], text });
  }

  return lines;
}

/**
 * A tool's result line, from a payload's `result` and `severity`.
 *
 * @param payload The entry's payload.
 * @returns The line, or `null` when there is no result text. A severity that is not `ok`, `warn`
 *   or `err` (`error` is read as `err`) draws neutral rather than guessing.
 */
export function readResult(payload: unknown): ResultLine | null {
  const text = field(payload, "result");
  if (typeof text !== "string" || text === "") return null;

  const severity = field(payload, "severity");
  const tone =
    severity === "ok" || severity === "warn" || severity === "err"
      ? severity
      : severity === "error"
        ? "err"
        : "neutral";

  return { text, tone };
}

/**
 * A progress meter, from a payload's `progress` and `state`.
 *
 * `47/63` is one stored fact and `74%` is its division, done here (the seed's own argument for
 * storing the fraction and not the width).
 *
 * @param payload The entry's payload.
 * @param toolTag The tool, which decides the unit — `run_tests` counts cases.
 * @returns The meter, or `null` unless `progress` is `{done, total}` with `0 ≤ done ≤ total`,
 *   `total > 0`.
 */
export function readProgress(payload: unknown, toolTag: string | null): ProgressLine | null {
  const progress = field(payload, "progress");
  const done = field(progress, "done");
  const total = field(progress, "total");
  if (typeof done !== "number" || typeof total !== "number") return null;
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0 || done < 0 || done > total) {
    return null;
  }

  const fraction = `${done}/${total}${toolTag === "run_tests" ? " cases" : ""}`;
  const running = field(payload, "state") === "running";

  return { text: running ? `running… ${fraction}` : fraction, percent: Math.floor((done / total) * 100) };
}

/**
 * Whether a payload says its work is still running.
 *
 * @param payload The entry's payload.
 * @returns `true` for `state: "running"`.
 */
function isRunning(payload: unknown): boolean {
  return field(payload, "state") === "running";
}

/**
 * A byte count as a person reads it.
 *
 * @param bytes The count.
 * @returns `812 B`, `12.4 KB`, `3.1 MB`.
 */
export function byteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What an elision marker says.
 *
 * @param elision What the cap refused.
 * @returns `37 entries (412.0 KB) were not kept — the transcript's cap refused them between
 *   14:02:11 and 14:09:30.`
 */
export function elisionText(elision: RunEventElision): string {
  const entries = elision.events === 1 ? "1 entry" : `${elision.events} entries`;

  return (
    `${entries} (${byteSize(elision.bytes)}) were not kept — the transcript's cap refused them ` +
    `between ${clockTime(elision.from)} and ${clockTime(elision.to)}.`
  );
}

/**
 * What the card says above the held entries when older ones were let go.
 *
 * @param dropped How many.
 * @returns `120 earlier entries are not shown here — Raw JSONL has all of them.`
 */
export function droppedText(dropped: number): string {
  const entries = dropped === 1 ? "1 earlier entry is" : `${dropped} earlier entries are`;

  return `${entries} not shown here — Raw JSONL has all of them.`;
}

/**
 * The actor chip's word.
 *
 * @param entry The entry.
 * @returns `CLAUDE-FABLE-5` for a model entry, the actor's word otherwise.
 */
export function actorLabel(entry: Pick<RunEventEntry, "actor" | "modelId">): string {
  if (entry.actor === "model") return entry.modelId?.toUpperCase() ?? UNNAMED_MODEL;

  return ACTOR_LABEL[entry.actor];
}

/**
 * One entry, ready to draw.
 *
 * @param entry The entry.
 * @param live Whether it is the live entry.
 * @returns The view.
 */
export function entryView(entry: RunEventEntry, live = false): EntryView {
  const tag = entry.toolTag ?? null;
  const diff = readHunks(entry.payload);
  const progress = readProgress(entry.payload, tag);
  const result = readResult(entry.payload);
  const body = entry.body ?? null;
  const label = actorLabel(entry);
  const time = clockTime(entry.ts);

  // A diff and a meter are the entry's content: the path or the command moves to the head.
  const bodyMoves = diff !== null || progress !== null;

  return {
    key: entry.seq,
    time,
    dateTime: entry.ts,
    actor: entry.actor,
    actorLabel: label,
    tag,
    headNote: bodyMoves ? body : null,
    body: bodyMoves ? null : body,
    bodyStyle: BODY_STYLE[entry.actor],
    diff,
    result,
    progress,
    elision: entry.elision === undefined ? null : elisionText(entry.elision),
    live,
    chip: null,
    accessibleName: [time, tag === null ? label : `${label} ${tag}`].filter((part) => part !== "").join(", "),
  };
}

/**
 * The entries a stage filter keeps.
 *
 * @param entries The held entries.
 * @param stage The stage the stepper selected, or `null` for all of them.
 * @returns The entries whose `stageKey` is the stage, or all of them.
 */
export function filterEntries(
  entries: readonly RunEventEntry[],
  stage: string | null,
): readonly RunEventEntry[] {
  return stage === null ? entries : entries.filter((entry) => entry.stageKey === stage);
}

/**
 * Which entry is live: the newest one, while its payload says it is still running.
 *
 * An older `running` entry is history — the tool finished and wrote a new entry — so only the
 * newest can be live.
 *
 * @param entries The held entries, oldest first.
 * @returns Its `seq`, or `null`.
 */
export function liveSeq(entries: readonly RunEventEntry[]): number | null {
  const newest = entries.at(-1);

  return newest !== undefined && isRunning(newest.payload) ? newest.seq : null;
}

/**
 * A steer's delivery chip.
 *
 * @param steer The steer.
 * @param polled The same control as the controls poll last reported it, or `undefined` before
 *   the poll has it — the submission's own answer stands in until then.
 * @returns `Steer · sending`, `Steer · sent`, `Steer · acknowledged` (the ack's words as its
 *   detail — *"steering applied to attempt 2"*), `Steer · no response …`, or the refusal.
 */
export function steerChip(steer: SentSteer, polled: RunControl | undefined): DeliveryChip {
  if (steer.failure !== null) return deliveryChip("steer", "rejected", steer.failure);

  const control = polled ?? steer.control;
  if (control === null) return deliveryChip("steer", "sending");

  return deliveryChip("steer", control.state, control.detail);
}

/**
 * The entries to draw, with this page's steers placed.
 *
 * Each steer claims the first `user` entry after the cursor it was sent at whose body is the
 * steer's text — the service's mirror of it — and its chip is drawn there. A steer whose mirror
 * has not arrived yet is drawn as an optimistic `USER` entry at the end, chip and all.
 *
 * @param entries The entries to draw (already filtered), as views, oldest first.
 * @param raw The same entries, as the stream holds them.
 * @param steers The steers this page sent, oldest first.
 * @param chips Each steer's chip, by `localId`.
 * @param showOptimistic Whether unplaced steers are drawn — `false` while a stage filter hides
 *   the current attempt's entries.
 * @returns The views to draw.
 */
export function placeSteers(
  entries: readonly EntryView[],
  raw: readonly RunEventEntry[],
  steers: readonly SentSteer[],
  chips: ReadonlyMap<number, DeliveryChip>,
  showOptimistic = true,
): EntryView[] {
  const claimed = new Map<number, DeliveryChip>();
  const pending: SentSteer[] = [];

  for (const steer of steers) {
    const mirror = raw.find(
      (entry) =>
        entry.actor === "user" &&
        entry.seq > steer.afterSeq &&
        (entry.body ?? "").trim() === steer.text &&
        !claimed.has(entry.seq),
    );
    const chip = chips.get(steer.localId) ?? null;

    if (mirror === undefined) pending.push(steer);
    else if (chip !== null) claimed.set(mirror.seq, chip);
  }

  const placed = entries.map((entry) => {
    const chip = claimed.get(entry.key);
    return chip === undefined ? entry : { ...entry, chip };
  });

  if (!showOptimistic) return placed;

  return [
    ...placed,
    ...pending.map((steer) => ({
      ...entryView({
        seq: steer.localId,
        ts: steer.sentAt,
        actor: "user" as const,
        body: steer.text,
        simulated: false,
      }),
      chip: chips.get(steer.localId) ?? null,
    })),
  ];
}

/**
 * What the live region says after a poll.
 *
 * One sentence per poll, counting — never the entries themselves, which would read a diff aloud
 * line by line every five seconds.
 *
 * @param added How many entries the poll added.
 * @returns `1 new transcript entry`, `3 new transcript entries`, or `""`.
 */
export function announcement(added: number): string {
  if (added <= 0) return "";

  return added === 1 ? "1 new transcript entry" : `${added} new transcript entries`;
}
