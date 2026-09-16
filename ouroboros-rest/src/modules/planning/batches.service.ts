/**
 * `BatchesService` — mockup 09's generator card: generate, regenerate, select, edit, push.
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)). This is orchestration; the
 * pieces are other tickets':
 *
 * ```
 * generate(org, body)
 *   ├─ source in org · write-capable, or 404/409
 *   ├─ engine.plan  (AL.1 /v0/plan — outline-v0)              decision N2
 *   ├─ assertAcyclic — 422 naming the cycle                   AK.2, service-side
 *   ├─ insertBatch — batch · drafts · edges, one transaction  AK.1 / AK.2
 *   └─ autoSize? ─▶ EstimationOrchestrator.enqueueDraft       INTAKE-L.3 — the ONE sizer (N3)
 *                    └─ every selected draft sized ─▶ drafting → sized
 *
 * regenerate(org, batch)       unpushed drafts replaced · SELECTIONS PRESERVED BY LOCAL KEY
 *                              pushed drafts untouched
 * patchDraft(org, batch, key)  select · title/body (provenance → edited) · blocked-by set
 * push / resume                PushService (AL.3) ─▶ queueSmall? ─▶ QueueSmallHook (M.3, N7)
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Regeneration preserves the review.** A person drafts six tickets, unchecks two, and presses
 * **Regenerate**. The selections are read by `local_key` before the unpushed drafts are replaced
 * and written onto the new drafts with the same key — the plan contract is deterministic, so the
 * same outline yields the same keys — and a key the planner did not produce before starts checked,
 * as a fresh batch does. A **pushed** draft is never replaced: its issue exists, and the pushed row
 * is the record of it. A new draft whose key a pushed draft holds is dropped for the same reason.
 *
 * **Edits say so.** A title or body change marks the draft `edited` (V037), so the planner is never
 * credited with a person's words.
 *
 * **Every edge write is walked first.** A generation, a regeneration and a dependency edit each
 * build the graph the batch *would* hold and walk it with AL.3's own push order; a cycle is refused
 * before anything is stored, as AL.3's `dependency_cycle` `422` naming the cycle.
 *
 * **Roles** are the controller's: every member drafts, selects and edits; pushing is admin+.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { DraftBatchStatus } from "../db/schema";
import { EngineClient } from "../engine/engine.client";
import { PLAN_MAX_WORKFLOW_TAGS, type Plan, type PlanDraft } from "../engine/engine.contract";
import { describeForLog } from "../errors/failure";
import {
  EstimationOrchestrator,
  type DraftSizingOutcome,
} from "../estimation/estimation.orchestrator";
import {
  supportsWrites,
  type WriteCapableProvider,
} from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { TicketSourcesService } from "../ticket-sources/ticket-sources.service";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import { WorkflowRegistryService } from "../workflows/registry.service";
import {
  DEFAULT_LOCAL_KEY_PREFIX,
  type CreateBatchBody,
  type PatchDraftBody,
} from "./planning.dto";
import {
  batchNotEditable,
  draftNotFound,
  draftPushed,
  epicNotFound,
  plannerUnversioned,
  planningTargetReadOnly,
  selfDependency,
  sourceNotFound,
  unknownDependency,
} from "./planning.errors";
import { assertAcyclic, withBlockers } from "./planning.graph";
import {
  PlanningRepository,
  type BatchEdgeRow,
  type BatchRow,
  type DraftRow,
  type NewDraft,
} from "./planning.repository";
import type {
  BatchResource,
  DraftResource,
  GeneratedBatchResource,
  MilestonesResource,
  PushResultResource,
  PushStatusResource,
} from "./planning.resources";
import { batchSummary } from "./planning.summary";
import { batchNotFound } from "./push.errors";
import type { DraftEdge } from "./push.order";
import { PushService } from "./push.service";
import { QueueSmallHook } from "./queue-small";

/** `draft_batches_planner_versioned`, as a pattern — a name and a version. */
export const PLANNER_PATTERN = /^[a-z0-9][a-z0-9-]*-v[0-9]+$/;

/** The longest planner name the column stores. */
export const MAX_PLANNER_LENGTH = 64;

/**
 * The statuses whose drafts may still change.
 *
 * `pushing` is here because it is also where AL.3 leaves a batch whose push **stopped short** — a
 * refusal or a throttle — and re-planning the unpushed remainder of such a batch is exactly what
 * regeneration's *pushed drafts untouched* rule exists for. A push actually in flight is refused
 * separately, by `PushService.isPushing`.
 */
export const EDITABLE_STATUSES: readonly DraftBatchStatus[] = Object.freeze([
  "drafting",
  "sized",
  "pushing",
]);

@Injectable()
export class BatchesService {
  /** Where a sizing dispatch that could not start is named. */
  private readonly logger = new Logger(BatchesService.name);

  /**
   * @param repository - Batches, drafts and edges.
   * @param engine - The planner (AL.1).
   * @param workflows - The workspace's workflow tags, offered to the planner in order.
   * @param registry - The providers, reached through the SPI only.
   * @param sources - What opens a source's credential, for the milestone passthrough.
   * @param orchestrator - INTAKE-L.3's orchestrator — the one sizer.
   * @param pusher - AL.3's push.
   * @param queueSmall - The `queue_small` hook (M.3).
   */
  constructor(
    private readonly repository: PlanningRepository,
    private readonly engine: EngineClient,
    private readonly workflows: WorkflowRegistryService,
    private readonly registry: TicketSourceRegistry,
    private readonly sources: TicketSourcesService,
    private readonly orchestrator: EstimationOrchestrator,
    private readonly pusher: PushService,
    private readonly queueSmall: QueueSmallHook,
  ) {}

  /**
   * Generate a batch — **Draft tickets ⟳**.
   *
   * @param organizationId - The workspace.
   * @param userId - Who pressed it, or null.
   * @param body - The prompt, outline, target and toggles.
   * @returns The stored batch, and the planner's notes.
   * @throws {NotFoundError} `planning_source_not_found`, `planning_epic_not_found`.
   * @throws {ConflictError} `planning_target_read_only`.
   * @throws {InvalidRequestError} `dependency_cycle`, naming it.
   * @throws {UpstreamError} `engine_unavailable`, `planner_unversioned`.
   */
  async generate(
    organizationId: string,
    userId: string | null,
    body: CreateBatchBody,
  ): Promise<GeneratedBatchResource> {
    const source = await this.repository.source(organizationId, body.targetSourceId);

    if (source === undefined) {
      throw sourceNotFound(body.targetSourceId);
    }

    const provider = this.writerFor(source);
    const epicId = body.epicId ?? null;

    if (epicId !== null && (await this.repository.epic(organizationId, epicId)) === undefined) {
      throw epicNotFound(epicId);
    }

    const outline = body.outline ?? null;
    const milestone = body.milestone ?? null;
    const plan = await this.plan(
      organizationId,
      body.prompt,
      outline,
      milestone,
      body.localKeyPrefix,
    );
    const drafts = plan.drafts.map((draft) => newDraft(draft, true));

    assertAcyclic("new", drafts.map(keyNode), draftEdges(drafts));

    const { batchId, drafts: stored } = await this.repository.insertBatch(
      {
        organizationId,
        prompt: body.prompt,
        outline,
        planner: plan.planner,
        targetSourceId: source.sourceId,
        targetMilestone: milestone,
        epicId,
        autoSize: body.autoSize ?? true,
        queueSmall: body.queueSmall ?? false,
        createdBy: userId,
      },
      drafts,
    );

    if (body.autoSize ?? true) {
      this.dispatchSizing(organizationId, batchId, source, provider, [...stored.values()]);
    }

    return { ...(await this.read(organizationId, batchId)), notes: plan.notes };
  }

  /**
   * One batch, with its drafts and footer.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns The batch.
   * @throws {NotFoundError} `planning_batch_not_found`.
   */
  async read(organizationId: string, batchId: string): Promise<BatchResource> {
    const batch = await this.batchIn(organizationId, batchId);
    const [drafts, edges] = await Promise.all([
      this.repository.drafts(organizationId, batchId),
      this.repository.edges(organizationId, batchId),
    ]);

    return batchResource(batch, drafts, edges);
  }

  /**
   * Regenerate a batch — **Regenerate**.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns The batch as it now stands, and the planner's notes.
   * @throws {NotFoundError} `planning_batch_not_found`.
   * @throws {ConflictError} `batch_not_editable`, `planning_target_read_only`.
   * @throws {InvalidRequestError} `dependency_cycle`, naming it.
   * @throws {UpstreamError} `engine_unavailable`, `planner_unversioned`.
   */
  async regenerate(organizationId: string, batchId: string): Promise<GeneratedBatchResource> {
    const batch = await this.editableBatch(organizationId, batchId);
    const provider = this.writerFor(batch.source);
    const current = await this.repository.drafts(organizationId, batchId);
    const prefix = prefixOf(current.map((draft) => draft.localKey));
    const plan = await this.plan(
      organizationId,
      batch.prompt,
      batch.outline,
      batch.targetMilestone,
      prefix,
    );

    const selections = new Map(
      current
        .filter((draft) => draft.pushState !== "pushed")
        .map((draft) => [draft.localKey, draft.selected]),
    );
    const pushedKeys = new Set(
      current.filter((draft) => draft.pushState === "pushed").map((draft) => draft.localKey),
    );
    const drafts = plan.drafts
      .filter((draft) => !pushedKeys.has(draft.localKey))
      .map((draft) => newDraft(draft, selections.get(draft.localKey) ?? true));

    assertAcyclic(
      batchId,
      [...drafts.map(keyNode), ...[...pushedKeys].map((localKey) => ({ id: localKey, localKey }))],
      draftEdges(drafts),
    );

    const stored = await this.repository.replaceUnpushed(
      organizationId,
      batchId,
      plan.planner,
      drafts,
    );

    if (batch.autoSize) {
      this.dispatchSizing(organizationId, batchId, batch.source, provider, [...stored.values()]);
    }

    return { ...(await this.read(organizationId, batchId)), notes: plan.notes };
  }

  /**
   * Select, edit or re-wire one draft.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @param localKey - The draft.
   * @param body - What changes.
   * @returns The batch as it now stands — the footer moves with a selection.
   * @throws {NotFoundError} `planning_batch_not_found`, `planning_draft_not_found`.
   * @throws {ConflictError} `batch_not_editable`, `draft_already_pushed`.
   * @throws {InvalidRequestError} `dependency_unknown_key`, `dependency_self_reference`,
   *   `dependency_cycle` naming the cycle.
   */
  async patchDraft(
    organizationId: string,
    batchId: string,
    localKey: string,
    body: PatchDraftBody,
  ): Promise<BatchResource> {
    const batch = await this.editableBatch(organizationId, batchId);
    const drafts = await this.repository.drafts(organizationId, batchId);
    const draft = drafts.find((candidate) => candidate.localKey === localKey);

    if (draft === undefined) {
      throw draftNotFound(batchId, localKey);
    }

    const title = body.title ?? undefined;
    const content = body.body;
    const edits = title !== undefined || content !== undefined;
    const dependencies = body.dependencies ?? undefined;

    if (draft.pushState === "pushed" && (edits || dependencies !== undefined)) {
      throw draftPushed(batchId, localKey);
    }

    if (dependencies !== undefined) {
      await this.rewire(organizationId, batch, drafts, draft, dependencies);
    }

    await this.repository.patchDraft(batchId, draft.id, {
      selected: body.selected ?? undefined,
      title,
      body: content,
      provenance: edits ? "edited" : undefined,
    });

    await this.settleSizing(organizationId, batchId);

    return this.read(organizationId, batchId);
  }

  /**
   * Push a batch — **Push 6 tickets to GitHub →** — then run the `queue_small` hook.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns AL.3's report, and the hook's outcome when the toggle is on.
   * @throws Every refusal `PushService.push` makes.
   */
  async push(organizationId: string, batchId: string): Promise<PushResultResource> {
    const batch = await this.batchIn(organizationId, batchId);
    const report = await this.pusher.push(organizationId, batchId);

    return { report, queueSmall: batch.queueSmall ? await this.queueSmall.run(batch) : null };
  }

  /**
   * Resume a push that stopped short, then run the `queue_small` hook.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns AL.3's report, and the hook's outcome when the toggle is on.
   * @throws Every refusal `PushService.resume` makes.
   */
  async resume(organizationId: string, batchId: string): Promise<PushResultResource> {
    const batch = await this.batchIn(organizationId, batchId);
    const report = await this.pusher.resume(organizationId, batchId);

    return { report, queueSmall: batch.queueSmall ? await this.queueSmall.run(batch) : null };
  }

  /**
   * Per-draft push states, for the UI's progress rendering.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns The states.
   * @throws {NotFoundError} `planning_batch_not_found`.
   */
  async pushStatus(organizationId: string, batchId: string): Promise<PushStatusResource> {
    const batch = await this.batchIn(organizationId, batchId);
    const drafts = await this.repository.drafts(organizationId, batchId);

    return {
      batchId,
      status: batch.status,
      pushing: this.pusher.isPushing(batchId),
      drafts: drafts.map((draft) => ({
        localKey: draft.localKey,
        selected: draft.selected,
        pushState: draft.pushState,
        pushedTicketId: draft.pushedTicketId,
        pushError: draft.pushError,
      })),
    };
  }

  /**
   * The milestones a source's tracker holds — the **Milestone ▾** options, passed through.
   *
   * @param organizationId - The workspace.
   * @param sourceId - The source.
   * @returns The milestones, and whether the tracker has any at all.
   * @throws {NotFoundError} `planning_source_not_found`.
   * @throws {ConflictError} `planning_target_read_only`.
   * @throws {TicketSourceError} What the tracker refused, as the envelope maps it.
   */
  async milestones(organizationId: string, sourceId: string): Promise<MilestonesResource> {
    const source = await this.repository.source(organizationId, sourceId);

    if (source === undefined) {
      throw sourceNotFound(sourceId);
    }

    const provider = this.writerFor(source);

    if (!provider.capabilities().write.milestones) {
      return { sourceId, supported: false, milestones: [] };
    }

    const milestones = await this.sources.withCredentials(source, async (context) =>
      provider.listMilestones(context),
    );

    return { sourceId, supported: true, milestones };
  }

  /**
   * Ask the planner, holding its answer to what the batch can store.
   *
   * @param organizationId - The workspace — whose workflow tags are offered.
   * @param narrative - The prompt.
   * @param outline - The outline, or null.
   * @param milestone - The milestone, or null.
   * @param prefix - The local key prefix, or undefined for the default.
   * @returns The plan.
   * @throws {UpstreamError} `engine_unavailable`, `planner_unversioned`.
   */
  private async plan(
    organizationId: string,
    narrative: string,
    outline: string | null,
    milestone: string | null,
    prefix: string | undefined,
  ): Promise<Plan> {
    const { slugs } = await this.workflows.offered(organizationId);
    const plan = await this.engine.plan({
      narrative,
      outline,
      context: {
        workflowTags: slugs.slice(0, PLAN_MAX_WORKFLOW_TAGS),
        milestone,
        localKeyPrefix: prefix ?? DEFAULT_LOCAL_KEY_PREFIX,
      },
    });

    if (!PLANNER_PATTERN.test(plan.planner) || plan.planner.length > MAX_PLANNER_LENGTH) {
      throw plannerUnversioned(plan.planner);
    }

    return plan;
  }

  /**
   * Replace one draft's blocked-by set, after checking every key and walking the graph.
   *
   * @param organizationId - The workspace.
   * @param batch - The batch.
   * @param drafts - Every draft of the batch.
   * @param draft - The draft being re-wired.
   * @param keys - Its new blockers, by local key.
   */
  private async rewire(
    organizationId: string,
    batch: BatchRow,
    drafts: readonly DraftRow[],
    draft: DraftRow,
    keys: readonly string[],
  ): Promise<void> {
    if (keys.includes(draft.localKey)) {
      throw selfDependency(draft.localKey);
    }

    const byKey = new Map(drafts.map((candidate) => [candidate.localKey, candidate]));
    const unknown = keys.filter((key) => !byKey.has(key));

    if (unknown.length > 0) {
      throw unknownDependency(draft.localKey, unknown);
    }

    const edges = await this.repository.edges(organizationId, batch.id);
    const blockers = keys.map((key) => byKey.get(key) as DraftRow);

    assertAcyclic(
      batch.id,
      drafts.map((candidate) => ({ id: candidate.id, localKey: candidate.localKey })),
      withBlockers(
        idEdges(edges, drafts),
        draft.id,
        blockers.map((blocker) => blocker.id),
      ),
    );

    await this.repository.setDraftBlockers(
      organizationId,
      draft.id,
      blockers.map((blocker) =>
        blocker.pushState === "pushed" && blocker.pushedTicketId !== null
          ? { ticketId: blocker.pushedTicketId }
          : { draftId: blocker.id },
      ),
      drafts.flatMap((candidate) =>
        candidate.pushedTicketId === null ? [] : [candidate.pushedTicketId],
      ),
    );
  }

  /**
   * Hand drafts to the one sizer, and move the batch to `sized` once every selected draft has an
   * estimate.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @param source - Its target source.
   * @param provider - That source's provider.
   * @param draftIds - The drafts to size.
   */
  private dispatchSizing(
    organizationId: string,
    batchId: string,
    source: SyncSource,
    provider: WriteCapableProvider,
    draftIds: readonly string[],
  ): void {
    let repo: string;

    try {
      repo = provider.pushTargetName(source.config);
    } catch (error) {
      this.logger.warn(
        `batch ${batchId}: the target source cannot name a repository, so its drafts were not ` +
          "sent for sizing.",
        describeForLog(error),
      );

      return;
    }

    const listener = async (_draftId: string, outcome: DraftSizingOutcome): Promise<void> => {
      if (outcome === "sized") {
        await this.settleSizing(organizationId, batchId);
      }
    };

    for (const draftId of draftIds) {
      this.orchestrator.enqueueDraft({ draftId, repo }, listener);
    }
  }

  /**
   * Keep `drafting` and `sized` truthful: `sized` exactly when every selected draft has an estimate.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   */
  private async settleSizing(organizationId: string, batchId: string): Promise<void> {
    const unsized = await this.repository.unsizedSelected(batchId);

    if (unsized === 0) {
      await this.repository.moveStatus(organizationId, batchId, "drafting", "sized");
    } else {
      await this.repository.moveStatus(organizationId, batchId, "sized", "drafting");
    }
  }

  /**
   * A batch inside the workspace, or the `404`.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns The batch.
   */
  private async batchIn(organizationId: string, batchId: string): Promise<BatchRow> {
    const batch = await this.repository.batch(organizationId, batchId);

    if (batch === undefined) {
      throw batchNotFound(batchId);
    }

    return batch;
  }

  /**
   * A batch whose drafts may still change, or the refusal.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns The batch.
   */
  private async editableBatch(organizationId: string, batchId: string): Promise<BatchRow> {
    const batch = await this.batchIn(organizationId, batchId);

    if (!EDITABLE_STATUSES.includes(batch.status) || this.pusher.isPushing(batchId)) {
      throw batchNotEditable(batchId, this.pusher.isPushing(batchId) ? "pushing" : batch.status);
    }

    return batch;
  }

  /**
   * The write-capable provider of a source, or the `409`.
   *
   * @param source - The source.
   * @returns Its provider.
   */
  private writerFor(source: SyncSource): WriteCapableProvider {
    const provider = this.registry.find(source.kind);

    if (provider === undefined || !supportsWrites(provider)) {
      throw planningTargetReadOnly(source.sourceId);
    }

    return provider;
  }
}

/**
 * A planner's draft, as a row to store.
 *
 * @param draft - What the planner answered.
 * @param selected - Its checkbox.
 * @returns The row.
 */
function newDraft(draft: PlanDraft, selected: boolean): NewDraft {
  return {
    localKey: draft.localKey,
    title: draft.title,
    // `""` is the contract's *nothing more to say*; the column's is null.
    body: draft.body === "" ? null : draft.body,
    suggestedWorkflow: draft.suggestedWorkflow,
    selected,
    dependencies: draft.dependencies,
  };
}

/**
 * A new draft as a graph node, named by its key.
 *
 * @param draft - The draft.
 * @returns The node.
 */
function keyNode(draft: NewDraft): { id: string; localKey: string } {
  return { id: draft.localKey, localKey: draft.localKey };
}

/**
 * New drafts' edges, by key.
 *
 * @param drafts - The drafts.
 * @returns `blocker → blocked`, by local key.
 */
function draftEdges(drafts: readonly NewDraft[]): DraftEdge[] {
  return drafts.flatMap((draft) =>
    draft.dependencies.map((blocker) => ({ blockerId: blocker, blockedId: draft.localKey })),
  );
}

/**
 * A batch's stored edges between its own drafts, by draft id — a ticket blocker counted as the
 * pushed draft that became it.
 *
 * @param edges - The stored edges.
 * @param drafts - The batch's drafts.
 * @returns The edges between drafts.
 */
function idEdges(edges: readonly BatchEdgeRow[], drafts: readonly DraftRow[]): DraftEdge[] {
  const byTicket = new Map(
    drafts.flatMap((draft) =>
      draft.pushedTicketId === null ? [] : [[draft.pushedTicketId, draft.id] as const],
    ),
  );

  return edges.flatMap((edge) => {
    const blocker =
      edge.blockerDraftId ??
      (edge.blockerTicketId === null ? undefined : byTicket.get(edge.blockerTicketId));

    return blocker === undefined ? [] : [{ blockerId: blocker, blockedId: edge.blockedDraftId }];
  });
}

/**
 * The prefix a batch's keys carry, so a regeneration numbers the same way.
 *
 * @param keys - The batch's local keys.
 * @returns `OTA` from `OTA-3`, or undefined when no key has the plan contract's shape.
 */
export function prefixOf(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const match = /^([A-Z][A-Z0-9]{0,11})-[1-9][0-9]{0,3}$/.exec(key);

    if (match !== null) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * A batch as the API answers it.
 *
 * @param batch - The batch.
 * @param drafts - Its drafts.
 * @param edges - Their edges.
 * @returns The resource.
 */
export function batchResource(
  batch: BatchRow,
  drafts: readonly DraftRow[],
  edges: readonly BatchEdgeRow[],
): BatchResource {
  const keyById = new Map(drafts.map((draft) => [draft.id, draft.localKey]));
  const keyByTicket = new Map(
    drafts.flatMap((draft) =>
      draft.pushedTicketId === null ? [] : [[draft.pushedTicketId, draft.localKey] as const],
    ),
  );

  return {
    id: batch.id,
    status: batch.status,
    planner: batch.planner,
    prompt: batch.prompt,
    outline: batch.outline,
    targetSourceId: batch.source.sourceId,
    milestone: batch.targetMilestone,
    epicId: batch.epicId,
    autoSize: batch.autoSize,
    queueSmall: batch.queueSmall,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    drafts: drafts.map((draft) => draftResource(draft, edges, keyById, keyByTicket)),
    summary: batchSummary(drafts),
  };
}

/**
 * One draft as the API answers it.
 *
 * @param draft - The draft.
 * @param edges - The batch's edges.
 * @param keyById - Local keys by draft id.
 * @param keyByTicket - Local keys by the ticket a pushed draft became.
 * @returns The resource.
 */
function draftResource(
  draft: DraftRow,
  edges: readonly BatchEdgeRow[],
  keyById: ReadonlyMap<string, string>,
  keyByTicket: ReadonlyMap<string, string>,
): DraftResource {
  const mine = edges.filter((edge) => edge.blockedDraftId === draft.id);
  const dependencies = mine
    .flatMap((edge) => {
      const key =
        edge.blockerDraftId === null
          ? edge.blockerTicketId === null
            ? undefined
            : keyByTicket.get(edge.blockerTicketId)
          : keyById.get(edge.blockerDraftId);

      return key === undefined ? [] : [key];
    })
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const blockedByTicketIds = mine
    .flatMap((edge) =>
      edge.blockerTicketId === null || keyByTicket.has(edge.blockerTicketId)
        ? []
        : [edge.blockerTicketId],
    )
    .sort();

  return {
    id: draft.id,
    localKey: draft.localKey,
    title: draft.title,
    body: draft.body,
    selected: draft.selected,
    suggestedWorkflow: draft.suggestedWorkflow,
    provenance: draft.provenance,
    dependencies,
    blockedByTicketIds,
    pushState: draft.pushState,
    pushedTicketId: draft.pushedTicketId,
    pushError: draft.pushError,
    estimate:
      draft.estimate === null
        ? null
        : {
            effort: draft.estimate.effort,
            confidence: draft.estimate.confidence,
            estMinutes: draft.estimate.estMinutes,
            estTokens: draft.estimate.estTokens,
            routedModel: draft.estimate.routedModel,
            estimator: draft.estimate.estimator,
            version: draft.estimate.version,
          },
  };
}
