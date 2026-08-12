/**
 * Who may do what inside an organization
 * ([#704](https://github.com/NobuData/ouroboros/issues/704)).
 *
 * The organization plugin ships three roles — `owner`, `admin`, `member` — and this
 * service needs a fourth. `V002__users_membership.sql` constrained `tenant_members.role`
 * to `owner | admin | member | viewer`, mockup 17's member list renders a **Viewer** beside
 * the other three, and [#708](https://github.com/NobuData/ouroboros/issues/708) has real
 * rows carrying that word to migrate. So `viewer` is defined here as a custom
 * access-control role, and the whole point of doing it this way rather than by convention
 * is that it becomes something a test can *ask* rather than assume — which is this issue's
 * third acceptance criterion in its own words.
 *
 * ## This module loads the library for real, and that is deliberate
 *
 * Everywhere else under `src/auth/`, `better-auth` is a type and never a value: the library
 * is ES-module-only, this service compiles to CommonJS, and `jest.config.mjs` replaces it
 * with `better-auth.fixture.ts`. This module is the exception. `better-auth/plugins/access`
 * and `better-auth/plugins/organization/access` are two small modules whose only dependency
 * is an error class, so `jest.config.mjs` converts them instead of replacing them — see the
 * `transformIgnorePatterns` allow-list there, which names them and says why.
 *
 * That is not a loosening of the seam; it is what makes the acceptance criterion provable.
 * A `viewer` built by a stand-in `createAccessControl` would prove that the stand-in
 * returns what it was given. Built by the library, `organization.roles.spec.ts` can assert
 * that **`viewer` refuses `member: ["create"]`** — the library's own answer, from the same
 * code path the running service takes.
 *
 * @see organization.plugin.ts — where these are handed to the plugin.
 * @see ../modules/tenancy/roles.guard.ts — the same vocabulary, enforced over this
 *   service's own routes.
 */

import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * The resources a role can be granted permissions over.
 *
 * The plugin's own list, copied rather than extended: `organization`, `member`,
 * `invitation`, `team` and `ac`. Spread into a fresh object because `createAccessControl`
 * takes ownership of what it is given and the library's export is shared with every other
 * consumer in the process.
 *
 * **Nothing of ours is added to it.** A statement here would be a permission the *plugin's*
 * endpoints never check — they authorize against this list, and only against this list — so
 * an `ouroboros: ["deploy"]` entry would read like policy and enforce nothing. This
 * service's own permissions are `RolesGuard`'s, over its own routes, in its own vocabulary.
 */
export const ORGANIZATION_STATEMENTS = { ...defaultStatements };

/**
 * The role that may look and may not touch.
 *
 * The one role this service defines, and the reason this module exists. Mockup 17 lists it
 * beside Owner, Admin and Maintainer; `V002` has been storing the word since
 * [#21](https://github.com/NobuData/ouroboros/issues/21); and #708 migrates rows carrying
 * it into `member.role`. Naming it here is what makes that migration a rename.
 */
export const VIEWER_ROLE = "viewer";

/**
 * What a viewer may do: nothing.
 *
 * Every resource is granted the empty list, which is the access-control library's spelling
 * of "no permission over this". Written out resource by resource rather than as `{}` for
 * one reason worth the five lines: a resource omitted from a role and a resource granted
 * nothing behave identically *today*, and only the explicit form still says what was
 * intended when the plugin adds a fifth resource. The omission would silently inherit
 * whatever the new default is; this stays a refusal.
 *
 * Note it is stricter than the plugin's own `member` role, which holds `ac: ["read"]` — a
 * member may read the role definitions, a viewer may not. That is the whole difference
 * between the two at the plugin's level, and it is deliberate: what actually separates them
 * in this product is what *this service's* routes let them do, which is `RolesGuard`'s
 * business. `viewer` exists at the plugin level so the vocabulary is shared and so the
 * plugin's own mutations refuse it too.
 */
export const VIEWER_PERMISSIONS = {
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: [],
} as const;

/**
 * The access-control instance the roles are minted from.
 *
 * Exported because the plugin takes it as its `ac` option and a second instance built from
 * the same statements would not be the same object — the plugin compares identity when it
 * resolves a role, so two would be a role that authorizes nothing with no error to say why.
 */
export const organizationAccessControl = createAccessControl(ORGANIZATION_STATEMENTS);

/** The `viewer` role itself — {@link VIEWER_PERMISSIONS}, as the library holds it. */
export const viewerAc = organizationAccessControl.newRole(VIEWER_PERMISSIONS);

/**
 * Every role this service recognises, keyed by the word stored in `member.role`.
 *
 * The three defaults are the library's own objects rather than rebuilt copies, for the
 * identity reason above and because rebuilding them would be this service quietly
 * redefining what an owner may do — a redefinition that would drift from the plugin's
 * endpoints at the next upgrade, silently, in the permissive direction.
 *
 * The keys are exactly `V002`'s `role in ('owner','admin','member','viewer')` check, which
 * is what makes #708 a rename rather than a re-think.
 */
export const ORGANIZATION_ROLES = {
  owner: ownerAc,
  admin: adminAc,
  member: memberAc,
  [VIEWER_ROLE]: viewerAc,
};

/**
 * The roles, as the words that appear in `member.role`.
 *
 * Derived from {@link ORGANIZATION_ROLES} rather than written twice, so the two cannot
 * disagree. `V005` deliberately leaves this column un-CHECK-constrained — the vocabulary is
 * configuration, not schema — which makes this list the place it is actually decided.
 */
export const ORGANIZATION_ROLE_IDS = Object.keys(ORGANIZATION_ROLES);

/**
 * What the person who creates an organization is given.
 *
 * `owner`, which is also the plugin's default — stated because it is the one role that
 * cannot be granted by anybody else. An organization whose creator was an `admin` would
 * have no owner at all, so nobody could delete it and nobody could hand it over.
 */
export const CREATOR_ROLE = "owner";
