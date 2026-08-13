/**
 * How a sign-in *begins* — the one request, and what its answer means.
 *
 * **This is the shape [#702](https://github.com/NobuData/ouroboros/issues/702) changed, and
 * the reason the login screen had to be re-wired.** #33's flow was a `GET` that answered
 * `302` to github.com, so an `<a href>` was the whole implementation. BetterAuth's is a
 * `POST` that answers `{ url }` and lets the caller decide what to do with it, so beginning a
 * sign-in is now a request with a body — and something has to make it.
 *
 * ### Why this is a shape rather than a function per provider
 *
 * The card offers GitHub today and is drawn around offering more: the mockup gives enterprise
 * SSO equal weight, and [#712](https://github.com/NobuData/ouroboros/issues/712) is the
 * domain-discovery endpoint behind it. Those do not all arrive on one route — BetterAuth's
 * social providers share `POST /sign-in/social` and distinguish themselves in the *body*,
 * while its SSO plugin answers on a route of its own. So what is written down here is the
 * **request**, not the provider: a path and a body. {@link socialSignIn} builds one for any
 * configured social provider, a second builder is what an SSO route needs, and
 * {@link beginSignIn} — the part with the failure handling in it — never learns which is
 * which.
 *
 * That is what "compatible with additional SSO types" means concretely: adding Google, or
 * GitLab, or the SSO plugin, is a builder and a button, and nothing in this file's
 * error handling, navigation or suites moves.
 *
 * ### Why it is not typed against the generated client
 *
 * The auth family is excluded from code generation
 * ([#711](https://github.com/NobuData/ouroboros/issues/711)) — `app/api/schema.d.ts` has no
 * entry for these paths — and this one is called from the *browser* besides, where
 * `app/api/auth-client.ts` cannot go: that module is `server-only`, because it forwards
 * `HttpOnly` cookies and knows the service's address. This travels same-origin through
 * `proxy.ts` instead and needs neither.
 *
 * Framework-free on purpose, the way `app/api/membership.ts` is: the rules are testable
 * without a DOM, and `sign-in-button.tsx` is left holding nothing but the press.
 */

/** Where BetterAuth begins a social sign-in. Same-origin — `proxy.ts` forwards it. */
export const SOCIAL_SIGN_IN_PATH = "/api/auth/sign-in/social";

/**
 * The GitHub provider's id, as `ouroboros-rest` configures it.
 *
 * `src/auth/github.provider.ts`'s `GITHUB_PROVIDER_ID`, which is also what composes that
 * service's callback path and what lands in `account.providerId`. It is repeated here rather
 * than shared because the two modules do not build together; the string is part of the wire
 * contract, like the path above it.
 */
export const GITHUB_PROVIDER = "github";

/**
 * One request that begins a sign-in.
 *
 * @property path Same-origin, beginning with a slash.
 * @property body What distinguishes this sign-in from another on the same path — `provider`
 *   for a social one, and whatever an SSO route asks for when there is one.
 */
export interface SignInRequest {
  readonly path: string;
  readonly body: Readonly<Record<string, string>>;
}

/**
 * Begin a social sign-in with a configured provider.
 *
 * @param provider The provider's id — {@link GITHUB_PROVIDER} today, and any other the
 *   service configures. An id `ouroboros-rest` has no provider for is a `400` from
 *   BetterAuth rather than an error here: which providers exist is the service's fact, and a
 *   list duplicated in the browser would be one more thing that can disagree.
 * @returns The request to make.
 */
export function socialSignIn(provider: string): SignInRequest {
  return { path: SOCIAL_SIGN_IN_PATH, body: { provider } };
}

/** What BetterAuth answers a sign-in request with. */
interface SignInAnswer {
  /** Where to send the browser. Absent when the flow does not begin with a navigation. */
  url?: string;
  /** Whether the caller is expected to follow {@link url}. */
  redirect?: boolean;
}

/**
 * A sign-in that did not begin.
 *
 * Carries a message fit to show a person, because that is what the button does with it: the
 * design system (§ 3.5) asks that a control which cannot act say why, and a press that failed
 * is that case arriving late.
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
 * Make the request, and produce the URL to send the browser to.
 *
 * It does **not** navigate. Navigation is `window.location`, which is the one part of this
 * that cannot be tested without a browser, so it stays in the component and this stays a
 * function with a return value.
 *
 * @param request What {@link socialSignIn} — or a future SSO builder — produced.
 * @param fetchImpl The fetch to call through. Defaults to the runtime's; the parameter is
 *   what lets a suite answer without a socket, the same way `app/api/session.ts` takes one.
 * @returns The absolute URL of the provider's consent page.
 * @throws {SignInError} When the service refused, when the network did, or when the answer
 *   carried no URL to follow — the last being a real possibility rather than a defensive
 *   check, since `redirect: false` is a shape BetterAuth uses for flows that complete
 *   without leaving the origin.
 */
export async function beginSignIn(
  request: SignInRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response;

  try {
    response = await fetchImpl(request.path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
      // The answer sets `better-auth.state`, the five-minute cookie the callback is checked
      // against. Same-origin sends cookies by default; this says so out loud because the
      // handshake fails at the last hop with `state_mismatch` if it ever stops being true.
      credentials: "same-origin",
    });
  } catch {
    throw new SignInError(0, "Could not reach the sign-in service. Check your connection.");
  }

  const answer = (await readJson(response)) as SignInAnswer | null;

  if (!response.ok) {
    const failure = (answer ?? {}) as { message?: string };
    throw new SignInError(
      response.status,
      failure.message ?? `Sign-in was refused (${response.status}).`,
    );
  }

  if (typeof answer?.url !== "string" || answer.url === "") {
    throw new SignInError(response.status, "Sign-in did not return somewhere to go.");
  }

  return answer.url;
}

/**
 * Parse a body that may not be JSON.
 *
 * A refusal from something in front of the service — a proxy, a gateway — is HTML often
 * enough to be worth surviving: the status is the fact worth reporting, and a parse error
 * thrown here would replace it with a `SyntaxError` naming a character position.
 *
 * @param response The answer.
 * @returns The parsed body, or `null` when it is empty or not JSON.
 */
async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text === "" ? null : JSON.parse(text);
  } catch {
    return null;
  }
}
