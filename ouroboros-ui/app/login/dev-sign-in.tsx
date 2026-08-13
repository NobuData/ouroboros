"use client";

import { type FormEvent, useId, useState } from "react";

import { signIn } from "@/app/api/auth-client";
import { Button, TextField } from "@/app/ui";

/**
 * The development email/password form — a way in that does not involve github.com
 * ([#705](https://github.com/NobuData/ouroboros/issues/705)).
 *
 * `ouroboros-rest` enables BetterAuth's `emailAndPassword` on `NODE_ENV !== "production"` and
 * nothing else (`src/auth/password.provider.ts`), and this is the other end of that decision.
 * It exists because a GitHub handshake needs a real OAuth application: without it a developer
 * with a fresh `docker compose up` has no way into the product, and the e2e suite has no way
 * to script one.
 *
 * **It is a password, not a bypass**, and that distinction is the whole of why it is
 * acceptable to ship the code at all. What it exercises still hashes, still compares, still
 * refuses a wrong answer and still writes a session row — it is the same door, opened with a
 * different key. `OURO_AUTH_DEV_USER`, which #705 deleted, was a way *around* the door.
 *
 * ### Where the line is drawn, twice
 *
 * `NODE_ENV !== "production"`, in two places, because they are two different guarantees:
 *
 *   * **`sign-in-card.tsx` does not compose it**, so no production render contains it. That
 *     is the one that matters to a person looking at the screen.
 *   * **{@link DevSignInForm} refuses to render one anyway.** Next.js inlines
 *     `process.env.NODE_ENV` into the browser bundle, so in a production build the check
 *     below is `if (true) return null` with {@link DevSignInFields} referenced from nowhere
 *     but dead code — which a production minifier drops. That is the one that keeps the form
 *     out of the JavaScript rather than merely out of the markup.
 *
 * Neither is a substitute for the service's own gate. `emailAndPassword.enabled: false` in
 * production makes `POST /api/auth/sign-in/email` answer `400 EMAIL_PASSWORD_DISABLED`
 * whatever any client does, and *that* is the security property; these two are what keep a
 * production screen from offering a control the service would refuse.
 *
 * ### Why it is a Client Component
 *
 * The same reason `sign-in-button.tsx` is, and a stronger one: BetterAuth answers a
 * successful sign-in with `Set-Cookie`, and a `Set-Cookie` reaches a browser only on a request
 * the browser itself made. A Server Action calling this route would receive the session cookie
 * into the Next.js process and stop there — which `app/api/auth-server.ts` records for
 * sign-out, and which is the reason sign-in of every kind is made from here.
 *
 * @see ouroboros-rest/src/auth/password.provider.ts — the service's half, and the twelve-
 *   character floor the seeded passwords clear.
 * @see ouroboros-db/migrations/R__dev_seed.sql — the seeded people, and the documented
 *   development password.
 */

/**
 * Read the page again, now that there is a session.
 *
 * The default, and the one line of this component a test cannot run: jsdom has no navigation.
 * So it is a parameter, the same seam `sign-in-button.tsx` opens for its departure.
 *
 * A reload rather than a route push, because `/login` is where the decision already lives —
 * `app/login/view.ts` sends a settled visitor to the dashboard, or to wherever a `?next=`
 * said — and reloading the current URL keeps that parameter rather than dropping it.
 */
const reread = () => window.location.reload();

/** What the form takes. */
interface DevSignInProps {
  /** What to do once a session exists. Defaults to {@link reread}; only a suite passes it. */
  readonly onSignedIn?: () => void;
}

/**
 * The development sign-in form, or nothing at all outside development.
 *
 * @param props See {@link DevSignInProps}.
 * @returns The form, or `null` in a production build.
 */
export function DevSignInForm(props: DevSignInProps) {
  // Split from the fields rather than written as an early return inside them, so the check is
  // above every hook — and so that a production build has the whole of {@link DevSignInFields}
  // referenced from unreachable code, where a minifier can remove it.
  if (process.env.NODE_ENV === "production") return null;

  return <DevSignInFields {...props} />;
}

/**
 * The fields, the press, and what the service said.
 *
 * @param props See {@link DevSignInProps}.
 * @returns The form.
 */
function DevSignInFields({ onSignedIn = reread }: DevSignInProps) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const failureId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    // Read before the first `await`: React clears `currentTarget` once the handler yields,
    // and a second press would otherwise read the fields off nothing.
    const submitted = new FormData(event.currentTarget);
    const email = String(submitted.get(EMAIL_FIELD) ?? "");
    const password = String(submitted.get(PASSWORD_FIELD) ?? "");

    setPending(true);
    setFailure(null);

    try {
      const { error } = await signIn.email({ email, password });

      if (error) {
        // The library's own message — "Invalid email or password" for a wrong answer, and
        // `EMAIL_PASSWORD_DISABLED` when somebody has pointed a development build at a
        // production service. Both are worth reading, and neither is worth translating.
        setFailure(error.message ?? `Sign-in was refused (${error.status ?? "no answer"}).`);
        setPending(false);
        return;
      }
    } catch {
      // better-fetch throws rather than reporting when the request never happened — see
      // `sign-in.ts`, which absorbs the same asymmetry for the social flow.
      setFailure("Could not reach the sign-in service. Check your connection.");
      setPending(false);
      return;
    }

    // `pending` is deliberately left set: the session exists, the page is about to be read
    // again, and clearing it would flash the idle label in between.
    onSignedIn();
  }

  return (
    <>
      <p className="login-or">development sign-in</p>

      <form onSubmit={(event) => void submit(event)}>
        <TextField
          className="login-field"
          id="login-dev-email"
          label="Email"
          name={EMAIL_FIELD}
          type="email"
          autoComplete="username"
          placeholder="ken@acme-robotics.dev"
          mono
          required
        />

        <TextField
          className="login-field"
          id="login-dev-password"
          label="Password"
          name={PASSWORD_FIELD}
          type="password"
          autoComplete="current-password"
          required
        />

        <Button
          type="submit"
          size="lg"
          block
          aria-busy={pending || undefined}
          aria-describedby={failure === null ? undefined : failureId}
        >
          Sign in
        </Button>

        {failure !== null && (
          <p className="login-note login-note--error" id={failureId} role="alert">
            {failure}
          </p>
        )}
      </form>

      <p className="login-note login-note--faint">
        Development builds only. `ouroboros-rest` refuses email and password sign-in in
        production, whatever a browser asks.
      </p>
    </>
  );
}

/** What the address is submitted under. */
const EMAIL_FIELD = "email";

/** What the password is submitted under. */
const PASSWORD_FIELD = "password";
