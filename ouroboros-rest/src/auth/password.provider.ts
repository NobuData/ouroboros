/**
 * Development email/password sign-in — on everywhere but production
 * ([#705](https://github.com/NobuData/ouroboros/issues/705)).
 *
 * Local development and the e2e suite need a way in that does not involve github.com.
 * [#33](https://github.com/NobuData/ouroboros/issues/33) answered that with a bypass: one
 * environment variable naming an address, and a branch inside the guard that treated every
 * request as already belonging to whoever it named. Roadmap decision **A8** replaces it with
 * the mechanism BetterAuth already has, and this file is that decision. The variable is gone
 * from the repository entirely — that removal is half of this issue.
 *
 * The difference is the whole point of the issue, so it is worth stating plainly rather than
 * leaving to be inferred: a bypass is a way *around* authentication, and a password is a way
 * *through* it. What is enabled below still hashes, still compares, still refuses a wrong
 * answer, still writes a `session` row and still leaves an `account` row saying how somebody
 * proved who they were. Turning it on in production would be a weaker credential than
 * GitHub's; turning the old variable on in production was no credential at all. That is why
 * this one can be gated by a single flag and that one needed two independent checks.
 *
 * ## Where the line is drawn
 *
 * `NODE_ENV !== "production"`, and nothing else — no `OURO_` variable of its own. A second
 * switch would be a second thing to get wrong, and the failure mode of getting it wrong is a
 * password route on the public API. `NODE_ENV` is already validated to one of three values
 * (`modules/config/configuration.ts`), it is already what decides which interface the service
 * binds, and `ouroboros-rest`'s image pins it to `production` in the image itself rather than
 * leaving it to whoever runs the container — so the off position is the one a deployment
 * inherits without doing anything.
 *
 * ## What "disabled" actually looks like
 *
 * **Not a 404.** The issue's acceptance criterion says *404/disabled*, and the library does
 * the second: `emailAndPassword.enabled: false` leaves the routes mounted and makes their
 * handlers refuse, so `POST /api/auth/sign-in/email` answers **400** with
 * `EMAIL_PASSWORD_DISABLED` (`better-auth/dist/api/routes/sign-in.mjs`), and the sign-up
 * route answers 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`. This is written down because a test
 * asserting 404 would be asserting something the library has never done, and would pass only
 * until somebody looked. What matters for the criterion — that no password can be exchanged
 * for a session in production — holds either way, and `password.provider.spec.ts` asserts it
 * where this service decides it, which is the options object below.
 *
 * The key is therefore **always present**, carrying `enabled: false` in production rather
 * than being omitted. An absent option and an option explicitly turned off read the same to
 * the library and very differently to a person: one is a decision, the other is
 * indistinguishable from a line somebody deleted. It also keeps the shape of
 * {@link authOptions}' output the same in every environment, which is what lets
 * `auth.options.spec.ts` pin the whole surface.
 *
 * ## The hash
 *
 * `password.hash` is deliberately not set, so the library's own **scrypt** implementation is
 * what writes and verifies `account.password`
 * ([#706](https://github.com/NobuData/ouroboros/issues/706)'s column). That is a fact
 * [#709](https://github.com/NobuData/ouroboros/issues/709) depends on: the development seed
 * has to write hashes *BetterAuth's verifier accepts*, and it can only do that against a
 * function this service has not replaced.
 *
 * @see auth.options.ts — where this is handed to the library.
 * @see ../modules/config/configuration.ts — `NODE_ENV`, and the values it admits.
 */

import type { BetterAuthOptions } from "better-auth";

import type { Configuration } from "../modules/config/configuration";

/**
 * The shortest password this service will accept, in characters — **twelve**.
 *
 * Above the library's default of eight, and stated rather than inherited for the reason
 * every other value in this directory is: a default that a minor upgrade could move is a
 * security property nothing records.
 *
 * Twelve is not a strength claim. These are credentials that exist on developer machines and
 * in a seed file; what the floor is really doing is making sure a password chosen for a
 * demo cannot be three letters, and making the seeded credentials
 * [#709](https://github.com/NobuData/ouroboros/issues/709) writes long enough to look like
 * passwords rather than placeholders. **#709's seeded passwords must clear this**, and that
 * is the one coupling between the two issues worth grepping for.
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * The longest password this service will accept, in characters — **128**.
 *
 * The library's own default, restated for the reason above. It is a denial-of-service bound
 * rather than a policy one: scrypt's cost is paid per attempt on whatever it is given, so an
 * unbounded field is an unbounded amount of work a stranger can ask for.
 */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Build the email/password block of BetterAuth's options.
 *
 * @param configuration - The validated configuration. Only `nodeEnv` is read; it is taken
 *   from here rather than from `process.env` so that the decision is made from the same
 *   validated value the rest of the service runs on, and so a test can exercise both sides
 *   of it without mutating the process.
 * @returns The options, with `enabled` false in production and true everywhere else. A fresh
 *   object each call, matching `authOptions` and `githubProvider`: two callers exist — the
 *   application and `@better-auth/cli` — and a shared literal would let one's mutation reach
 *   the other.
 */
export function passwordProvider(
  configuration: Configuration,
): BetterAuthOptions["emailAndPassword"] {
  const enabled = configuration.nodeEnv !== "production";

  return {
    enabled,

    // Sign-up follows sign-in rather than being separately switchable, and it is on in
    // development on purpose. A developer whose database predates #709's seed — or who has
    // just run `docker compose down -v` — otherwise has no way into the product at all:
    // no seeded password to use, and a GitHub handshake that needs a real OAuth application.
    // The surface this widens is unreachable in production, because the flag above is what
    // gates both routes.
    //
    // Stated rather than left to the library's `false` default so that "development can
    // create an account" is a sentence in this file rather than an absence somebody has to
    // notice.
    disableSignUp: !enabled,

    // Nothing in this service sends email — that is #724 — so requiring a verification a
    // developer could never receive would turn every new account into an account that
    // cannot sign in. `false` is the honest value rather than the convenient one: the
    // addresses here are `@acme-robotics.dev`, nobody has proved anything about them, and
    // the `"user"."emailVerified"` column keeps saying so.
    requireEmailVerification: false,

    // Signing up lands a session, rather than creating an account and then asking the caller
    // to sign in with it. The library's default, restated: a scripted caller — which is what
    // the e2e suite is — otherwise has to make two calls to get where one should take it.
    autoSignIn: true,

    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
  };
}
