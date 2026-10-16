/**
 * The account-approval writes that belong to BetterAuth's tables, through BetterAuth's adapter.
 *
 * `"user"`, `organization`, `member` and `session` are `LIBRARY_OWNED_TABLES`: the library mints
 * their ids, maps their field names and converts their dates, and no statement in this service
 * writes them. An administrator's decision touches three of them —
 *
 *   * the person's status fields (`accountStatus` and its companions, registered as BetterAuth
 *     user fields in `auth/account.approval.ts`);
 *   * on approval, a personal organization and its owner membership, made by the **same**
 *     function a sign-in uses (`resolveActiveOrganization`);
 *   * the person's open sessions, stamped with that organization so their next request acts in
 *     it without signing in again.
 *
 * — so they are behind {@link AccountDirectory}, an interface a spec can replace, with
 * {@link BetterAuthAccountDirectory} the implementation over the library's `$context`.
 */

import { Injectable } from "@nestjs/common";
import { AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import {
  resolveActiveOrganization,
  type OrganizationOwner,
  type OrganizationStore,
} from "../../auth/active.organization";
import type { Auth } from "../../auth/auth.factory";
import type { AccountStatus, AccountStatusReason } from "../db/schema";

/** The injection token for {@link AccountDirectory}. */
export const ACCOUNT_DIRECTORY = Symbol("ACCOUNT_DIRECTORY");

/** A decision to write onto a person. */
export interface AccountStatusChange {
  readonly status: AccountStatus;
  readonly reason: AccountStatusReason;
  /** The deciding administrator, lower-cased. */
  readonly changedBy: string;
  readonly changedAt: Date;
}

/** What account approval writes through BetterAuth. */
export interface AccountDirectory {
  /**
   * Write a decision onto the person's row.
   *
   * @param userId - `"user".id`.
   * @param change - The status, reason, administrator and time.
   */
  setStatus(userId: string, change: AccountStatusChange): Promise<void>;

  /**
   * Give an approved person somewhere to act: their personal organization when they belong
   * nowhere, then stamp it onto every open session that is acting nowhere.
   *
   * @param owner - The person.
   * @returns The organization their sessions now start in, or `null` if none could be had.
   */
  ensureWorkspace(owner: OrganizationOwner): Promise<string | null>;
}

/** The adapter calls this module makes beyond {@link OrganizationStore}'s. */
interface SessionStore extends OrganizationStore {
  update<T>(query: {
    model: string;
    where: readonly { field: string; value: unknown }[];
    update: Record<string, unknown>;
  }): Promise<T | null>;
}

/** The internal-adapter call this module makes. */
interface UserWriter {
  updateUser(userId: string, data: Record<string, unknown>): Promise<unknown>;
}

@Injectable()
export class BetterAuthAccountDirectory implements AccountDirectory {
  /**
   * @param betterAuth - The library's service; its `instance.$context` holds the adapters.
   */
  constructor(private readonly betterAuth: BetterAuth<Auth>) {}

  /** @inheritdoc */
  async setStatus(userId: string, change: AccountStatusChange): Promise<void> {
    const context = await this.betterAuth.instance.$context;
    const users = context.internalAdapter as unknown as UserWriter;

    await users.updateUser(userId, {
      accountStatus: change.status,
      accountStatusReason: change.reason,
      accountStatusChangedBy: change.changedBy,
      accountStatusChangedAt: change.changedAt,
    });
  }

  /** @inheritdoc */
  async ensureWorkspace(owner: OrganizationOwner): Promise<string | null> {
    const context = await this.betterAuth.instance.$context;
    const store = context.adapter as unknown as SessionStore;
    const organizationId = await resolveActiveOrganization({ store, user: owner, mayCreate: true });

    if (organizationId === null) return null;

    const sessions = await store.findMany<{ id: string; activeOrganizationId: string | null }>({
      model: "session",
      where: [{ field: "userId", value: owner.id }],
    });

    for (const session of sessions) {
      if (session.activeOrganizationId) continue;

      await store.update({
        model: "session",
        where: [{ field: "id", value: session.id }],
        update: { activeOrganizationId: organizationId },
      });
    }

    return organizationId;
  }
}
