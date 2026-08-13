import type { SessionUser } from "@/app/api/session";
import { Button, Card, Eyebrow, TextField } from "@/app/ui";

import { GithubMark } from "./github-mark";
import { Monogram } from "./monogram";
import { GITHUB_PROVIDER, socialSignIn } from "./sign-in";
import { SignInButton } from "./sign-in-button";

/**
 * Step 1 of the mockup: sign in.
 *
 * Two shapes, one card. Before a session exists it is the control — "Continue with GitHub",
 * the enterprise-SSO explainer, and the isolation note. After one exists it states who is
 * signed in, because a numbered step that vanished once it was done would leave the second
 * card labelled "Step 2" with no step 1 above it.
 *
 * ### Why sign-in is a button, and was a link
 *
 * It was an anchor because #33's route answered `302` to github.com: a `fetch` would have
 * followed the redirect into a consent page it cannot render and landed nobody anywhere.
 *
 * The handshake still belongs to `ouroboros-rest` — but to **BetterAuth** inside it, since
 * [#702](https://github.com/NobuData/ouroboros/issues/702), which deleted the hand-rolled
 * flow that anchor pointed at. The library begins a social sign-in with a `POST` that
 * *answers* with the github.com URL rather than redirecting to it, so the anchor became a
 * `GET` at a `POST`-only route — a `404` from the service, which is what it had been
 * answering since. `sign-in-button.tsx` is the control that replaces it, and `sign-in.ts` is
 * the request behind it; this card only says which provider.
 *
 * **The card no longer takes a sign-in URL**, which is what let the anchor be wrong from
 * here. Where a sign-in *goes* is now the service's answer to a request, and the path that
 * request is made to is same-origin (`proxy.ts`) — so there is no address for a screen to be
 * handed, and none to be handed a stale one.
 *
 * ### Why the SSO form is present but inert
 *
 * The mockup gives enterprise SSO equal weight, and the issue asks for "the
 * enterprise-domain explainer per the mockup copy". What does not exist is an endpoint
 * behind it: SAML and OIDC are v2 work, and the contract describes no domain-discovery
 * operation to call. The design system's answer to exactly this is § 3.5 — a control that
 * cannot act explains itself rather than being quietly dropped — so the field and its
 * button render, marked unavailable, saying why. The button carries `aria-disabled` rather
 * than `disabled`, the same way the account menu's items do: a `disabled` button leaves the
 * tab order and takes its explanation with it, while an `aria-disabled` one is still
 * reachable, still announces why, and — having no handler and no form — still does nothing.
 * The input carries the real `disabled`, because a text box that accepts typing and then
 * discards it is worse than one that does not.
 */

/** Why the SSO half cannot act yet. Written once; it is both the tooltip and the prose. */
const SSO_UNAVAILABLE =
  "Enterprise SSO is not configured yet — sign in with GitHub for now.";

/**
 * Step 1's card.
 *
 * @param props.user The signed-in person, or `null` while nobody is.
 * @returns The card: the sign-in control, or the identity it produced.
 */
export function SignInCard({ user }: Readonly<{ user: SessionUser | null }>) {
  if (user !== null) {
    return (
      <Card as="section" tone="ground" size="lg" aria-labelledby="login-step-1">
        <Eyebrow>Step 1 · Signed in</Eyebrow>
        <h1 className="login-step__title" id="login-step-1">
          Signed in
        </h1>
        <p className="login-identity">
          <Monogram name={user.displayName || user.email} />
          <span className="login-identity__who">
            {user.displayName}
            <span className="login-identity__mail">{user.email}</span>
          </span>
        </p>
      </Card>
    );
  }

  return (
    <Card as="section" tone="ground" size="lg" aria-labelledby="login-step-1">
      <Eyebrow>Step 1 · Sign in</Eyebrow>
      <h1 className="login-step__title" id="login-step-1">
        Sign in
      </h1>

      <SignInButton request={socialSignIn(GITHUB_PROVIDER)}>
        <GithubMark />
        Continue with GitHub
      </SignInButton>

      <p className="login-or">or enterprise SSO</p>

      <TextField
        className="login-field"
        id="login-sso-domain"
        label="Company domain"
        name="domain"
        type="text"
        inputMode="url"
        autoComplete="organization"
        placeholder="acme.ouroboros.dev"
        mono
        disabled
        aria-describedby="login-sso-why"
      />

      <Button
        tone="ghost"
        size="lg"
        block
        reason={SSO_UNAVAILABLE}
        aria-describedby="login-sso-why"
      >
        Continue with SSO
      </Button>

      <p className="login-note login-note--faint" id="login-sso-why">
        SAML 2.0 and OIDC via your identity provider — Okta, Entra ID, Google Workspace.{" "}
        {SSO_UNAVAILABLE}
      </p>

      <hr className="login-step__rule" />

      <p className="login-note">
        <span className="login-note__marker" aria-hidden>
          ▸
        </span>{" "}
        Each domain is an isolated tenant. Your code, runs, and model keys never cross the
        boundary.
      </p>
    </Card>
  );
}
