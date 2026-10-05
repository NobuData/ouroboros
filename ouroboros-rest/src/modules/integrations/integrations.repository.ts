/**
 * The integrations hub's reads (BR.4, [#488](https://github.com/NobuData/ouroboros/issues/488)) —
 * one question per owning plane, asked of that plane's own tables, and **never a write**.
 *
 * ```
 * GitHub      github_credentials (a token is stored) · github_orgs (App installed, login)
 *             · ticket_sources kind=github
 * Jira/Linear ticket_sources of that kind
 * webhooks    webhook_endpoints (active)
 * build farm  runners (by status, removed excluded)
 * ```
 *
 * Read directly rather than through each plane's service, as onboarding does (`OnboardingModule`):
 * those modules export nothing that answers a per-workspace status question, and the hub needs
 * only presence and counts — no ciphertext is read (`credentials_encrypted is not null` is asked
 * in SQL) and no credential leaves this file.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { RunnerStatus, TicketSourceKind, TicketSourceStatus } from "../db/schema";

/** One ticket source, as the hub needs it. */
export interface SourceFact {
  readonly kind: TicketSourceKind;
  readonly displayName: string;
  readonly status: TicketSourceStatus;
  readonly statusReason: string | null;
  readonly config: unknown;
  /** Whether a credential is stored — asked in SQL, never read. */
  readonly hasCredential: boolean;
}

/** One GitHub organization the workspace registered. */
export interface GithubOrgFact {
  readonly login: string;
  /** The App installation exists (V027's `installed_at`, null until the installation flow lands). */
  readonly appInstalled: boolean;
}

/** Everything the tiles are composed from. */
export interface IntegrationFacts {
  /** A workspace GitHub token is stored (K.4's `github_credentials`). */
  readonly githubTokenStored: boolean;
  readonly githubOrgs: readonly GithubOrgFact[];
  /** The workspace's GitHub, Jira and Linear ticket sources. */
  readonly sources: readonly SourceFact[];
  /** Webhook endpoints switched on. */
  readonly activeWebhooks: number;
  /** Runners in the fleet (removed excluded), by status. */
  readonly runners: ReadonlyMap<RunnerStatus, number>;
}

/** The ticket-source kinds the grid shows a tile for. */
const SOURCE_KINDS: readonly TicketSourceKind[] = ["github", "jira", "linear"];

@Injectable()
export class IntegrationsRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every fact the grid is composed from, for one workspace.
   *
   * @param organizationId - The workspace.
   * @returns The facts, read now.
   */
  async facts(organizationId: string): Promise<IntegrationFacts> {
    const db = this.database.db;
    const [token, orgs, sources, webhooks, runners] = await Promise.all([
      db
        .selectFrom("github_credentials")
        .select("organization_id")
        .where("organization_id", "=", organizationId)
        .executeTakeFirst(),
      db
        .selectFrom("github_orgs")
        .select(["login", "installed_at"])
        .where("organization_id", "=", organizationId)
        .orderBy("login")
        .execute(),
      db
        .selectFrom("ticket_sources")
        .select([
          "kind",
          "display_name",
          "status",
          "status_reason",
          "config",
          sql<boolean>`credentials_encrypted is not null`.as("has_credential"),
        ])
        .where("organization_id", "=", organizationId)
        .where("kind", "in", [...SOURCE_KINDS])
        .orderBy("created_at")
        .execute(),
      db
        .selectFrom("webhook_endpoints")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("organization_id", "=", organizationId)
        .where("active", "=", true)
        .executeTakeFirst(),
      db
        .selectFrom("runners")
        .select(["status", (eb) => eb.fn.countAll<string>().as("count")])
        .where("organization_id", "=", organizationId)
        .where("status", "<>", "removed")
        .groupBy("status")
        .execute(),
    ]);

    return {
      githubTokenStored: token !== undefined,
      githubOrgs: orgs.map((row) => ({
        login: row.login,
        appInstalled: row.installed_at !== null,
      })),
      sources: sources.map((row) => ({
        kind: row.kind,
        displayName: row.display_name,
        status: row.status,
        statusReason: row.status_reason,
        config: row.config,
        hasCredential: row.has_credential,
      })),
      activeWebhooks: Number(webhooks?.count ?? 0),
      runners: new Map(runners.map((row) => [row.status, Number(row.count)])),
    };
  }
}
