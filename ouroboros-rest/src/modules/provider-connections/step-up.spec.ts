import type { AuthService as BetterAuth } from "@thallesp/nestjs-better-auth";

import type { Auth } from "../../auth/auth.factory";
import { COOKIE } from "../auth/http";
import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import type { Principal } from "../auth/principal";
import {
  CONFIRMATION_TTL_MS,
  STEP_UP_MAX_AGE_SECONDS,
  STEP_UP_METHODS,
  StepUpRegistry,
  StepUpService,
} from "./step-up";

/**
 * The price of a reveal.
 *
 * Three properties carry the design and each has its own group. A **fresh session** is a
 * re-authentication in itself, which is the only method a GitHub-only account has. A
 * **confirmed password** counts for the window, so confirming once and revealing two keys is
 * one prompt. And **a wrong password answers exactly as an absent one does**, which is what
 * stops this being a password oracle for anybody holding a stolen session.
 */

const NOW = new Date("2026-08-23T10:00:00.000Z");

/** An instant, in seconds before {@link NOW}. */
const secondsAgo = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000);

/** A request carrying a session cookie, as the controller hands one over. */
const REQUEST = { headers: { [COOKIE]: "better-auth.session_token=abc" } };

/** A principal whose session was created `seconds` ago. */
const signedInAgo = (seconds: number): Principal =>
  principalFor(FIXTURE_USER, "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10", secondsAgo(seconds));

/** A stale session — signed in a day ago, which is the ordinary case. */
const STALE = signedInAgo(24 * 60 * 60);

/** BetterAuth, scripted. */
const betterAuth = (verify: jest.Mock): BetterAuth<Auth> =>
  ({ api: { verifyPassword: verify } }) as unknown as BetterAuth<Auth>;

describe("what the challenge offers", () => {
  it("names the two methods this build accepts, cheapest first", () => {
    // `session` first because it is the one that needs nothing typed: a client whose session
    // is fresh should simply retry rather than prompt.
    expect(STEP_UP_METHODS).toEqual(["session", "password"]);
  });

  it("counts a proof as recent for the same window the session cache uses", () => {
    // Five minutes is already this service's answer to *how stale may a security fact be*,
    // and a second window with a different length would be a second thing to reason about.
    expect(STEP_UP_MAX_AGE_SECONDS).toBe(5 * 60);
    expect(CONFIRMATION_TTL_MS).toBe(STEP_UP_MAX_AGE_SECONDS * 1000);
  });
});

describe("the step-up registry", () => {
  let registry: StepUpRegistry;

  beforeEach(() => {
    registry = new StepUpRegistry();
  });

  it("has no confirmation for a session that has never proved itself", () => {
    expect(registry.isRecent("session-1", NOW)).toBe(false);
  });

  it("remembers a confirmation for the window", () => {
    registry.record("session-1", secondsAgo(STEP_UP_MAX_AGE_SECONDS - 1));

    expect(registry.isRecent("session-1", NOW)).toBe(true);
  });

  it("forgets one that has left the window", () => {
    registry.record("session-1", secondsAgo(STEP_UP_MAX_AGE_SECONDS + 1));

    expect(registry.isRecent("session-1", NOW)).toBe(false);
  });

  it("keeps sessions apart", () => {
    registry.record("session-1", NOW);

    expect(registry.isRecent("session-2", NOW)).toBe(false);
  });

  it("can be told to forget one before its window closes", () => {
    registry.record("session-1", NOW);

    registry.forget("session-1");

    expect(registry.isRecent("session-1", NOW)).toBe(false);
  });

  it("sweeps stale confirmations rather than holding them forever", () => {
    registry.record("session-1", secondsAgo(STEP_UP_MAX_AGE_SECONDS * 4));

    registry.record("session-2", NOW);

    expect(registry.size()).toBe(1);
  });
});

describe("satisfying a step-up", () => {
  let registry: StepUpRegistry;
  let verify: jest.Mock;
  let stepUp: StepUpService;

  beforeEach(() => {
    registry = new StepUpRegistry();
    verify = jest.fn().mockResolvedValue({ status: true });
    stepUp = new StepUpService(betterAuth(verify), registry);
  });

  describe("a fresh session", () => {
    it("is a re-authentication in itself", async () => {
      await expect(stepUp.satisfied(signedInAgo(30), REQUEST, undefined, NOW)).resolves.toBe(
        "session",
      );
    });

    it("costs no password comparison at all", async () => {
      // Cheapest first, and it matters: scrypt is deliberately slow and must not run on
      // every reveal by somebody who has just signed in.
      await stepUp.satisfied(signedInAgo(30), REQUEST, "a-password", NOW);

      expect(verify).not.toHaveBeenCalled();
    });

    it("stops counting at the window's edge", async () => {
      await expect(
        stepUp.satisfied(signedInAgo(STEP_UP_MAX_AGE_SECONDS + 1), REQUEST, undefined, NOW),
      ).resolves.toBeNull();
    });

    it("does not accept a session stamped in the future", async () => {
      // A clock that disagrees with itself, not a session that is very fresh indeed.
      // Refusing is what stops a skewed replica handing out credentials without asking.
      await expect(stepUp.satisfied(signedInAgo(-60), REQUEST, undefined, NOW)).resolves.toBeNull();
    });

    it("does not accept a session that cannot say when it was created", async () => {
      // An absent fact is not a proof, and the safe reading of *this build does not know when
      // you signed in* is `ask again`.
      const unstamped = principalFor();

      await expect(
        stepUp.satisfied(
          { ...unstamped, session: { ...unstamped.session, createdAt: undefined } },
          REQUEST,
          undefined,
          NOW,
        ),
      ).resolves.toBeNull();
    });
  });

  describe("a password", () => {
    it("satisfies the step-up when BetterAuth accepts it", async () => {
      await expect(stepUp.satisfied(STALE, REQUEST, "a-password", NOW)).resolves.toBe("password");
    });

    it("is compared by the library, against the caller's own session", async () => {
      // Never compared here: `verifyPassword` is BetterAuth's scrypt verifier against the
      // caller's `credential` account, and it authenticates by the request's own cookie.
      await stepUp.satisfied(STALE, REQUEST, "a-password", NOW);

      expect(verify).toHaveBeenCalledTimes(1);
      const [call] = verify.mock.calls as [[{ body: { password: string }; headers: Headers }]];
      expect(call[0].body).toEqual({ password: "a-password" });
      expect(call[0].headers.get("cookie")).toBe("better-auth.session_token=abc");
    });

    it("counts for the window, so two reveals are one prompt", async () => {
      await stepUp.satisfied(STALE, REQUEST, "a-password", NOW);

      const later = new Date(NOW.getTime() + (STEP_UP_MAX_AGE_SECONDS - 1) * 1000);
      await expect(stepUp.satisfied(STALE, REQUEST, undefined, later)).resolves.toBe("password");
      expect(verify).toHaveBeenCalledTimes(1);
    });

    it("stops counting once the window has passed", async () => {
      await stepUp.satisfied(STALE, REQUEST, "a-password", NOW);

      const later = new Date(NOW.getTime() + (STEP_UP_MAX_AGE_SECONDS + 1) * 1000);
      await expect(stepUp.satisfied(STALE, REQUEST, undefined, later)).resolves.toBeNull();
    });
  });

  describe("what does not satisfy it", () => {
    it("answers null for a stale session that offered nothing", async () => {
      await expect(stepUp.satisfied(STALE, REQUEST, undefined, NOW)).resolves.toBeNull();
    });

    it("answers null for an empty password without asking the library", async () => {
      await expect(stepUp.satisfied(STALE, REQUEST, "", NOW)).resolves.toBeNull();
      expect(verify).not.toHaveBeenCalled();
    });

    it("answers null — indistinguishably — for a wrong password", async () => {
      // The whole point: telling *wrong password* from *no password* would make this endpoint
      // a password oracle for anybody holding a stolen session, which is precisely the person
      // a step-up exists to stop.
      verify.mockRejectedValue(new Error("INVALID_PASSWORD"));

      await expect(stepUp.satisfied(STALE, REQUEST, "wrong", NOW)).resolves.toBeNull();
    });

    it("records nothing when the password was refused", async () => {
      verify.mockRejectedValue(new Error("INVALID_PASSWORD"));

      await stepUp.satisfied(STALE, REQUEST, "wrong", NOW);

      expect(registry.isRecent(STALE.session.id, NOW)).toBe(false);
    });

    it("treats a library that answered `false` as a refusal", async () => {
      verify.mockResolvedValue({ status: false });

      await expect(stepUp.satisfied(STALE, REQUEST, "wrong", NOW)).resolves.toBeNull();
    });

    it("treats a verification that could not be completed as not passed", async () => {
      // Fail closed. The one thing this must never do is let an exception on the slow path
      // read as a successful step-up.
      verify.mockRejectedValue(new TypeError("fetch failed"));

      await expect(stepUp.satisfied(STALE, REQUEST, "a-password", NOW)).resolves.toBeNull();
    });
  });
});
