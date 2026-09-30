/**
 * An in-memory `FactsRepository` that holds V071's rules itself (BF.2, #411) — the legal edges,
 * the actor on a human gate, the audit row on every insert and move, re-learn from an expired
 * fact only, the expired freeze, anchor uniqueness and provenance resolution — throwing the
 * `pg`-shaped errors the database would, so the service's checks *and* its backstop mapping are
 * both exercised without PostgreSQL.
 */

import type { Fact, FactAnchor, FactStatus } from "../db/schema";
import { isLegalTransition, requiresActor } from "./facts.lifecycle";
import type {
  FactMove,
  FactsRepository,
  MergedChange,
  NewAnchorInput,
  NewFactInput,
  SweepAnchor,
} from "./facts.repository";
import type { FactRecord, FactTransitionRow } from "./facts.resources";

/** A `pg` error: SQLSTATE and the constraint that refused. */
export class StoreViolation extends Error {
  /**
   * @param code - The SQLSTATE.
   * @param constraint - The constraint's name.
   */
  constructor(
    readonly code: string,
    readonly constraint: string,
  ) {
    super(`${constraint} (${code})`);
  }
}

/** The fixture's clock start. */
export const STORE_EPOCH = new Date("2026-09-01T00:00:00.000Z");

/** One injection record, as far as the use count cares. */
interface Injection {
  readonly organizationId: string;
  readonly factIds: readonly string[];
}

export class FactStore {
  readonly facts: Fact[] = [];
  readonly anchors: FactAnchor[] = [];
  readonly transitions: FactTransitionRow[] = [];
  readonly injections: Injection[] = [];
  readonly changes: (MergedChange & { organizationId: string; enabled: boolean })[] = [];
  /** Person id → display name, for the audit join. */
  readonly people = new Map<string, string>();
  /** Run / PR / ticket ids per workspace — what provenance may cite. */
  readonly citable = new Map<string, Set<string>>();

  private sequence = 0;
  private clock = STORE_EPOCH.getTime();

  /**
   * Advance and read the store's clock, a second at a time, so audit rows order.
   *
   * @returns The next instant.
   */
  tick(): Date {
    this.clock += 1000;
    return new Date(this.clock);
  }

  /**
   * A fresh id, uuid-shaped.
   *
   * @returns The id.
   */
  nextId(): string {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`;
  }

  /**
   * Seed a fact already at a status, with its audit trail, as the seed's updates would.
   *
   * @param organizationId - The workspace.
   * @param status - Where it should be.
   * @param overrides - Columns to set.
   * @returns The fact.
   */
  seed(organizationId: string, status: FactStatus, overrides: Partial<Fact> = {}): Fact {
    const id = this.insertSync(organizationId, {
      repoRef: overrides.repo_ref ?? null,
      text: overrides.text ?? `fact ${String(this.sequence + 1)}`,
      proposer: overrides.proposer ?? "manual",
      provenance: { line: "seeded", refs: [] },
      actorId: null,
      relearnedFromFactId: null,
    });
    const path: Record<FactStatus, FactStatus[]> = {
      proposed: [],
      confirmed: ["confirmed"],
      rejected: ["rejected"],
      stale: ["confirmed", "stale"],
      expired: ["confirmed", "stale", "expired"],
    };

    for (const to of path[status]) {
      this.moveSync(id, {
        to,
        actorId: to === "stale" ? null : "seed-person",
        reason: to === "expired" ? "seeded expiry" : null,
        stampConfirmation: to === "confirmed",
        expiredReason: to === "expired" ? "seeded expiry" : undefined,
      });
    }

    const fact = this.find(id);
    Object.assign(fact, overrides);
    return fact;
  }

  /**
   * @param id - A fact id.
   * @returns The row.
   */
  find(id: string): Fact {
    const fact = this.facts.find((row) => row.id === id);

    if (fact === undefined) {
      throw new Error(`no fact ${id}`);
    }
    return fact;
  }

  /**
   * The repository surface the service and the sweep call.
   *
   * @returns A stand-in for `FactsRepository`.
   */
  asRepository(): FactsRepository {
    const repository: Partial<Record<keyof FactsRepository, unknown>> = {
      records: (
        organizationId: string,
        filter: { status?: FactStatus; ids?: readonly string[] } = {},
      ) => Promise.resolve(this.records(organizationId, filter)),
      counts: (organizationId: string) => {
        const counts = new Map<FactStatus, number>();
        for (const fact of this.facts.filter((row) => row.organization_id === organizationId)) {
          counts.set(fact.status, (counts.get(fact.status) ?? 0) + 1);
        }
        return Promise.resolve([...counts].map(([status, count]) => ({ status, count })));
      },
      lock: (organizationId: string, factId: string) =>
        Promise.resolve(
          this.facts.find((row) => row.id === factId && row.organization_id === organizationId),
        ),
      insert: (organizationId: string, input: NewFactInput) =>
        this.attempt(() => this.insertSync(organizationId, input)),
      move: (factId: string, move: FactMove) => this.attempt(() => this.moveSync(factId, move)),
      flagStale: (factId: string, reason: string) =>
        this.attempt(() => {
          if (this.find(factId).status !== "confirmed") {
            return false;
          }
          this.moveSync(factId, { to: "stale", actorId: null, reason });
          return true;
        }),
      anchorsOf: (factId: string) =>
        Promise.resolve(this.anchors.filter((anchor) => anchor.fact_id === factId)),
      insertAnchors: (factId: string, anchors: readonly NewAnchorInput[]) =>
        this.attempt(() => anchors.map((anchor) => this.insertAnchorSync(factId, anchor))),
      deleteAnchor: (factId: string, anchorId: string) => {
        const at = this.anchors.findIndex((row) => row.fact_id === factId && row.id === anchorId);
        if (at === -1) {
          return Promise.resolve(false);
        }
        this.anchors.splice(at, 1);
        return Promise.resolve(true);
      },
      sweepWorkspaces: () =>
        Promise.resolve(
          [
            ...new Set(
              this.facts
                .filter(
                  (fact) => fact.status === "confirmed" && this.anchorsFor(fact.id).length > 0,
                )
                .map((fact) => fact.organization_id),
            ),
          ].sort(),
        ),
      sweepAnchors: (organizationId: string) =>
        Promise.resolve(
          this.facts
            .filter(
              (fact) => fact.organization_id === organizationId && fact.status === "confirmed",
            )
            .flatMap((fact) =>
              this.anchorsFor(fact.id).map((anchor): SweepAnchor => ({
                organizationId,
                factId: fact.id,
                repoRef: fact.repo_ref,
                confirmedAt: fact.confirmed_at ?? STORE_EPOCH,
                anchorId: anchor.id,
                kind: anchor.kind,
                value: anchor.value,
                lastCheckedAt: anchor.last_checked_at,
              })),
            ),
        ),
      uncoveredCount: (organizationId: string) =>
        Promise.resolve(
          this.facts.filter(
            (fact) =>
              fact.organization_id === organizationId &&
              fact.status === "confirmed" &&
              this.anchorsFor(fact.id).length === 0,
          ).length,
        ),
      mergedChanges: (
        organizationId: string,
        options: { prId?: string; since?: Date; enabledOnly?: boolean },
      ) =>
        Promise.resolve(
          this.changes
            .filter(
              (row) =>
                row.organizationId === organizationId &&
                (options.prId === undefined || row.prId === options.prId) &&
                (options.since === undefined || row.mergedAt > options.since) &&
                (options.enabledOnly !== true || row.enabled),
            )
            .sort((a, b) => a.mergedAt.getTime() - b.mergedAt.getTime())
            .map(({ organizationId: _org, enabled: _enabled, ...change }) => change),
        ),
      stampChecked: (anchorIds: readonly string[], at: Date) => {
        for (const anchor of this.anchors) {
          if (
            anchorIds.includes(anchor.id) &&
            (anchor.last_checked_at === null || anchor.last_checked_at < at)
          ) {
            anchor.last_checked_at = at;
          }
        }
        return Promise.resolve();
      },
    };

    return repository as unknown as FactsRepository;
  }

  /**
   * @param factId - A fact.
   * @returns Its anchors.
   */
  private anchorsFor(factId: string): FactAnchor[] {
    return this.anchors.filter((anchor) => anchor.fact_id === factId);
  }

  /**
   * @param work - A synchronous write that may throw a violation.
   * @returns It, as a promise.
   */
  private async attempt<T>(work: () => T): Promise<T> {
    // An async function rejects with whatever `work` throws, as a driver would.
    return Promise.resolve(work());
  }

  /**
   * @param organizationId - The workspace.
   * @param filter - Status or ids.
   * @returns The records, newest first.
   */
  private records(
    organizationId: string,
    filter: { status?: FactStatus; ids?: readonly string[] },
  ): FactRecord[] {
    return this.facts
      .filter(
        (fact) =>
          fact.organization_id === organizationId &&
          (filter.status === undefined || fact.status === filter.status) &&
          (filter.ids === undefined || filter.ids.includes(fact.id)),
      )
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .map((fact) => ({
        fact: { ...fact },
        usedCount: this.useCount(fact.id),
        anchors: this.anchorsFor(fact.id).map((anchor) => ({ ...anchor })),
        transitions: this.transitions
          .filter((row) => row.fact_id === fact.id)
          .map((row) => ({
            ...row,
            actor_name: row.actor_id === null ? null : (this.people.get(row.actor_id) ?? null),
          })),
        relearnedBy: this.facts
          .filter((row) => row.relearned_from_fact_id === fact.id)
          .map((row) => row.id),
      }));
  }

  /**
   * @param factId - A fact.
   * @returns The injection records containing it.
   */
  private useCount(factId: string): number {
    return this.injections.filter((row) => row.factIds.includes(factId)).length;
  }

  /**
   * `facts` insert, with V071's insert triggers.
   *
   * @param organizationId - The workspace.
   * @param input - The proposal.
   * @returns The id.
   */
  private insertSync(organizationId: string, input: NewFactInput): string {
    const citable = this.citable.get(organizationId) ?? new Set<string>();

    for (const ref of input.provenance.refs) {
      if ("id" in ref && !citable.has(ref.id)) {
        throw new StoreViolation("23503", "facts_provenance_resolves");
      }
    }

    if (input.relearnedFromFactId !== null) {
      const from = this.facts.find((row) => row.id === input.relearnedFromFactId);

      if (from?.status !== "expired") {
        throw new StoreViolation("23514", "facts_relearn_from_expired");
      }
    }

    const at = this.tick();
    const id = this.nextId();

    this.facts.push({
      id,
      organization_id: organizationId,
      repo_ref: input.repoRef,
      text: input.text,
      status: "proposed",
      proposer: input.proposer,
      provenance: JSON.parse(JSON.stringify(input.provenance)) as unknown,
      confirmed_by: null,
      confirmed_at: null,
      expired_reason: null,
      previous_use_count: null,
      relearned_from_fact_id: input.relearnedFromFactId,
      status_changed_by: input.actorId,
      status_reason: null,
      created_at: at,
      updated_at: at,
    });
    this.transitions.push({
      fact_id: id,
      from_status: null,
      to_status: "proposed",
      actor_id: input.actorId,
      actor_name: null,
      reason: null,
      at,
    });

    return id;
  }

  /**
   * `facts` status update, with V071's guard, freeze and audit triggers.
   *
   * @param factId - The fact.
   * @param move - The move.
   */
  private moveSync(factId: string, move: FactMove): void {
    const fact = this.find(factId);

    if (fact.status === "expired") {
      throw new StoreViolation("23001", "facts_expired_frozen");
    }
    if (!isLegalTransition(fact.status, move.to)) {
      throw new StoreViolation("23514", "facts_legal_transition");
    }
    if (requiresActor(move.to) && move.actorId === null) {
      throw new StoreViolation("23514", "facts_transition_actor");
    }

    const at = this.tick();
    const from = fact.status;

    fact.status = move.to;
    fact.status_changed_by = move.actorId;
    fact.status_reason = move.reason;
    fact.updated_at = at;

    if (move.stampConfirmation === true) {
      fact.confirmed_by = move.actorId;
      fact.confirmed_at = at;
    }
    if (move.expiredReason !== undefined) {
      fact.expired_reason = move.expiredReason;
      fact.previous_use_count = this.useCount(factId);
    }

    this.transitions.push({
      fact_id: factId,
      from_status: from,
      to_status: move.to,
      actor_id: move.actorId,
      actor_name: null,
      reason: move.reason,
      at,
    });
  }

  /**
   * `fact_anchors` insert, with its unique key.
   *
   * @param factId - The fact.
   * @param anchor - The anchor.
   * @returns The id.
   */
  private insertAnchorSync(factId: string, anchor: NewAnchorInput): string {
    if (
      this.anchors.some(
        (row) => row.fact_id === factId && row.kind === anchor.kind && row.value === anchor.value,
      )
    ) {
      throw new StoreViolation("23505", "fact_anchors_fact_kind_value_key");
    }

    const id = this.nextId();

    this.anchors.push({
      id,
      fact_id: factId,
      kind: anchor.kind,
      value: anchor.value,
      last_checked_at: null,
      created_at: this.tick(),
    });

    return id;
  }
}
