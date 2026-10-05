/**
 * `RetentionPolicyService` — the one place a sweep learns how long a class of data is kept
 * (BQ.3, [#482](https://github.com/NobuData/ouroboros/issues/482)).
 *
 * ```
 * card select · '30 days' ─┐                         ┌─▶ cutoffs('transcripts') → transcript sweep (#299)
 * advanced editor ─────────┼─▶ update() ─ bounds ─▶ │─▶ cutoffs('build_logs')  → build-log sweep (#253)
 *                          │   audit row per change  ├─▶ cutoffs('artifacts')   → artifact sweep (#333)
 *                          │                         └─▶ cutoffs('audit')       → audit purge (BR.2)
 * GET /settings/retention ─┴─▶ read(): tiers · bounds · next sweep · last tombstone count
 * ```
 *
 * **Reads.** {@link cutoffs} is what a sweep asks for once per run: the default cutoff, and one per
 * workspace that stored a tier — `now − days`, computed in `retention.policy.ts` and nowhere else,
 * so a sweep never re-derives date arithmetic and a change to one class cannot move another
 * class's sweep. {@link retainUntil} is what a write path asks for when it records the promise on
 * the row (`retain_until`, `retained_until`); its per-workspace lookup is cached for
 * {@link TIER_CACHE_MS} because the build-log ingest asks once per chunk.
 *
 * **Writes.** {@link update} checks every requested tier against its class's bounds before
 * storing any (all or nothing), stores only the classes whose value actually changes, and writes
 * one `workspace.retention_changed` audit event per changed class with the old and new value and
 * the actor. Saving deletes nothing: the next sweep of each class applies the new tier.
 */

import { Injectable } from "@nestjs/common";

import { WORKSPACE_RETENTION_CHANGED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { AppConfigService } from "../config/config.service";
import type { OrganizationRole } from "../db/schema";
import { roleEditability } from "../settings/workspace.resources";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import type { RetentionCutoffs } from "./retention.cutoffs";
import type { PatchRetentionDto } from "./retention.dto";
import { retentionBodyInvalid, retentionOutOfBounds } from "./retention.errors";
import {
  CORE_DATA_CLASSES,
  CUSTOM_DEFAULT_DAYS,
  LOOP_DATA_CLASSES,
  RETENTION_DEFAULT_DAYS,
  boundsFor,
  checkTier,
  cutoffAt,
  isDataClass,
  isLoopDataClass,
  retainedUntil,
  type DataClass,
  type RetentionRefusal,
} from "./retention.policy";
import { RetentionRepository, type StoredTier } from "./retention.repository";
import {
  RETENTION_EFFECT_NOTE,
  sharedLoopDays,
  sweepRecordResource,
  type RetentionSettingsResource,
  type RetentionTierResource,
} from "./retention.resources";
import { RetentionSchedule } from "./retention.schedule";

/** How long a workspace's stored tiers are reused by {@link RetentionPolicyService.daysFor}. */
export const TIER_CACHE_MS = 60_000;

/** Who is asking, as far as the card is concerned. */
export interface RetentionCaller {
  /** The user id — the audit actor on a save. */
  readonly userId: string;
  /** The caller's roles in the workspace — what decides `editable`. */
  readonly roles: readonly OrganizationRole[];
}

/** One tier the save changed. */
interface TierChange {
  readonly dataClass: DataClass;
  readonly previousDays: number;
  readonly previousSource: "policy" | "default";
  readonly days: number;
}

@Injectable()
export class RetentionPolicyService {
  /** Stored tiers by workspace, with when they were read. */
  private readonly cache = new Map<
    string,
    { readonly at: number; readonly tiers: Map<string, number> }
  >();

  constructor(
    private readonly repository: RetentionRepository,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly schedule: RetentionSchedule,
  ) {}

  /**
   * The days a class is kept in a workspace that stored no tier for it.
   *
   * @param dataClass - The class.
   * @returns 30 for loop data and custom classes, 400 for audit — except `artifacts`, which keeps
   *   the deployment's `OURO_ARTIFACT_RETENTION_DAYS` (30 unless set) so an upgrade deletes nothing
   *   the artifact sweep would have kept.
   */
  defaultDays(dataClass: DataClass): number {
    if (dataClass === "artifacts") return this.config.artifacts.retentionDays;
    return (CORE_DATA_CLASSES as readonly string[]).includes(dataClass)
      ? RETENTION_DEFAULT_DAYS[dataClass as keyof typeof RETENTION_DEFAULT_DAYS]
      : CUSTOM_DEFAULT_DAYS;
  }

  /**
   * The days one workspace keeps one class — its stored tier, or the default. Cached per
   * workspace for {@link TIER_CACHE_MS}; a save through {@link update} clears the workspace's entry.
   *
   * @param organizationId - The workspace.
   * @param dataClass - The class.
   * @returns Days kept.
   */
  async daysFor(organizationId: string, dataClass: DataClass): Promise<number> {
    const cached = this.cache.get(organizationId);
    let tiers =
      cached !== undefined && Date.now() - cached.at < TIER_CACHE_MS ? cached.tiers : undefined;

    if (tiers === undefined) {
      tiers = new Map(
        (await this.repository.stored(organizationId)).map((row) => [row.data_class, row.days]),
      );
      this.cache.set(organizationId, { at: Date.now(), tiers });
    }

    return tiers.get(dataClass) ?? this.defaultDays(dataClass);
  }

  /**
   * When data of a class stored now is promised until — for the columns that record it.
   *
   * @param organizationId - The workspace.
   * @param dataClass - The class.
   * @param at - When it is stored.
   * @returns `at + days`.
   */
  async retainUntil(organizationId: string, dataClass: DataClass, at: Date): Promise<Date> {
    return retainedUntil(at, await this.daysFor(organizationId, dataClass));
  }

  /**
   * The cutoffs one sweep of one class works to: data stored before its workspace's cutoff is
   * expired. Read fresh — a sweep is minutes apart, and must see a save made since the last.
   *
   * @param dataClass - The class being swept.
   * @param now - When the sweep runs.
   * @returns The default cutoff and one per workspace that stored a tier.
   */
  async cutoffs(dataClass: DataClass, now: Date): Promise<RetentionCutoffs> {
    const overrides = await this.repository.overrides(dataClass);

    return {
      dataClass,
      fallback: cutoffAt(now, this.defaultDays(dataClass)),
      byOrganization: new Map(
        overrides.map((row) => [row.organization_id, cutoffAt(now, row.days)] as const),
      ),
    };
  }

  /**
   * The card, as it stands for this caller.
   *
   * @param organizationId - The workspace.
   * @param caller - Who is asking; their roles decide `editable`.
   * @returns Every core class, then every stored custom class, with bounds and sweep timing.
   */
  async read(organizationId: string, caller: RetentionCaller): Promise<RetentionSettingsResource> {
    const stored = new Map(
      (await this.repository.stored(organizationId)).map((row) => [row.data_class, row] as const),
    );
    const custom = [...stored.keys()].filter(
      (dataClass) => !(CORE_DATA_CLASSES as readonly string[]).includes(dataClass),
    );

    const classes = [...CORE_DATA_CLASSES, ...custom]
      .filter(isDataClass)
      .map((dataClass) => this.tier(dataClass, stored.get(dataClass)));

    return {
      ...roleEditability(caller.roles.some((role) => ADMINISTRATORS.includes(role))),
      loopDays: sharedLoopDays(classes),
      classes,
      effect: RETENTION_EFFECT_NOTE,
    };
  }

  /**
   * Save the simple select or the advanced editor, then read the card back.
   *
   * @param organizationId - The workspace.
   * @param caller - The administrator saving it (the route's `@Roles` has already checked).
   * @param patch - The validated body: `loopDays` or `classes`, never both.
   * @returns The card after the save.
   * @throws {InvalidRequestError} `422 validation_failed` for a body that sets both controls,
   *   names an unknown class or sends a non-number; `422 retention_out_of_bounds` when any tier
   *   is outside its class's bounds. Nothing is stored in either case.
   */
  async update(
    organizationId: string,
    caller: RetentionCaller,
    patch: PatchRetentionDto,
  ): Promise<RetentionSettingsResource> {
    const requested = requestedTiers(patch);
    const refusals = [...requested].flatMap(([dataClass, days]) => {
      const refusal = checkTier(dataClass, days);
      return refusal === undefined ? [] : [refusal];
    });

    if (refusals.length > 0) {
      throw retentionOutOfBounds(refusals, (refusal) => bindRefusal(patch, refusal));
    }

    const changes = await this.repository.transaction(async (trx) => {
      const stored = new Map(
        (await this.repository.stored(organizationId, trx)).map((row) => [row.data_class, row]),
      );
      const changed: TierChange[] = [];

      for (const [dataClass, days] of requested) {
        const previous = stored.get(dataClass);
        const previousDays = previous?.days ?? this.defaultDays(dataClass);
        if (previousDays === days) continue;

        await this.repository.upsert(trx, organizationId, dataClass, days, caller.userId);
        changed.push({
          dataClass,
          previousDays,
          previousSource: previous === undefined ? "default" : "policy",
          days,
        });
      }

      return changed;
    });

    this.cache.delete(organizationId);

    const at = new Date();
    for (const change of changes) {
      await this.audit.record({
        organizationId,
        actorId: caller.userId,
        action: WORKSPACE_RETENTION_CHANGED_EVENT,
        subjectType: "workspace",
        subjectId: organizationId,
        at,
        detail: {
          dataClass: change.dataClass,
          previousDays: change.previousDays,
          previousSource: change.previousSource,
          days: change.days,
        },
      });
    }

    return this.read(organizationId, caller);
  }

  /**
   * One class's row of the card.
   *
   * @param dataClass - The class.
   * @param stored - Its stored tier, or `undefined` for the default.
   * @returns The row.
   */
  private tier(dataClass: DataClass, stored: StoredTier | undefined): RetentionTierResource {
    const status = this.schedule.status(dataClass);

    return {
      dataClass,
      days: stored?.days ?? this.defaultDays(dataClass),
      source: stored === undefined ? "default" : "policy",
      loopData: isLoopDataClass(dataClass),
      ...boundsFor(dataClass),
      updatedAt: stored?.updated_at.toISOString() ?? null,
      updatedBy: stored?.updated_by ?? null,
      nextSweepAt: status.nextAt?.toISOString() ?? null,
      lastSweep: sweepRecordResource(status.last),
    };
  }
}

/**
 * The tiers a body asks for: the simple select's three, or the advanced editor's named classes.
 *
 * @param patch - The validated body.
 * @returns Class → days, empty for a body carrying neither control.
 * @throws {InvalidRequestError} `422 validation_failed` for both controls at once, an unknown
 *   class, or a value that is not a number.
 */
function requestedTiers(patch: PatchRetentionDto): Map<DataClass, number> {
  if (patch.loopDays !== undefined && patch.classes !== undefined) {
    const message = "Send loopDays or classes, not both.";
    throw retentionBodyInvalid({ loopDays: [message], classes: [message] });
  }

  if (patch.loopDays !== undefined) {
    const days = patch.loopDays;
    return new Map(LOOP_DATA_CLASSES.map((dataClass) => [dataClass, days] as const));
  }

  const requested = new Map<DataClass, number>();
  const fields: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(patch.classes ?? {})) {
    if (!isDataClass(key)) {
      fields[`classes.${key}`] = [
        "Unknown data class: use transcripts, build_logs, artifacts, audit or custom:<slug>.",
      ];
    } else if (typeof value !== "number") {
      fields[`classes.${key}`] = [`Retention for ${key} must be a number of days.`];
    } else {
      requested.set(key, value);
    }
  }

  if (Object.keys(fields).length > 0) throw retentionBodyInvalid(fields);
  return requested;
}

/**
 * The request field a refusal is bound to, and the message shown beside it — so the card shows it
 * beside the input that sent the value.
 *
 * @param patch - The body.
 * @param refusal - The refusal.
 * @returns `loopDays` with one message for the three loop classes the select sets together, or
 *   `classes.<class>` with the class's own message.
 */
function bindRefusal(
  patch: PatchRetentionDto,
  refusal: RetentionRefusal,
): { field: string; message: string } {
  if (patch.loopDays === undefined) {
    return { field: `classes.${refusal.dataClass}`, message: refusal.message };
  }

  const bound =
    refusal.reason === "below_floor"
      ? `at least ${String(refusal.floor)} days`
      : refusal.reason === "above_ceiling"
        ? `at most ${String(refusal.ceiling)} days`
        : "a whole number of days";
  return {
    field: "loopDays",
    message: `Retention for transcripts, logs and artifacts must be ${bound}.`,
  };
}
