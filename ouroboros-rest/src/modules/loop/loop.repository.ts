/**
 * The workspace reads the loop capability report and the readiness preflight need (DG.2,
 * [#1300](https://github.com/NobuData/ouroboros/issues/1300)).
 *
 * **The workspace is a parameter of both statements.** The report's acceptance criterion is
 * that a workspace never learns another's connection or runner state through a reason, and
 * the reasons are computed from nothing but these two answers. `loop.repository.spec.ts`
 * compiles both and asserts the predicate.
 *
 * Both are existence questions and select nothing secret: a connection's id, a runner's
 * capability document.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { ProviderConnectionKind } from "../db/schema";
import { supportsSourceCheckout } from "../farm/gateway/capabilities";
import type { ConnectionFact } from "./readiness";

/** Runner statuses dispatch would offer a job to — `farm/dispatch/dispatch.repository.ts`. */
const DISPATCHABLE_STATUSES = ["online", "building"] as const;

/** What the workspace's runners can do right now. */
export interface RunnerPresence {
  /** Whether any runner is active and online. */
  readonly online: boolean;
  /** Whether any of those has said it can check out source. */
  readonly sourceCheckout: boolean;
}

@Injectable()
export class LoopRepository {
  /**
   * @param database - The pool. Nothing here writes.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Whether the workspace has an enabled, unpaused connection of one of the given kinds.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param kinds - The kinds cleared for invocation (`invocation.terms.ts`). Empty asks
   *   nothing and answers `false`.
   * @returns True when at least one such connection exists.
   */
  async invocableConnectionExists(
    organizationId: string,
    kinds: readonly ProviderConnectionKind[],
  ): Promise<boolean> {
    if (kinds.length === 0) return false;

    const row = await this.database.db
      .selectFrom("provider_connections")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("kind", "in", kinds)
      .where("enabled", "=", true)
      .where("status", "!=", "paused")
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * The workspace's enabled, unpaused connections of the given kinds, with their last health
   * test's outcome — the readiness preflight's provider check (DK.1, #1318).
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param kinds - The kinds cleared for invocation. Empty asks nothing and answers none.
   * @returns The connections: kind, display name and status — nothing secret.
   */
  async invocableConnections(
    organizationId: string,
    kinds: readonly ProviderConnectionKind[],
  ): Promise<ConnectionFact[]> {
    if (kinds.length === 0) return [];

    const rows = await this.database.db
      .selectFrom("provider_connections")
      .select(["kind", "display_name", "status"])
      .where("organization_id", "=", organizationId)
      .where("kind", "in", kinds)
      .where("enabled", "=", true)
      .where("status", "!=", "paused")
      .orderBy("created_at")
      .execute();

    return rows.map((row) => ({
      kind: row.kind,
      displayName: row.display_name,
      status: row.status,
    }));
  }

  /**
   * Whether the workspace has a runner online, and whether one of those can check out source.
   *
   * Reads the capability documents of the dispatchable runners — a handful per workspace — and
   * judges them with the farm's own helper, so the rule lives in one place.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The two answers.
   */
  async runnerPresence(organizationId: string): Promise<RunnerPresence> {
    const rows = await this.database.db
      .selectFrom("runners")
      .select("capabilities")
      .where("organization_id", "=", organizationId)
      .where("desired_state", "=", "active")
      .where("status", "in", DISPATCHABLE_STATUSES)
      .execute();

    return {
      online: rows.length > 0,
      sourceCheckout: rows.some((row) => supportsSourceCheckout(row.capabilities)),
    };
  }
}
