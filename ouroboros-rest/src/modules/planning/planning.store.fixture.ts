/**
 * An in-memory `PlanningRepository` for the batch and epic service suites.
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)). It keeps the V034–V037 rules the
 * services are written against — tenancy through the batch, one key per batch, drafts cascading
 * their edges and estimates, pushed drafts surviving a regeneration — so a service suite asserts
 * behaviour rather than call order. `planning.integration-spec.ts` repeats the flow against
 * PostgreSQL. Not shipped.
 */

import type { DraftBatchStatus, DraftPushState } from "../db/schema";
import type { Effort } from "../engine/engine.contract";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import type {
  BatchEdgeRow,
  BatchRow,
  DraftPatch,
  DraftRow,
  EpicFieldsRow,
  EpicMirrorRow,
  EpicRow,
  MirroredIssueRow,
  NewBatch,
  NewDraft,
  PlanningRepository,
  PlanningTicketRow,
  PushedDraftRow,
  StoredDrafts,
  TicketSearch,
} from "./planning.repository";

/** The workspace every fixture row belongs to. */
export const STORE_ORG = "org-planning";

/** Another workspace, for isolation. */
export const OTHER_ORG = "org-next-door";

/** The GitHub source the fixture's batches target. */
export const STORE_SOURCE: SyncSource = {
  sourceId: "5eed001a-0000-4000-8000-000000000001",
  organizationId: STORE_ORG,
  kind: "github",
  displayName: "GitHub · acme-robotics",
  config: { login: "acme-robotics", repos: ["helios-firmware"] },
  cursor: null,
  syncedAt: null,
};

/** One stored draft. */
interface StoredDraft {
  id: string;
  batchId: string;
  localKey: string;
  title: string;
  body: string | null;
  selected: boolean;
  suggestedWorkflow: string | null;
  provenance: "planned" | "edited";
  pushState: DraftPushState;
  pushedTicketId: string | null;
  externalId: string | null;
}

/** One stored canonical ticket. The display fields are optional so a chip suite need not name them. */
interface StoredTicket {
  organizationId: string;
  state: "open" | "closed";
  sourceId?: string;
  externalKey?: string;
  title?: string;
  sourceUpdatedAt?: number;
}

/** One stored edge. */
interface StoredEdge {
  organizationId: string;
  blockerDraftId: string | null;
  blockerTicketId: string | null;
  blockedDraftId: string;
}

/** An in-memory planning store — see this file's header. */
export class PlanningStore {
  readonly sources = new Map<string, SyncSource>([[STORE_SOURCE.sourceId, STORE_SOURCE]]);
  readonly batches = new Map<string, BatchRow>();
  readonly draftRows = new Map<string, StoredDraft>();
  edgeRows: StoredEdge[] = [];
  /** Estimates by draft id — effort, est_minutes. */
  readonly estimates = new Map<string, { effort: Effort; estMinutes: number }>();
  readonly epicRows = new Map<string, EpicRow & { organizationId: string }>();
  readonly epicLinks = new Map<string, Set<string>>();
  readonly tickets = new Map<string, StoredTicket>();
  /** Mirrors by epic id, as AL.3 would have recorded them — each carrying its workspace. */
  readonly mirrors = new Map<string, (EpicMirrorRow & { organizationId: string })[]>();
  mirrored: MirroredIssueRow[] = [];
  private sequence = 0;

  /**
   * @param prefix - What the id is for.
   * @returns A fresh, deterministic id.
   */
  private id(prefix: string): string {
    this.sequence += 1;

    return `${prefix}-${String(this.sequence)}`;
  }

  /** @returns This store as the repository the services take. */
  asRepository(): PlanningRepository {
    return this as unknown as PlanningRepository;
  }

  /** @inheritdoc */
  source(organizationId: string, sourceId: string): Promise<SyncSource | undefined> {
    const source = this.sources.get(sourceId);

    return Promise.resolve(source?.organizationId === organizationId ? source : undefined);
  }

  /** @inheritdoc */
  batch(organizationId: string, batchId: string): Promise<BatchRow | undefined> {
    const batch = this.batches.get(batchId);

    return Promise.resolve(batch?.organizationId === organizationId ? batch : undefined);
  }

  /**
   * The repository's `drafts`.
   *
   * @param _organizationId - The workspace.
   * @param batchId - The batch.
   * @returns Its drafts, in key order.
   */
  drafts(_organizationId: string, batchId: string): Promise<DraftRow[]> {
    return Promise.resolve(
      [...this.draftRows.values()]
        .filter((draft) => draft.batchId === batchId)
        .sort((left, right) => left.localKey.localeCompare(right.localKey, "en", { numeric: true }))
        .map((draft) => {
          const estimate = this.estimates.get(draft.id);

          return {
            id: draft.id,
            localKey: draft.localKey,
            title: draft.title,
            body: draft.body,
            selected: draft.selected,
            suggestedWorkflow: draft.suggestedWorkflow,
            provenance: draft.provenance,
            pushState: draft.pushState,
            pushedTicketId: draft.pushedTicketId,
            pushedTicket:
              draft.externalId === null
                ? null
                : {
                    externalId: draft.externalId,
                    externalKey: `#${draft.externalId}`,
                    url: `https://github.com/acme-robotics/helios-firmware/issues/${draft.externalId}`,
                  },
            pushError: null,
            estimate:
              estimate === undefined
                ? null
                : {
                    version: 1,
                    effort: estimate.effort,
                    confidence: 90,
                    routedModel: "claude-fable-5",
                    estMinutes: estimate.estMinutes,
                    estTokens: 100_000,
                    estimator: "heuristic-v0",
                  },
            price: null,
          };
        }),
    );
  }

  /** @inheritdoc */
  edges(organizationId: string, batchId: string): Promise<BatchEdgeRow[]> {
    return Promise.resolve(
      this.edgeRows
        .filter(
          (edge) =>
            edge.organizationId === organizationId &&
            this.draftRows.get(edge.blockedDraftId)?.batchId === batchId,
        )
        .map(({ blockerDraftId, blockerTicketId, blockedDraftId }) => ({
          blockerDraftId,
          blockerTicketId,
          blockedDraftId,
        })),
    );
  }

  /** @inheritdoc */
  insertBatch(
    batch: NewBatch,
    drafts: readonly NewDraft[],
  ): Promise<{ batchId: string; drafts: StoredDrafts }> {
    const batchId = this.id("batch");
    const source = this.sources.get(batch.targetSourceId) as SyncSource;
    const now = new Date("2026-09-16T15:00:00.000Z");

    this.batches.set(batchId, {
      id: batchId,
      organizationId: batch.organizationId,
      status: "drafting",
      planner: batch.planner,
      prompt: batch.prompt,
      outline: batch.outline,
      targetMilestone: batch.targetMilestone,
      epicId: batch.epicId,
      autoSize: batch.autoSize,
      queueSmall: batch.queueSmall,
      createdAt: now,
      updatedAt: now,
      source,
    });

    return Promise.resolve({
      batchId,
      drafts: this.insertDrafts(batch.organizationId, batchId, drafts),
    });
  }

  /** @inheritdoc */
  replaceUnpushed(
    organizationId: string,
    batchId: string,
    planner: string,
    drafts: readonly NewDraft[],
  ): Promise<StoredDrafts> {
    for (const draft of [...this.draftRows.values()]) {
      if (draft.batchId === batchId && draft.pushState !== "pushed") {
        this.deleteDraft(draft.id);
      }
    }

    const kept = new Set(
      [...this.draftRows.values()]
        .filter((draft) => draft.batchId === batchId)
        .map((draft) => draft.localKey),
    );
    const stored = this.insertDrafts(
      organizationId,
      batchId,
      drafts.filter((draft) => !kept.has(draft.localKey)),
    );
    const batch = this.batches.get(batchId) as BatchRow;

    this.batches.set(batchId, { ...batch, planner, status: "drafting" });

    return Promise.resolve(stored);
  }

  /** @inheritdoc */
  patchDraft(batchId: string, draftId: string, patch: DraftPatch): Promise<void> {
    const draft = this.draftRows.get(draftId);

    if (draft?.batchId === batchId) {
      Object.assign(
        draft,
        Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      );
    }

    return Promise.resolve();
  }

  /** @inheritdoc */
  setDraftBlockers(
    organizationId: string,
    blockedDraftId: string,
    blockers: readonly ({ draftId: string } | { ticketId: string })[],
    batchTicketIds: readonly string[],
  ): Promise<void> {
    this.edgeRows = this.edgeRows.filter(
      (edge) =>
        !(
          edge.blockedDraftId === blockedDraftId &&
          (edge.blockerDraftId !== null ||
            (edge.blockerTicketId !== null && batchTicketIds.includes(edge.blockerTicketId)))
        ),
    );
    this.edgeRows.push(
      ...blockers.map((blocker) => ({
        organizationId,
        blockerDraftId: "draftId" in blocker ? blocker.draftId : null,
        blockerTicketId: "ticketId" in blocker ? blocker.ticketId : null,
        blockedDraftId,
      })),
    );

    return Promise.resolve();
  }

  /** @inheritdoc */
  moveStatus(
    organizationId: string,
    batchId: string,
    from: DraftBatchStatus,
    to: DraftBatchStatus,
  ): Promise<boolean> {
    const batch = this.batches.get(batchId);

    if (batch?.organizationId !== organizationId || batch.status !== from) {
      return Promise.resolve(false);
    }

    this.batches.set(batchId, { ...batch, status: to });

    return Promise.resolve(true);
  }

  /** @inheritdoc */
  unsizedSelected(batchId: string): Promise<number> {
    return Promise.resolve(
      [...this.draftRows.values()].filter(
        (draft) => draft.batchId === batchId && draft.selected && !this.estimates.has(draft.id),
      ).length,
    );
  }

  /** @inheritdoc */
  pushedDrafts(organizationId: string, batchId: string): Promise<PushedDraftRow[]> {
    if (this.batches.get(batchId)?.organizationId !== organizationId) {
      return Promise.resolve([]);
    }

    return Promise.resolve(
      [...this.draftRows.values()]
        .filter((draft) => draft.batchId === batchId && draft.pushState === "pushed")
        .map((draft) => ({
          localKey: draft.localKey,
          externalId: draft.externalId ?? "",
          effort: this.estimates.get(draft.id)?.effort ?? null,
        })),
    );
  }

  /** @inheritdoc */
  mirroredIssues(
    _organizationId: string,
    _repo: string,
    numbers: readonly number[],
  ): Promise<MirroredIssueRow[]> {
    return Promise.resolve(this.mirrored.filter((issue) => numbers.includes(issue.number)));
  }

  /** @inheritdoc */
  epics(organizationId: string): Promise<EpicRow[]> {
    return Promise.resolve(
      [...this.epicRows.values()]
        .filter((epic) => epic.organizationId === organizationId)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((epic) => this.withChips(epic)),
    );
  }

  /** @inheritdoc */
  epic(organizationId: string, epicId: string): Promise<EpicRow | undefined> {
    const epic = this.epicRows.get(epicId);

    return Promise.resolve(
      epic?.organizationId === organizationId ? this.withChips(epic) : undefined,
    );
  }

  /** @inheritdoc */
  createEpic(organizationId: string, fields: EpicFieldsRow): Promise<string> {
    const id = this.id("epic");
    const highest = Math.max(
      0,
      ...[...this.epicRows.values()]
        .filter((epic) => epic.organizationId === organizationId)
        .map((epic) => epic.sortOrder),
    );

    this.epicRows.set(id, {
      ...fields,
      id,
      organizationId,
      sortOrder: highest + 1,
      ticketCount: 0,
      doneCount: 0,
    });

    return Promise.resolve(id);
  }

  /** @inheritdoc */
  updateEpic(organizationId: string, epicId: string, fields: EpicFieldsRow): Promise<boolean> {
    const epic = this.epicRows.get(epicId);

    if (epic?.organizationId !== organizationId) {
      return Promise.resolve(false);
    }

    this.epicRows.set(epicId, { ...epic, ...fields });

    return Promise.resolve(true);
  }

  /** @inheritdoc */
  deleteEpic(organizationId: string, epicId: string): Promise<boolean> {
    if (this.epicRows.get(epicId)?.organizationId !== organizationId) {
      return Promise.resolve(false);
    }

    this.epicRows.delete(epicId);
    this.epicLinks.delete(epicId);

    return Promise.resolve(true);
  }

  /** @inheritdoc */
  reorderEpics(organizationId: string, epicIds: readonly string[]): Promise<void> {
    epicIds.forEach((epicId, index) => {
      const epic = this.epicRows.get(epicId);

      if (epic?.organizationId === organizationId) {
        this.epicRows.set(epicId, { ...epic, sortOrder: index + 1 });
      }
    });

    return Promise.resolve();
  }

  /** @inheritdoc */
  ticketIdsIn(organizationId: string, ticketIds: readonly string[]): Promise<string[]> {
    return Promise.resolve(
      ticketIds.filter((id) => this.tickets.get(id)?.organizationId === organizationId),
    );
  }

  /** @inheritdoc */
  linkTickets(epicId: string, ticketIds: readonly string[]): Promise<void> {
    const links = this.epicLinks.get(epicId) ?? new Set<string>();

    ticketIds.forEach((id) => links.add(id));
    this.epicLinks.set(epicId, links);

    return Promise.resolve();
  }

  /** @inheritdoc */
  unlinkTickets(epicId: string, ticketIds: readonly string[]): Promise<void> {
    ticketIds.forEach((id) => this.epicLinks.get(epicId)?.delete(id));

    return Promise.resolve();
  }

  /** @inheritdoc */
  epicTickets(organizationId: string, epicId: string): Promise<PlanningTicketRow[]> {
    const rows = [...(this.epicLinks.get(epicId) ?? [])]
      .filter((id) => this.tickets.get(id)?.organizationId === organizationId)
      .map((id) => this.ticketRow(id))
      .sort(
        (a, b) =>
          Number(a.state === "closed") - Number(b.state === "closed") ||
          a.externalKey.localeCompare(b.externalKey) ||
          a.id.localeCompare(b.id),
      );

    return Promise.resolve(rows);
  }

  /** @inheritdoc */
  epicMirrors(organizationId: string, epicId: string): Promise<EpicMirrorRow[]> {
    return Promise.resolve(
      (this.mirrors.get(epicId) ?? [])
        .filter((mirror) => mirror.organizationId === organizationId)
        .map(({ organizationId: _organization, ...mirror }) => mirror)
        .sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.kind.localeCompare(b.kind)),
    );
  }

  /**
   * The repository's `searchTickets`, with `ilike` read as a case-insensitive substring match of the
   * unescaped term — the fixture's suites type no wildcards.
   *
   * @param organizationId - The workspace.
   * @param search - The pattern and the limit.
   * @returns The matches, most recently updated first.
   */
  searchTickets(organizationId: string, search: TicketSearch): Promise<PlanningTicketRow[]> {
    const needle = search.pattern
      ?.slice(1, -1)
      .replace(/\\([\\%_])/g, "$1")
      .toLowerCase();
    const rows = [...this.tickets.entries()]
      .filter(([, ticket]) => ticket.organizationId === organizationId)
      .sort(([, a], [, b]) => (b.sourceUpdatedAt ?? 0) - (a.sourceUpdatedAt ?? 0))
      .map(([id]) => this.ticketRow(id))
      .filter(
        (row) =>
          needle === undefined ||
          row.title.toLowerCase().includes(needle) ||
          row.externalKey.toLowerCase().includes(needle),
      )
      .slice(0, search.limit);

    return Promise.resolve(rows);
  }

  /**
   * One stored ticket as the repository answers it, with its display fields defaulted.
   *
   * @param id - The ticket.
   * @returns The row.
   */
  private ticketRow(id: string): PlanningTicketRow {
    const ticket = this.tickets.get(id) as StoredTicket;
    const externalKey = ticket.externalKey ?? `#${id}`;

    return {
      id,
      sourceId: ticket.sourceId ?? STORE_SOURCE.sourceId,
      externalKey,
      title: ticket.title ?? `Ticket ${id}`,
      state: ticket.state,
      url: `https://github.com/acme-robotics/helios-firmware/issues/${externalKey.replace("#", "")}`,
    };
  }

  /**
   * Mark a draft pushed, as AL.3 would — its ticket, and edge ends rewritten.
   *
   * @param draftId - The draft.
   * @param externalId - The tracker's number.
   * @returns The ticket id.
   */
  push(draftId: string, externalId: string): string {
    const draft = this.draftRows.get(draftId) as StoredDraft;
    const ticketId = `ticket-${externalId}`;

    draft.pushState = "pushed";
    draft.pushedTicketId = ticketId;
    draft.externalId = externalId;
    this.tickets.set(ticketId, { organizationId: STORE_ORG, state: "open" });

    for (const edge of this.edgeRows) {
      if (edge.blockerDraftId === draftId) {
        edge.blockerDraftId = null;
        edge.blockerTicketId = ticketId;
      }
    }

    return ticketId;
  }

  /**
   * A draft by batch and key.
   *
   * @param batchId - The batch.
   * @param localKey - The key.
   * @returns The stored draft.
   */
  draftByKey(batchId: string, localKey: string): StoredDraft {
    const found = [...this.draftRows.values()].find(
      (draft) => draft.batchId === batchId && draft.localKey === localKey,
    );

    if (found === undefined) {
      throw new Error(`no draft ${localKey}`);
    }

    return found;
  }

  /**
   * Insert drafts and their edges.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @param drafts - The drafts.
   * @returns Ids by key.
   */
  private insertDrafts(
    organizationId: string,
    batchId: string,
    drafts: readonly NewDraft[],
  ): Map<string, string> {
    const ids = new Map<string, string>();

    for (const draft of drafts) {
      const id = this.id("draft");

      ids.set(draft.localKey, id);
      this.draftRows.set(id, {
        id,
        batchId,
        localKey: draft.localKey,
        title: draft.title,
        body: draft.body,
        selected: draft.selected,
        suggestedWorkflow: draft.suggestedWorkflow,
        provenance: "planned",
        pushState: "pending",
        pushedTicketId: null,
        externalId: null,
      });
    }

    for (const draft of drafts) {
      for (const key of draft.dependencies) {
        const blocker =
          ids.get(key) ??
          [...this.draftRows.values()].find(
            (row) => row.batchId === batchId && row.localKey === key,
          )?.id;
        const kept = blocker === undefined ? undefined : this.draftRows.get(blocker);

        if (kept === undefined) {
          continue;
        }

        this.edgeRows.push({
          organizationId,
          blockerDraftId: kept.pushedTicketId === null ? kept.id : null,
          blockerTicketId: kept.pushedTicketId,
          blockedDraftId: ids.get(draft.localKey) as string,
        });
      }
    }

    return ids;
  }

  /**
   * Delete a draft, cascading its edges and estimate.
   *
   * @param draftId - The draft.
   */
  private deleteDraft(draftId: string): void {
    this.draftRows.delete(draftId);
    this.estimates.delete(draftId);
    this.edgeRows = this.edgeRows.filter(
      (edge) => edge.blockedDraftId !== draftId && edge.blockerDraftId !== draftId,
    );
  }

  /**
   * An epic with its chips computed from linked tickets.
   *
   * @param epic - The stored epic.
   * @returns The row.
   */
  private withChips(epic: EpicRow & { organizationId: string }): EpicRow {
    const linked = [...(this.epicLinks.get(epic.id) ?? [])];
    const { organizationId: _organization, ...row } = epic;

    return {
      ...row,
      ticketCount: linked.length,
      doneCount: linked.filter((id) => this.tickets.get(id)?.state === "closed").length,
    };
  }
}
