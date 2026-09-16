/**
 * An in-memory `PushStore` that keeps the database's promises — so the push service's suites
 * exercise its orchestration without a PostgreSQL, and cannot pass by leaning on a store more
 * forgiving than V034–V036.
 *
 * AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)). Each rule below is a constraint
 * or trigger the real tables carry, restated where the service would otherwise get away with
 * breaking it:
 *
 * ```
 * ticket_drafts_push_state_transition   a pushed draft names its ticket and never moves again
 * ticket_drafts_push_state_coherent     pushed ⇒ no error · failed ⇒ error and no ticket
 * tickets_source_external_id_key        one ticket per (source, external id) — a push adopts
 * ticket_dependencies_*_one_kind        each end a draft or a ticket, never both
 * epic_mirrors_epic_source_kind_key     one mirror per (epic, source, kind) — the first wins
 * epic_tickets_epic_ticket_key          one membership per (epic, ticket)
 * organization isolation                a batch is found only inside its own workspace
 * ```
 *
 * `crashOnRecordPushed` is the *kill the process mid-batch* the acceptance criterion asks for: the
 * tracker has answered, and the transaction that would record it never commits.
 */

import type {
  DraftBatchStatus,
  DraftPushError,
  DraftPushState,
  EpicMirrorKind,
} from "../db/schema";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import type {
  PushBatch,
  PushDraft,
  PushEdge,
  PushStore,
  PushTicket,
  PushedDraft,
} from "./push.repository";

/** A draft as the fixture holds it. */
export interface StoredDraft {
  readonly id: string;
  readonly batchId: string;
  readonly localKey: string;
  readonly title: string;
  readonly body: string | null;
  selected: boolean;
  pushState: DraftPushState;
  pushedTicketId: string | null;
  pushError: DraftPushError | null;
}

/** A batch as the fixture holds it. */
export interface StoredBatch {
  readonly id: string;
  readonly organizationId: string;
  status: DraftBatchStatus;
  readonly targetMilestone: string | null;
  readonly epicId: string | null;
  readonly sourceId: string;
}

/** A dependency as the fixture holds it. */
export interface StoredEdge {
  blockerDraftId: string | null;
  blockerTicketId: string | null;
  blockedDraftId: string | null;
  blockedTicketId: string | null;
  readonly organizationId: string;
}

/** A canonical ticket as the fixture holds it. */
export interface StoredTicket extends PushTicket {
  readonly organizationId: string;
  readonly title: string;
}

/** The planning tables, in memory. */
export class InMemoryPushStore implements PushStore {
  /** Sources by id. */
  readonly sources = new Map<string, SyncSource>();
  /** Batches by id. */
  readonly batches = new Map<string, StoredBatch>();
  /** Drafts, in insertion order. */
  readonly drafts: StoredDraft[] = [];
  /** Dependencies. */
  readonly edges: StoredEdge[] = [];
  /** Canonical tickets. */
  readonly ticketRows: StoredTicket[] = [];
  /** Planning epics: id → { organizationId, name }. */
  readonly epics = new Map<string, { organizationId: string; name: string }>();
  /** Epic mirrors, keyed `epic|source|kind`. */
  readonly mirrors = new Map<string, string>();
  /** Epic memberships, keyed `epic|ticket`. */
  readonly memberships = new Set<string>();
  /** How many `recordPushed` calls commit before the next one is killed — null for never. */
  crashOnRecordPushed: number | null = null;

  /** @inheritdoc */
  batch(organizationId: string, batchId: string): Promise<PushBatch | undefined> {
    const batch = this.batches.get(batchId);
    const source = batch === undefined ? undefined : this.sources.get(batch.sourceId);

    if (
      batch === undefined ||
      source === undefined ||
      batch.organizationId !== organizationId ||
      source.organizationId !== organizationId
    ) {
      return Promise.resolve(undefined);
    }

    return Promise.resolve({
      id: batch.id,
      organizationId: batch.organizationId,
      status: batch.status,
      targetMilestone: batch.targetMilestone,
      epicId: batch.epicId,
      source,
    });
  }

  /** @inheritdoc */
  selectedDrafts(batchId: string): Promise<PushDraft[]> {
    return Promise.resolve(
      this.drafts
        .filter((draft) => draft.batchId === batchId && draft.selected)
        .sort((left, right) => left.localKey.localeCompare(right.localKey))
        .map((draft) => ({
          id: draft.id,
          localKey: draft.localKey,
          title: draft.title,
          body: draft.body,
          pushState: draft.pushState,
          pushedTicketId: draft.pushedTicketId,
          pushError: draft.pushError === null ? null : structuredClone(draft.pushError),
        })),
    );
  }

  /** @inheritdoc */
  dependencies(organizationId: string, draftIds: readonly string[]): Promise<PushEdge[]> {
    return Promise.resolve(
      this.edges
        .filter(
          (edge) =>
            edge.organizationId === organizationId &&
            ((edge.blockerDraftId !== null && draftIds.includes(edge.blockerDraftId)) ||
              (edge.blockedDraftId !== null && draftIds.includes(edge.blockedDraftId))),
        )
        .map((edge) => ({
          blockerDraftId: edge.blockerDraftId,
          blockerTicketId: edge.blockerTicketId,
          blockedDraftId: edge.blockedDraftId,
          blockedTicketId: edge.blockedTicketId,
        })),
    );
  }

  /** @inheritdoc */
  tickets(organizationId: string, ticketIds: readonly string[]): Promise<PushTicket[]> {
    return Promise.resolve(
      this.ticketRows
        .filter(
          (ticket) =>
            ticket.organizationId === organizationId && ticketIds.includes(ticket.ticketId),
        )
        .map(({ ticketId, sourceId, ref }) => ({ ticketId, sourceId, ref })),
    );
  }

  /** @inheritdoc */
  setBatchStatus(organizationId: string, batchId: string, status: DraftBatchStatus): Promise<void> {
    const batch = this.batches.get(batchId);

    if (batch !== undefined && batch.organizationId === organizationId) {
      batch.status = status;
    }

    return Promise.resolve();
  }

  /** @inheritdoc */
  epicName(organizationId: string, epicId: string): Promise<string | undefined> {
    const epic = this.epics.get(epicId);

    return Promise.resolve(epic?.organizationId === organizationId ? epic.name : undefined);
  }

  /** @inheritdoc */
  epicMirror(epicId: string, sourceId: string, kind: EpicMirrorKind): Promise<string | undefined> {
    return Promise.resolve(this.mirrors.get(`${epicId}|${sourceId}|${kind}`));
  }

  /** @inheritdoc */
  saveEpicMirror(
    epicId: string,
    sourceId: string,
    kind: EpicMirrorKind,
    externalRef: string,
  ): Promise<void> {
    const key = `${epicId}|${sourceId}|${kind}`;

    if (!this.mirrors.has(key)) {
      this.mirrors.set(key, externalRef);
    }

    return Promise.resolve();
  }

  /** @inheritdoc */
  recordPushed(pushed: PushedDraft): Promise<string> {
    if (this.crashOnRecordPushed !== null) {
      if (this.crashOnRecordPushed <= 0) {
        return Promise.reject(new Error("the process was killed before the transaction committed"));
      }

      this.crashOnRecordPushed -= 1;
    }

    const draft = this.drafts.find(
      (candidate) => candidate.id === pushed.draftId && candidate.batchId === pushed.batchId,
    );

    if (draft === undefined) {
      return Promise.reject(new Error("recordPushed named a draft outside its batch"));
    }

    let ticket = this.ticketRows.find(
      (row) => row.sourceId === pushed.sourceId && row.ref.externalId === pushed.ref.externalId,
    );

    if (ticket === undefined) {
      ticket = {
        ticketId: `ticket-${String(this.ticketRows.length + 1)}`,
        organizationId: pushed.organizationId,
        sourceId: pushed.sourceId,
        ref: pushed.ref,
        title: pushed.title,
      };
      this.ticketRows.push(ticket);
    }

    if (draft.pushState === "pushed" && draft.pushedTicketId !== ticket.ticketId) {
      return Promise.reject(
        new Error("ticket_drafts_push_state_transition: a pushed draft cannot be re-pointed"),
      );
    }

    draft.pushState = "pushed";
    draft.pushedTicketId = ticket.ticketId;
    draft.pushError = null;

    for (const edge of this.edges) {
      if (edge.blockerDraftId === draft.id) {
        edge.blockerDraftId = null;
        edge.blockerTicketId = ticket.ticketId;
      }

      if (edge.blockedDraftId === draft.id) {
        edge.blockedDraftId = null;
        edge.blockedTicketId = ticket.ticketId;
      }
    }

    if (pushed.epicId !== null) {
      this.memberships.add(`${pushed.epicId}|${ticket.ticketId}`);
    }

    return Promise.resolve(ticket.ticketId);
  }

  /** @inheritdoc */
  recordFailed(batchId: string, draftId: string, error: DraftPushError): Promise<void> {
    const draft = this.drafts.find(
      (candidate) => candidate.id === draftId && candidate.batchId === batchId,
    );

    if (draft !== undefined && draft.pushState !== "pushed") {
      if (
        !/^[a-z][a-z0-9_]*$/.test(error.code) ||
        error.message.trim() === "" ||
        error.message.length > 1024
      ) {
        return Promise.reject(new Error("ticket_drafts_push_error_shape"));
      }

      draft.pushState = "failed";
      draft.pushError = structuredClone(error);
    }

    return Promise.resolve();
  }
}
