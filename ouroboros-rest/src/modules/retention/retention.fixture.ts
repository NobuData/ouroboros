/**
 * The retention policy service over an in-memory `retention_policies`, for unit suites (#482).
 *
 * The real {@link RetentionPolicyService} — defaults, bounds, cutoffs, audit — with only its
 * statements replaced, so a sweep's suite exercises the cutoff it will really be handed.
 */

import type { AuditService } from "../audit/audit.service";
import type { AuditRecord } from "../audit/audit.events";
import type { AppConfigService } from "../config/config.service";
import type { DataClass } from "./retention.policy";
import type { RetentionRepository, StoredTier, TierOverride } from "./retention.repository";
import { RetentionSchedule } from "./retention.schedule";
import { RetentionPolicyService } from "./retention.service";

/** One stored tier, as a suite plants it. */
export interface PlantedTier {
  readonly organizationId: string;
  readonly dataClass: DataClass;
  readonly days: number;
}

/** `retention_policies`, in memory: the statements {@link RetentionPolicyService} issues. */
export class InMemoryRetentionRepository implements Pick<
  RetentionRepository,
  "stored" | "overrides" | "upsert" | "transaction"
> {
  /** Rows by `organization:class`. */
  readonly rows = new Map<string, StoredTier & { readonly organization_id: string }>();

  /** How many times {@link stored} was asked — what a cache test counts. */
  storedCalls = 0;

  /**
   * @param planted - Tiers the workspaces already stored.
   */
  constructor(planted: readonly PlantedTier[] = []) {
    for (const tier of planted) {
      this.put(tier.organizationId, tier.dataClass, tier.days, null);
    }
  }

  stored(organizationId: string): Promise<StoredTier[]> {
    this.storedCalls += 1;
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.organization_id === organizationId)
        .sort((a, b) => a.data_class.localeCompare(b.data_class)),
    );
  }

  overrides(dataClass: string): Promise<TierOverride[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.data_class === dataClass)
        .map((row) => ({ organization_id: row.organization_id, days: row.days })),
    );
  }

  upsert(
    _trx: unknown,
    organizationId: string,
    dataClass: string,
    days: number,
    updatedBy: string,
  ): Promise<void> {
    this.put(organizationId, dataClass, days, updatedBy);
    return Promise.resolve();
  }

  transaction<T>(work: (trx: never) => Promise<T>): Promise<T> {
    return work(undefined as never);
  }

  /** Store a row. */
  private put(
    organizationId: string,
    dataClass: string,
    days: number,
    updatedBy: string | null,
  ): void {
    this.rows.set(`${organizationId}:${dataClass}`, {
      organization_id: organizationId,
      data_class: dataClass,
      days,
      updated_by: updatedBy,
      updated_at: new Date("2026-10-01T00:00:00.000Z"),
    });
  }
}

/** A service, and everything a suite wants to look at behind it. */
export interface RetentionHarness {
  readonly service: RetentionPolicyService;
  readonly repository: InMemoryRetentionRepository;
  readonly schedule: RetentionSchedule;
  /** Every audit event the service recorded. */
  readonly audited: AuditRecord[];
}

/**
 * Build the service over an in-memory table.
 *
 * @param planted - Tiers already stored.
 * @param artifactDays - The deployment's `OURO_ARTIFACT_RETENTION_DAYS` (30 when unset).
 * @returns The harness.
 */
export function retentionHarness(
  planted: readonly PlantedTier[] = [],
  artifactDays = 30,
): RetentionHarness {
  const repository = new InMemoryRetentionRepository(planted);
  const schedule = new RetentionSchedule();
  const audited: AuditRecord[] = [];
  const audit = {
    record: (event: AuditRecord) => {
      audited.push(event);
      return Promise.resolve(String(audited.length));
    },
  } as unknown as AuditService;
  const config = { artifacts: { retentionDays: artifactDays } } as unknown as AppConfigService;

  return {
    service: new RetentionPolicyService(
      repository as unknown as RetentionRepository,
      config,
      audit,
      schedule,
    ),
    repository,
    schedule,
    audited,
  };
}
