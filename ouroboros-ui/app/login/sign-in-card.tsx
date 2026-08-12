import type { SessionUser } from "@/app/api/session";
import { Button, Card, Eyebrow, TextField } from "@/app/ui";

import { GithubMark } from "./github-mark";
import { Monogram } from "./monogram";

/**
 * Step 1 of the mockup: sign in.
 *
 * Two shapes, one card. Before a session exists it is the control — "Continue with GitHub",
 * the enterprise-SSO explainer, and the isolation note. After one exists it states who is
 * signed in, because a numbered step that vanished once it was done would leave the second
 * card labelled "Step 2" with no step 1 above it.
 *
 * ### Why sign-in is a link
 *
 * `GET /api/v1/auth/github` answers `302` to github.com. The contract calls it "a
 * navigation, not a call" in as many words: a `fetch` would follow the redirect into a
 * consent page it cannot render and land nobody anywhere. So this is an anchor the browser
 * follows, and the whole handshake — `state`, the PKCE challenge, the short-lived
 * `ouro_oauth` cookie — belongs to `ouroboros-rest`.
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
 * @param props.signInHref Absolute URL of `GET /api/v1/auth/github` on `ouroboros-rest`.
 * @param props.user The signed-in person, or `null` while nobody is.
 * @returns The card: the sign-in control, or the identity it produced.
 */
export function SignInCard({
  signInHref,
  user,
}: Readonly<{ signInHref: string; user: SessionUser | null }>) {
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

      <Button tone="primary" size="lg" block href={signInHref}>
        <GithubMark />
        Continue with GitHub
      </Button>

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
