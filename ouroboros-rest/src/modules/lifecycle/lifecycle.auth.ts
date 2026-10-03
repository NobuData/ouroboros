/**
 * The two writes the lifecycle makes to BetterAuth's rows — through the library, never a
 * hand-written statement (BR.5, [#489](https://github.com/NobuData/ouroboros/issues/489)).
 *
 * `organization` and `session` are the library's tables (`db/schema.ts`'s `LIBRARY_OWNED_TABLES`
 * rule): it mints and maps their rows, so a deletion goes through its own adapter. The adapter
 * rather than `auth.api.deleteOrganization` because both callers act without a session that could
 * authorise the endpoint — the purge is the system at day 30, and revoking *other* people's
 * sessions is not something any one session's endpoint does.
 *
 * An interface plus a token so the service's specs substitute a recording fake.
 */

import { Injectable } from "@nestjs/common";
import { AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import type { Auth } from "../../auth/auth.factory";

/** The injection token for {@link WorkspaceAuthStore}. */
export const WORKSPACE_AUTH_STORE = Symbol("WORKSPACE_AUTH_STORE");

/** What the lifecycle needs from the library's rows. */
export interface WorkspaceAuthStore {
  /**
   * Revoke every session acting in a workspace, except those of the given people.
   *
   * @param organizationId - The workspace being deleted.
   * @param keepUserIds - The owners, who keep their sessions to reach the recovery screen.
   * @returns How many sessions were revoked.
   */
  revokeSessions(organizationId: string, keepUserIds: readonly string[]): Promise<number>;
  /**
   * Remove the organization row. Every tenant table cascades from it.
   *
   * @param organizationId - The workspace being purged.
   */
  removeOrganization(organizationId: string): Promise<void>;
}

/** The narrow slice of the library's adapter these two writes use. */
interface AdapterSlice {
  deleteMany(input: {
    model: string;
    where: { field: string; value: unknown; operator?: string }[];
  }): Promise<number>;
  delete(input: { model: string; where: { field: string; value: unknown }[] }): Promise<void>;
}

@Injectable()
export class BetterAuthWorkspaceStore implements WorkspaceAuthStore {
  /** @param betterAuth - The library instance, whose context carries the adapter. */
  constructor(private readonly betterAuth: BetterAuth<Auth>) {}

  /** @see WorkspaceAuthStore.revokeSessions */
  async revokeSessions(organizationId: string, keepUserIds: readonly string[]): Promise<number> {
    const where: { field: string; value: unknown; operator?: string }[] = [
      { field: "activeOrganizationId", value: organizationId },
    ];

    if (keepUserIds.length > 0) {
      where.push({ field: "userId", value: [...keepUserIds], operator: "not_in" });
    }

    return (await this.adapter()).deleteMany({ model: "session", where });
  }

  /** @see WorkspaceAuthStore.removeOrganization */
  async removeOrganization(organizationId: string): Promise<void> {
    await (
      await this.adapter()
    ).delete({
      model: "organization",
      where: [{ field: "id", value: organizationId }],
    });
  }

  /**
   * The library's adapter.
   *
   * @returns Its context's adapter, narrowed to what this file calls.
   */
  private async adapter(): Promise<AdapterSlice> {
    const context = await this.betterAuth.instance.$context;

    return context.adapter;
  }
}
