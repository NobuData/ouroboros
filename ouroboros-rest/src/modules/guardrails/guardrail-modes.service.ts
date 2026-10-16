/**
 * `GuardrailModesService` — whether each guardrail check stops a run or is only shown (AR.1,
 * [#315](https://github.com/NobuData/ouroboros/issues/315), decision 1).
 *
 * ```
 * GET   /api/v1/settings/guardrails   any member      → {modes: {allowed_paths, ci_config, secrets, review_required}}
 * PATCH /api/v1/settings/guardrails   owner · admin   guardrail_modes   workspace.guardrail_modes_changed
 * ```
 *
 * A check a workspace never chose a mode for is `block` (V148: no row is `block`), so the read
 * always answers all four. The write is a partial map; it stores only the checks it names and
 * writes one audit row, and only when a mode actually moved — setting a check to the mode it
 * already has leaves the trail alone, as the live-execution settings do (#1312).
 *
 * The evaluator reads the same rows inside each change-set report and stamps every verdict with
 * the mode in force (`guardrail_evaluations.mode`), so a change here applies from the next report
 * on and never rewrites a verdict already made.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import { WORKSPACE_GUARDRAIL_MODES_CHANGED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { DatabaseService } from "../db/db.service";
import { GUARDRAIL_CHECKS, type GuardrailCheck, type GuardrailMode } from "../db/schema";
import { GuardrailsRepository } from "./guardrails.repository";

/** Every check's mode — the whole map, never a partial one. */
export type GuardrailModes = Readonly<Record<GuardrailCheck, GuardrailMode>>;

/** `GET`/`PATCH /api/v1/settings/guardrails`. */
export interface GuardrailModesResource {
  /** The four checks, each `block` (a fail stops the run) or `warn` (a fail is only shown). */
  readonly modes: GuardrailModes;
}

/** The audit trail, as this service writes to it. */
export type GuardrailModesAudit = Pick<AuditService, "record">;

/** Injection token for the clock — `Date.now` unless a suite binds one. */
export const GUARDRAIL_MODES_CLOCK = "ouroboros:guardrails:modes-clock";

/**
 * The whole map from what is stored.
 *
 * @param stored - The rows a workspace has, by check.
 * @returns All four checks, in the card's order; a check with no row is `block`.
 */
export function completeModes(
  stored: Readonly<Partial<Record<GuardrailCheck, GuardrailMode>>>,
): GuardrailModes {
  return Object.fromEntries(
    GUARDRAIL_CHECKS.map((check) => [check, stored[check] ?? "block"]),
  ) as Record<GuardrailCheck, GuardrailMode>;
}

/**
 * The map as an audit detail value — flat, because audit details are.
 *
 * @param modes - The whole map.
 * @returns `allowed_paths=block,ci_config=block,secrets=warn,review_required=block`.
 */
export function modesDetail(modes: GuardrailModes): string {
  return GUARDRAIL_CHECKS.map((check) => `${check}=${modes[check]}`).join(",");
}

@Injectable()
export class GuardrailModesService {
  /** The clock. */
  private readonly clock: () => Date;

  /**
   * @param database - The connection the settings route reads and writes through.
   * @param repository - The `guardrail_modes` statements, shared with the evaluator.
   * @param audit - The trail.
   * @param clock - The clock — `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: GuardrailsRepository,
    @Inject(AuditService) private readonly audit: GuardrailModesAudit,
    @Optional() @Inject(GUARDRAIL_MODES_CLOCK) clock?: () => number,
  ) {
    this.clock = () => new Date((clock ?? Date.now)());
  }

  /**
   * The workspace's mode for each check.
   *
   * @param organizationId - The workspace.
   * @returns All four, `block` where nothing was chosen.
   */
  async read(organizationId: string): Promise<GuardrailModesResource> {
    return { modes: completeModes(await this.repository.modes(this.database.db, organizationId)) };
  }

  /**
   * Change some of the workspace's modes.
   *
   * @param organizationId - The workspace.
   * @param patch - The checks to change, each with its new mode. Checks it does not name keep
   *   theirs; an empty patch changes nothing.
   * @param userId - The owner or admin setting them.
   * @returns All four modes as they now stand.
   */
  async update(
    organizationId: string,
    patch: Readonly<Partial<Record<GuardrailCheck, GuardrailMode>>>,
    userId: string,
  ): Promise<GuardrailModesResource> {
    const before = completeModes(await this.repository.modes(this.database.db, organizationId));
    const moved = GUARDRAIL_CHECKS.filter(
      (check) => patch[check] !== undefined && patch[check] !== before[check],
    );

    if (moved.length === 0) {
      return { modes: before };
    }

    const changes = Object.fromEntries(moved.map((check) => [check, patch[check]])) as Partial<
      Record<GuardrailCheck, GuardrailMode>
    >;
    const after = completeModes({ ...before, ...changes });

    await this.repository.saveModes(this.database.db, organizationId, changes, userId);
    await this.audit.record({
      organizationId,
      actorId: userId,
      action: WORKSPACE_GUARDRAIL_MODES_CHANGED_EVENT,
      subjectType: "workspace",
      subjectId: organizationId,
      at: this.clock(),
      detail: {
        changed: moved.join(","),
        before: modesDetail(before),
        after: modesDetail(after),
      },
    });

    return { modes: after };
  }
}
