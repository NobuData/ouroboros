/**
 * Account approval's reads, and the writes to its own two tables (V149).
 *
 * `"user"` is one of `LIBRARY_OWNED_TABLES`: this repository **reads** it (the admin lists, one
 * account, an account by address) and never writes it — a status change goes through BetterAuth's
 * adapter (`accounts.directory.ts`). `app_preapproved_emails` and `app_account_events` are this
 * service's, written here; the events table is append-only, so it has an insert and no update.
 */

import { Injectable } from "@nestjs/common";
import type { Selectable } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  AccountStatus,
  AccountStatusReason,
  AppAccountEventAction,
  AppPreapprovedEmailsTable,
} from "../db/schema";

/** The most accounts one admin list answers with — the spec's cap. */
export const ACCOUNT_LIST_LIMIT = 200;

/** One account, as the admin routes read it. */
export interface AccountRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly github_login: string | null;
  readonly account_status: AccountStatus;
  readonly createdAt: Date;
  readonly account_status_changed_at: Date | null;
  readonly account_status_changed_by: string | null;
  readonly account_status_reason: AccountStatusReason | null;
}

/** One pre-approved address, as stored. */
export type PreapprovedEmailRow = Selectable<AppPreapprovedEmailsTable>;

/** One event to append. */
export interface AccountEvent {
  /** The administrator, lower-cased; `null` when the system decided. */
  readonly actorEmail: string | null;
  readonly action: AppAccountEventAction;
  readonly subjectUserId: string | null;
  readonly subjectEmail: string;
  readonly detail?: Record<string, unknown>;
}

/** The columns every account read selects. */
const ACCOUNT_COLUMNS = [
  "id",
  "name",
  "email",
  "github_login",
  "account_status",
  "createdAt",
  "account_status_changed_at",
  "account_status_changed_by",
  "account_status_reason",
] as const;

@Injectable()
export class AccountsRepository {
  /**
   * @param database - The pool owner.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The accounts in one status, newest first, at most {@link ACCOUNT_LIST_LIMIT}.
   *
   * `pending` and `denied` read V149's partial `user_account_status_held_idx`.
   *
   * @param status - Which list.
   * @returns The rows.
   */
  async list(status: AccountStatus): Promise<AccountRow[]> {
    return this.database.db
      .selectFrom("user")
      .select(ACCOUNT_COLUMNS)
      .where("account_status", "=", status)
      .orderBy("createdAt", "desc")
      .orderBy("id", "desc")
      .limit(ACCOUNT_LIST_LIMIT)
      .execute();
  }

  /**
   * One account.
   *
   * @param userId - `"user".id`.
   * @returns The row, or `undefined`.
   */
  async find(userId: string): Promise<AccountRow | undefined> {
    return this.database.db
      .selectFrom("user")
      .select(ACCOUNT_COLUMNS)
      .where("id", "=", userId)
      .executeTakeFirst();
  }

  /**
   * The account holding an address, if any.
   *
   * @param email - A lower-cased address (BetterAuth stores `"user".email` lower-cased).
   * @returns The row, or `undefined`.
   */
  async findByEmail(email: string): Promise<AccountRow | undefined> {
    return this.database.db
      .selectFrom("user")
      .select(ACCOUNT_COLUMNS)
      .where("email", "=", email)
      .executeTakeFirst();
  }

  /**
   * Every pre-approved address, newest first.
   *
   * @returns The rows.
   */
  async listPreapproved(): Promise<PreapprovedEmailRow[]> {
    return this.database.db
      .selectFrom("app_preapproved_emails")
      .selectAll()
      .orderBy("created_at", "desc")
      .orderBy("email")
      .execute();
  }

  /**
   * Pre-approve an address, unless it already is.
   *
   * @param entry - The lower-cased address, the administrator and the optional note.
   * @returns The new row, or `undefined` when the address was already listed.
   */
  async addPreapproved(entry: {
    email: string;
    addedBy: string;
    note: string | null;
  }): Promise<PreapprovedEmailRow | undefined> {
    return this.database.db
      .insertInto("app_preapproved_emails")
      .values({ email: entry.email, added_by: entry.addedBy, note: entry.note })
      .onConflict((conflict) => conflict.column("email").doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Remove an address from the list.
   *
   * @param email - The lower-cased address.
   * @returns The removed row, or `undefined` when it was not listed.
   */
  async removePreapproved(email: string): Promise<PreapprovedEmailRow | undefined> {
    return this.database.db
      .deleteFrom("app_preapproved_emails")
      .where("email", "=", email)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Append one event to the deployment-level trail.
   *
   * @param event - What happened.
   */
  async record(event: AccountEvent): Promise<void> {
    await this.database.db
      .insertInto("app_account_events")
      .values({
        actor_email: event.actorEmail,
        action: event.action,
        subject_user_id: event.subjectUserId,
        subject_email: event.subjectEmail,
        // An object, which `pg` serialises as JSON for the jsonb column.
        detail: event.detail ?? {},
      })
      .execute();
  }
}
