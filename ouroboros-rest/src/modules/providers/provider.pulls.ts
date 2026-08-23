/**
 * Server-side pull tracking — the half of AC.4 that makes a progress bar honest after a reload.
 *
 * AC.4 ([#219](https://github.com/NobuData/ouroboros/issues/219)). `adapters/ollama.adapter.ts`
 * knows how to ask a daemon for a model and turn its NDJSON into
 * {@link ModelPullProgress}; this knows nothing about Ollama at all and does the other thing:
 * it **consumes that stream on the server**, writes what it says to a record, and answers *where
 * did it get to* to whoever asks next.
 *
 * ```
 * request(a, qwen3-coder:32b) ─▶ running · pulling manifest      ┐ one lane per connection
 * request(a, llama4:scout)    ─▶ queued                          │ one active pull in it
 * request(a, qwen3-coder:32b) ─▶ running · the same record       ┘ asking twice is not two pulls
 *
 * find(a, llama4:scout)       ─▶ { state: running, percent: 61 } ← after a reload, a restart,
 *                                                                  or a different browser
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why a pull cannot be tracked in the browser, which is the whole reason this file exists.**
 *
 * A pull of `llama4:scout` moves 63 GB. It takes minutes, and the person who started it will
 * navigate away, reload, close the tab, and come back. A progress bar driven by a streamed HTTP
 * response is a progress bar that resets to nothing the moment any of that happens — and worse,
 * it makes the *transfer itself* depend on a browser staying connected, so a closed tab either
 * abandons a half-finished 63 GB download or leaves one running that nothing can report on.
 *
 * So the stream is consumed here, by the process, exactly once, and what AE.4
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)) renders is a *reading* of a record
 * rather than a subscription to a socket. That is what makes AC.4's third acceptance criterion —
 * *reloading the page mid-pull shows the pull still running at its current percentage* — a
 * property of the design rather than something a front end has to be careful about.
 *
 * **What survives, precisely.** A page reload, a browser restart, a second browser, a different
 * person on the same workspace: all of them see the same record, because none of them is where
 * it lives. A **process** restart does not, and this file does not pretend otherwise — the
 * records are in memory, `provider_models` is the only provider table V017 gives us, and a
 * `model_pulls` table is not something AC.4 is entitled to invent. A restart mid-pull leaves the
 * daemon finishing the transfer on its own and the next discovery finding the model present,
 * which is the honest outcome rather than a resumed progress bar with nothing behind it.
 *
 * ---------------------------------------------------------------------------
 * **One active pull per connection, and the second one queues.**
 *
 * {@link MAX_ACTIVE_PULLS_PER_CONNECTION} is `1`. Two concurrent 63 GB transfers to the same box
 * do not finish in half the time; they finish in the same total time having spent it competing
 * for one disk and one network link, with both progress bars crawling. So a second request goes
 * into a **queued** state and starts when the first finishes — which is AC.4's fourth acceptance
 * criterion, and deliberately the whole of it. Ordering, cancellation, disk-space awareness and
 * a queue a person can rearrange are AF.5's
 * ([#238](https://github.com/NobuData/ouroboros/issues/238)); what is here is FIFO and says so.
 *
 * Requesting a model that is already queued or running answers the **existing** record rather
 * than adding a second. Somebody clicking **Pull latest** twice because the first click did not
 * appear to do anything is the commonest interaction there is, and two records for one model
 * would render as two rows for one transfer.
 *
 * ---------------------------------------------------------------------------
 * **Why this takes a thunk rather than an adapter and a connection.**
 *
 * {@link ModelPullRequest.open} is `() => AsyncIterable<ModelPullProgress>`, so a caller writes
 * `() => registry.pullCapable(kind).pullModel(connection, modelId)` and **no credential ever
 * reaches this file**. That matters more than it looks: a pull is the one operation in this
 * service that lives for minutes, and a design where the tracker held a
 * {@link import("./provider.adapter").ProviderConnectionContext} would be a design where an
 * opened credential's lifetime was *the length of a 63 GB download* rather than the length of a
 * request. Ollama has no credential to hold today, which is exactly why the constraint is cheap
 * to adopt now and expensive to retrofit later.
 *
 * It also keeps the capability gate where it belongs. `ModelProviderRegistry.pullCapable` is the
 * only door to `pullModel`; this file never looks at an adapter, so it cannot become a second
 * one.
 *
 * ---------------------------------------------------------------------------
 * **It holds no controller and writes no row.** `providers.module.ts` explains why the module
 * has no HTTP surface: AD.2 ([#223](https://github.com/NobuData/ouroboros/issues/223)) owns
 * `/api/v1/providers`, and a route written here first is one that ticket would have to negotiate
 * with rather than write. What AE.4 polls is a handler over {@link ModelPullTracker.find} and
 * {@link ModelPullTracker.list}, which is a few lines once there is a connection to resolve.
 */

import { Injectable, type OnModuleDestroy } from "@nestjs/common";

import type { ModelPullProgress } from "./provider.adapter";
import { ProviderAdapterError, type ProviderErrorClass } from "./provider.errors";

/**
 * How many pulls one connection may have in flight.
 *
 * One. See this file's header for why more is slower rather than faster, and why the queue
 * behind it is deliberately the simplest thing that satisfies AC.4.
 */
export const MAX_ACTIVE_PULLS_PER_CONNECTION = 1;

/**
 * How long a finished pull stays readable.
 *
 * Fifteen minutes. Long enough that somebody who started a pull, went to a meeting and came back
 * still sees that it succeeded; short enough that a process is not accumulating a record per
 * pull for its whole life. A finished record is a *notification*, and `provider_models` is where
 * the durable answer lives — the model is either on the host at the next discovery or it is not.
 */
export const PULL_RETENTION_MS = 15 * 60_000;

/**
 * The most finished records one connection keeps, whatever their age.
 *
 * A second bound beside {@link PULL_RETENTION_MS}, because the interesting failure is not a slow
 * leak over hours but a fast one: something looping over a catalog and requesting thirty pulls
 * inside the retention window. The oldest finished records are dropped first; nothing queued or
 * running is ever dropped.
 */
export const MAX_PULL_RECORDS_PER_CONNECTION = 32;

/** What a record's `status` says before the daemon has said anything. */
export const PULL_QUEUED_STATUS = "queued";

/** What it says once the pull is this connection's active one, before the first event. */
export const PULL_STARTING_STATUS = "starting";

/** The `detail` of a pull the process abandoned because it is shutting down. */
export const PULL_INTERRUPTED_DETAIL = "the pull was interrupted before it finished";

/** The `detail` of a stream that ended without saying it had succeeded. */
export const PULL_UNFINISHED_DETAIL = "the pull ended before the host reported success";

/**
 * The `detail` of a failure that carried no provider error class.
 *
 * A `ProviderAdapterError` is what an adapter throws and carries the shared five-word taxonomy.
 * Anything else reaching here is a programming error in this service, and its message stays
 * inside the process for `error.filter.ts`'s reason: a stack trace is not a sentence written for
 * a client.
 */
export const PULL_FAILED_DETAIL = "the pull failed";

/**
 * Where a tracked pull has got to.
 *
 * Four states and no fifth. `queued` and `running` are the two AC.4 names; `succeeded` and
 * `failed` are the two terminal ones a page has to be able to tell apart, because *the model is
 * now on the host* and *it is not* are different facts and only one of them means the pull-list
 * is worth refreshing.
 *
 * There is deliberately no `cancelled`. Cancelling a pull is AF.5's
 * ([#238](https://github.com/NobuData/ouroboros/issues/238)), and a state nothing can reach is a
 * state every consumer has to write a branch for.
 */
export type ModelPullState = "queued" | "running" | "succeeded" | "failed";

/** Whether a state is one nothing will move out of. */
export function isTerminalPullState(state: ModelPullState): boolean {
  return state === "succeeded" || state === "failed";
}

/**
 * One tracked pull, as a reader sees it.
 *
 * A snapshot: every read answers a fresh frozen object rather than a live view, so a caller that
 * holds one while rendering cannot watch it change halfway through a response. That is the same
 * argument `configSchema()` makes about handing out copies, applied to a value that really does
 * change under a reader.
 */
export interface ModelPullRecord {
  /** `provider_connections.id` — which connection this pull is on. */
  readonly connectionId: string;
  /** The model's own id, as {@link import("./provider.adapter").NormalizedModel.id} gave it. */
  readonly modelId: string;
  /** Where it has got to. */
  readonly state: ModelPullState;
  /**
   * What is happening, in the daemon's own words — `pulling manifest`, `verifying sha256 digest`.
   *
   * Before the daemon has said anything it is this module's word instead —
   * {@link PULL_QUEUED_STATUS}, then {@link PULL_STARTING_STATUS}. After a failure it is
   * whatever the daemon last said, left alone on purpose: *what it was doing when it stopped* is
   * the useful half, and {@link state} and {@link detail} already carry the outcome.
   */
  readonly status: string;
  /** Bytes transferred so far, or null while the daemon has not said. */
  readonly completedBytes: number | null;
  /** Bytes in total, or null while the daemon has not said. */
  readonly totalBytes: number | null;
  /**
   * Whole percent complete, or **null when it is not known**.
   *
   * Null rather than zero for {@link ModelPullProgress}'s reason: a manifest is fetched before a
   * size is, so the first few seconds of every pull genuinely have no percentage, and `0%` is a
   * claim about a transfer that has not been measured. AE.4 renders the indeterminate bar for
   * null, which is a different drawing from a bar at its left edge.
   */
  readonly percent: number | null;
  /** When it was asked for. */
  readonly queuedAt: Date;
  /** When it became this connection's active pull; null while it is still queued. */
  readonly startedAt: Date | null;
  /** When it reached a terminal state; null until it has. */
  readonly finishedAt: Date | null;
  /**
   * Which of the five a failure was, or null.
   *
   * Null on a success, and **also null on a failure this service caused** — an interrupted pull
   * is not the daemon's fault and has no place in a taxonomy of what a provider did. A consumer
   * reads {@link state} to know whether it failed and this to know whom to tell.
   */
  readonly errorClass: ProviderErrorClass | null;
  /** The sentence a failure renders as, or null. Never a daemon's own error body. */
  readonly detail: string | null;
}

/** What {@link ModelPullTracker.request} is asked for. */
export interface ModelPullRequest {
  /** `provider_connections.id`. The lane a pull queues in — see this file's header. */
  readonly connectionId: string;
  /** The model to pull, in the daemon's own spelling. */
  readonly modelId: string;
  /**
   * Start the pull.
   *
   * Called at most once, and **not** at request time: a queued pull's `open` is not invoked
   * until it becomes the connection's active one, which is what makes *queued* mean nothing has
   * been asked of the daemon yet.
   *
   * A thunk rather than an adapter and a connection, so no credential reaches this module — see
   * this file's header. In practice:
   * `() => registry.pullCapable(kind).pullModel(connection, modelId)`.
   */
  readonly open: () => AsyncIterable<ModelPullProgress>;
}

/**
 * A tracked pull, as this module holds it.
 *
 * Mutable, private, and never handed out — {@link snapshot} is what crosses the boundary. Split
 * from {@link ModelPullRecord} rather than sharing one type with mutable fields, because a
 * `readonly` on the public shape is the only thing that makes *a reader cannot change this* true
 * for a value that really is being written to from another task.
 */
interface TrackedPull {
  readonly connectionId: string;
  readonly modelId: string;
  readonly open: () => AsyncIterable<ModelPullProgress>;
  state: ModelPullState;
  status: string;
  completedBytes: number | null;
  totalBytes: number | null;
  readonly queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorClass: ProviderErrorClass | null;
  detail: string | null;
  /** Resolved with the terminal snapshot, once. What {@link ModelPullTracker.whenSettled} hands out. */
  readonly settled: Promise<ModelPullRecord>;
  /** {@link settled}'s resolver. Called exactly once, from the drain's `finally`. */
  settle: (record: ModelPullRecord) => void;
}

/** One connection's pulls: what is running, what is waiting, and what has been. */
interface PullLane {
  /**
   * The connection this lane is for.
   *
   * Carried here as well as being the map's key, so the one operation that needs it backwards —
   * dropping a lane that has emptied — is a field read rather than a scan of the map.
   */
  readonly connectionId: string;
  /** Every record, by model id. Includes terminal ones until they are pruned. */
  readonly tracked: Map<string, TrackedPull>;
  /** The queue, oldest first. FIFO — see this file's header on why ordering is AF.5's. */
  readonly waiting: TrackedPull[];
  /** The one that is running, or null. */
  active: TrackedPull | null;
}

/**
 * Whole percent complete, or null when it cannot be known.
 *
 * @param completedBytes - What has arrived, or null.
 * @param totalBytes - How much there is, or null.
 * @returns A whole number from 0 to 100, or null. Floored rather than rounded, so a bar never
 *   reads `100%` while bytes are still moving — the one number on this record that a person
 *   treats as a promise.
 */
export function pullPercent(
  completedBytes: number | null,
  totalBytes: number | null,
): number | null {
  if (completedBytes === null || totalBytes === null || totalBytes <= 0) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.floor((completedBytes / totalBytes) * 100)));
}

/**
 * A tracked pull, as a reader sees it.
 *
 * @param tracked - The live record.
 * @returns A frozen snapshot. `Object.freeze` rather than a convention, because the value is
 *   handed to a caller that will hold it while the original keeps changing.
 */
function snapshot(tracked: TrackedPull): ModelPullRecord {
  return Object.freeze({
    connectionId: tracked.connectionId,
    modelId: tracked.modelId,
    state: tracked.state,
    status: tracked.status,
    completedBytes: tracked.completedBytes,
    totalBytes: tracked.totalBytes,
    percent: pullPercent(tracked.completedBytes, tracked.totalBytes),
    queuedAt: tracked.queuedAt,
    startedAt: tracked.startedAt,
    finishedAt: tracked.finishedAt,
    errorClass: tracked.errorClass,
    detail: tracked.detail,
  });
}

/**
 * Tracks model pulls for as long as this process lives.
 *
 * `@Injectable()`, registered by `providers.module.ts` and exported from it. **One instance for
 * the whole service**, which is what makes a record outlive the request that started it — a
 * request-scoped tracker would be a tracker that forgot everything the moment a page reloaded,
 * which is the failure this class exists to prevent.
 */
@Injectable()
export class ModelPullTracker implements OnModuleDestroy {
  /** One lane per connection. Lanes are created on demand and dropped when they empty. */
  private readonly lanes = new Map<string, PullLane>();

  /** Whether the process is going away. Set by {@link onModuleDestroy}, never cleared. */
  private stopped = false;

  /**
   * Ask for a model to be pulled.
   *
   * Returns **immediately**, with the record as it stands: `running` when this connection had
   * nothing in flight, `queued` when it did. The transfer itself is a detached task — this is
   * not something a caller awaits, and an HTTP handler over it answers `202` rather than holding
   * a connection open for twenty minutes.
   *
   * @param request - What to pull, where, and how to start it.
   * @returns The record. **The existing one** when this model is already queued or running on
   *   this connection — see this file's header on why a second click is not a second pull. A
   *   model that finished earlier is pulled again: *Pull latest* is a real instruction, and a
   *   succeeded record is a notification rather than a lock.
   *
   *   After {@link onModuleDestroy} it is a record in `queued` that nothing will ever start,
   *   because the process is going away and refusing would only mean a `500` on the way out. The
   *   window is the length of a shutdown, and what a caller sees in it is the truth.
   */
  request(request: ModelPullRequest): ModelPullRecord {
    const now = new Date();
    const lane = this.laneFor(request.connectionId);

    this.prune(lane, now);

    const existing = lane.tracked.get(request.modelId);

    if (existing !== undefined && !isTerminalPullState(existing.state)) {
      return snapshot(existing);
    }

    const tracked = this.track(request, now);

    lane.tracked.set(request.modelId, tracked);
    lane.waiting.push(tracked);
    // Synchronous, so a caller that started the only pull on an idle connection is told `running`
    // rather than `queued` — a card that flickered through a queued state it was never really in
    // is a card that looks like it is waiting for something.
    this.pump(lane);

    return snapshot(tracked);
  }

  /**
   * One pull, if anything is known about it.
   *
   * What AE.4 polls: *is the transfer this row started still going, and how far*.
   *
   * @param connectionId - The connection.
   * @param modelId - The model.
   * @returns The record, or `undefined` when this connection has never been asked for that model
   *   — or was, long enough ago that {@link PULL_RETENTION_MS} has taken the record away.
   */
  find(connectionId: string, modelId: string): ModelPullRecord | undefined {
    const lane = this.lanes.get(connectionId);

    if (lane === undefined) {
      return undefined;
    }

    this.prune(lane, new Date());

    const tracked = lane.tracked.get(modelId);
    const record = tracked === undefined ? undefined : snapshot(tracked);

    this.dispose(lane);

    return record;
  }

  /**
   * Every pull known for one connection.
   *
   * What a card asks for on first render, so one request answers every row's state rather than
   * one request per model.
   *
   * @param connectionId - The connection.
   * @returns The records, oldest request first — the order they were asked for, which is the
   *   order a queue is worth reading in. Empty for a connection nothing has pulled on.
   */
  list(connectionId: string): ModelPullRecord[] {
    const lane = this.lanes.get(connectionId);

    if (lane === undefined) {
      return [];
    }

    this.prune(lane, new Date());

    const records = [...lane.tracked.values()]
      .sort((left, right) => left.queuedAt.getTime() - right.queuedAt.getTime())
      .map(snapshot);

    this.dispose(lane);

    return records;
  }

  /**
   * The pull this connection is currently transferring, if any.
   *
   * @param connectionId - The connection.
   * @returns The active record, or `undefined`. Separate from {@link list} because *may I start
   *   one* is a different question from *what is the state of everything*, and a caller that had
   *   to filter a list for it would be re-deriving {@link MAX_ACTIVE_PULLS_PER_CONNECTION}.
   */
  active(connectionId: string): ModelPullRecord | undefined {
    const active = this.lanes.get(connectionId)?.active ?? null;

    return active === null ? undefined : snapshot(active);
  }

  /**
   * A promise for one pull's terminal record.
   *
   * Not what a page uses — a browser polls {@link find}, because a promise cannot survive a
   * reload and that is the whole point of this class. What it is for is a caller inside this
   * process that genuinely has to wait: a test, and any future work that wants to refresh
   * `provider_models` the moment a pull lands.
   *
   * @param connectionId - The connection.
   * @param modelId - The model.
   * @returns The record as it will be when the pull settles, or `undefined` when nothing is known
   *   about that pull. Already-terminal records resolve immediately.
   */
  whenSettled(connectionId: string, modelId: string): Promise<ModelPullRecord> | undefined {
    return this.lanes.get(connectionId)?.tracked.get(modelId)?.settled;
  }

  /**
   * Stop starting pulls, and let the running one go.
   *
   * Synchronous on purpose. Nest awaits an `onModuleDestroy` that returns a promise, and waiting
   * for a 63 GB transfer to notice it should stop would turn every deployment into a shutdown
   * that hangs. So this marks what is queued and what is running as interrupted, and the drain
   * loop finds the flag at its next event and stops reading — which cancels the response body,
   * which closes the socket.
   *
   * The record says `failed` with **no error class**, because the failure is this service's and
   * the taxonomy describes what a *provider* did. The daemon, meanwhile, carries on pulling: an
   * Ollama pull is the daemon's own work, not this process's, and the next discovery will find
   * the model there. That is the honest outcome and it is worth knowing rather than papering
   * over.
   */
  onModuleDestroy(): void {
    this.stopped = true;

    for (const lane of this.lanes.values()) {
      for (const tracked of [...lane.waiting, ...(lane.active === null ? [] : [lane.active])]) {
        this.finish(tracked, "failed", null, PULL_INTERRUPTED_DETAIL);
      }

      lane.waiting.length = 0;
    }
  }

  /**
   * This connection's lane, created if it has none.
   *
   * @param connectionId - The connection.
   * @returns The lane.
   */
  private laneFor(connectionId: string): PullLane {
    const existing = this.lanes.get(connectionId);

    if (existing !== undefined) {
      return existing;
    }

    const lane: PullLane = { connectionId, tracked: new Map(), waiting: [], active: null };

    this.lanes.set(connectionId, lane);

    return lane;
  }

  /**
   * A fresh record, queued.
   *
   * @param request - What was asked for.
   * @param now - When.
   * @returns The tracked pull, with its settled promise already wired.
   */
  private track(request: ModelPullRequest, now: Date): TrackedPull {
    let settle: (record: ModelPullRecord) => void = () => {
      // Replaced synchronously below. The placeholder exists so the field is never `undefined`,
      // which would make the drain's `finally` an optional call that silently did nothing.
    };
    const settled = new Promise<ModelPullRecord>((resolve) => {
      settle = resolve;
    });

    return {
      connectionId: request.connectionId,
      modelId: request.modelId,
      open: request.open,
      state: "queued",
      status: PULL_QUEUED_STATUS,
      completedBytes: null,
      totalBytes: null,
      queuedAt: now,
      startedAt: null,
      finishedAt: null,
      errorClass: null,
      detail: null,
      settled,
      settle,
    };
  }

  /**
   * Start the next pull in a lane, if there is room and there is one.
   *
   * Synchronous up to the point the transfer begins — see {@link request} on why the caller has
   * to be told `running` rather than `queued`.
   *
   * @param lane - The lane.
   */
  private pump(lane: PullLane): void {
    if (this.stopped || lane.active !== null) {
      return;
    }

    const next = lane.waiting.shift();

    if (next === undefined) {
      this.dispose(lane);

      return;
    }

    lane.active = next;
    next.state = "running";
    next.status = PULL_STARTING_STATUS;
    next.startedAt = new Date();

    void this.drain(lane, next);
  }

  /**
   * Consume one pull's stream to its end, writing what it says to the record.
   *
   * The detached task. Nothing awaits it — {@link request} returns as soon as this is running,
   * and every failure is turned into a state rather than a rejection, because there is no caller
   * left to reject to. A `void this.drain(…)` that could throw would be an unhandled rejection
   * taking the process down over a daemon that went away.
   *
   * @param lane - The lane, so the next queued pull can be started afterwards.
   * @param tracked - The record to write to.
   */
  private async drain(lane: PullLane, tracked: TrackedPull): Promise<void> {
    let finished = false;

    try {
      for await (const progress of tracked.open()) {
        tracked.status = progress.status;
        tracked.completedBytes = progress.completedBytes;
        tracked.totalBytes = progress.totalBytes;
        finished = progress.done;

        if (this.stopped) {
          // The consumer stopping is what closes the socket: leaving this loop runs the
          // generator's `finally`, which cancels the response body. See `onModuleDestroy`.
          break;
        }
      }

      if (this.stopped) {
        this.finish(tracked, "failed", null, PULL_INTERRUPTED_DETAIL);
      } else if (finished) {
        this.finish(tracked, "succeeded", null, null);
      } else {
        // The adapter already refuses a stream that ends without saying it succeeded, so this is
        // reachable only through a pull source that does not. It is still a state rather than a
        // crash, because *the model may or may not be there* is exactly what a card has to say.
        this.finish(tracked, "failed", "upstream", PULL_UNFINISHED_DETAIL);
      }
    } catch (error) {
      // The five-word taxonomy when the adapter threw one, and nothing at all when it did not:
      // an error this service produced is not a statement about what a provider did, and its
      // message stays inside the process.
      const failure = ProviderAdapterError.is(error)
        ? { errorClass: error.errorClass, detail: error.detail }
        : { errorClass: null, detail: PULL_FAILED_DETAIL };

      this.finish(tracked, "failed", failure.errorClass, failure.detail);
    } finally {
      lane.active = null;
      this.pump(lane);
    }
  }

  /**
   * Move a record to a terminal state, once.
   *
   * Idempotent, because two things can reach for it: the drain's own outcome, and
   * {@link onModuleDestroy} marking a running pull interrupted a moment before the drain notices.
   * Whichever gets there first is the answer — a shutdown that overwrote a `succeeded` with
   * `failed` would report a model that really did arrive as one that did not.
   *
   * @param tracked - The record.
   * @param state - The terminal state.
   * @param errorClass - Which of the five, or null.
   * @param detail - The sentence, or null.
   */
  private finish(
    tracked: TrackedPull,
    state: ModelPullState,
    errorClass: ProviderErrorClass | null,
    detail: string | null,
  ): void {
    if (isTerminalPullState(tracked.state)) {
      return;
    }

    tracked.state = state;
    tracked.errorClass = errorClass;
    tracked.detail = detail;
    tracked.finishedAt = new Date();
    tracked.settle(snapshot(tracked));
  }

  /**
   * Forget the finished records a lane no longer needs.
   *
   * Called on every read as well as on every request, so a connection nobody is pulling on any
   * more still stops holding records — there is no sweeper, and a class whose cleanup depended
   * on one would be a class that leaks whenever the sweeper is the thing that broke.
   *
   * It deliberately does **not** {@link dispose} of the lane afterwards. `request` prunes a lane
   * it is about to insert into — a brand-new one is empty — and a lane dropped from the map there
   * would be one every subsequent read looked past.
   *
   * @param lane - The lane.
   * @param now - The moment to measure ages against.
   */
  private prune(lane: PullLane, now: Date): void {
    const finishedFirst: TrackedPull[] = [];

    for (const tracked of lane.tracked.values()) {
      if (!isTerminalPullState(tracked.state) || tracked.finishedAt === null) {
        continue;
      }

      if (now.getTime() - tracked.finishedAt.getTime() >= PULL_RETENTION_MS) {
        lane.tracked.delete(tracked.modelId);
      } else {
        finishedFirst.push(tracked);
      }
    }

    // The count bound, applied after the age one so a burst inside the window is still cut back.
    // Oldest finished first; nothing queued or running is a candidate.
    const excess = lane.tracked.size - MAX_PULL_RECORDS_PER_CONNECTION;

    if (excess > 0) {
      finishedFirst
        .sort(
          (left, right) => (left.finishedAt?.getTime() ?? 0) - (right.finishedAt?.getTime() ?? 0),
        )
        .slice(0, excess)
        .forEach((tracked) => lane.tracked.delete(tracked.modelId));
    }
  }

  /**
   * Drop a lane that has nothing left in it.
   *
   * Without this, a long-lived process holds one map per connection anybody has ever pulled on —
   * small, but unbounded, and unbounded is the property that matters. `laneFor` builds another
   * the next time one is asked for, so dropping is free.
   *
   * A lane is only empty once its last record has been pruned, which happens well after the
   * transfer finished — so there is no window in which a draining task is holding a lane this
   * has already removed from the map. It is called from the two reads and from {@link pump}, and
   * never from {@link request}, which prunes a lane in order to add to it.
   *
   * @param lane - The lane.
   */
  private dispose(lane: PullLane): void {
    if (lane.active === null && lane.waiting.length === 0 && lane.tracked.size === 0) {
      this.lanes.delete(lane.connectionId);
    }
  }
}
