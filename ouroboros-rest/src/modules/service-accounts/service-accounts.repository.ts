/**
 * The statements behind service accounts and their tokens
 * ([#485](https://github.com/NobuData/ouroboros/issues/485)) — and nothing else.
 *
 * Every read that can authenticate is `revoked_at is null` **and** `disabled_at is null`, so a
 * rotated token and a revoked account stop working the moment their transaction commits.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, Organization } from "../db/schema";

/** What an accepted token authenticates as. */
export interface AuthenticatedServiceRow {
  readonly tokenId: string;
  readonly accountId: string;
  readonly name: string;
  readonly scopes: string[];
  readonly organization: Organization;
}

/** One account as the list renders it, with its live token's metadata (never the token). */
export interface ServiceAccountRow {
  readonly id: string;
  readonly name: string;
  readonly scopes: string[];
  readonly created_by: string | null;
  readonly created_at: Date;
  readonly disabled_at: Date | null;
  /** The live token's id, or `null` when the account has none (revoked, or seeded without). */
  readonly token_id: string | null;
  readonly token_hint_sealed: string | null;
  readonly token_created_at: Date | null;
  readonly token_last_used_at: Date | null;
}

/** A new account. */
export interface NewServiceAccountRow {
  readonly organization_id: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly created_by: string;
}

/** A new token row. The token itself is not a field: only its hash and sealed hint. */
export interface NewServiceTokenRow {
  readonly id: string;
  readonly organization_id: string;
  readonly service_account_id: string;
  readonly token_hash: string;
  readonly hint_sealed: string;
  readonly created_by: string;
  readonly created_at: Date;
}

@Injectable()
export class ServiceAccountsRepository {
  /**
   * @param database - The pool owner.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Run `work` in one transaction.
   *
   * @param work - The statements.
   * @returns Whatever `work` returned, after the commit.
   */
  transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.db.transaction().execute(work);
  }

  /**
   * Find the live token with this hash, on an enabled account, with its workspace.
   *
   * @param tokenHash - SHA-256 of the presented token.
   * @returns The principal's facts, or `undefined` — unknown, revoked, or the account disabled.
   */
  async authenticate(tokenHash: string): Promise<AuthenticatedServiceRow | undefined> {
    const row = await this.database.db
      .selectFrom("service_tokens")
      .innerJoin("service_accounts", "service_accounts.id", "service_tokens.service_account_id")
      .innerJoin("organization", "organization.id", "service_accounts.organization_id")
      .select([
        "service_tokens.id as token_id",
        "service_accounts.id as account_id",
        "service_accounts.name",
        "service_accounts.scopes",
        "organization.id as org_id",
        "organization.name as org_name",
        "organization.slug as org_slug",
        "organization.logo as org_logo",
        "organization.createdAt as org_created_at",
        "organization.metadata as org_metadata",
      ])
      .where("service_tokens.token_hash", "=", tokenHash)
      .where("service_tokens.revoked_at", "is", null)
      .where("service_accounts.disabled_at", "is", null)
      .executeTakeFirst();

    if (row === undefined) return undefined;

    return {
      tokenId: row.token_id,
      accountId: row.account_id,
      name: row.name,
      scopes: row.scopes,
      organization: {
        id: row.org_id,
        name: row.org_name,
        slug: row.org_slug,
        logo: row.org_logo,
        createdAt: row.org_created_at,
        metadata: row.org_metadata,
      },
    };
  }

  /**
   * Record that a token was just used.
   *
   * @param tokenId - The token.
   * @param at - When.
   */
  async touch(tokenId: string, at: Date): Promise<void> {
    await this.database.db
      .updateTable("service_tokens")
      .set({ last_used_at: at })
      .where("id", "=", tokenId)
      .execute();
  }

  /**
   * Every account of a workspace, newest first, with its live token's metadata.
   *
   * @param organizationId - The workspace.
   * @returns The rows.
   */
  list(organizationId: string): Promise<ServiceAccountRow[]> {
    return this.accounts(organizationId).orderBy("service_accounts.created_at", "desc").execute();
  }

  /**
   * One account of a workspace.
   *
   * @param organizationId - The workspace.
   * @param id - The account.
   * @param trx - The transaction, when called inside one.
   * @returns The row, or `undefined` when it is not this workspace's.
   */
  find(
    organizationId: string,
    id: string,
    trx?: Transaction<Database>,
  ): Promise<ServiceAccountRow | undefined> {
    return this.accounts(organizationId, trx)
      .where("service_accounts.id", "=", id)
      .executeTakeFirst();
  }

  /**
   * Whether a workspace already has an account of this name.
   *
   * @param organizationId - The workspace.
   * @param name - The name.
   * @param trx - The transaction.
   * @returns `true` when the name is taken.
   */
  async nameTaken(
    organizationId: string,
    name: string,
    trx: Transaction<Database>,
  ): Promise<boolean> {
    const row = await trx
      .selectFrom("service_accounts")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("name", "=", name)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * Insert an account.
   *
   * @param trx - The transaction.
   * @param account - The row.
   * @returns The new account's id.
   */
  async insertAccount(trx: Transaction<Database>, account: NewServiceAccountRow): Promise<string> {
    const row = await trx
      .insertInto("service_accounts")
      .values({ ...account, scopes: JSON.stringify(account.scopes) })
      .returning("id")
      .executeTakeFirstOrThrow();

    return row.id;
  }

  /**
   * Insert a token row (hash and sealed hint only).
   *
   * @param trx - The transaction.
   * @param token - The row.
   */
  async insertToken(trx: Transaction<Database>, token: NewServiceTokenRow): Promise<void> {
    await trx.insertInto("service_tokens").values(token).execute();
  }

  /**
   * Revoke an account's live token, if it has one.
   *
   * @param trx - The transaction.
   * @param accountId - The account.
   * @param at - When.
   * @returns How many tokens were revoked (0 or 1).
   */
  async revokeLive(trx: Transaction<Database>, accountId: string, at: Date): Promise<number> {
    const result = await trx
      .updateTable("service_tokens")
      .set({ revoked_at: at })
      .where("service_account_id", "=", accountId)
      .where("revoked_at", "is", null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }

  /**
   * Disable an account.
   *
   * @param trx - The transaction.
   * @param accountId - The account.
   * @param at - When.
   */
  async disable(trx: Transaction<Database>, accountId: string, at: Date): Promise<void> {
    await trx
      .updateTable("service_accounts")
      .set({ disabled_at: at })
      .where("id", "=", accountId)
      .execute();
  }

  /**
   * The account read both {@link list} and {@link find} share.
   *
   * @param organizationId - The workspace.
   * @param trx - The transaction, if any.
   * @returns The query.
   */
  private accounts(organizationId: string, trx?: Transaction<Database>) {
    return (trx ?? this.database.db)
      .selectFrom("service_accounts")
      .leftJoin("service_tokens", (join) =>
        join
          .onRef("service_tokens.service_account_id", "=", "service_accounts.id")
          .on("service_tokens.revoked_at", "is", null),
      )
      .select([
        "service_accounts.id",
        "service_accounts.name",
        "service_accounts.scopes",
        "service_accounts.created_by",
        "service_accounts.created_at",
        "service_accounts.disabled_at",
        "service_tokens.id as token_id",
        "service_tokens.hint_sealed as token_hint_sealed",
        "service_tokens.created_at as token_created_at",
        "service_tokens.last_used_at as token_last_used_at",
      ])
      .where("service_accounts.organization_id", "=", organizationId);
  }
}
