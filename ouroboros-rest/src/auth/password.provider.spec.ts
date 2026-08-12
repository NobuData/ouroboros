import { testConfiguration } from "../modules/config/configuration.fixture";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProvider } from "./password.provider";

/**
 * The development sign-in, and the one thing that has to be true of it in production.
 *
 * The subject is an object: which values reach the library, and — the acceptance criterion
 * this file exists for — that `NODE_ENV=production` produces one in which no password can be
 * exchanged for a session. Nothing here connects to anything, because the decision is made
 * before anything connects.
 *
 * What this deliberately does *not* assert is a status code. The library answers a disabled
 * route with 400 `EMAIL_PASSWORD_DISABLED` rather than the 404 the issue's wording suggests
 * (see `password.provider.ts`), and pinning a number the library owns would make this suite
 * fail on an upgrade that changed nothing this service decided.
 */

describe("passwordProvider", () => {
  describe("in production", () => {
    const production = () => passwordProvider(testConfiguration({ NODE_ENV: "production" }));

    // The acceptance criterion, stated as the one assertion that matters. Every other test
    // in this file is about the shape of a development sign-in; this is the one about there
    // not being one.
    it("is off, so no password can be exchanged for a session", () => {
      expect(production()?.enabled).toBe(false);
    });

    it("refuses sign-up as well, so the two routes cannot disagree", () => {
      // Both halves are gated by `enabled` inside the library, so this is belt and braces
      // rather than a second mechanism — and it is asserted because a future edit that made
      // `disableSignUp` independent of the environment would otherwise leave account
      // creation on in production with nothing failing to say so.
      expect(production()?.disableSignUp).toBe(true);
    });
  });

  describe("outside production", () => {
    // `test` and `development` are the two remaining members of `NODE_ENVIRONMENTS`, and
    // both have to work: `development` is a developer's machine, and `test` is what an
    // integration run sets. Enumerating them rather than testing one is what stops the gate
    // from being read as `=== "development"`, which would leave the test environment with no
    // way to sign in and no failure until somebody tried.
    it.each(["development", "test"] as const)("is on when NODE_ENV is %s", (nodeEnv) => {
      const options = passwordProvider(testConfiguration({ NODE_ENV: nodeEnv }));

      expect(options?.enabled).toBe(true);
      expect(options?.disableSignUp).toBe(false);
    });

    it("does not require a verification nothing can deliver", () => {
      // There is no mail in this service until #724. Requiring verification would make every
      // account created in development an account that cannot sign in.
      expect(passwordProvider(testConfiguration())?.requireEmailVerification).toBe(false);
    });

    it("signs a new account in rather than making the caller ask twice", () => {
      expect(passwordProvider(testConfiguration())?.autoSignIn).toBe(true);
    });

    it("states its own password bounds rather than inheriting the library's", () => {
      const options = passwordProvider(testConfiguration());

      expect(options?.minPasswordLength).toBe(PASSWORD_MIN_LENGTH);
      expect(options?.maxPasswordLength).toBe(PASSWORD_MAX_LENGTH);
    });

    it("sets a floor above the library's default of eight", () => {
      // The value is this service's, and the reason it is higher is in `password.provider.ts`.
      // Asserted as an inequality rather than restating the constant, so this keeps meaning
      // what it says if the number moves.
      expect(PASSWORD_MIN_LENGTH).toBeGreaterThan(8);
    });
  });

  it("leaves the hash to the library, which is what #709's seed writes against", () => {
    // The seed has to produce hashes BetterAuth's verifier accepts, and it can only do that
    // if this service has not substituted the hashing function. An override added here
    // without #709 being revisited would make every seeded credential unusable, with the
    // failure surfacing as "wrong password" on a password that is right.
    expect(passwordProvider(testConfiguration())).not.toHaveProperty("password");
  });

  it("hands back a fresh object each time", () => {
    // The same rule `authOptions` and `githubProvider` follow: two callers exist — the
    // application and `@better-auth/cli` — and a shared literal would let one's mutation
    // reach the other.
    const first = passwordProvider(testConfiguration());
    const second = passwordProvider(testConfiguration());

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
