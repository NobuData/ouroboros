/**
 * What step 1's enterprise-SSO half knows: the states it can be in, and the rules that read
 * one answer into one of them.
 *
 * The counterpart of `app/login/view.ts` for the other card, and framework-free for the same
 * reason: everything with a decision in it is then a unit test rather than a form to drive,
 * and the component is left holding nothing but markup. It is also what
 * [#712](https://github.com/NobuData/ouroboros/issues/712)'s endpoint arriving *changed*, so
 * it is worth saying plainly what it replaced.
 *
 * ### The constant this module exists to have deleted
 *
 * The SSO field and button shipped in [#44](https://github.com/NobuData/ouroboros/issues/44)
 * inert, gated behind a single `SSO_UNAVAILABLE` string in `sign-in-card.tsx` that was both
 * the tooltip and the prose. That was the honest rendering at the time — the design system
 * (§ 3.5) asks that a control which cannot act say why rather than be dropped, and there was
 * no endpoint to put behind it. There is one now, so **the card is told by the service and no
 * longer by a constant**: `ssoAvailable` travels with the message, both branches are live
 * code, and nothing in `sso-form.tsx` moves when
 * [#722](https://github.com/NobuData/ouroboros/issues/722) starts answering `true`.
 *
 * A constant is still in this file — {@link DISCOVERY_UNREACHABLE} — and the difference is
 * the whole point of the rewrite: it says *we could not ask*, which is this client's own
 * fact, and never *SSO is not configured*, which is the service's alone.
 *
 * @see app/api/discovery.ts — the call, and why the answer is uniform for every domain.
 * @see app/login/sso-form.tsx — the form that submits, and what it renders of this.
 */

import type { Discovery } from "@/app/api/discovery";
import { isApiError } from "@/app/api/errors";

/**
 * What the SSO half has been told, and therefore what it renders.
 *
 * A discriminated union rather than a bag of optional fields, so there is no state in which
 * a message is rendered without knowing which branch it came from — which is exactly the
 * confusion the deleted constant was.
 */
export type DiscoveryState =
  /** Nothing has been asked yet — the state the form is first rendered in. */
  | { readonly status: "waiting" }
  /**
   * The service answered.
   *
   * @property ssoAvailable Whether this domain signs in through SAML or OIDC. `false` in
   *   every answer this release sends, and read rather than assumed.
   * @property message The sentence to render. Always present, in both branches — the
   *   contract requires it so a client never has to invent copy of its own.
   */
  | { readonly status: "answered"; readonly ssoAvailable: boolean; readonly message: string }
  /**
   * The domain could not be looked up at all.
   *
   * @property message Why, fit to show a person — the field's own `422` detail where the
   *   service named one, and the envelope's message otherwise.
   */
  | { readonly status: "refused"; readonly message: string };

/** The state the form begins in, before anything has been submitted. */
export const DISCOVERY_WAITING: DiscoveryState = { status: "waiting" };

/** The field the domain is submitted under, on both sides of the form. */
export const DOMAIN_FIELD = "domain";

/**
 * What a blank submission is told, without spending a request on it.
 *
 * The service's own `422` detail for this field, verbatim (`openapi.yaml` § `discoverDomain`),
 * so a person sees one sentence about the field however their submission got here — the
 * browser's `required` normally catches it first, and a form posted by hand does not.
 */
export const DOMAIN_REQUIRED = "domain must be a company domain, such as acme.ouroboros.dev";

/**
 * What a failure carrying no envelope is called.
 *
 * It says *we could not ask*, and deliberately not *SSO is not configured*: the second is the
 * service's answer to give, and a client that guessed it would be the deleted constant wearing
 * a different name — right today by luck, and wrong the moment #722 lands.
 */
export const DISCOVERY_UNREACHABLE =
  "Could not check that domain just now. Try again, or sign in with GitHub.";

/**
 * Where a discovered domain says to send the browser, or nowhere.
 *
 * `ssoAvailable: true` with no usable `redirectUrl` is *nowhere* rather than an error, and the
 * card then renders the message — which the contract describes as "what the card shows while
 * the browser is on its way", and is the right thing to be looking at if it never leaves.
 *
 * @param answer What the service said about the domain.
 * @returns The destination, or `undefined` when there is none to follow.
 */
export function ssoDestination(answer: Discovery): string | undefined {
  if (!answer.ssoAvailable) return undefined;

  const url = answer.redirectUrl;

  return url !== undefined && url !== "" && isSafeDestination(url) ? url : undefined;
}

/**
 * Whether a URL is one a browser may be sent to.
 *
 * **Weaker than `safeReturnTo` in `app/paths.ts`, and for a reason rather than by oversight.**
 * That one guards a value out of a URL a stranger composed, so it admits only paths on this
 * origin. This one guards a value the *service* sent, over a server-side client, and an
 * identity provider is somewhere else by definition — Okta, Entra ID, Google Workspace — so
 * an absolute URL is the expected shape rather than the suspicious one.
 *
 * What is refused is the class that would still be wrong from a trusted sender: a scheme a
 * browser *executes* rather than fetches. `javascript:` and `data:` in a redirect are script
 * running on this origin, and a service compromised into sending one should not find a client
 * that follows it.
 *
 * @param url Whatever `redirectUrl` carried.
 * @returns `true` for an `http:` or `https:` URL, or for a path on this origin.
 */
export function isSafeDestination(url: string): boolean {
  // A path on this origin — the shape the contract's own example takes,
  // `/api/auth/sso/saml2/acme`. `//host` and `/\host` are authorities rather than paths, the
  // same pair `safeReturnTo` refuses and for the same reason.
  if (url.startsWith("/")) {
    return !url.startsWith("//") && !url.startsWith("/\\");
  }

  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * What to tell a person about a discovery that failed.
 *
 * @param error Whatever the call threw.
 * @returns The field's own `422` detail when the service named one — the sentence about
 *   *this field*, rather than the envelope's "see `details` for each field" — then the
 *   envelope's own message, and {@link DISCOVERY_UNREACHABLE} for a failure that never
 *   reached the service at all.
 */
export function refusalMessage(error: unknown): string {
  if (!isApiError(error)) return DISCOVERY_UNREACHABLE;

  const named = error.details[DOMAIN_FIELD];
  const first = Array.isArray(named) ? named[0] : undefined;

  return typeof first === "string" && first !== "" ? first : error.message;
}
