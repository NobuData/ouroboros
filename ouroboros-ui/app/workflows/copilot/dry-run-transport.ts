import { type TransportOutcome, type TransportRefusal, UNREACHABLE_CODE, readRefusal } from "./conversation-transport";
import {
  DRY_RUN_EVENT_KINDS,
  type DryRun,
  type DryRunApplied,
  type DryRunCandidate,
  type DryRunExplanation,
  type DryRunStreamEvent,
  type DryRunSuggestion,
  isLive,
} from "./dry-run";

/**
 * How the dry-run card reaches the service from the browser (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)) — the client's half of this origin's
 * pass-through routes (`app/api/workflows/[id]/dry-runs/…`), which exist because the browser
 * cannot reach `ouroboros-rest`.
 *
 * Two things live here, each behind a seam a test replaces:
 *
 * - a {@link DryRunTransport} — the card's four reads and five writes. Every call answers a
 *   value or **a refusal as a value**, with the service's status, code and sentence, so the card
 *   can draw the refusal where the reader is looking and never has to catch;
 * - {@link followDryRun} — a run in flight, followed over server-sent events with `EventSource`
 *   and, where there is none or the stream drops, by reading the run every three seconds until it
 *   ends.
 *
 * ### Why `done` closes the source
 *
 * An `EventSource` reconnects by itself whenever its connection closes — and once a run has
 * ended the service would answer `done` again, for ever. So the follower closes the source on
 * `done`. A connection that is lost *before* `done` is not left to the browser's reconnect
 * either: the follower closes it and polls, because a poll is the one path that is certain to
 * notice the run ending.
 */

/** What a request that never got an answer says. */
export const UNREACHABLE_DRY_RUN = "The dry-run service could not be reached. Check your connection and try again.";

/** What an answer this page cannot read says. */
export const UNREADABLE_DRY_RUN = "The service answered in a shape this page could not read.";

/** What a start names. */
export interface StartBody {
  /** The canonical ticket to run against. */
  readonly ticketId: string;
  /** The draft revision the reader is looking at. */
  readonly draftRev: number;
  /** The active conversation, so the run's debrief reaches it. */
  readonly sessionId?: string;
}

/** The card's reads and writes. */
export interface DryRunTransport {
  /** Read one run. */
  detail(workflowId: string, dryRunId: string): Promise<TransportOutcome<DryRun>>;
  /** Read a run's suggestions, in card order. */
  suggestions(workflowId: string, dryRunId: string): Promise<TransportOutcome<readonly DryRunSuggestion[]>>;
  /** Read the picker's ranked candidates. */
  candidates(workflowId: string): Promise<TransportOutcome<readonly DryRunCandidate[]>>;
  /** Read how a suggestion was derived. */
  explanation(workflowId: string, dryRunId: string, suggestionId: string): Promise<TransportOutcome<DryRunExplanation>>;
  /** Start a run. */
  start(workflowId: string, body: StartBody): Promise<TransportOutcome<DryRun>>;
  /** Stop a run in flight. */
  cancel(workflowId: string, dryRunId: string): Promise<TransportOutcome<DryRun>>;
  /** Run it again, on the draft as it is now. */
  rerun(workflowId: string, dryRunId: string): Promise<TransportOutcome<DryRun>>;
  /** Apply a suggestion's operations. */
  apply(workflowId: string, dryRunId: string, suggestionId: string): Promise<TransportOutcome<DryRunApplied>>;
  /** Ignore a suggestion. */
  ignore(workflowId: string, dryRunId: string, suggestionId: string): Promise<TransportOutcome<DryRunSuggestion>>;
}

/**
 * This origin's route for a workflow's dry runs.
 *
 * @param workflowId The workflow.
 * @returns `/api/workflows/{id}/dry-runs`, the id encoded.
 */
export function dryRunsUrl(workflowId: string): string {
  return `/api/workflows/${encodeURIComponent(workflowId)}/dry-runs`;
}

/**
 * This origin's route for one dry run, or for something under it.
 *
 * @param workflowId The workflow.
 * @param dryRunId The dry run.
 * @param rest What follows it. Omitted, the run itself.
 * @returns `…/dry-runs/{dryRunId}` or `…/dry-runs/{dryRunId}/{rest}`.
 */
export function dryRunUrl(
  workflowId: string,
  dryRunId: string,
  rest?: "events" | "cancel" | "rerun" | "suggestions",
): string {
  const run = `${dryRunsUrl(workflowId)}/${encodeURIComponent(dryRunId)}`;

  return rest === undefined ? run : `${run}/${rest}`;
}

/**
 * This origin's route for one suggestion's explanation, or for settling it.
 *
 * @param workflowId The workflow.
 * @param dryRunId The dry run.
 * @param suggestionId The suggestion.
 * @param rest `explanation`, `apply` or `ignore`.
 * @returns `…/suggestions/{suggestionId}/{rest}`.
 */
export function suggestionUrl(
  workflowId: string,
  dryRunId: string,
  suggestionId: string,
  rest: "explanation" | "apply" | "ignore",
): string {
  return `${dryRunUrl(workflowId, dryRunId, "suggestions")}/${encodeURIComponent(suggestionId)}/${rest}`;
}

/** The refusal for a request that never got an answer. */
const UNREACHABLE: TransportRefusal = { status: 0, code: UNREACHABLE_CODE, message: UNREACHABLE_DRY_RUN };

/**
 * Make one request of this origin and read its JSON.
 *
 * @param fetcher How to fetch.
 * @param url The route.
 * @param method `GET` or `POST`.
 * @param body A `POST`'s body.
 * @param pick What to take from the answer; `null` for an answer that is not the expected shape.
 * @returns The value, or the refusal.
 */
async function request<T>(
  fetcher: typeof fetch,
  url: string,
  method: "GET" | "POST",
  body: unknown,
  pick: (answer: unknown) => T | null,
): Promise<TransportOutcome<T>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, refusal: UNREACHABLE };
  }

  if (!response.ok) return { ok: false, refusal: await readRefusal(response) };

  let answer: unknown = null;
  try {
    answer = await response.json();
  } catch {
    // Not JSON: the refusal below is all there is to say.
  }

  const value = pick(answer);

  return value === null
    ? { ok: false, refusal: { status: response.status, code: UNREACHABLE_CODE, message: UNREADABLE_DRY_RUN } }
    : { ok: true, value };
}

/**
 * An answer as an object, or `null`.
 *
 * @param answer What arrived.
 * @returns The object.
 */
function object(answer: unknown): Record<string, unknown> | null {
  return typeof answer === "object" && answer !== null && !Array.isArray(answer)
    ? (answer as Record<string, unknown>)
    : null;
}

/**
 * Whether a payload is shaped like a run — enough to draw rows from.
 *
 * @param answer What arrived.
 * @returns The run, or `null`.
 */
export function asDryRun(answer: unknown): DryRun | null {
  const run = object(answer);

  return run !== null && typeof run.id === "string" && typeof run.status === "string" && Array.isArray(run.stages)
    ? (run as unknown as DryRun)
    : null;
}

/**
 * Make a transport over a `fetch`.
 *
 * @param fetcher How to fetch. Defaults to the global, looked up at each call.
 * @returns The transport.
 */
export function createDryRunTransport(fetcher: typeof fetch = (input, init) => fetch(input, init)): DryRunTransport {
  const list =
    <T>(key: string) =>
    (answer: unknown): readonly T[] | null => {
      const items = object(answer)?.[key];

      return Array.isArray(items) ? (items as T[]) : null;
    };
  const keyed =
    <T>(key: string) =>
    (answer: unknown): T | null => {
      const value = object(answer);

      return value !== null && key in value ? (value as unknown as T) : null;
    };

  return {
    detail: (workflowId, dryRunId) => request(fetcher, dryRunUrl(workflowId, dryRunId), "GET", null, asDryRun),
    suggestions: (workflowId, dryRunId) =>
      request(fetcher, dryRunUrl(workflowId, dryRunId, "suggestions"), "GET", null, list<DryRunSuggestion>("suggestions")),
    candidates: (workflowId) =>
      request(fetcher, `${dryRunsUrl(workflowId)}/candidates`, "GET", null, list<DryRunCandidate>("candidates")),
    explanation: (workflowId, dryRunId, suggestionId) =>
      request(
        fetcher,
        suggestionUrl(workflowId, dryRunId, suggestionId, "explanation"),
        "GET",
        null,
        keyed<DryRunExplanation>("evidence"),
      ),
    start: (workflowId, body) => request(fetcher, dryRunsUrl(workflowId), "POST", body, asDryRun),
    cancel: (workflowId, dryRunId) => request(fetcher, dryRunUrl(workflowId, dryRunId, "cancel"), "POST", {}, asDryRun),
    rerun: (workflowId, dryRunId) => request(fetcher, dryRunUrl(workflowId, dryRunId, "rerun"), "POST", {}, asDryRun),
    apply: (workflowId, dryRunId, suggestionId) =>
      request(
        fetcher,
        suggestionUrl(workflowId, dryRunId, suggestionId, "apply"),
        "POST",
        {},
        keyed<DryRunApplied>("draftLabel"),
      ),
    ignore: (workflowId, dryRunId, suggestionId) =>
      request(
        fetcher,
        suggestionUrl(workflowId, dryRunId, suggestionId, "ignore"),
        "POST",
        {},
        keyed<DryRunSuggestion>("status"),
      ),
  };
}

/** The transport the card uses in a browser. */
export const browserDryRunTransport: DryRunTransport = createDryRunTransport();

/* ------------------------------------------------------------------ following a run */

/** How often a run is read when its stream cannot be followed, in milliseconds. */
export const FOLLOW_POLL_MS = 3000;

/** The part of a message event the follower reads. */
export interface FollowMessage {
  /** The `data:` line — JSON, or undefined on the browser's own connection event. */
  readonly data?: unknown;
}

/** The part of an `EventSource` the follower uses — what a fake provides in a test. */
export interface FollowSource {
  addEventListener(type: string, listener: (event: FollowMessage) => void): void;
  close(): void;
}

/** How a source is opened; `null` where the runtime has no `EventSource`. */
export type FollowSourceFactory = (url: string) => FollowSource | null;

/** What a follower is told. */
export interface FollowHandlers {
  /** An event of the stream. */
  readonly onEvent: (event: DryRunStreamEvent) => void;
  /** The run, as a poll read it. */
  readonly onDetail: (run: DryRun) => void;
  /** The stream could not be followed; the run is polled from here. */
  readonly onDropped: () => void;
  /** The run has ended — told once, by whichever path noticed. The follow is over. */
  readonly onEnded: () => void;
}

/** The wiring a test replaces. */
export interface FollowOptions {
  /** How to open the stream. Defaults to the browser's `EventSource`. */
  readonly open?: FollowSourceFactory;
  /** How to read the run for a poll. */
  readonly read: (workflowId: string, dryRunId: string) => Promise<TransportOutcome<DryRun>>;
  /** The poll's interval. Defaults to {@link FOLLOW_POLL_MS}. */
  readonly intervalMs?: number;
}

/** How the card follows a run — {@link followDryRun} by default; a test hands in its own. */
export type DryRunFollower = (
  workflowId: string,
  dryRunId: string,
  handlers: FollowHandlers,
  options: FollowOptions,
) => () => void;

/**
 * Open the browser's `EventSource` on a URL.
 *
 * @param url The stream.
 * @returns The source — or `null` where the runtime has none (a test document), which sends the
 *   follower straight to its poll.
 */
function browserSource(url: string): FollowSource | null {
  return typeof EventSource === "undefined" ? null : new EventSource(url);
}

/**
 * Read one event of the stream.
 *
 * @param kind The event's name.
 * @param message The message.
 * @returns The event, or `null` for a connection event or a line that is not one.
 */
export function readFollowEvent(kind: string, message: FollowMessage): DryRunStreamEvent | null {
  if (typeof message.data !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(message.data);
  } catch {
    return null;
  }

  const data = object(parsed);
  if (data === null) return null;

  switch (kind) {
    case "accepted":
    case "done": {
      const dryRun = asDryRun(data.dryRun);

      return dryRun === null ? null : { kind, dryRun };
    }
    case "stage_started":
      return typeof data.seq === "number" && typeof data.stageKey === "string" && typeof data.displayName === "string"
        ? { kind, seq: data.seq, stageKey: data.stageKey, displayName: data.displayName }
        : null;
    case "stage_finished": {
      const stage = object(data.stage);

      return stage !== null && typeof stage.seq === "number" && typeof stage.stageKey === "string"
        ? { kind, stage: stage as unknown as Extract<DryRunStreamEvent, { kind: "stage_finished" }>["stage"] }
        : null;
    }
    case "guard_blocked":
      return typeof data.guard === "string" && typeof data.call === "string" && typeof data.stageKey === "string"
        ? { kind, guard: data.guard, call: data.call, stageKey: data.stageKey }
        : null;
    default:
      return null;
  }
}

/**
 * Follow a run until it ends or the caller stops.
 *
 * The stream first: each event is handed on, and `done` ends the follow. If there is no
 * `EventSource`, or the connection is lost before `done`, the run is read every interval instead
 * — each reading handed on — until a reading says it has ended. A reading that is refused is
 * skipped: the next interval asks again.
 *
 * @param workflowId The workflow.
 * @param dryRunId The run.
 * @param handlers What to do with each event and reading.
 * @param options How to open the stream and read the run.
 * @returns Stop following. Idempotent; called by the follower itself when the run ends.
 */
export function followDryRun(
  workflowId: string,
  dryRunId: string,
  handlers: FollowHandlers,
  options: FollowOptions,
): () => void {
  const { open = browserSource, read, intervalMs = FOLLOW_POLL_MS } = options;
  let stopped = false;
  let source: FollowSource | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    source?.close();
    if (timer !== null) clearInterval(timer);
  };

  const end = (): void => {
    if (stopped) return;
    stop();
    handlers.onEnded();
  };

  const poll = (): void => {
    if (stopped || timer !== null) return;

    source?.close();
    source = null;
    handlers.onDropped();

    let asking = false;
    timer = setInterval(() => {
      if (asking || stopped) return;
      asking = true;

      void read(workflowId, dryRunId)
        .then((outcome) => {
          if (stopped || !outcome.ok) return;

          handlers.onDetail(outcome.value);
          if (!isLive(outcome.value.status)) end();
        })
        .finally(() => {
          asking = false;
        });
    }, intervalMs);
  };

  source = open(dryRunUrl(workflowId, dryRunId, "events"));
  if (source === null) {
    poll();
    return stop;
  }

  for (const kind of DRY_RUN_EVENT_KINDS) {
    source.addEventListener(kind, (message) => {
      if (stopped) return;

      const event = readFollowEvent(kind, message);
      if (event === null) return;

      handlers.onEvent(event);
      if (event.kind === "done") end();
    });
  }

  // The browser's own connection event: the stream dropped before `done`.
  source.addEventListener("error", () => poll());

  return stop;
}
