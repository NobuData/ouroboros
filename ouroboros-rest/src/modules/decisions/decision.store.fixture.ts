/**
 * An in-memory decision store — `DecisionRepository`'s statements with V093/V095/V097's rules, for
 * the unit suites of the registry, the watcher and the plane emitters.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)). It keeps the rules a suite relies
 * on: one item per `(workspace, plane:source_ref)`; a repeat refreshes facts only while the item is
 * open or snoozed; a closure writes only on an asking item. Validation is the registry's, so the
 * store accepts whatever reaches it — the integration suite asks the database.
 */

import { randomUUID } from "node:crypto";

import { AuditService } from "../audit/audit.service";
import type { AuditRecord } from "../audit/audit.events";
import type { DecisionChannel, DecisionItemStatus, DecisionSeverity } from "../db/schema";
import { DecisionKindRegistry } from "./decision-kind.registry";
import { DecisionLifecycle, type DecisionLifecycleEvent } from "./decision.lifecycle";
import type {
  DecisionFeedRow,
  DecisionItemIdentity,
  DecisionItemSnapshot,
  DecisionRepository,
} from "./decision.repository";
import type {
  DecisionEmission,
  DecisionKey,
  DecisionKindDeclaration,
  DecisionRef,
  PublishedDecisionKind,
} from "./decision.types";
import { SHIPPED_KINDS } from "./decision.kinds.fixture";

/** One stored item. */
export interface StoredDecision {
  id: string;
  organizationId: string;
  kindId: string;
  kindVersion: number;
  payload: Record<string, unknown>;
  refs: DecisionRef[];
  severity: DecisionSeverity;
  status: DecisionItemStatus;
  plane: string;
  sourceRef: string;
  snoozedUntil: Date | null;
}

/** One stored resolution. */
export interface StoredResolution {
  itemId: string;
  actionId: string;
  resolver: "human" | "policy";
  policy: string | null;
  channel: DecisionChannel;
  outcome: Record<string, string>;
}

/** The in-memory store; see this file's header. */
export class DecisionStore {
  /** Every published version, newest last per kind. */
  readonly kinds: PublishedDecisionKind[] = Object.values(SHIPPED_KINDS).map((kind) => ({ ...kind }));

  readonly items: StoredDecision[] = [];

  readonly resolutions: StoredResolution[] = [];

  /** How many times `emit` reached the store — zero after a refused emission. */
  emits = 0;

  /**
   * The store as the repository the registry is constructed with.
   *
   * @returns A `DecisionRepository` over this store.
   */
  asRepository(): DecisionRepository {
    const repository = {
      db: {} as never,
      transaction: <T>(work: (trx: never) => Promise<T>) => work({} as never),
      currentKind: (kindId: string) => Promise.resolve(this.current(kindId)),
      kindVersion: (kindId: string, version: number) =>
        Promise.resolve(this.kinds.find((kind) => kind.kindId === kindId && kind.version === version)),
      currentKinds: () =>
        Promise.resolve(
          [...new Set(this.kinds.map((kind) => kind.kindId))]
            .sort()
            .map((kindId) => this.current(kindId) as PublishedDecisionKind),
        ),
      publishKind: (declaration: DecisionKindDeclaration, version: number) => {
        if (version !== (this.current(declaration.kindId)?.version ?? 0) + 1) {
          return Promise.reject(new Error(`v${String(version)} is not the next version`));
        }

        this.kinds.push({ ...declaration, version });

        return Promise.resolve(version);
      },
      canonicalInterval: (_executor: unknown, interval: string) =>
        Promise.resolve(interval === "30 minutes" ? "00:30:00" : interval),
      lockKey: () => Promise.resolve(),
      lockKind: () => Promise.resolve(),
      itemByKey: (_executor: unknown, organizationId: string, key: DecisionKey) =>
        Promise.resolve(this.snapshot(this.byKey(organizationId, key))),
      emit: (_executor: unknown, emission: DecisionEmission) => Promise.resolve(this.emit(emission)),
      identity: (itemId: string) => Promise.resolve(this.identity(itemId)),
      sourceResolve: (itemId: string, channel: DecisionChannel, outcome: Record<string, string>) =>
        Promise.resolve(this.resolve(itemId, "source_resolved", "policy", "source_resolved", channel, outcome)),
      asking: (kinds: readonly string[], organizationId: string | null) =>
        Promise.resolve(
          this.items
            .filter(
              (item) =>
                (item.status === "open" || item.status === "snoozed") &&
                kinds.includes(item.kindId) &&
                (organizationId === null || item.organizationId === organizationId),
            )
            .map((item) => ({
              id: item.id,
              organization_id: item.organizationId,
              kind_id: item.kindId,
              refs: item.refs,
              source_ref: item.sourceRef,
            })),
        ),
      feed: (organizationId: string, now: Date) => Promise.resolve(this.feed(organizationId, now)),
    };

    return repository as unknown as DecisionRepository;
  }

  /**
   * The item a key filed.
   *
   * @param organizationId - The workspace.
   * @param key - The key.
   * @returns The item, or undefined.
   */
  byKey(organizationId: string, key: DecisionKey): StoredDecision | undefined {
    return this.items.find(
      (item) =>
        item.organizationId === organizationId &&
        item.plane === key.plane &&
        item.sourceRef === key.sourceRef,
    );
  }

  /**
   * Write a resolution, as V095/V097 would — only on an asking item, once.
   *
   * @param itemId - The item.
   * @param actionId - The action.
   * @param resolver - Who.
   * @param policy - The policy, for a policy resolution.
   * @param channel - Where from.
   * @param outcome - The receipt.
   * @returns Whether it was written.
   */
  resolve(
    itemId: string,
    actionId: string,
    resolver: "human" | "policy",
    policy: string | null,
    channel: DecisionChannel,
    outcome: Record<string, string> = {},
  ): boolean {
    const item = this.items.find((candidate) => candidate.id === itemId);

    if (item === undefined || (item.status !== "open" && item.status !== "snoozed")) {
      return false;
    }

    item.status = "resolved";
    item.snoozedUntil = null;
    this.resolutions.push({ itemId, actionId, resolver, policy, channel, outcome });

    return true;
  }

  /**
   * The newest version of a kind.
   *
   * @param kindId - The kind.
   * @returns It, or undefined.
   */
  private current(kindId: string): PublishedDecisionKind | undefined {
    return this.kinds.filter((kind) => kind.kindId === kindId).at(-1);
  }

  /**
   * V093's upsert.
   *
   * @param emission - What was emitted.
   * @returns The item id.
   */
  private emit(emission: DecisionEmission): string {
    this.emits += 1;

    const existing = this.byKey(emission.organizationId, emission.key);

    if (existing !== undefined) {
      if (existing.status === "open" || existing.status === "snoozed") {
        existing.payload = { ...emission.payload };
        existing.refs = [...emission.refs];
        existing.severity = emission.severity ?? existing.severity;
      }

      return existing.id;
    }

    const kind = this.current(emission.kindId) as PublishedDecisionKind;
    const item: StoredDecision = {
      id: randomUUID(),
      organizationId: emission.organizationId,
      kindId: emission.kindId,
      kindVersion: kind.version,
      payload: { ...emission.payload },
      refs: [...emission.refs],
      severity: emission.severity ?? kind.severityDefault,
      status: "open",
      plane: emission.key.plane,
      sourceRef: emission.key.sourceRef,
      snoozedUntil: null,
    };

    this.items.push(item);

    return item.id;
  }

  /**
   * An item as `itemByKey` answers.
   *
   * @param item - The item.
   * @returns The snapshot, or undefined.
   */
  private snapshot(item: StoredDecision | undefined): DecisionItemSnapshot | undefined {
    return item === undefined
      ? undefined
      : {
          id: item.id,
          status: item.status,
          payload: { ...item.payload },
          refs: [...item.refs],
          severity: item.severity,
        };
  }

  /**
   * An item as `identity` answers.
   *
   * @param itemId - The item.
   * @returns Its identity, or undefined.
   */
  private identity(itemId: string): DecisionItemIdentity | undefined {
    const item = this.items.find((candidate) => candidate.id === itemId);

    return item === undefined
      ? undefined
      : {
          id: item.id,
          organizationId: item.organizationId,
          kindId: item.kindId,
          kindVersion: item.kindVersion,
          plane: item.plane,
          sourceRef: item.sourceRef,
        };
  }

  /**
   * The feed's rows, snooze-aware.
   *
   * @param organizationId - The workspace.
   * @param now - The instant.
   * @returns One row per severity present.
   */
  private feed(organizationId: string, now: Date): DecisionFeedRow[] {
    const rows = new Map<DecisionSeverity, DecisionFeedRow>();

    for (const item of this.items) {
      if (item.organizationId !== organizationId) continue;
      if (item.status !== "open" && item.status !== "snoozed") continue;

      const hidden = item.status === "snoozed" && item.snoozedUntil !== null && item.snoozedUntil > now;
      const row = rows.get(item.severity) ?? { severity: item.severity, open: 0, snoozed: 0, nextWakeAt: null };
      const wake =
        hidden && (row.nextWakeAt === null || (item.snoozedUntil as Date) < row.nextWakeAt)
          ? item.snoozedUntil
          : row.nextWakeAt;

      rows.set(item.severity, {
        severity: item.severity,
        open: row.open + (hidden ? 0 : 1),
        snoozed: row.snoozed + (hidden ? 1 : 0),
        nextWakeAt: wake,
      });
    }

    return [...rows.values()];
  }
}

/** A registry over an in-memory store, with its audit trail and lifecycle events recorded. */
export interface RegistryHarness {
  readonly store: DecisionStore;
  readonly registry: DecisionKindRegistry;
  /** Every audit record written. */
  readonly audit: AuditRecord[];
  /** Every lifecycle event told. */
  readonly events: DecisionLifecycleEvent[];
  readonly lifecycle: DecisionLifecycle;
}

/**
 * Build a registry over a fresh store.
 *
 * @returns The registry, the store and the recorded audit and lifecycle.
 */
export function registryHarness(): RegistryHarness {
  const store = new DecisionStore();
  const audit: AuditRecord[] = [];
  const events: DecisionLifecycleEvent[] = [];
  const lifecycle = new DecisionLifecycle();

  lifecycle.add({ decisionChanged: (event) => events.push(event) });

  const auditService = {
    record: (record: AuditRecord) => {
      audit.push(record);
      return Promise.resolve(randomUUID());
    },
  } as unknown as AuditService;

  return {
    store,
    registry: new DecisionKindRegistry(store.asRepository(), auditService, lifecycle),
    audit,
    events,
    lifecycle,
  };
}
