/**
 * The organization plugin's options — tenancy, as a configuration object
 * ([#704](https://github.com/NobuData/ouroboros/issues/704)).
 *
 * Roadmap decision **A5**: organizations, membership, roles and the active-organization
 * pointer all come from BetterAuth's organization plugin rather than from the
 * `tenants`/`tenant_members` tables [#20](https://github.com/NobuData/ouroboros/issues/20)
 * and [#21](https://github.com/NobuData/ouroboros/issues/21) built. What is left to decide
 * is what this file holds:
 *
 *   * **Which roles exist**, which is `organization.roles.ts` — including the `viewer` the
 *     library does not ship and `V002` has been storing since #21.
 *   * **What the creator of an organization becomes**, which is the one role nobody else
 *     can grant.
 *   * **What a client may not say about an organization it is creating** — see
 *     {@link stripPersonalFlag}, the one rule this file enforces on its own account.
 *   * **Where an audit trail attaches**, which is
 *     [#725](https://github.com/NobuData/ouroboros/issues/725)'s and is a seam rather than
 *     an implementation.
 *
 * Where a *session* starts out acting is the other half, and it is `active.organization.ts`
 * — a `databaseHooks` entry on the root options rather than a plugin option, because the
 * library puts it there.
 *
 * Like `auth.options.ts`, this module **imports nothing from `better-auth` as a value** and
 * nothing from NestJS at all: `OrganizationOptions` arrives through `import type`, which
 * the compiler erases. `auth.factory.ts` is where `organization()` is actually called, for
 * the reason that file gives — it is the one module that names the library as a value, so
 * it is the one module a CommonJS test runner cannot load.
 *
 * `organization.roles.ts` is the deliberate exception to that rule and says why.
 *
 * @see auth.factory.ts — where these options become a plugin.
 * @see organization.roles.ts — the role model, built with the real access-control library.
 * @see active.organization.ts — the tenant pointer, and the personal organization.
 */

import type { OrganizationOptions } from "better-auth/plugins/organization";

import { CREATOR_ROLE, ORGANIZATION_ROLES, organizationAccessControl } from "./organization.roles";

/** The `metadata` key that makes an organization somebody's own. */
const PERSONAL_FLAG = "personal";

/**
 * Where an audit trail attaches, when there is one to attach.
 *
 * [#725](https://github.com/NobuData/ouroboros/issues/725) owns auth audit events, and this
 * is the shape it will implement. It is an interface and an optional dependency rather than
 * two empty hook bodies, because a hook that exists and does nothing is indistinguishable
 * from a hook that was supposed to do something — and because
 * {@link organizationOptions} can then be asserted to register *no* hooks when nothing
 * needs them, which is what keeps the plugin's own code path unchanged until #725 lands.
 *
 * The two events are the ones this issue names, and they are the two that change who can
 * reach what: an organization coming into existence, and somebody joining one.
 */
export interface OrganizationAuditSink {
  /**
   * An organization is about to be created.
   *
   * Called before the row is written, so a sink that throws stops the creation — which is
   * what makes this the hook a policy would attach to, not just a log.
   *
   * @param event - Who is creating it, and what they asked for.
   */
  organizationCreating?(event: {
    readonly name?: string;
    readonly slug?: string;
    readonly userId: string;
  }): Promise<void>;
  /**
   * Somebody has joined an organization.
   *
   * Called after the membership row exists, because an audit entry for a member who was not
   * added would be worse than no entry at all.
   *
   * @param event - Who joined what, holding which role.
   */
  memberAdded?(event: {
    readonly organizationId: string;
    readonly userId: string;
    readonly role: string;
  }): Promise<void>;
}

/**
 * Take a client-supplied `personal` flag back off an organization's metadata.
 *
 * The plugin's `createOrganization` route accepts arbitrary `metadata` from the request
 * body, and mockup 01 Step 2 renders `metadata.personal` as a pill that means *this
 * workspace is yours alone*. Without this, anybody could create an organization that wears
 * that pill — invite four colleagues into it, and the list shows a shared workspace
 * labelled `personal`. It is not a privilege escalation; it is a label that would be
 * lying, on the one screen whose job is to tell somebody where their work is going.
 *
 * A personal organization is made by `active.organization.ts` and by nothing else, which is
 * what this makes true rather than merely intended.
 *
 * @param metadata - Whatever the request carried, if anything.
 * @returns The same metadata without the flag, or `undefined` when nothing is left — so an
 *   organization created with only that key stores no metadata at all rather than `{}`.
 */
export function stripPersonalFlag(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (metadata === undefined || !(PERSONAL_FLAG in metadata)) {
    return metadata;
  }

  const { [PERSONAL_FLAG]: _ignored, ...rest } = metadata;

  return Object.keys(rest).length === 0 ? undefined : rest;
}

/**
 * Build the plugin's options.
 *
 * @param audit - Where to report organization creation and membership changes. Omitted
 *   today: #725 is what supplies one, and until it does no hook of ours runs on those
 *   paths at all.
 * @returns The options, ready for `organization()`. A fresh object each call, for the
 *   reason `authOptions` returns one — two callers exist, and a shared literal would let
 *   one's mutation reach the other.
 */
export function organizationOptions(audit?: OrganizationAuditSink): OrganizationOptions {
  return {
    // The access-control instance the roles below were minted from. It has to be *this*
    // instance rather than an equivalent one: the plugin resolves a role by looking it up
    // in `roles` and authorizing against `ac`, and two instances built from the same
    // statements would authorize nothing with no error to say why.
    ac: organizationAccessControl,

    // owner, admin, member — the library's own — plus the `viewer` this service defines.
    // See `organization.roles.ts` for what each may do and why `viewer` is a real
    // access-control role rather than a word in a column.
    roles: ORGANIZATION_ROLES,

    // What the person who creates an organization holds. The plugin's default is the same
    // value; it is stated because it is the one role that cannot be granted by anybody
    // else, so a default that changed in an upgrade would leave organizations with no owner.
    creatorRole: CREATOR_ROLE,

    organizationHooks: {
      // The one rule this file enforces on its own account, plus #725's seam. Both live in
      // the same hook because the plugin allows one `beforeCreateOrganization`, and a
      // wrapper that composed two would be indirection for a list of length two.
      beforeCreateOrganization: async ({ organization, user }) => {
        await audit?.organizationCreating?.({
          name: organization.name,
          slug: organization.slug,
          userId: user.id,
        });

        return {
          data: { ...organization, metadata: stripPersonalFlag(organization.metadata) },
        };
      },

      // #725's, and nothing else's — there is no rule of ours on this path. Registered
      // unconditionally so the shape is fixed now rather than negotiated later; it awaits
      // an `audit` and does nothing without one.
      afterAddMember: async ({ member }) => {
        await audit?.memberAdded?.({
          organizationId: member.organizationId,
          userId: member.userId,
          role: member.role,
        });
      },
    },
  };
}
