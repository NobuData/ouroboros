import type { SessionUser } from "@/app/api/identity";
import { Card, Eyebrow } from "@/app/ui";

import { DevSignInForm } from "./dev-sign-in";
import { GithubMark } from "./github-mark";
import { Monogram } from "./monogram";
import { GITHUB_PROVIDER, socialSignIn } from "./sign-in";
import { SignInButton } from "./sign-in-button";
import { SsoForm } from "./sso-form";

/**
 * Step 1 of the mockup: sign in.
 *
 * Two shapes, one card. Before a session exists it is the control — "Continue with GitHub",
 * the enterprise-SSO form, and the isolation note. After one exists it states who is signed
 * in, because a numbered step that vanished once it was done would leave the second card
 * labelled "Step 2" with no step 1 above it.
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
 * the call behind it; this card only says which provider.
 *
 * **The card no longer takes a sign-in URL**, which is what let the anchor be wrong from
 * here. Where a sign-in *goes* is now the service's answer to a request, and the path that
 * request is made to is same-origin (`proxy.ts`) — so there is no address for a screen to be
 * handed, and none to be handed a stale one.
 *
 * ### The SSO half is live, and was inert
 *
 * It shipped with the field carrying `disabled`, the button carrying a `reason`, and one
 * `SSO_UNAVAILABLE` string here serving as both the tooltip and the prose. The comment that
 * stood in this place recorded why: *"The mockup gives enterprise SSO equal weight… What does
 * not exist is an endpoint behind it."*
 *
 * [#712](https://github.com/NobuData/ouroboros/issues/712) is that endpoint, and
 * [#718](https://github.com/NobuData/ouroboros/issues/718) connected them. The constant is
 * gone rather than moved: what the card says about a domain is now what the service said about
 * it, in both branches of `ssoAvailable`, so nothing here changes shape when
 * [#722](https://github.com/NobuData/ouroboros/issues/722) starts answering `true`. See
 * `sso-form.tsx` for why that half is a Client Component and this card is not.
 *
 * What the removal also restores is the mockup's own copy. The explainer below is
 * `docs/mockups/01-login.html` line for line; while the constant existed it was appended to
 * that sentence, which made the one paragraph the mockup writes into a paragraph and a
 * disclaimer.
 */

/**
 * The id of the SAML/OIDC explainer, which both SSO controls are described by.
 *
 * The paragraph belongs to the card rather than to the form — it is the mockup's copy, in the
 * mockup's place in the card's flow — so the id is declared here and handed down.
 */
const SSO_EXPLAINER_ID = "login-sso-why";

/**
 * Step 1's card.
 *
 * @param props.user The signed-in person, or `null` while nobody is.
 * @returns The card: the sign-in controls, or the identity they produced.
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

      <SignInButton begin={socialSignIn(GITHUB_PROVIDER)}>
        <GithubMark />
        Continue with GitHub
      </SignInButton>

      <p className="login-or">or enterprise SSO</p>

      <SsoForm describedBy={SSO_EXPLAINER_ID} />

      <p className="login-note login-note--faint" id={SSO_EXPLAINER_ID}>
        SAML 2.0 and OIDC via your identity provider — Okta, Entra ID, Google Workspace.
      </p>

      {/*
        The development sign-in, and the gate that keeps it out of a production render. The
        component refuses to render one too, which is what keeps it out of the production
        *bundle* — see `dev-sign-in.tsx` for why that is two guarantees rather than one said
        twice.
      */}
      {process.env.NODE_ENV !== "production" && <DevSignInForm />}

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
