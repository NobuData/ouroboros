/**
 * The workspace card's one write to BetterAuth's rows — the organization's display name
 * (BQ.4, [#483](https://github.com/NobuData/ouroboros/issues/483)).
 *
 * `organization` is the library's table (`db/schema.ts`'s `LIBRARY_OWNED_TABLES` rule), so the
 * rename goes through the organization plugin's own adapter rather than a hand-written statement
 * — the same choice `lifecycle/lifecycle.auth.ts` makes, for the same reason: the library maps
 * the model to its row. The adapter rather than `auth.api.updateOrganization` because the role
 * rule is already this route's `@Roles(...ADMINISTRATORS)`, and the endpoint would demand a
 * cookie that a request authenticated any other way does not carry.
 *
 * An interface plus a token so the service's specs substitute a recording fake.
 */

import { Injectable } from "@nestjs/common";
import { AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import type { Auth } from "../../auth/auth.factory";

/** The injection token for {@link WorkspaceNameStore}. */
export const WORKSPACE_NAME_STORE = Symbol("WORKSPACE_NAME_STORE");

/** What the card needs from the library's `organization` row. */
export interface WorkspaceNameStore {
  /**
   * Set a workspace's display name.
   *
   * @param organizationId - The workspace.
   * @param name - The new name, already validated by the DTO.
   * @returns When the row has been written.
   */
  rename(organizationId: string, name: string): Promise<void>;
}

/** The narrow slice of the library's adapter the rename uses. */
interface AdapterSlice {
  update(input: {
    model: string;
    where: { field: string; value: unknown }[];
    update: Record<string, unknown>;
  }): Promise<unknown>;
}

@Injectable()
export class BetterAuthWorkspaceNames implements WorkspaceNameStore {
  /** @param betterAuth - The library instance, whose context carries the adapter. */
  constructor(private readonly betterAuth: BetterAuth<Auth>) {}

  /** @see WorkspaceNameStore.rename */
  async rename(organizationId: string, name: string): Promise<void> {
    const context = await this.betterAuth.instance.$context;
    const adapter: AdapterSlice = context.adapter;

    await adapter.update({
      model: "organization",
      where: [{ field: "id", value: organizationId }],
      update: { name },
    });
  }
}
