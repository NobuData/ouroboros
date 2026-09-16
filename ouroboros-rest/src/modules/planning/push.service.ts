/**
 * `PushService` — a planning batch's drafts become real tickets, idempotently and resumably.
 *
 * AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)), decisions **N4** and **N6**.
 * *"Pushing six tickets that half-fail must never create nine issues."*
 *
 * ```
 * push(org, batch) / resume(org, batch)
 *   ├─ batch + source, inside the workspace asking             (isolation)
 *   ├─ registry.find(kind) → supportsWrites, or 409             (SPI only — never a provider import)
 *   ├─ pushOrder(drafts, edges) — blockers first, or 422 naming the cycle
 *   ├─ ensureMilestone · ensureEpicContainer (epic_mirrors first)
 *   └─ each pending|failed draft, in order
 *        createTicket(key = batch:draft)        the provider probes before it creates
 *        linkDependency(blocker → it)           every blocker already exists
 *        attachToEpic(it, mirror)
 *        recordPushed ── one transaction: ticket · draft pushed · dep ends rewritten · epic count
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Why a crash anywhere is safe.** Every tracker call is idempotent (AL.2's contract, and the
 * write kit's), and a draft is marked pushed only in the transaction that records its ticket. So a
 * process killed after the tracker's `201` and before that commit leaves the draft `pending`, and
 * the resume's `createTicket` finds the issue by its key rather than filing a second. A process
 * killed after the commit leaves nothing for the resume to touch — it re-runs only `pending` and
 * `failed` drafts.
 *
 * **Why a throttle stops the walk and a refusal does not.** A `rate_limit` says *everything* will
 * be refused until a time, so pressing on would only turn every remaining draft into a failure the
 * next resume has to undo; the walk stops, the untouched drafts stay `pending`, and the report
 * carries `retryAt`. Any other refusal is about *this* draft — a payload the tracker rejected — so
 * it is recorded as a structured `push_error` and the walk continues with drafts that do not
 * depend on it. A draft whose blocker has not been pushed is not created at all, because nothing
 * could reference a blocker that does not exist; it records `blocker_not_pushed`, and the resume
 * re-runs both.
 *
 * **What is not linked.** A dependency on an unselected draft (nobody is pushing it) or on a
 * ticket in another source (a relation cannot cross trackers) stays in `ticket_dependencies` as
 * planned and is not sent anywhere.
 *
 * **One push per batch at a time**, per process — `inFlight`, the same guard the sync loop keeps.
 * Two replicas racing the same batch are still safe against duplicates, because the provider
 * probes before every create; they would only do the work twice.
 *
 * HTTP is AL.4's ([#280](https://github.com/NobuData/ouroboros/issues/280)): `POST /:batch/push`
 * calls {@link PushService.push}, and **Resume push** calls {@link PushService.resume}.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import type {
  DraftBatchStatus,
  DraftPushError,
  DraftPushState,
  EpicMirrorKind,
} from "../db/schema";
import { describeForLog } from "../errors/failure";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import {
  supportsWrites,
  type TicketSyncContext,
  type WriteCapableProvider,
} from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import type {
  DependencyLinkMode,
  EpicMapping,
  EpicMirrorRef,
  MilestoneRef,
  TicketWriteRef,
} from "../ticket-sources/ticket-source.write";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import { TicketSourcesService } from "../ticket-sources/ticket-sources.service";
import {
  asTrackerFailure,
  batchNotFound,
  blockerNotPushedError,
  dependencyCycle,
  draftPushError,
  nothingSelected,
  nothingToResume,
  notPushable,
  pushInProgress,
  targetReadOnly,
  type PushStep,
} from "./push.errors";
import { DependencyCycleError, pushOrder } from "./push.order";
import {
  PushRepository,
  type PushBatch,
  type PushDraft,
  type PushEdge,
  type PushStore,
  type PushTicket,
} from "./push.repository";

/** What opens a source's credential for the length of one push — `TicketSourcesService`'s. */
export interface SourceOpener {
  /**
   * @param source - The source.
   * @param run - What to do with the opened context.
   * @returns What `run` returned.
   */
  withCredentials<T>(
    source: SyncSource,
    run: (context: TicketSyncContext) => Promise<T>,
  ): Promise<T>;
}

/** How a push run ended. */
export type PushOutcome =
  /** Every selected draft is a ticket. */
  | "pushed"
  /** Some drafts failed; a resume re-runs them. */
  | "partial"
  /** The tracker is rate limiting; a resume after `retryAt` continues. */
  | "throttled";

/** One draft, as a push report shows it. */
export interface PushDraftReport {
  /** `ticket_drafts.id`. */
  readonly draftId: string;
  /** `OTA-3`. */
  readonly localKey: string;
  /** Where it is now. */
  readonly pushState: DraftPushState;
  /** The canonical ticket, once pushed. */
  readonly ticketId: string | null;
  /** Its identity in the tracker — the `pushed ✓ #612` link — once pushed. */
  readonly ticket: TicketWriteRef | null;
  /** Why it failed, when it did. */
  readonly error: DraftPushError | null;
}

/** What one push run did, and where the batch stands. */
export interface PushReport {
  /** The batch. */
  readonly batchId: string;
  /** How the run ended. */
  readonly outcome: PushOutcome;
  /** The batch's status after the run. */
  readonly batchStatus: DraftBatchStatus;
  /** How many drafts became tickets in this run. */
  readonly pushedThisRun: number;
  /**
   * The dependency links this run made, by the mode that ran — *the UI is told which mode ran*.
   * A tracker without native relations reports every link as `fallback`.
   */
  readonly links: Readonly<Record<DependencyLinkMode, number>>;
  /** When a throttled push may resume, when the tracker said. */
  readonly retryAt: Date | null;
  /** The milestone assigned, or null. */
  readonly milestone: MilestoneRef | null;
  /** The epic container attached to, or null. */
  readonly epic: EpicMirrorRef | null;
  /** Every selected draft, in local-key order. */
  readonly drafts: readonly PushDraftReport[];
}

/**
 * Which `epic_mirrors.kind` stores a mapping's container — null where V036 has no kind for it,
 * and the container is then ensured on every push instead of remembered.
 */
export const MIRROR_KINDS: Readonly<Record<Exclude<EpicMapping, "none">, EpicMirrorKind | null>> =
  Object.freeze({ parent_issue: "parent_issue", epic: "jira_epic", project: null });

/**
 * The idempotency key a draft is pushed under — decision N6's *batch + draft id*.
 *
 * @param batchId - The batch.
 * @param draftId - The draft.
 * @returns `<batch>:<draft>` — two uuids, 73 characters, inside the SPI's bound.
 */
export function pushKey(batchId: string, draftId: string): string {
  return `${batchId}:${draftId}`;
}

/** A tracker call that failed, and which step it was. */
class StepFailure extends Error {
  /**
   * @param failure - The classified failure.
   * @param step - The step.
   */
  constructor(
    readonly failure: TicketSourceError,
    readonly step: PushStep,
  ) {
    super(failure.detail);
    this.name = "StepFailure";
  }
}

/**
 * Run one tracker call, so its failure is told apart from a database one.
 *
 * @param step - Which step it is.
 * @param call - The call.
 * @returns What it answered.
 * @throws {StepFailure} Whatever the call threw, classified.
 */
async function tracked<T>(step: PushStep, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new StepFailure(asTrackerFailure(error), step);
  }
}

/** Everything one run knows while it walks. */
interface Walk {
  readonly batch: PushBatch;
  readonly provider: WriteCapableProvider;
  /** The opened source — set once the credential is open, and dropped with the run. */
  context: TicketSyncContext | null;
  readonly edges: readonly PushEdge[];
  /** Canonical tickets by id — pushed drafts' and dependency ends'. */
  readonly tickets: Map<string, PushTicket>;
  /** Pushed drafts' refs, by draft id. */
  readonly refs: Map<string, TicketWriteRef>;
  readonly links: Record<DependencyLinkMode, number>;
  milestone: MilestoneRef | null;
  epic: EpicMirrorRef | null;
  pushed: number;
  retryAt: Date | null;
  throttled: boolean;
}

@Injectable()
export class PushService {
  /** Where failed drafts are reported for an operator. Never a credential. */
  private readonly logger = new Logger(PushService.name);

  /** Batches being pushed by this process right now. */
  private readonly inFlight = new Set<string>();

  /**
   * @param store - The database, as the push reads and writes it.
   * @param registry - The providers — reached through the SPI only.
   * @param sources - What opens a source's credential.
   */
  constructor(
    @Inject(PushRepository) private readonly store: PushStore,
    private readonly registry: TicketSourceRegistry,
    @Inject(TicketSourcesService) private readonly sources: SourceOpener,
  ) {}

  /**
   * Push a batch's selected drafts — every one not already pushed.
   *
   * @param organizationId - The workspace asking. The batch must be its own.
   * @param batchId - The batch.
   * @returns What the run did.
   * @throws {NotFoundError} `planning_batch_not_found`.
   * @throws {ConflictError} `push_in_progress`, `batch_not_pushable`, `push_nothing_selected`,
   *   `push_target_read_only`.
   * @throws {InvalidRequestError} `dependency_cycle`, naming it.
   */
  push(organizationId: string, batchId: string): Promise<PushReport> {
    return this.guarded(organizationId, batchId, "push");
  }

  /**
   * Resume a push that stopped short — re-running only `pending` and `failed` drafts.
   *
   * @param organizationId - The workspace asking.
   * @param batchId - The batch.
   * @returns What the run did.
   * @throws {ConflictError} `push_nothing_to_resume`, for a batch no push has started — and every
   *   refusal {@link push} makes.
   */
  resume(organizationId: string, batchId: string): Promise<PushReport> {
    return this.guarded(organizationId, batchId, "resume");
  }

  /**
   * Whether this process is pushing a batch right now.
   *
   * @param batchId - The batch.
   * @returns `true` while a run is in flight.
   */
  isPushing(batchId: string): boolean {
    return this.inFlight.has(batchId);
  }

  /**
   * One run, with the in-flight guard around it.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @param mode - Which entry point was called.
   * @returns The report.
   */
  private async guarded(
    organizationId: string,
    batchId: string,
    mode: "push" | "resume",
  ): Promise<PushReport> {
    if (this.inFlight.has(batchId)) {
      throw pushInProgress(batchId);
    }

    this.inFlight.add(batchId);

    try {
      return await this.run(organizationId, batchId, mode);
    } finally {
      this.inFlight.delete(batchId);
    }
  }

  /**
   * One run — see this file's header.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @param mode - Which entry point was called.
   * @returns The report.
   */
  private async run(
    organizationId: string,
    batchId: string,
    mode: "push" | "resume",
  ): Promise<PushReport> {
    const batch = await this.store.batch(organizationId, batchId);

    if (batch === undefined) {
      throw batchNotFound(batchId);
    }

    if (batch.status === "abandoned" || batch.status === "pushed") {
      throw notPushable(batchId, batch.status);
    }

    if (mode === "resume" && batch.status !== "pushing") {
      throw nothingToResume(batchId);
    }

    const provider = this.registry.find(batch.source.kind);

    if (provider === undefined || !supportsWrites(provider)) {
      throw targetReadOnly(batchId);
    }

    const drafts = await this.store.selectedDrafts(batchId);

    if (drafts.length === 0) {
      throw nothingSelected(batchId);
    }

    const edges = await this.store.dependencies(
      organizationId,
      drafts.map((draft) => draft.id),
    );
    const order = orderOf(batchId, drafts, edges);

    await this.store.setBatchStatus(organizationId, batchId, "pushing");

    const tickets = await this.ticketsFor(organizationId, drafts, edges);
    const walk: Walk = {
      batch,
      provider,
      context: null,
      edges,
      tickets,
      refs: refsOf(drafts, tickets),
      links: { native: 0, fallback: 0 },
      milestone: null,
      epic: null,
      pushed: 0,
      retryAt: null,
      throttled: false,
    };

    await this.walkOpened(walk, order, drafts);

    return this.report(walk);
  }

  /**
   * Open the source's credential and walk the drafts inside it.
   *
   * @param walk - The run, without a context yet.
   * @param order - The drafts in push order.
   * @param drafts - The selected drafts.
   */
  private async walkOpened(
    walk: Walk,
    order: readonly PushDraft[],
    drafts: readonly PushDraft[],
  ): Promise<void> {
    const todo = order.filter((draft) => draft.pushState !== "pushed");
    let opened = false;

    try {
      await this.sources.withCredentials(walk.batch.source, async (context) => {
        opened = true;
        walk.context = context;

        try {
          await this.walk(walk, todo, drafts);
        } finally {
          walk.context = null;
        }
      });
    } catch (error) {
      if (opened || !TicketSourceError.is(error)) {
        throw error;
      }

      await this.failAll(walk.batch.id, todo, error, "credentials");
    }
  }

  /**
   * Ensure the containers, then push each draft in order.
   *
   * @param walk - The run, with its context open.
   * @param todo - The drafts to push, in order.
   * @param drafts - Every selected draft, for blocker names.
   */
  private async walk(
    walk: Walk,
    todo: readonly PushDraft[],
    drafts: readonly PushDraft[],
  ): Promise<void> {
    try {
      walk.milestone = await this.milestoneFor(walk);
      walk.epic = await this.epicFor(walk);
    } catch (error) {
      if (!(error instanceof StepFailure)) {
        throw error;
      }

      if (!this.throttle(walk, error.failure)) {
        await this.failAll(walk.batch.id, todo, error.failure, error.step);
      }

      return;
    }

    const keys = new Map(drafts.map((draft) => [draft.id, draft.localKey]));

    for (const draft of todo) {
      const waiting = walk.edges
        .filter((edge) => edge.blockedDraftId === draft.id && edge.blockerDraftId !== null)
        .map((edge) => edge.blockerDraftId as string)
        .filter((blocker) => keys.has(blocker) && !walk.refs.has(blocker));

      if (waiting.length > 0) {
        await this.store.recordFailed(
          walk.batch.id,
          draft.id,
          blockerNotPushedError(waiting.map((blocker) => keys.get(blocker) as string)),
        );
        continue;
      }

      let ref: TicketWriteRef;

      try {
        ref = await this.pushDraft(walk, draft);
      } catch (error) {
        if (!(error instanceof StepFailure)) {
          throw error;
        }

        if (this.throttle(walk, error.failure)) {
          return;
        }

        this.logger.warn(
          `batch ${walk.batch.id}: ${draft.localKey} failed at ${error.step} ` +
            `(${error.failure.errorClass}).`,
          error.failure.detail,
        );
        await this.store.recordFailed(
          walk.batch.id,
          draft.id,
          draftPushError(error.failure, error.step),
        );
        continue;
      }

      const ticketId = await this.store.recordPushed({
        organizationId: walk.batch.organizationId,
        batchId: walk.batch.id,
        draftId: draft.id,
        sourceId: walk.batch.source.sourceId,
        ref,
        title: draft.title,
        body: draft.body,
        epicId: walk.epic === null ? null : walk.batch.epicId,
        at: new Date(),
      });

      walk.refs.set(draft.id, ref);
      walk.tickets.set(ticketId, { ticketId, sourceId: walk.batch.source.sourceId, ref });
      walk.pushed += 1;
    }
  }

  /**
   * Create one draft's ticket, link it to what blocks it and what it blocks, and attach it.
   *
   * @param walk - The run, with its context open and its containers ensured.
   * @param draft - The draft.
   * @returns The ticket's identity.
   * @throws {StepFailure} When a tracker call failed.
   */
  private async pushDraft(walk: Walk, draft: PushDraft): Promise<TicketWriteRef> {
    const { provider } = walk;
    const context = contextOf(walk);
    const ref = await tracked("create", () =>
      provider.createTicket(context, {
        idempotencyKey: pushKey(walk.batch.id, draft.id),
        title: draft.title,
        body: draft.body,
        labels: [],
        milestone: walk.milestone,
      }),
    );

    for (const edge of walk.edges) {
      let blocker: TicketWriteRef | undefined;
      let blocked: TicketWriteRef | undefined;

      if (edge.blockedDraftId === draft.id) {
        blocker = this.endRef(walk, edge.blockerDraftId, edge.blockerTicketId);
        blocked = ref;
      } else if (edge.blockerDraftId === draft.id && edge.blockedTicketId !== null) {
        // A draft blocking a ticket that already exists: this draft is the one created later.
        blocker = ref;
        blocked = this.endRef(walk, null, edge.blockedTicketId);
      }

      if (blocker === undefined || blocked === undefined) {
        continue;
      }

      const pair = [blocker, blocked] as const;
      const linked = await tracked("link", () => provider.linkDependency(context, ...pair));

      walk.links[linked.mode] += 1;
    }

    const mirror = walk.epic;

    if (mirror !== null) {
      await tracked("attach", () => provider.attachToEpic(context, ref, mirror));
    }

    return ref;
  }

  /**
   * The tracker identity of one dependency end, when it can be linked.
   *
   * @param walk - The run.
   * @param draftId - The end's draft, or null.
   * @param ticketId - The end's ticket, or null.
   * @returns The ref — a pushed draft's, or a ticket's in the push's own source — or undefined for
   *   an unselected draft or a ticket in another tracker.
   */
  private endRef(
    walk: Walk,
    draftId: string | null,
    ticketId: string | null,
  ): TicketWriteRef | undefined {
    if (draftId !== null) {
      return walk.refs.get(draftId);
    }

    const ticket = ticketId === null ? undefined : walk.tickets.get(ticketId);

    return ticket?.sourceId === walk.batch.source.sourceId ? ticket.ref : undefined;
  }

  /**
   * The batch's milestone in the tracker.
   *
   * @param walk - The run.
   * @returns The milestone, or null when the batch names none or the tracker has none.
   * @throws {StepFailure} When the tracker refused.
   */
  private async milestoneFor(walk: Walk): Promise<MilestoneRef | null> {
    const name = walk.batch.targetMilestone;

    return name === null
      ? null
      : tracked("milestone", () => walk.provider.ensureMilestone(contextOf(walk), name));
  }

  /**
   * The batch epic's container in the tracker — the stored mirror when there is one (AK.3), else
   * ensured and remembered.
   *
   * @param walk - The run.
   * @returns The mirror, or null when there is no epic or the tracker maps epics to nothing.
   * @throws {StepFailure} When the tracker refused.
   */
  private async epicFor(walk: Walk): Promise<EpicMirrorRef | null> {
    const { batch, provider } = walk;
    const context = contextOf(walk);
    const mapping = provider.capabilities().write.epicMapping;

    if (batch.epicId === null || mapping === "none") {
      return null;
    }

    const epicId = batch.epicId;
    const kind = MIRROR_KINDS[mapping];
    const sourceId = batch.source.sourceId;
    const stored = kind === null ? undefined : await this.store.epicMirror(epicId, sourceId, kind);

    if (stored !== undefined) {
      return { mapping, externalRef: stored };
    }

    const name = await this.store.epicName(batch.organizationId, epicId);

    if (name === undefined) {
      return null;
    }

    const mirror = await tracked("epic", () =>
      provider.ensureEpicContainer(context, { epicId, title: name, description: null }),
    );

    if (mirror === null || kind === null) {
      return mirror;
    }

    await this.store.saveEpicMirror(epicId, sourceId, kind, mirror.externalRef);

    // Whichever reference was stored first wins, so two racing pushes attach to one container.
    const kept = await this.store.epicMirror(epicId, sourceId, kind);

    return { mapping, externalRef: kept ?? mirror.externalRef };
  }

  /**
   * Record a throttle, when a failure is one.
   *
   * @param walk - The run.
   * @param failure - The failure.
   * @returns `true` when the walk must stop.
   */
  private throttle(walk: Walk, failure: TicketSourceError): boolean {
    if (failure.errorClass !== "rate_limit") {
      return false;
    }

    walk.throttled = true;
    walk.retryAt = failure.retryAt;
    this.logger.warn(`batch ${walk.batch.id}: the tracker is rate limiting; the push stops here.`);

    return true;
  }

  /**
   * Record one failure against every draft still to push.
   *
   * @param batchId - The batch.
   * @param todo - The drafts.
   * @param failure - The failure.
   * @param step - Where it happened.
   */
  private async failAll(
    batchId: string,
    todo: readonly PushDraft[],
    failure: TicketSourceError,
    step: PushStep,
  ): Promise<void> {
    this.logger.warn(
      `batch ${batchId}: ${step} failed (${failure.errorClass}); no draft was pushed.`,
      describeForLog(failure),
    );

    for (const draft of todo) {
      await this.store.recordFailed(batchId, draft.id, draftPushError(failure, step));
    }
  }

  /**
   * The canonical tickets a run needs up front — pushed drafts' and dependency ends'.
   *
   * @param organizationId - The workspace.
   * @param drafts - The selected drafts.
   * @param edges - Their dependencies.
   * @returns The tickets, by id.
   */
  private async ticketsFor(
    organizationId: string,
    drafts: readonly PushDraft[],
    edges: readonly PushEdge[],
  ): Promise<Map<string, PushTicket>> {
    const ids = new Set<string>();

    for (const draft of drafts) {
      if (draft.pushedTicketId !== null) {
        ids.add(draft.pushedTicketId);
      }
    }

    for (const edge of edges) {
      for (const id of [edge.blockerTicketId, edge.blockedTicketId]) {
        if (id !== null) {
          ids.add(id);
        }
      }
    }

    const tickets = await this.store.tickets(organizationId, [...ids]);

    return new Map(tickets.map((ticket) => [ticket.ticketId, ticket]));
  }

  /**
   * The report, read back from the database — so it says what is stored, not what the walk hoped.
   *
   * @param walk - The run.
   * @returns The report.
   */
  private async report(walk: Walk): Promise<PushReport> {
    const { batch } = walk;
    const drafts = await this.store.selectedDrafts(batch.id);
    const done = drafts.every((draft) => draft.pushState === "pushed");
    const batchStatus: DraftBatchStatus = done ? "pushed" : "pushing";

    if (done) {
      await this.store.setBatchStatus(batch.organizationId, batch.id, "pushed");
    }

    const tickets = await this.store.tickets(
      batch.organizationId,
      drafts.flatMap((draft) => (draft.pushedTicketId === null ? [] : [draft.pushedTicketId])),
    );
    const byId = new Map(tickets.map((ticket) => [ticket.ticketId, ticket.ref]));

    return {
      batchId: batch.id,
      outcome: walk.throttled ? "throttled" : done ? "pushed" : "partial",
      batchStatus,
      pushedThisRun: walk.pushed,
      links: { ...walk.links },
      retryAt: walk.retryAt,
      milestone: walk.milestone,
      epic: walk.epic,
      drafts: drafts.map((draft) => ({
        draftId: draft.id,
        localKey: draft.localKey,
        pushState: draft.pushState,
        ticketId: draft.pushedTicketId,
        ticket: draft.pushedTicketId === null ? null : (byId.get(draft.pushedTicketId) ?? null),
        error: draft.pushError,
      })),
    };
  }
}

/**
 * The drafts in push order, or the envelope's refusal.
 *
 * @param batchId - The batch.
 * @param drafts - The selected drafts.
 * @param edges - Their dependencies.
 * @returns The drafts, blockers first.
 * @throws {InvalidRequestError} `dependency_cycle`.
 */
function orderOf(
  batchId: string,
  drafts: readonly PushDraft[],
  edges: readonly PushEdge[],
): PushDraft[] {
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));

  try {
    return pushOrder(
      drafts,
      edges.flatMap((edge) =>
        edge.blockerDraftId === null || edge.blockedDraftId === null
          ? []
          : [{ blockerId: edge.blockerDraftId, blockedId: edge.blockedDraftId }],
      ),
    ).map((ordered) => byId.get(ordered.id) as PushDraft);
  } catch (error) {
    if (error instanceof DependencyCycleError) {
      throw dependencyCycle(batchId, error.cycle);
    }

    throw error;
  }
}

/**
 * The opened context of a run.
 *
 * @param walk - The run.
 * @returns Its context.
 * @throws {Error} When called outside the credential's scope — a bug, never a tracker's doing.
 */
function contextOf(walk: Walk): TicketSyncContext {
  if (walk.context === null) {
    throw new Error("a push step ran outside the source's opened credential");
  }

  return walk.context;
}

/**
 * The refs of drafts an earlier run pushed.
 *
 * @param drafts - The selected drafts.
 * @param tickets - The tickets loaded for the run.
 * @returns Refs by draft id.
 */
function refsOf(
  drafts: readonly PushDraft[],
  tickets: ReadonlyMap<string, PushTicket>,
): Map<string, TicketWriteRef> {
  const refs = new Map<string, TicketWriteRef>();

  for (const draft of drafts) {
    const ticket = draft.pushedTicketId === null ? undefined : tickets.get(draft.pushedTicketId);

    if (ticket !== undefined) {
      refs.set(draft.id, ticket.ref);
    }
  }

  return refs;
}
