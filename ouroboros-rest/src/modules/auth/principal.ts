/**
 * Who is asking — the library's session, as everything downstream of the guard reads it.
 *
 * [#703](https://github.com/NobuData/ouroboros/issues/703) replaced this module's own
 * `Principal` with BetterAuth's `@Session()` shape. What used to happen here was a guard
 * verifying a signed cookie, reading `ouroboros.users`, and hanging the row on the request
 * under a symbol; what happens now is that the library's `AuthGuard` resolves the session —
 * from the signed snapshot in the cookie cache, or from one lookup against
 * `ouroboros.session` joined to `ouroboros."user"` — and writes it to `request.session`.
 * This file is the *typing* of that, plus the one adaptation the rest of the service needs.
 *
 * Two things are worth stating, because each replaces a decision the old module made:
 *
 *   * **The property is `session`, a plain name, not a symbol.** #33 used a symbol
 *     precisely to avoid the contended `request.user`, and that argument still holds — the
 *     library writes `request.user` too, and this module deliberately never reads it. What
 *     it reads is `request.session`, which the library owns and this service does not get
 *     to choose. Naming it in one constant here is what keeps the choice greppable.
 *   * **The session's user is the person, and no row is read to confirm it.** The library's
 *     `AuthGuard` has already resolved `ouroboros."user"`; reading it again would cost a
 *     query per request, which is the thing the cookie cache exists to avoid. `session.user`
 *     *is* the answer, and `member.userId` names the same value.
 *
 * **There is no longer an adaptation, and its absence is the point.** Until
 * [#714](https://github.com/NobuData/ouroboros/issues/714) this file also held `userRow`,
 * which spelled a `SessionUser` as a row of `ouroboros.users` so that tenancy code written
 * before BetterAuth could keep reading the vocabulary it was written against. #708 dropped
 * that table and #714 rewrote those callers, so the translation had nothing left to translate
 * *to*. {@link SessionUser} is what the tenant context carries now, and one shape for "the
 * signed-in person" is one shape fewer to keep in step.
 */

/**
 * Where the library's guard writes the session on the request.
 *
 * `@thallesp/nestjs-better-auth`'s `AuthGuard` sets `request.session`, and its `@Session()`
 * parameter decorator reads the same property back. A guard that cannot use a parameter
 * decorator — `TenantContextGuard` — reads it through {@link principalOf}, and this is the
 * one place the name is written.
 */
export const SESSION_PROPERTY = "session";

/**
 * The person, as BetterAuth holds them — a row of `ouroboros."user"` (V004).
 *
 * Declared structurally rather than imported from `better-auth`, for the reason
 * `auth.options.ts` gives about *its* types: naming the fields this service reads is both
 * the documentation and the whole of the coupling, and a service that spreads the library's
 * inferred session type through its tenancy code would have to substitute the library to
 * type-check a guard. The names are the library's own, which is why they are camelCase in a
 * codebase whose rows are not — see V004 on why those tables keep vendor naming.
 */
export interface SessionUser {
  /** `"user".id`. The same value `member."userId"` holds — V004's back-fill preserved ids. */
  readonly id: string;
  /** `"user".name` — what a member list prints. `not null`; #702 maps GitHub's into it. */
  readonly name: string;
  /** `"user".email`, lower-cased and unique across the installation. */
  readonly email: string;
  /** Whether the address has been proved. Account linking consults it (#702). */
  readonly emailVerified: boolean;
  /** `"user".image` — the avatar, or null when none is known. */
  readonly image?: string | null;
  /** When the person was created. */
  readonly createdAt: Date;
  /** When they were last updated. */
  readonly updatedAt: Date;
}

/**
 * The sign-in itself — a row of `ouroboros.session` (V004).
 *
 * The half of the session that is *not* the person, and the half #33 had no equivalent of:
 * it exists as a row, so deleting it is revocation. Only the fields this service reads are
 * named; the library's row also carries `ipAddress` and `userAgent`, which nothing here
 * consults and [#725](https://github.com/NobuData/ouroboros/issues/725)'s audit events are
 * what will.
 */
export interface SessionRecord {
  /** `session.id`. */
  readonly id: string;
  /** `session.token` — the value the cookie carries. Deleting this row revokes it. */
  readonly token: string;
  /** `session.userId`, the same value as {@link SessionUser.id}. */
  readonly userId: string;
  /** When this session stops being honoured, whether or not anybody signs out. */
  readonly expiresAt: Date;
  /**
   * `session."activeOrganizationId"` — the workspace this session is acting in (V005).
   *
   * The organization plugin adds the column to the session model and returns it with the
   * session, `active.organization.ts` stamps it when the row is created, and the plugin's
   * `setActiveOrganization` is the only thing that changes it. That is what makes it *server*
   * state rather than a client assertion, and it is why
   * [#713](https://github.com/NobuData/ouroboros/issues/713) resolves the tenant from here in
   * preference to the `X-Ouro-Tenant` header.
   *
   * `null` on a session that is signed in and acting nowhere — somebody who belongs to no
   * workspace, or whose workspace has since been deleted (V005 nulls the pointer on delete
   * rather than leaving it dangling). Optional as well as nullable because a session read
   * from a service configured without the plugin would carry no such field at all, and a
   * guard that treated the absence as a type error would fail on a state the library permits.
   */
  readonly activeOrganizationId?: string | null;
}

/**
 * A resolved session: the sign-in, and who it belongs to.
 *
 * This is BetterAuth's `@Session()` shape, and the type a controller annotates that
 * decorator with. It replaces #33's `Principal`, which carried a `users` row and nothing
 * about the session — because there was no session to carry anything about.
 */
export interface Principal {
  /** The `session` row that authorised this request. */
  readonly session: SessionRecord;
  /** The person it belongs to. */
  readonly user: SessionUser;
}

/**
 * A request that may have been through the global auth guard.
 *
 * Structural rather than `express.Request`, matching `src/application.ts` and
 * `error.filter.ts`: this module has no opinion about the HTTP adapter, and naming the one
 * property it touches is both the documentation and the whole of the coupling.
 */
export interface PrincipalRequest {
  /**
   * The session, once the guard has run.
   *
   * `null` on a route the guard let through as `@AllowAnonymous()` — the library writes the
   * property either way — and absent only where no guard ran at all, which is a unit test
   * calling a guard directly.
   */
  [SESSION_PROPERTY]?: Principal | null;
}

/**
 * Read the session off a request.
 *
 * For code that cannot use a parameter decorator, which in this service means a guard.
 *
 * @param request - The request being handled.
 * @returns The principal, or `undefined` on an anonymous route — collapsing the library's
 *   `null` and the absent property into the one answer a caller can act on, because
 *   "nobody is signed in" and "nothing wrote the property" have the same consequence
 *   everywhere it is asked.
 */
export function principalOf(request: PrincipalRequest): Principal | undefined {
  return request[SESSION_PROPERTY] ?? undefined;
}

/**
 * The workspace a session is acting in.
 *
 * A function rather than a property read at three call sites, because "acting nowhere" has
 * two spellings the library uses interchangeably — the column is `null` and the field is
 * absent when nothing set it — and code that branches on which one it got would be branching
 * on nothing.
 *
 * @param principal - The session, or nothing on an anonymous route.
 * @returns The active organization's id, or `undefined` when there is none. One answer for
 *   both spellings, and for no session at all.
 */
export function activeOrganizationOf(principal: Principal | null | undefined): string | undefined {
  return principal?.session.activeOrganizationId ?? undefined;
}
