/**
 * Where a session starts out acting, and the personal organization that gives it somewhere
 * to be ([#704](https://github.com/NobuData/ouroboros/issues/704)).
 *
 * Two of this issue's acceptance criteria meet in one hook:
 *
 *   * *A new GitHub sign-in yields a personal organization and a membership row.*
 *   * *`setActiveOrganization` updates the session row* — which needs the session row to
 *     have somewhere sensible to start, or mockup 01 Step 2 opens on an empty list and the
 *     **Enter mission control →** button leads nowhere.
 *
 * `V005` added `session."activeOrganizationId"`, and this is what fills it in. From here on
 * the tenant a request acts in is **server state**: the plugin's `setActiveOrganization` is
 * the only way it changes, and a client cannot assert it by sending a header. That is
 * roadmap decision **A5**, and it is the difference between this and
 * [#32](https://github.com/NobuData/ouroboros/issues/32)'s `X-Ouro-Tenant`, which
 * [#713](https://github.com/NobuData/ouroboros/issues/713) demotes to an override.
 *
 * ## Why this hangs off session creation rather than user creation
 *
 * The issue says *first sign-in auto-creates a personal organization*, and the obvious
 * place for that is `databaseHooks.user.create.after` — the hook that fires exactly once,
 * when the `"user"` row is written. It is the wrong place, for a reason that is specific to
 * where this service is in its migration rather than a general preference.
 *
 * **The `"user"` rows already exist.** `V004`'s back-fill copied every person out of
 * `V002`'s `users` table, and #708 will migrate their `tenant_members` rows in. A hook on
 * user creation would never fire for any of them: they were created by a migration, not by
 * a sign-in. Everybody who used Ouroboros before BetterAuth would sign in, find no
 * organization, and see an empty Step 2 — and the fix would be a second, one-shot back-fill
 * to write the organizations the hook missed.
 *
 * Hanging it off **session creation** makes the rule self-healing instead. It is evaluated
 * at every sign-in and does nothing when there is nothing to do, so a person who already
 * holds a membership — because they were migrated, because they were invited, because they
 * signed in yesterday — costs one indexed lookup and no writes. A person who holds none
 * gets one, whether this is their first sign-in ever or their first since the migration.
 * "First sign-in creates a personal organization" stays true for a new person; it just also
 * becomes true for the people who were already here.
 *
 * @see organization.plugin.ts — the plugin these organizations belong to.
 * @see ../../../ouroboros-db/migrations/V005__betterauth_organization.sql — the column, and
 *   why it is `on delete set null`.
 */

import type { BetterAuthOptions } from "better-auth";

/** The model names this module reads and writes, as the plugin's schema names them. */
const ORGANIZATION_MODEL = "organization";
const MEMBER_MODEL = "member";

/**
 * The `metadata` that makes an organization somebody's own.
 *
 * Mockup 01 Step 2 renders it as the `personal` pill beside the org row. It is one flag and
 * not a column, which is roadmap decision **A5** taken to its conclusion: `organization` is
 * a vendor-shaped table and an extra column on it would be drift every future
 * `@better-auth/cli generate` reported (#710). `metadata` is the library's own escape
 * hatch, and this is what it is for.
 */
export const PERSONAL_ORGANIZATION_METADATA = { personal: true } as const;

/**
 * That same flag, as the column actually holds it.
 *
 * **`organization.metadata` is JSON held as text**, and the plugin's own routes stringify
 * on the way in. This module does not go through those routes — it writes through the
 * adapter directly, for the reasons below — so it has to do the stringifying itself.
 * Passing the object would hand `pg` something it renders as `[object Object]`, which
 * `V005`'s `organization_metadata_is_json` check refuses outright. That refusal is the
 * good outcome: the alternative, on a schema without the check, is a row that stores
 * nonsense and a `personal` pill that silently stops rendering.
 */
export const PERSONAL_ORGANIZATION_METADATA_JSON = JSON.stringify(PERSONAL_ORGANIZATION_METADATA);

/**
 * How long a generated slug may be.
 *
 * 63 characters, which is a DNS label — the same bound `V001` put on `tenants.slug`, kept
 * so that a slug generated here stays usable if one is ever wanted as a subdomain. `V005`
 * does not constrain the column, because the plugin validates what its own routes accept;
 * this bound governs what *this module* generates.
 */
export const SLUG_MAX_LENGTH = 63;

/**
 * The shortest slug worth generating.
 *
 * Two characters, `V001`'s minimum. A one-character slug is not wrong so much as useless,
 * and the fallback below is what a name that renders to fewer than two characters gets —
 * an address of `字@example.com`, or a display name that is entirely punctuation.
 */
export const SLUG_MIN_LENGTH = 2;

/**
 * How much of a user id is borrowed to make a slug unique.
 *
 * Eight characters of an id that is a uuid at minimum. It is a disambiguator appended to a
 * slug somebody else already holds, not an identifier, so what matters is that two people
 * called "Ken" get different slugs rather than that the suffix is unguessable.
 */
export const SLUG_SUFFIX_LENGTH = 8;

/** The person a personal organization is being made for. */
export interface OrganizationOwner {
  /** Their id — `"user".id`. */
  readonly id: string;
  /** What to call them. `"user"."name"` is `not null`, but may be anything. */
  readonly name?: string | null;
  /** Their address. The fallback when a name renders to nothing usable. */
  readonly email?: string | null;
}

/** A membership row, as much of it as choosing an active organization needs. */
export interface MembershipRecord {
  /** The organization it is a membership of. */
  readonly organizationId: string;
}

/** One `field = value` term, as the plugin's adapter spells a where clause. */
interface AdapterWhere {
  readonly field: string;
  readonly value: unknown;
}

/**
 * The two adapter calls this module makes, named structurally.
 *
 * BetterAuth's `DBAdapter` is a much larger interface reached through
 * `context.context.adapter`, and depending on the whole of it would mean a spec could only
 * exercise this by building an auth context. Narrowing to what is used keeps
 * `active.organization.spec.ts` able to hand it an object literal — and keeps this module
 * honest about how much of the library it actually needs.
 *
 * It is the *adapter* rather than the pool, which is a deliberate choice over writing SQL:
 * the adapter mints ids the same way every other row in the schema gets one, applies the
 * plugin's field mapping, and converts dates as the configured database wants them. Two
 * hand-written `insert`s would be a second implementation of all three.
 */
export interface OrganizationStore {
  /** Rows of a model matching a where clause. */
  findMany<T>(query: {
    model: string;
    where?: readonly AdapterWhere[];
    limit?: number;
    sortBy?: { field: string; direction: "asc" | "desc" };
  }): Promise<T[]>;
  /** One new row. The adapter mints its `id`. */
  create<T>(query: { model: string; data: Record<string, unknown> }): Promise<T>;
}

/**
 * What to call somebody's personal organization.
 *
 * Their own name, which is what mockup 01 Step 2 shows beside the `personal` pill — so the
 * row reads *"Maya Chen · personal"* rather than *"maya-chen-workspace"*.
 *
 * The fallback chain matters because `"user"."name"` is `not null` but is not guaranteed to
 * be *useful*: `V004`'s back-fill copied `display_name` across, and `github.provider.ts`
 * writes the GitHub login when an account has set no name. A name of three spaces is
 * treated as absent, for the same reason `githubProfileToUser` treats it so — it renders as
 * nothing at all, which looks like a broken row rather than a person.
 *
 * @param user - The person the organization belongs to.
 * @returns Their name, or the local part of their address, or `Personal` — in that order.
 *   Never blank, because `organization.name` is `not null` and a blank one renders as an
 *   empty row in the mockup's list.
 */
export function personalOrganizationName(user: OrganizationOwner): string {
  const named = user.name?.trim();

  if (named !== undefined && named !== "") {
    return named;
  }

  const local = user.email?.split("@")[0]?.trim();

  return local !== undefined && local !== "" ? local : "Personal";
}

/**
 * Turn arbitrary text into a slug shaped like a DNS label.
 *
 * Lower-cased, with every run of characters that is not a letter or digit collapsed to a
 * single hyphen, and no hyphen at either end. That is `V001`'s
 * `tenants_slug_format` expressed as a transformation rather than as a constraint, so a
 * slug generated here would satisfy it — which is what keeps #708's migration from having
 * to reconcile two shapes.
 *
 * ASCII-only by construction, and that is a limitation worth naming rather than hiding: a
 * name written in a non-Latin script renders to the empty string here and falls through to
 * {@link personalOrganizationSlug}'s id-derived fallback. The alternative — transliteration
 * — is a large dependency and a set of choices no library makes the same way twice, for a
 * value nobody has to type.
 *
 * @param text - Whatever is being turned into a slug.
 * @returns The slug, at most {@link SLUG_MAX_LENGTH} characters. May be empty, which is the
 *   caller's signal to use a fallback.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * The slugs to try for somebody's personal organization, in order.
 *
 * Two of them, and the second is what makes this terminate. `organization.slug` is unique
 * across the installation, so the readable slug — `maya-chen` — belongs to whoever gets
 * there first; the second person called Maya Chen needs a different one. Appending
 * {@link SLUG_SUFFIX_LENGTH} characters of their user id gives it to them without a loop, a
 * counter, or a second round trip: a user id appears in exactly one person's personal
 * organization, so the pair *(name, id-prefix)* cannot collide with itself.
 *
 * A name that slugifies to nothing — punctuation, a non-Latin script, an address whose
 * local part is all dots — skips straight to the id-derived form, which is why the returned
 * list may hold one entry rather than two.
 *
 * @param user - The person the organization belongs to.
 * @returns The candidates, most readable first. Never empty.
 */
export function personalOrganizationSlugs(user: OrganizationOwner): string[] {
  const suffix = slugify(user.id).slice(0, SLUG_SUFFIX_LENGTH);
  // An id that slugifies to nothing is not a case any id generator produces — uuids and
  // BetterAuth's own ids are alphanumeric — but a slug of `personal-` would be this
  // function's fault rather than the id's, so the empty case is handled rather than assumed.
  const fallback = suffix === "" ? "personal" : `personal-${suffix}`;
  const preferred = slugify(personalOrganizationName(user));

  if (preferred.length < SLUG_MIN_LENGTH) {
    return [fallback];
  }

  return [preferred, `${preferred.slice(0, SLUG_MAX_LENGTH - suffix.length - 1)}-${suffix}`];
}

/**
 * Which of somebody's organizations a new session should start in.
 *
 * The **earliest** membership, which for anybody who arrived through this module is their
 * personal organization — it is the only one they have when the session that created it is
 * their first. For somebody with several, it is a stable, boring default: the same choice
 * every time, so a sign-in does not land somewhere different depending on which row the
 * database happened to return first.
 *
 * It is deliberately not cleverer than that. Mockup 01 Step 2 exists precisely so the
 * person chooses, and `setActiveOrganization` is what records the choice; a heuristic here
 * — most recently used, most repositories enabled — would be this module guessing at an
 * answer the next screen is about to ask for.
 *
 * @param memberships - The person's memberships, **already ordered** by the caller. The
 *   ordering is the adapter's job because it is an index scan there and a sort here.
 * @returns The organization to start in, or `null` when they belong to none.
 */
export function chooseActiveOrganization(memberships: readonly MembershipRecord[]): string | null {
  return memberships[0]?.organizationId ?? null;
}

/** What {@link resolveActiveOrganization} needs. */
export interface ActiveOrganizationRequest {
  /** The adapter to read and write through — `context.context.adapter`. */
  readonly store: OrganizationStore;
  /** The person signing in. */
  readonly user: OrganizationOwner;
}

/**
 * Find, or make, the organization a new session should start in.
 *
 * One indexed lookup in the common case: the memberships of one person, ordered, which
 * `member_userId_idx` serves. Nothing is written unless the answer is "none".
 *
 * @param request - The adapter and the person — see {@link ActiveOrganizationRequest}.
 * @returns The organization id to write onto the session row, or `null` if one could not be
 *   established. `null` is a valid session: *signed in, acting nowhere*, which is the state
 *   `V005`'s nullable column exists to hold and which mockup 01 Step 2 renders as an empty
 *   list rather than an error.
 */
export async function resolveActiveOrganization({
  store,
  user,
}: ActiveOrganizationRequest): Promise<string | null> {
  const existing = await membershipsOf(store, user.id);

  if (existing.length > 0) {
    return chooseActiveOrganization(existing);
  }

  return createPersonalOrganization(store, user);
}

/**
 * Somebody's memberships, oldest first.
 *
 * @param store - The adapter.
 * @param userId - Whose memberships.
 * @returns The rows, ordered — see {@link chooseActiveOrganization} for why the order is
 *   settled here rather than there.
 */
async function membershipsOf(
  store: OrganizationStore,
  userId: string,
): Promise<MembershipRecord[]> {
  return store.findMany<MembershipRecord>({
    model: MEMBER_MODEL,
    where: [{ field: "userId", value: userId }],
    sortBy: { field: "createdAt", direction: "asc" },
  });
}

/**
 * Make somebody an organization of their own, and put them in it as its owner.
 *
 * Two writes, and they are not in a transaction — the adapter's interface offers none at
 * this seam. What that costs is bounded and is worth stating: if the second write fails,
 * the person owns nothing and holds an organization row nobody is a member of. Their next
 * sign-in finds no membership and makes another, so the *user-visible* failure heals
 * itself; what is left behind is an orphan organization, which is inert (nothing can reach
 * an organization it has no membership in) and which #725's audit path is the natural place
 * to notice.
 *
 * The slug is tried in the order {@link personalOrganizationSlugs} gives, because
 * `organization.slug` is unique and the readable one may already belong to somebody else.
 * A rejected insert is caught rather than fatal — the next candidate is tried, and only if
 * every candidate is exhausted does the sign-in proceed with no active organization, which
 * is a session that works and a Step 2 the person can choose from.
 *
 * @param store - The adapter.
 * @param user - The person.
 * @returns The new organization's id, or `null` if it could not be created.
 */
async function createPersonalOrganization(
  store: OrganizationStore,
  user: OrganizationOwner,
): Promise<string | null> {
  const now = new Date();

  for (const slug of personalOrganizationSlugs(user)) {
    try {
      // `createdAt` is passed rather than defaulted: the plugin's schema declares it
      // required and supplies no default, so the adapter would write null and the column
      // would refuse it. The plugin's own `createOrganization` route passes it for the
      // same reason.
      const organization = await store.create<{ id: string }>({
        model: ORGANIZATION_MODEL,
        data: {
          name: personalOrganizationName(user),
          slug,
          createdAt: now,
          metadata: PERSONAL_ORGANIZATION_METADATA_JSON,
        },
      });

      await store.create({
        model: MEMBER_MODEL,
        data: {
          organizationId: organization.id,
          userId: user.id,
          // The role the creator of an organization holds. Not `CREATOR_ROLE` from
          // `organization.roles.ts` by accident: this *is* a creation, and an organization
          // whose only member were an admin would have no owner to delete it or hand it on.
          role: "owner",
          createdAt: now,
        },
      });

      return organization.id;
    } catch {
      // The slug was taken — by another person with the same name, or by this same person
      // signing in twice at once. Either way the next candidate carries their user id and
      // cannot collide with anybody else's.
      continue;
    }
  }

  return null;
}

/** The `session.create.before` hook, as the library declares it. */
type SessionCreateBefore = NonNullable<
  NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["session"]>["create"]
>["before"];

/**
 * Stamp a new session with the organization it should start in.
 *
 * A `before` hook rather than an `after` one, and the difference is a write: `before`
 * returns the row the library is about to insert, so the pointer is part of the `insert`
 * rather than an `update` issued against a row that existed without it for a moment. Every
 * session therefore has an active organization from the instant it exists — which matters,
 * because the request that created it is already on its way to a handler that may read one.
 *
 * A **module-level function rather than a closure** built inside
 * {@link activeOrganizationHooks}, so that two calls to `authOptions` produce hooks that
 * compare equal. `auth.options.spec.ts` asserts exactly that — a fresh object each call,
 * with equal contents — and a new arrow function per call would make the object fresh and
 * the contents unequal, which is a distinction nothing wants.
 *
 * @param session - The row the library is about to write.
 * @param context - The request that caused it, or `null`.
 * @returns The row with `activeOrganizationId` filled in, or nothing at all — which leaves
 *   the library's own data untouched.
 */
export const stampActiveOrganization: SessionCreateBefore = async (session, context) => {
  // `context` is null when a session is created outside a request — the library types it
  // so, and nothing in this service does it today. Refusing to guess is the right answer:
  // there is no adapter to reach, and a session that starts with a null pointer is a valid
  // session rather than a failed sign-in.
  if (context === null) {
    return;
  }

  const store = context.context.adapter as unknown as OrganizationStore;
  const user = await context.context.internalAdapter.findUserById(session.userId);

  // A session whose user cannot be read is not this hook's problem to report — the library
  // is about to fail on its own foreign key, with a better message than anything here
  // could produce.
  if (user === null) {
    return;
  }

  return {
    data: { ...session, activeOrganizationId: await resolveActiveOrganization({ store, user }) },
  };
};

/**
 * The session half of BetterAuth's `databaseHooks`.
 *
 * @returns The hooks, as `authOptions` hands them to the library. A fresh object each call,
 *   matching every other options builder here: the caller owns what it is given. The hook
 *   inside it is {@link stampActiveOrganization}, shared rather than rebuilt — see there.
 */
export function activeOrganizationHooks(): BetterAuthOptions["databaseHooks"] {
  return { session: { create: { before: stampActiveOrganization } } };
}
