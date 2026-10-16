/**
 * Account approval's routes, as operations: the caller's own status, and the application
 * administrator's lists and decisions.
 *
 * Every administrator operation starts with {@link AccountsService.requireAppAdmin}: the caller's
 * address must be in `OURO_APP_ADMIN_EMAILS`, or the answer is `403 app_admin_required`. These
 * routes belong to no workspace, so no role or capability could stand in for that check.
 *
 * An approval is four steps, in this order, and only the first must succeed for it to stand:
 *
 *   1. the status (`approved`, `approved_by_admin`, who, when) through BetterAuth's adapter;
 *   2. the `approved` event;
 *   3. the personal workspace, when the person belongs nowhere, stamped onto their sessions —
 *      a failure is logged, and their next sign-in makes it instead (`active.organization.ts`);
 *   4. the approval email, when `OURO_SMTP_URL` is set — a failure is logged.
 *
 * The status write and the event are not one transaction: the first goes through the library's
 * adapter and its own connection. Written in this order, a lost event leaves an approved account
 * whose trail is short by one line, never an event describing a change that did not happen.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { approvedMail, mailEnabled } from "../../auth/account.mail";
import { effectiveAccountStatus, isAppAdmin } from "../../auth/account.approval";
import { appAdminRequired } from "../auth/auth.errors";
import type { SessionUser } from "../auth/principal";
import { AppConfigService } from "../config/config.service";
import type { AccountStatus } from "../db/schema";
import { describeForLog } from "../errors/failure";
import { MAILER, type Mailer } from "../mail/mailer";
import { ACCOUNT_DIRECTORY, type AccountDirectory } from "./accounts.directory";
import {
  accountNotFound,
  alreadyPreapproved,
  cannotDenyAppAdmin,
  preapprovedEmailNotFound,
} from "./accounts.errors";
import {
  AccountsRepository,
  type AccountRow,
  type PreapprovedEmailRow,
} from "./accounts.repository";
import type {
  AccountStatusResource,
  AddedPreapprovedEmailResource,
  AdminAccountResource,
  AdminAccountsResource,
  PreapprovedEmailResource,
  PreapprovedEmailsResource,
} from "./accounts.resources";

/** The list `GET /api/v1/admin/accounts` answers when no `status` is given. */
export const DEFAULT_ACCOUNT_LIST: AccountStatus = "pending";

/** The signed-in caller, as much of them as these routes read. */
export type AccountCaller = Pick<SessionUser, "id" | "email" | "accountStatus">;

/**
 * An account row as the API answers it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function toAccountResource(row: AccountRow): AdminAccountResource {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    githubLogin: row.github_login,
    status: row.account_status,
    createdAt: row.createdAt.toISOString(),
    statusChangedAt: row.account_status_changed_at?.toISOString() ?? null,
    statusChangedBy: row.account_status_changed_by,
    statusReason: row.account_status_reason,
  };
}

/**
 * A pre-approved row as the API answers it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function toPreapprovedResource(row: PreapprovedEmailRow): PreapprovedEmailResource {
  return {
    email: row.email,
    addedBy: row.added_by,
    createdAt: row.created_at.toISOString(),
    note: row.note,
  };
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  /**
   * @param accounts - The reads and the two V149 tables.
   * @param directory - The writes to BetterAuth's tables.
   * @param config - `OURO_APP_ADMIN_EMAILS` and `OURO_UI_URL`.
   * @param mailer - The approval email's transport; an unconfigured one sends nothing.
   */
  constructor(
    private readonly accounts: AccountsRepository,
    @Inject(ACCOUNT_DIRECTORY) private readonly directory: AccountDirectory,
    private readonly config: AppConfigService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /**
   * The caller's own status — `GET /api/v1/account/status`, open to held accounts.
   *
   * Read from the row rather than the session snapshot, so the waiting page never shows a
   * decision five minutes old; an application administrator is `approved` whatever is stored.
   *
   * @param caller - The signed-in person.
   * @returns Their status, whether they are an administrator, and their address.
   */
  async status(caller: AccountCaller): Promise<AccountStatusResource> {
    const admins = this.config.appAdminEmails;
    const row = await this.accounts.find(caller.id);
    const status = effectiveAccountStatus(
      { email: caller.email, accountStatus: row?.account_status ?? caller.accountStatus },
      admins,
    );

    return {
      status: status === "unknown" ? "pending" : status,
      appAdmin: isAppAdmin(caller.email, admins),
      email: caller.email,
    };
  }

  /**
   * Refuse anybody who is not an application administrator.
   *
   * @param caller - The signed-in person.
   * @returns Their lower-cased address, the identity decisions are recorded under.
   * @throws {ForbiddenError} `403 app_admin_required`.
   */
  requireAppAdmin(caller: AccountCaller): string {
    if (!isAppAdmin(caller.email, this.config.appAdminEmails)) throw appAdminRequired();

    return caller.email.toLowerCase();
  }

  /**
   * One admin list.
   *
   * @param caller - Must be an administrator.
   * @param status - Which list; {@link DEFAULT_ACCOUNT_LIST} when absent.
   * @returns Newest first, at most 200.
   */
  async list(caller: AccountCaller, status?: AccountStatus): Promise<AdminAccountsResource> {
    this.requireAppAdmin(caller);

    const rows = await this.accounts.list(status ?? DEFAULT_ACCOUNT_LIST);

    return { accounts: rows.map(toAccountResource) };
  }

  /**
   * Approve an account — pending, denied, or already approved (which changes nothing).
   *
   * @param caller - Must be an administrator.
   * @param userId - The account.
   * @returns The account as it now stands.
   * @throws {NotFoundError} `404 account_not_found`.
   */
  async approve(caller: AccountCaller, userId: string): Promise<AdminAccountResource> {
    const actor = this.requireAppAdmin(caller);
    const row = await this.accounts.find(userId);

    if (row === undefined) throw accountNotFound(userId);

    return toAccountResource(await this.approveRow(actor, row));
  }

  /**
   * Deny an account. It stays blocked — the guard refuses its sessions — until approved.
   *
   * @param caller - Must be an administrator.
   * @param userId - The account.
   * @returns The account as it now stands.
   * @throws {NotFoundError} `404 account_not_found`.
   * @throws {ConflictError} `409 cannot_deny_app_admin` — `OURO_APP_ADMIN_EMAILS` approves it
   *   whatever is stored.
   */
  async deny(caller: AccountCaller, userId: string): Promise<AdminAccountResource> {
    const actor = this.requireAppAdmin(caller);
    const row = await this.accounts.find(userId);

    if (row === undefined) throw accountNotFound(userId);
    if (isAppAdmin(row.email, this.config.appAdminEmails)) throw cannotDenyAppAdmin(userId);
    if (row.account_status === "denied") return toAccountResource(row);

    const changedAt = new Date();

    await this.directory.setStatus(row.id, {
      status: "denied",
      reason: "denied_by_admin",
      changedBy: actor,
      changedAt,
    });
    await this.accounts.record({
      actorEmail: actor,
      action: "denied",
      subjectUserId: row.id,
      subjectEmail: row.email,
      detail: { previousStatus: row.account_status },
    });

    return toAccountResource({
      ...row,
      account_status: "denied",
      account_status_reason: "denied_by_admin",
      account_status_changed_by: actor,
      account_status_changed_at: changedAt,
    });
  }

  /**
   * The pre-approved addresses.
   *
   * @param caller - Must be an administrator.
   * @returns Newest first.
   */
  async listPreapproved(caller: AccountCaller): Promise<PreapprovedEmailsResource> {
    this.requireAppAdmin(caller);

    const rows = await this.accounts.listPreapproved();

    return { emails: rows.map(toPreapprovedResource) };
  }

  /**
   * Pre-approve an address. A **pending** account already waiting under it is approved on the
   * spot, exactly as {@link approve} would; a denied one is left for an explicit approval.
   *
   * @param caller - Must be an administrator.
   * @param input - The lower-cased address and the optional note.
   * @returns The entry, and the account it approved (or `null`).
   * @throws {ConflictError} `409 already_preapproved`.
   */
  async addPreapproved(
    caller: AccountCaller,
    input: { email: string; note?: string | null },
  ): Promise<AddedPreapprovedEmailResource> {
    const actor = this.requireAppAdmin(caller);
    const email = input.email.toLowerCase();
    const note = input.note?.trim() ? input.note.trim() : null;
    const added = await this.accounts.addPreapproved({ email, addedBy: actor, note });

    if (added === undefined) throw alreadyPreapproved(email);

    await this.accounts.record({
      actorEmail: actor,
      action: "preapproved_added",
      subjectUserId: null,
      subjectEmail: email,
      detail: note === null ? {} : { note },
    });

    const waiting = await this.accounts.findByEmail(email);
    const approved =
      waiting?.account_status === "pending" ? await this.approveRow(actor, waiting) : null;

    return {
      ...toPreapprovedResource(added),
      approvedAccount: approved === null ? null : toAccountResource(approved),
    };
  }

  /**
   * Take an address off the list. An account it already let in stays approved.
   *
   * @param caller - Must be an administrator.
   * @param email - The address, in any case.
   * @throws {NotFoundError} `404 preapproved_email_not_found`.
   */
  async removePreapproved(caller: AccountCaller, email: string): Promise<void> {
    const actor = this.requireAppAdmin(caller);
    const address = email.trim().toLowerCase();
    const removed = await this.accounts.removePreapproved(address);

    if (removed === undefined) throw preapprovedEmailNotFound(address);

    await this.accounts.record({
      actorEmail: actor,
      action: "preapproved_removed",
      subjectUserId: null,
      subjectEmail: address,
    });
  }

  /**
   * The approval itself — see the module header for its four steps.
   *
   * @param actor - The administrator, lower-cased.
   * @param row - The account.
   * @returns The row as it now stands.
   */
  private async approveRow(actor: string, row: AccountRow): Promise<AccountRow> {
    if (row.account_status === "approved") return row;

    const changedAt = new Date();

    await this.directory.setStatus(row.id, {
      status: "approved",
      reason: "approved_by_admin",
      changedBy: actor,
      changedAt,
    });
    await this.accounts.record({
      actorEmail: actor,
      action: "approved",
      subjectUserId: row.id,
      subjectEmail: row.email,
      detail: { previousStatus: row.account_status },
    });

    try {
      await this.directory.ensureWorkspace({ id: row.id, name: row.name, email: row.email });
    } catch (error) {
      this.logger.warn(
        `Approved ${row.id} but could not give them a workspace yet: ${describeForLog(error)}`,
      );
    }

    if (mailEnabled(this.mailer)) {
      try {
        await this.mailer.send(
          approvedMail(
            { name: row.name, email: row.email, githubLogin: row.github_login },
            this.config.uiUrl,
          ),
        );
      } catch (error) {
        this.logger.warn(`Approved ${row.id} but could not email them: ${describeForLog(error)}`);
      }
    }

    return {
      ...row,
      account_status: "approved",
      account_status_reason: "approved_by_admin",
      account_status_changed_by: actor,
      account_status_changed_at: changedAt,
    };
  }
}
