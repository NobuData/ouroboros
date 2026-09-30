/**
 * What the fact routes answer, and the pure mappers from rows (BF.2,
 * [#411](https://github.com/NobuData/ouroboros/issues/411)).
 *
 * **Every stamp the card renders is read from the audit.** *"confirmed by Ken, 6w ago"* is the
 * newest `fact_transitions` row into `confirmed`, rendered — its actor and its instant — not a
 * column written for the page. The staleness line (*"platform_version anchor zephyr-4.0 matched
 * west.yml in PR #531"*) is the newest row into `stale`, and the struck-through row's *"expired on
 * Zephyr 4.1 migration · was used 31×"* is the expiry reason and the snapshot V071 froze.
 *
 * **`usedCount` is counted, never stored** — the `context_injections` rows whose `fact_ids`
 * contain the fact. An expired fact answers its `previous_use_count` snapshot instead, which is the
 * only number V071 stores and which never changes afterwards.
 *
 * **Coverage is stated.** `sweep.covered` is false, with `reason: "no_anchors"`, for a fact with
 * no anchors: the staleness sweep never flags it, and the API says so rather than implying
 * coverage it does not have.
 *
 * The **needs-you feed** ({@link FactNeedsYou}) is the contract mockup 16's inbox consumes as its
 * `fact_review` decision kind (#461): one item per fact waiting on a person — a proposal awaiting
 * review, or a confirmed fact the sweep flagged stale — at `severity: "info"`, so knowledge
 * housekeeping never outranks a blocked loop.
 */

import type { Fact, FactAnchor, FactAnchorKind, FactProposer, FactStatus } from "../db/schema";
import { FACT_STATUSES } from "../db/schema";

/** A person the audit names. */
export interface FactActor {
  /** `"user".id`, or null when the person has since been removed. */
  readonly id: string | null;
  /** Their display name, or null when they are gone. */
  readonly name: string | null;
}

/**
 * The row kinds a provenance reference names by uuid — V071's `run`, `pull_request` and `ticket`,
 * and V074's (#412) proposer sources: `classification`, `waiver`, `steer`, `run_stage` and `gate`.
 */
export type FactProvenanceRowKind =
  "run" | "pull_request" | "ticket" | "classification" | "waiver" | "steer" | "run_stage" | "gate";

/** A typed provenance reference (V071's `fact_provenance_typed`, widened by V074). */
export type FactProvenanceRef =
  | { readonly kind: FactProvenanceRowKind; readonly id: string }
  | { readonly kind: "person"; readonly id: string }
  | { readonly kind: "import"; readonly file: string; readonly section?: string };

/** `facts.provenance` — the card's line, and what it stands for. */
export interface FactProvenance {
  readonly line: string;
  readonly refs: readonly FactProvenanceRef[];
}

/** One anchor — why a fact can expire. */
export interface FactAnchorResource {
  readonly id: string;
  readonly kind: FactAnchorKind;
  readonly value: string;
  /** When the sweep last evaluated it; null until it has. */
  readonly lastCheckedAt: string | null;
}

/** One audited status change. */
export interface FactTransitionResource {
  /** Null on the row recording the fact's creation. */
  readonly from: FactStatus | null;
  readonly to: FactStatus;
  /** The person, or null for the staleness sweep. */
  readonly actor: FactActor | null;
  readonly reason: string | null;
  readonly at: string;
}

/** A human gate's stamp — *"confirmed by Ken, 6w ago"*. */
export interface FactStamp {
  /** The person, or null when the audit names nobody (the sweep, or a removed person). */
  readonly actor: FactActor | null;
  readonly at: string;
  readonly reason: string | null;
}

/** An expired fact's frozen facts — *"expired on Zephyr 4.1 migration · was used 31×"*. */
export interface FactExpiry {
  readonly reason: string;
  /** The injection count snapshotted at expiry. Never changes afterwards. */
  readonly previousUseCount: number;
  /** Who expired it and when, from the audit; null only for a row the audit has lost. */
  readonly stamp: FactStamp | null;
}

/** Whether the staleness sweep watches a fact. */
export interface FactSweepCoverage {
  readonly covered: boolean;
  /** Why not: a fact with no anchors is never flagged stale. */
  readonly reason: "no_anchors" | null;
}

/** A fact, as the learned-facts card renders it. */
export interface FactResource {
  readonly id: string;
  /** `owner/name`, or null for the whole workspace. */
  readonly repoRef: string | null;
  readonly text: string;
  readonly status: FactStatus;
  readonly proposer: FactProposer;
  readonly provenance: FactProvenance;
  /** The newest confirmation, from the audit; null for a fact never confirmed. */
  readonly confirmation: FactStamp | null;
  /** Why the sweep (or a person) flagged it, while `stale`; null otherwise. */
  readonly staleness: FactStamp | null;
  /** Set exactly when `expired`. */
  readonly expiry: FactExpiry | null;
  /** Manifests that carried it — counted live, or the expiry snapshot once expired. */
  readonly usedCount: number;
  /** The expired fact this proposal re-learns. */
  readonly relearnedFromFactId: string | null;
  /** The proposals that re-learn this fact, oldest first. */
  readonly relearnedByFactIds: readonly string[];
  readonly anchors: readonly FactAnchorResource[];
  readonly sweep: FactSweepCoverage;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One fact with its whole history, oldest first. */
export interface FactDetail extends FactResource {
  readonly history: readonly FactTransitionResource[];
}

/** `GET /api/v1/facts` — the card, and its header's counts. */
export interface FactList {
  readonly items: readonly FactResource[];
  /** Every status's count in the workspace, whatever the filter — `2 awaiting review`. */
  readonly counts: Readonly<Record<FactStatus, number>>;
}

/** Why a fact is in the needs-you feed. */
export type FactReviewReason = "awaiting_review" | "stale";

/**
 * One needs-you item — the `fact_review` decision kind's payload (#461, mockup 16).
 *
 * Stable: fields are added, never renamed. `factId` is the item's identity, so an inbox that files
 * it can do so idempotently and resolve it when the fact leaves `proposed` / `stale`.
 */
export interface FactNeedsYouItem {
  readonly kind: "fact_review";
  /** Always `info` — knowledge housekeeping never outranks a blocked loop. */
  readonly severity: "info";
  readonly factId: string;
  readonly reason: FactReviewReason;
  readonly text: string;
  readonly repoRef: string | null;
  /** The provenance line — *"from PR #514 review cycle"*. */
  readonly provenanceLine: string;
  /** Set for `stale`: the matched anchor's reason and when the sweep flagged it. */
  readonly staleness: FactStamp | null;
  /** When it started waiting — the proposal's creation, or the stale flag. */
  readonly since: string;
}

/** `GET /api/v1/facts/needs-you` — the feed, and the count the needs-you pill joins (#90). */
export interface FactNeedsYou {
  readonly count: number;
  readonly items: readonly FactNeedsYouItem[];
}

/** One audit row, with the actor's name joined. */
export interface FactTransitionRow {
  readonly fact_id: string;
  readonly from_status: FactStatus | null;
  readonly to_status: FactStatus;
  readonly actor_id: string | null;
  readonly actor_name: string | null;
  readonly reason: string | null;
  readonly at: Date;
}

/** Everything a fact's resource is built from. */
export interface FactRecord {
  readonly fact: Fact;
  /** Live injection count. */
  readonly usedCount: number;
  readonly anchors: readonly FactAnchor[];
  /** Its audit rows, any order. */
  readonly transitions: readonly FactTransitionRow[];
  /** The ids of proposals re-learning it. */
  readonly relearnedBy: readonly string[];
}

/**
 * @param at - An instant.
 * @returns It, as ISO-8601.
 */
function iso(at: Date): string {
  return at.toISOString();
}

/**
 * The newest audit row into a status.
 *
 * @param transitions - A fact's audit rows.
 * @param to - The status.
 * @returns The row, or undefined.
 */
export function latestInto(
  transitions: readonly FactTransitionRow[],
  to: FactStatus,
): FactTransitionRow | undefined {
  let latest: FactTransitionRow | undefined;

  for (const row of transitions) {
    if (row.to_status === to && (latest === undefined || row.at >= latest.at)) {
      latest = row;
    }
  }

  return latest;
}

/**
 * @param row - An audit row.
 * @returns The person it names, or null for the sweep's (or a removed person's) row.
 */
function actorOf(row: FactTransitionRow): FactActor | null {
  return row.actor_id === null ? null : { id: row.actor_id, name: row.actor_name };
}

/**
 * @param row - An audit row, or undefined.
 * @returns The stamp it renders as, or null.
 */
function stampOf(row: FactTransitionRow | undefined): FactStamp | null {
  return row === undefined ? null : { actor: actorOf(row), at: iso(row.at), reason: row.reason };
}

/**
 * Read `facts.provenance` into its type. V071's CHECK guarantees the shape, so this only narrows.
 *
 * @param value - The column as `pg` parsed it.
 * @returns The provenance.
 */
export function provenanceOf(value: unknown): FactProvenance {
  const document = value as { line?: unknown; refs?: unknown };

  return {
    line: typeof document.line === "string" ? document.line : "",
    refs: Array.isArray(document.refs) ? (document.refs as FactProvenanceRef[]) : [],
  };
}

/**
 * @param anchor - A `fact_anchors` row.
 * @returns Its resource.
 */
export function anchorResource(anchor: FactAnchor): FactAnchorResource {
  return {
    id: anchor.id,
    kind: anchor.kind,
    value: anchor.value,
    lastCheckedAt: anchor.last_checked_at === null ? null : iso(anchor.last_checked_at),
  };
}

/**
 * Build a fact's resource.
 *
 * @param record - The row, its anchors, audit and counts.
 * @returns What the card renders.
 */
export function factResource(record: FactRecord): FactResource {
  const { fact } = record;
  const expired = fact.status === "expired";

  return {
    id: fact.id,
    repoRef: fact.repo_ref,
    text: fact.text,
    status: fact.status,
    proposer: fact.proposer,
    provenance: provenanceOf(fact.provenance),
    confirmation:
      fact.confirmed_at === null
        ? null
        : (stampOf(latestInto(record.transitions, "confirmed")) ?? {
            // A row the audit lost (it cannot, by grant) still renders its column stamp.
            actor: fact.confirmed_by === null ? null : { id: fact.confirmed_by, name: null },
            at: iso(fact.confirmed_at),
            reason: null,
          }),
    staleness: fact.status === "stale" ? stampOf(latestInto(record.transitions, "stale")) : null,
    expiry: expired
      ? {
          reason: fact.expired_reason ?? "",
          previousUseCount: fact.previous_use_count ?? 0,
          stamp: stampOf(latestInto(record.transitions, "expired")),
        }
      : null,
    usedCount: expired ? (fact.previous_use_count ?? 0) : record.usedCount,
    relearnedFromFactId: fact.relearned_from_fact_id,
    relearnedByFactIds: [...record.relearnedBy],
    anchors: [...record.anchors]
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id))
      .map(anchorResource),
    sweep:
      record.anchors.length === 0
        ? { covered: false, reason: "no_anchors" }
        : { covered: true, reason: null },
    createdAt: iso(fact.created_at),
    updatedAt: iso(fact.updated_at),
  };
}

/**
 * Build a fact's detail — the resource and its whole history, oldest first.
 *
 * @param record - The row, its anchors, audit and counts.
 * @returns The detail.
 */
export function factDetail(record: FactRecord): FactDetail {
  const history = [...record.transitions]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((row) => ({
      from: row.from_status,
      to: row.to_status,
      actor: actorOf(row),
      reason: row.reason,
      at: iso(row.at),
    }));

  return { ...factResource(record), history };
}

/**
 * Count a workspace's facts by status, every status present.
 *
 * @param counted - `(status, count)` pairs; a status with no row is zero.
 * @returns The counts.
 */
export function statusCounts(
  counted: readonly { readonly status: FactStatus; readonly count: number }[],
): Record<FactStatus, number> {
  const counts = Object.fromEntries(FACT_STATUSES.map((status) => [status, 0])) as Record<
    FactStatus,
    number
  >;

  for (const row of counted) {
    counts[row.status] = row.count;
  }

  return counts;
}

/**
 * The needs-you item a fact waiting on a person files, or null when it waits on nobody.
 *
 * @param fact - The fact's resource.
 * @returns The item, for a `proposed` or `stale` fact.
 */
export function needsYouItem(fact: FactResource): FactNeedsYouItem | null {
  if (fact.status !== "proposed" && fact.status !== "stale") {
    return null;
  }

  const stale = fact.status === "stale";

  return {
    kind: "fact_review",
    severity: "info",
    factId: fact.id,
    reason: stale ? "stale" : "awaiting_review",
    text: fact.text,
    repoRef: fact.repoRef,
    provenanceLine: fact.provenance.line,
    staleness: stale ? fact.staleness : null,
    since: stale ? (fact.staleness?.at ?? fact.updatedAt) : fact.createdAt,
  };
}

/**
 * The needs-you feed — oldest wait first, so the longest-ignored review is on top.
 *
 * @param facts - The workspace's facts waiting on a person.
 * @returns The feed.
 */
export function needsYouFeed(facts: readonly FactResource[]): FactNeedsYou {
  const items = facts
    .map(needsYouItem)
    .filter((item): item is FactNeedsYouItem => item !== null)
    .sort((a, b) => a.since.localeCompare(b.since) || a.factId.localeCompare(b.factId));

  return { count: items.length, items };
}
