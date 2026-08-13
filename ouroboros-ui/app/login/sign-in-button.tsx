"use client";

import { type ReactNode, useState } from "react";

import { Button, type ButtonSize, type ButtonTone } from "@/app/ui";

import { type SignInRequest, beginSignIn } from "./sign-in";

/**
 * The control that begins a sign-in — the press, and nothing else.
 *
 * **This is the first client component on the login screen**, and the note in
 * `app/(auth)/login/page.tsx` saying there is none is now wrong by exactly this much. It is
 * here because [#702](https://github.com/NobuData/ouroboros/issues/702) turned sign-in from a
 * navigation into a request: BetterAuth answers `POST /sign-in/social` with the provider's
 * URL rather than redirecting to it, so something has to make the call and *then* navigate.
 * A Server Action could make the call, but the navigation that follows leaves the origin
 * entirely, and `redirect()` to github.com through an action is a round trip to ask the
 * server for a URL the browser already has.
 *
 * Everything above the press is `sign-in.ts` — which request, and what its answer means —
 * so this file holds the two things that genuinely need a browser: `window.location`, and
 * what the button looks like while it waits.
 *
 * ### It is a button now, and was an anchor
 *
 * #33's route answered `302` to github.com, so a link was the honest element and
 * `app/ui/button.tsx` still explains that choice. It is no longer true: a link would issue a
 * `GET` at a route that answers only `POST`, which is a `404` from the service rather than a
 * consent screen. A control that acts is a button — the same rule, applied to what the
 * control now does.
 *
 * @see sign-in.ts — the request, the failures, and why they are a shape rather than a
 *   provider.
 */

/**
 * Leave this origin for the provider's consent page.
 *
 * The default, and the one line of this component that a test cannot run: jsdom has no
 * navigation, and refuses to let `location.assign` be replaced. So it is a parameter —
 * the same seam `app/api/auth-server.ts` opens for `fetch`, and for the same reason.
 *
 * @param url Where the service said to go.
 */
const leaveFor = (url: string) => window.location.assign(url);

/**
 * A sign-in control.
 *
 * @param props.request What to send — {@link socialSignIn}'s output for a social provider,
 *   and whatever an SSO route's builder returns when there is one. Taken as a prop rather
 *   than composed here, so this component is provider-agnostic and a second one is a second
 *   `<SignInButton>` with a different request.
 * @param props.tone Which treatment, as `app/ui/button.tsx` defines them.
 * @param props.size How large.
 * @param props.block Whether it fills its column.
 * @param props.children The label, and any mark beside it.
 * @param props.navigate How to leave for the provider. Defaults to {@link leaveFor}; only a
 *   suite passes it. A Server Component rendering this passes no function across the
 *   boundary — the default is resolved here, on the client.
 * @returns The button, and — after a failure — the reason under it.
 */
export function SignInButton({
  request,
  tone = "primary",
  size = "lg",
  block = true,
  children,
  navigate = leaveFor,
}: Readonly<{
  request: SignInRequest;
  tone?: ButtonTone;
  size?: ButtonSize;
  block?: boolean;
  children?: ReactNode;
  navigate?: (url: string) => void;
}>) {
  /**
   * `pending` outlives the request on the way out: a successful sign-in is a navigation, and
   * clearing it would flash the idle label for however long the browser takes to leave.
   */
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function press() {
    // A second press mid-flight would begin a second handshake and issue a second `state`
    // cookie, invalidating the first — so the one already in flight would fail at the
    // callback. The guard is the state, not a disabled attribute, which would take the
    // control out of the tab order while it waits.
    if (pending) return;

    setPending(true);
    setFailure(null);

    try {
      navigate(await beginSignIn(request));
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Sign-in could not be started.",
      );
      setPending(false);
    }
  }

  return (
    <>
      <Button
        tone={tone}
        size={size}
        block={block}
        onClick={() => void press()}
        aria-busy={pending || undefined}
        aria-describedby={failure === null ? undefined : FAILURE_ID}
      >
        {children}
      </Button>

      {failure !== null && (
        // `role="alert"` because it appears in answer to a press: a person who has just
        // pressed a button and been given nothing needs to be told, whatever they are
        // reading the screen with.
        <p className="login-note login-note--error" id={FAILURE_ID} role="alert">
          {failure}
        </p>
      )}
    </>
  );
}

/** What the failure text is called, so the button can point at it while it is there. */
const FAILURE_ID = "login-sign-in-failure";
