/**
 * The GitHub OAuth application, as BetterAuth's provider
 * ([#702](https://github.com/NobuData/ouroboros/issues/702)).
 *
 * Mockup 01's primary action is **Continue with GitHub**, and this is now the whole of what
 * makes it work: the library owns the handshake, the code exchange, the profile read and
 * the account upsert. What is left to decide — and what is here — is the four things a
 * library cannot decide for a service:
 *
 *   * **Which scopes are asked for**, and therefore what the consent screen says.
 *   * **How a GitHub profile becomes a person**, which is one small pure function.
 *   * **When an arriving GitHub account is somebody this service already knows**, which is
 *     the account-linking policy and the one decision here with a security argument
 *     underneath it.
 *   * **Where GitHub sends the browser back to**, which is a string that has to match what
 *     is registered on github.com exactly.
 *
 * It imports nothing from `better-auth` as a *value* and nothing from NestJS at all, for
 * the reasons `auth.options.ts` gives: the CLI loads this graph with no Nest process
 * anywhere, and the CommonJS test runner cannot parse the library. Every type it needs is
 * derived from `BetterAuthOptions`, and the one profile shape it reads is declared below
 * rather than imported — three fields, structurally satisfied by the library's own much
 * larger interface, and unit-testable without an ES-module loader.
 *
 * **This replaces `src/modules/auth/oauth.ts` and `github.ts`**, which #33 shipped and this
 * issue deletes. Nothing here re-implements a handshake: if you are looking for where the
 * `state` is generated and compared, it is inside BetterAuth, which is the point of the
 * move.
 *
 * @see auth.options.ts — where this is handed to the library.
 */

import type { BetterAuthOptions } from "better-auth";

import type { Configuration } from "../modules/config/configuration";

/**
 * The provider's id, which is also its path segment.
 *
 * BetterAuth keys `socialProviders` by it, routes `/api/auth/callback/:id` on it, and
 * writes it into `account.providerId` — so this one string is the OAuth App's callback URL,
 * the column value [#706](https://github.com/NobuData/ouroboros/issues/706) back-filled
 * `user_identities.provider` into, and the key `ouroboros-ui` passes to `signIn.social`.
 * Four things that have to agree, named once.
 */
export const GITHUB_PROVIDER_ID = "github";

/**
 * The scopes the authorization request carries.
 *
 * Both are needed and neither is spare:
 *
 *   * `read:user` — the profile itself, `GET /user`: the account id, the login, the name
 *     and the avatar.
 *   * `user:email` — `GET /user/emails`, which is the **only** way a private primary
 *     address resolves. Without it, an account that has not published an address publicly
 *     arrives with `email: null`, and a person whose colleague invited them by that exact
 *     address would sign in as a stranger. GitHub's default privacy setting is private, so
 *     this is the common case rather than the edge one.
 *
 * Nothing that grants repository access is here. Reading and writing a customer's code is
 * `ouroboros-engine`'s business through a GitHub App with its own installation grant;
 * signing in needs to know who somebody is and nothing more, and a consent screen that
 * asked for more than that would be asking for something this service cannot use.
 *
 * **Stated rather than inherited.** The library defaults to exactly this pair and appends
 * whatever `scope` adds — so passing them without {@link githubProvider}'s
 * `disableDefaultScope` would send each one twice. Owning the list instead is the
 * difference between a scope set this service chose and one it happens to have: a library
 * upgrade that widened its defaults would widen the consent screen, silently, on a deploy.
 */
export const GITHUB_SCOPES = ["read:user", "user:email"] as const;

/**
 * The fields of GitHub's profile this service reads.
 *
 * Declared rather than imported from `better-auth/social-providers`, and both halves of
 * that are deliberate. The library's `GithubProfile` has some fifty fields and lives behind
 * a subpath export this module's resolution settings do not reach; this is the three that
 * are actually read, so {@link githubProfileToUser} is an ordinary pure function a spec can
 * call with an object literal. The library's own interface satisfies it structurally, so
 * nothing adapts anything.
 */
export interface GithubProfile {
  /** The account's login — `@octocat`, without the `@`. Renameable, so display only. */
  readonly login: string;
  /** The name they have set, if they have set one. GitHub returns `null` when they have not. */
  readonly name?: string | null;
  /** Their avatar. GitHub serves one for every account, generated when none was uploaded. */
  readonly avatar_url?: string | null;
}

/** What {@link githubProfileToUser} writes onto the `"user"` row. */
export interface GithubUserFields {
  /** What to call them. Never blank — see {@link githubProfileToUser}. */
  readonly name: string;
  /**
   * Their avatar, or `undefined` when GitHub offered none.
   *
   * `undefined` rather than `null`, which is what the library's own map type accepts and
   * what the adapter turns into the nullable column's null. Returning `null` would not
   * compile; returning the empty string would store one, and `"user"."image"` holding `""`
   * is an `<img src="">` that requests the page it is on.
   */
  readonly image: string | undefined;
}

/**
 * Turn a GitHub profile into the columns `"user"` holds.
 *
 * The mapping the issue asks for — login, display name and avatar — and it is written out
 * rather than left to the library's default for one reason: `"user"."name"` is `not null`,
 * and the library's default would write an empty string for an account that has set no
 * name. An empty string renders as nothing at all in mockup 17's member list and in every
 * avatar fallback, which is a row that looks broken rather than a person who never filled
 * in a field.
 *
 * So the fallback chain is explicit. The name if there is one, the login if there is not —
 * GitHub requires a login and it is never empty, so there is always something to render.
 * Whitespace-only names are treated as absent, because a name of three spaces is the same
 * blank as no name and only one of the two would have been caught otherwise.
 *
 * The **address is deliberately not here.** BetterAuth reads it from `GET /user/emails`,
 * takes the verified primary, and sets `emailVerified` from GitHub's own flag — and a
 * `mapProfileToUser` that touched `email` would be overriding a verified value with the
 * public profile's unverified one. #33 made the same choice for the same reason; see
 * `V004__betterauth_core.sql`, whose back-fill trusts that flag.
 *
 * @param profile - What `GET /user` returned. Only three of its fields are read.
 * @returns The name and image to write. A fresh object; the caller owns it.
 */
export function githubProfileToUser(profile: GithubProfile): GithubUserFields {
  return {
    name: profile.name?.trim() || profile.login,
    image: profile.avatar_url || undefined,
  };
}

/** The options BetterAuth takes for its social providers. */
type SocialProviders = NonNullable<BetterAuthOptions["socialProviders"]>;

/**
 * The options BetterAuth takes for GitHub in particular.
 *
 * `Extract`ed to the object form, because the library also accepts a *function* returning
 * one — a per-request provider, for a deployment whose credentials vary by tenant. This
 * service's do not: they are two environment variables validated at boot, and narrowing the
 * type here is what keeps {@link githubProvider}'s fields readable rather than hidden behind
 * a union nothing ever takes the other branch of.
 */
export type GithubProviderOptions = Extract<
  NonNullable<SocialProviders["github"]>,
  { clientId: string }
>;

/**
 * Build the provider.
 *
 * @param configuration - The validated configuration, for the OAuth application's
 *   credentials. `OURO_GITHUB_CLIENT_ID` and `OURO_GITHUB_CLIENT_SECRET` are the same two
 *   variables #33's `GithubClient` read; this issue changes who reads them and nothing
 *   about the environment, so no deployment has to be touched to land it.
 * @returns The provider options. A fresh object each call, for the reason `authOptions`
 *   returns one: two callers exist, and a shared literal would let one's mutation reach the
 *   other.
 */
export function githubProvider(configuration: Configuration): GithubProviderOptions {
  return {
    clientId: configuration.githubClientId,
    clientSecret: configuration.githubClientSecret,

    // The scope list is this service's, not the library's — see {@link GITHUB_SCOPES}.
    // Without this flag the library's defaults would be prepended and `scope` appended, so
    // the authorize URL would carry `read:user user:email read:user user:email`.
    disableDefaultScope: true,
    scope: [...GITHUB_SCOPES],

    mapProfileToUser: githubProfileToUser,
  };
}

/**
 * When an arriving GitHub account is somebody this service already has a row for.
 *
 * This is the policy #33 called `resolveUser`'s second branch, restated in the library's
 * vocabulary — and it exists because of the tenancy API: `MembersRepository.createUser`
 * ([#31](https://github.com/NobuData/ouroboros/issues/31)) makes a stub row when somebody
 * is invited to a workspace, days before they ever sign in. Without linking, that person's
 * first sign-in creates a *second* row and they arrive as a stranger, with an empty product
 * and the invitation still pointing at the row they are not.
 *
 * Two settings, and the argument for each:
 *
 *   * **`trustedProviders` is empty**, which means a provider is never trusted *by name*.
 *     Naming GitHub here would link an arriving account to an existing row on the strength
 *     of the provider alone — including an account whose address GitHub has **not**
 *     verified, which is an address somebody may merely have typed. Left empty, the
 *     library's condition falls through to `userInfo.emailVerified`, so what authorises the
 *     link is GitHub having *proved* the address rather than having been configured as
 *     trustworthy. That is exactly the rule #33 enforced by hand, where `github.ts` refused
 *     an account offering no verified address. It is the library's default in 1.6, and it
 *     is written out anyway: a default that a minor upgrade could flip is a security
 *     decision nothing records.
 *   * **`requireLocalEmailVerified` is off.** The local flag says whether *this service* has
 *     ever verified the address, and an invited stub has never been given the chance —
 *     [#706](https://github.com/NobuData/ouroboros/issues/706)'s back-fill sets it `false`
 *     for exactly those rows, truthfully. Leaving the library's default on would make the
 *     invitation flow unusable: the person it was addressed to could never link to it. What
 *     is given up is small, because the clause above still stands — the *provider* has
 *     proved the address either way, and the two flags answer different questions.
 *
 * The pair is stricter than the library's shipped defaults on the half that matters (an
 * unverified provider address links nothing) and looser on the half that would break a
 * shipped feature.
 */
export const ACCOUNT_LINKING = {
  enabled: true,
  trustedProviders: [],
  requireLocalEmailVerified: false,
} as const satisfies NonNullable<NonNullable<BetterAuthOptions["account"]>["accountLinking"]>;
