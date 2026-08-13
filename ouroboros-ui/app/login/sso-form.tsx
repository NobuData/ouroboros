"use client";

import { useActionState, useId } from "react";

import { Button, TextField, cx } from "@/app/ui";

import { discoverDomain } from "./actions";
import { DISCOVERY_WAITING, DOMAIN_FIELD } from "./sso";

/**
 * The mockup's enterprise-SSO half of step 1 — the domain field, its button, and what the
 * service said about the domain.
 *
 * **This form shipped inert** ([#44](https://github.com/NobuData/ouroboros/issues/44)): the
 * field carried `disabled`, the button carried a `reason`, and one `SSO_UNAVAILABLE` string
 * in `sign-in-card.tsx` was both the tooltip and the prose. That was the honest rendering of
 * a control with no endpoint behind it (design system § 3.5). There is an endpoint now —
 * [#712](https://github.com/NobuData/ouroboros/issues/712) — so the constant is gone and the
 * card is told: `app/login/sso.ts` holds the states, `discoverDomain` fills one in, and the
 * paragraph below renders whichever arrived.
 *
 * ### Why the login screen has a client component here
 *
 * `app/(auth)/login/page.tsx` records that this screen is Server Components with Server
 * Action writes, and the reason is worth keeping: the switches on step 2 are submit buttons
 * in one-field forms, so they work before hydration and without JavaScript. This form cannot
 * be that, and the reason is not the call — the call **is** a Server Action, because
 * `proxy.ts` forwards `/api/auth/*` and deliberately not `/api/v1/*`, so the browser has no
 * address for the discovery endpoint at all.
 *
 * The reason is the *answer*. Discovery is a read whose entire product is a sentence, and a
 * plain `<form action={…}>` throws away what the action returned. The two ways to render it
 * without a client component are both worse than this one: a `redirect()` back to `/login`
 * carrying the message would put a company's own domain in a URL, a browser history and a
 * `Referer` — which is the thing the endpoint is a `POST` rather than a `GET` to avoid — and
 * a page-level search param would make the answer survive a refresh, long after the question.
 * `useActionState` is the framework's own answer to "render what the action returned", so
 * that is what this is, and the boundary is one form rather than the card.
 *
 * It degrades honestly: without JavaScript the form still posts and the page still re-renders,
 * and what is lost is the message rather than the ability to sign in — GitHub is above it and
 * is a Server Component's button on a route of its own.
 *
 * @see sso.ts — the states, and the constant this replaced.
 * @see actions.ts — the submission, and why it is the one action that takes no authority.
 */

/**
 * The step-1 SSO form.
 *
 * @param props.describedBy The id of the SAML/OIDC explainer under the form, so the field and
 *   the button are both announced with it. Passed in rather than composed here because the
 *   paragraph is the card's — it is the mockup's copy and belongs to the card's flow, not to
 *   this form's.
 * @returns The field, the button, and the service's answer once there is one.
 */
export function SsoForm({ describedBy }: Readonly<{ describedBy: string }>) {
  const [state, submit, pending] = useActionState(discoverDomain, DISCOVERY_WAITING);

  /**
   * What the answer paragraph is called, so the field can point at it once there is one.
   *
   * The live region announces it when it appears; this is what makes it findable *again* by
   * somebody who has tabbed back to the field to correct a domain, which is the more likely
   * order of events after a refusal.
   */
  const answerId = useId();

  return (
    <form action={submit}>
      <TextField
        className="login-field"
        id="login-sso-domain"
        label="Company domain"
        name={DOMAIN_FIELD}
        type="text"
        inputMode="url"
        autoComplete="organization"
        placeholder="acme.ouroboros.dev"
        mono
        required
        // Only a refusal is the *field's* fault. An answer is about the domain rather than
        // about what was typed, and marking the input invalid for one would tell somebody
        // they had mistyped a domain the service understood perfectly.
        aria-invalid={state.status === "refused" || undefined}
        aria-describedby={
          state.status === "waiting" ? describedBy : `${describedBy} ${answerId}`
        }
      />

      <Button
        type="submit"
        tone="ghost"
        size="lg"
        block
        // `aria-busy` rather than `disabled`, the same choice `sign-in-button.tsx` makes and
        // for the same reason: a control disabled mid-press loses focus, which sends a
        // keyboard reader to the top of the document while the request is in flight.
        aria-busy={pending || undefined}
        aria-describedby={describedBy}
      >
        Continue with SSO
      </Button>

      {state.status !== "waiting" && (
        // `role="status"` for an answer and `role="alert"` for a refusal, which is the
        // difference between *the service told us this* and *we could not ask*. Both are
        // announced, because either way a person has pressed a button and the only thing that
        // changed is a paragraph they may not be looking at.
        <p
          className={cx("login-note", state.status === "refused" && "login-note--error")}
          id={answerId}
          role={state.status === "refused" ? "alert" : "status"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
