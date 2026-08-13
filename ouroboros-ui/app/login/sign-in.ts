/**
 * How a sign-in *begins* — the one call, and what its answer means.
 *
 * **This is BetterAuth's own client since
 * [#718](https://github.com/NobuData/ouroboros/issues/718).** The module it replaces was a
 * hand-written `POST` to `/api/auth/sign-in/social`, written in
 * [#702](https://github.com/NobuData/ouroboros/issues/702) when that flow arrived and
 * `app/api/auth-client.ts` did not yet exist; it composed the path, the body, the
 * `credentials` and the failure envelope itself, and every one of those is now the library's.
 * The reason for the move is the reason #716 configured the client at all: `signIn.social` is
 * typed against the route table the service actually mounts, so a route that changes shape is
 * a compile error here rather than a `404` a person meets after pressing the button.
 *
 * ### Why this is a shape rather than a function per provider
 *
 * The card offers GitHub today and is drawn around offering more: the mockup gives enterprise
 * SSO equal weight, and the SSO plugin answers on a route of its own rather than on this one.
 * So what is written down here is a {@link SignInStart} — *which sign-in*, as a value — and
 * not a provider: {@link socialSignIn} builds one, an SSO builder is a second function
 * returning a second `kind`, {@link beginSignIn} is the one place that turns either into a
 * call, and `sign-in-button.tsx` never learns which is which.
 *
 * That is what "compatible with additional SSO types" means concretely: adding Google, or
 * GitLab, or the SSO plugin is a `kind`, a branch and a button, and nothing in this file's
 * error handling, navigation or suites moves.
 *
 * **It is a value rather than a thunk, and that is a hard constraint rather than a taste.**
 * The card is a Server Component and the button is a Client Component, so whatever passes
 * between them is serialised — *"functions cannot be passed directly to Client Components"*,
 * which is a `500` on the login route rather than a type error, and is what a first run of
 * this issue's rewrite produced. It was a `{path, body}` pair before #718 for exactly this
 * reason; the pair is now a `kind` because the transport moved from a path to a method call,
 * but the property that made it work is unchanged.
 *
 * ### Why the redirect is refused and then made here
 *
 * BetterAuth's client ships a `redirect` plugin that assigns `window.location.href` itself
 * whenever an answer carries `{url, redirect: true}` (`better-auth/dist/client/fetch-plugins.mjs`),
 * inside a `try {} catch {}` that swallows whatever goes wrong. Two navigations for one press
 * is the least of what that costs: a departure nothing can observe is a departure the button
 * cannot report having failed, and the pending state it leaves behind would be a lie.
 *
 * So every call here sends `disableRedirect: true` — the library's own option for exactly
 * this — which makes the service answer `{url, redirect: false}` and send no `Location`
 * header, and the plugin then does nothing. The one navigation is `sign-in-button.tsx`'s, on
 * a value this module returned, past a seam a suite can hold.
 *
 * Framework-free apart from the client, the way `app/api/membership.ts` is: the rules are
 * testable without a DOM, and `sign-in-button.tsx` is left holding nothing but the press.
 */

import { signIn } from "@/app/api/auth-client";

/**
 * Where BetterAuth begins a social sign-in, same-origin — `proxy.ts` forwards it.
 *
 * Not used to compose a request any more; the client does that. It is kept because it is the
 * route this module is *about*, and because `sign-in.test.ts` asserts the client addresses it
 * — the check that would catch a base path or a proxy matcher drifting apart.
 */
export const SOCIAL_SIGN_IN_PATH = "/api/auth/sign-in/social";

/**
 * Which providers `signIn.social` accepts, read off the client rather than restated.
 *
 * BetterAuth validates `provider` against an enum of the social providers it knows
 * (`better-auth/dist/api/routes/sign-in.mjs`), and the client is typed from it. Deriving the
 * type here means a provider this build has no support for is a compile error at the call
 * site instead of a `400` at the end of a press.
 */
export type SocialProvider = Parameters<typeof signIn.social>[0]["provider"];

/**
 * The GitHub provider's id, as `ouroboros-rest` configures it.
 *
 * `src/auth/github.provider.ts`'s `GITHUB_PROVIDER_ID`, which is also what composes that
 * service's callback path and what lands in `account.providerId`. It is repeated here rather
 * than shared because the two modules do not build together; the string is part of the wire
 * contract, like the path above it.
 */
export const GITHUB_PROVIDER = "github" satisfies SocialProvider;

/**
 * Which sign-in to begin — everything {@link beginSignIn} needs, and nothing that cannot
 * cross the Server/Client boundary.
 *
 * A union of one today. That is deliberate rather than premature: the discriminator is what
 * lets the SSO plugin's route arrive as a second member without `SignInButton`'s prop type
 * moving, and a second member is where the shape stops looking like an over-wrapped string.
 */
export type SignInStart =
  /** A configured social provider — BetterAuth's `POST /sign-in/social`. */
  { readonly kind: "social"; readonly provider: SocialProvider };

/**
 * A sign-in that did not begin.
 *
 * Carries a message fit to show a person, because that is what the button does with it: the
 * design system (§ 3.5) asks that a control which cannot act say why, and a press that failed
 * is that case arriving late. Separate from `AuthError` for that reason alone — that class
 * composes `"/api/auth/… answered 503"` when the service sent no message of its own, which is
 * a log line rather than a sentence.
 *
 * @property status The HTTP status, or `0` when the request never got an answer.
 */
export class SignInError extends Error {
  readonly name = "SignInError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Begin a social sign-in with a configured provider.
 *
 * @param provider The provider's id — {@link GITHUB_PROVIDER} today, and any other the
 *   service configures. An id `ouroboros-rest` has no provider for is a `400` from
 *   BetterAuth rather than an error here: which providers exist is the service's fact, and a
 *   list duplicated in the browser would be one more thing that can disagree.
 * @returns The sign-in to begin, as a value a Server Component may hand to a button. Nothing
 *   is requested until {@link beginSignIn} is called with it, so composing one during a
 *   render costs nothing and reaches nowhere.
 */
export function socialSignIn(provider: SocialProvider): SignInStart {
  return { kind: "social", provider };
}

/** The half of BetterAuth's sign-in answer this module reads. */
interface SignInAnswer {
  /** Where to send the browser. Absent when the flow does not begin with a navigation. */
  readonly url?: string | null;
}

/** What every method on BetterAuth's client resolves with, narrowed to what is read here. */
interface SignInResult {
  readonly data?: SignInAnswer | null;
  readonly error?: { readonly status?: number; readonly message?: string } | null;
}

/**
 * Make the call one {@link SignInStart} describes, and produce the URL to send the browser to.
 *
 * The three outcomes BetterAuth's client can produce collapse to two here — a URL, or a
 * {@link SignInError} with something to say — because a control that has just been pressed
 * needs one answer and not a result object to branch on.
 *
 * It does **not** navigate. Navigation is `window.location`, which is the one part of this
 * that cannot be tested without a browser, so it stays in the component and this stays a
 * function with a return value.
 *
 * @param start Which sign-in to begin. The `switch` is the whole of what a second kind costs.
 * @returns The absolute URL of the provider's consent page.
 * @throws {SignInError} When the service refused, when the network did, or when the answer
 *   carried no URL to follow — the last being a real possibility rather than a defensive
 *   check, since `redirect: false` is also the shape of a flow that completes without leaving
 *   the origin (an `idToken` sign-in, for instance).
 */
export async function beginSignIn(start: SignInStart): Promise<string> {
  let result: SignInResult;

  try {
    result = await call(start);
  } catch {
    // better-fetch reports a refusal in the value but still *throws* when the request never
    // happened at all — it is only configured to catch its own errors with `catchAllError`,
    // which BetterAuth does not set. So a dropped connection arrives here rather than below.
    throw new SignInError(0, "Could not reach the sign-in service. Check your connection.");
  }

  const failure = result.error;
  if (failure !== null && failure !== undefined) {
    throw new SignInError(
      failure.status ?? 0,
      failure.message ?? `Sign-in was refused (${failure.status ?? "no answer"}).`,
    );
  }

  const url = result.data?.url;
  if (typeof url !== "string" || url === "") {
    throw new SignInError(200, "Sign-in did not return somewhere to go.");
  }

  return url;
}

/**
 * Ask BetterAuth's client for the one sign-in this start names.
 *
 * @param start Which sign-in to begin.
 * @returns The client's own result, refusals and all.
 */
function call(start: SignInStart): Promise<SignInResult> {
  switch (start.kind) {
    case "social":
      // `disableRedirect` on every call — see the note at the top of this file for the
      // navigation it suppresses and why the button's own is worth more.
      return signIn.social({ provider: start.provider, disableRedirect: true });
  }
}
