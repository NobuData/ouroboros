import {
  REVEAL_ATTEMPTS_PER_CONNECTION,
  REVEAL_ATTEMPTS_PER_USER,
  REVEAL_WINDOW_MS,
  REVEAL_WINDOW_SECONDS,
  RevealLimiter,
} from "./reveal.limiter";

/**
 * How often a credential may be asked for.
 *
 * The two limits catch different things — one account walking the whole list, and several
 * accounts converging on one credential — so both are exercised, and so is the property that
 * makes them useful: a refused attempt is **not** counted, or a caller hammering a full
 * bucket would push its own recovery indefinitely into the future.
 */

const ALICE = "5eed0003-0000-4000-8000-000000000001";
const BOB = "5eed0003-0000-4000-8000-000000000002";
const ANTHROPIC = "5eed000c-0000-4000-8000-000000000001";
const OLLAMA = "5eed000c-0000-4000-8000-000000000005";

const START = new Date("2026-08-23T10:00:00.000Z");

/** An instant, in seconds after {@link START}. */
const at = (seconds: number): Date => new Date(START.getTime() + seconds * 1000);

describe("the reveal limiter", () => {
  let limiter: RevealLimiter;

  beforeEach(() => {
    limiter = new RevealLimiter();
  });

  it("admits an attempt when both buckets have room", () => {
    expect(limiter.attempt(ALICE, ANTHROPIC, START)).toBeNull();
  });

  describe("the per-connection limit", () => {
    it("admits exactly its limit and refuses the next", () => {
      for (let n = 0; n < REVEAL_ATTEMPTS_PER_CONNECTION; n += 1) {
        expect(limiter.attempt(ALICE, ANTHROPIC, at(n))).toBeNull();
      }

      expect(limiter.attempt(ALICE, ANTHROPIC, at(REVEAL_ATTEMPTS_PER_CONNECTION))).toEqual({
        scope: "connection",
        retryAfterSeconds: REVEAL_WINDOW_SECONDS - REVEAL_ATTEMPTS_PER_CONNECTION,
      });
    });

    it("catches several people converging on one credential", () => {
      // The case a per-user limit cannot see at all, and the reason there are two limits.
      const people = [ALICE, BOB, "c", "d", "e", "f"];

      const refusals = people.map((person) => limiter.attempt(person, ANTHROPIC, START));

      expect(refusals.slice(0, REVEAL_ATTEMPTS_PER_CONNECTION)).toEqual(
        Array<null>(REVEAL_ATTEMPTS_PER_CONNECTION).fill(null),
      );
      expect(refusals[REVEAL_ATTEMPTS_PER_CONNECTION]).toMatchObject({ scope: "connection" });
    });
  });

  describe("the per-user limit", () => {
    it("admits exactly its limit across different connections and refuses the next", () => {
      // One connection each so the per-connection bucket never fills: what is being measured
      // is the person, which is what an exfiltration looks like from the account's side.
      for (let n = 0; n < REVEAL_ATTEMPTS_PER_USER; n += 1) {
        expect(limiter.attempt(ALICE, `connection-${n.toString()}`, at(n))).toBeNull();
      }

      expect(limiter.attempt(ALICE, "one-more", at(REVEAL_ATTEMPTS_PER_USER))).toEqual({
        scope: "user",
        retryAfterSeconds: REVEAL_WINDOW_SECONDS - REVEAL_ATTEMPTS_PER_USER,
      });
    });

    it("does not refuse a second person because the first was busy", () => {
      for (let n = 0; n < REVEAL_ATTEMPTS_PER_USER; n += 1) {
        limiter.attempt(ALICE, `connection-${n.toString()}`, START);
      }

      expect(limiter.attempt(BOB, OLLAMA, START)).toBeNull();
    });
  });

  describe("what a refusal says", () => {
    it("names the bucket that filled, because the two have different remedies", () => {
      for (let n = 0; n < REVEAL_ATTEMPTS_PER_CONNECTION; n += 1) {
        limiter.attempt(ALICE, ANTHROPIC, START);
      }

      expect(limiter.attempt(ALICE, ANTHROPIC, START)?.scope).toBe("connection");
    });

    it("counts down as the oldest attempt ages out", () => {
      for (let n = 0; n < REVEAL_ATTEMPTS_PER_CONNECTION; n += 1) {
        limiter.attempt(ALICE, ANTHROPIC, START);
      }

      expect(limiter.attempt(ALICE, ANTHROPIC, at(60))?.retryAfterSeconds).toBe(
        REVEAL_WINDOW_SECONDS - 60,
      );
      expect(
        limiter.attempt(ALICE, ANTHROPIC, at(REVEAL_WINDOW_SECONDS - 1))?.retryAfterSeconds,
      ).toBe(1);
    });

    it("never recommends retrying immediately", () => {
      // Rounded up, because a client that retried at the exact boundary would be refused
      // again — and a refusal that recommends a moment that does not work is worse than no
      // recommendation at all.
      for (let n = 0; n < REVEAL_ATTEMPTS_PER_CONNECTION; n += 1) {
        limiter.attempt(ALICE, ANTHROPIC, START);
      }

      const refused = limiter.attempt(
        ALICE,
        ANTHROPIC,
        new Date(START.getTime() + REVEAL_WINDOW_MS - 1),
      );

      expect(refused?.retryAfterSeconds).toBe(1);
    });
  });

  describe("the window slides", () => {
    it("lets an attempt through once the oldest has left it", () => {
      for (let n = 0; n < REVEAL_ATTEMPTS_PER_CONNECTION; n += 1) {
        limiter.attempt(ALICE, ANTHROPIC, START);
      }
      expect(limiter.attempt(ALICE, ANTHROPIC, at(1))).not.toBeNull();

      expect(limiter.attempt(ALICE, ANTHROPIC, at(REVEAL_WINDOW_SECONDS))).toBeNull();
    });

    it("does not admit twice the limit across a boundary", () => {
      // The failure a fixed bucket has and a sliding window does not: five at 11:59:59 and
      // five more at 12:00:00 would be ten in one second.
      for (let n = 0; n < REVEAL_ATTEMPTS_PER_CONNECTION; n += 1) {
        limiter.attempt(ALICE, ANTHROPIC, at(REVEAL_WINDOW_SECONDS - 1));
      }

      expect(limiter.attempt(ALICE, ANTHROPIC, at(REVEAL_WINDOW_SECONDS))).toMatchObject({
        scope: "connection",
      });
    });
  });

  describe("what a refused attempt costs", () => {
    it("is not counted, so a full bucket still empties on time", () => {
      for (let n = 0; n < REVEAL_ATTEMPTS_PER_CONNECTION; n += 1) {
        limiter.attempt(ALICE, ANTHROPIC, START);
      }

      // Hammer it throughout the window. If refusals were recorded, the window would keep
      // being pushed forward and the limit would become an indefinite lockout.
      for (let second = 1; second < REVEAL_WINDOW_SECONDS; second += 1) {
        expect(limiter.attempt(ALICE, ANTHROPIC, at(second))).not.toBeNull();
      }

      expect(limiter.attempt(ALICE, ANTHROPIC, at(REVEAL_WINDOW_SECONDS))).toBeNull();
    });

    it("does not consume room in the other bucket either", () => {
      // Both buckets are pruned before either is judged, and nothing is recorded unless both
      // had room — so a connection-scoped refusal must not have spent one of Alice's ten.
      for (let n = 0; n < REVEAL_ATTEMPTS_PER_CONNECTION; n += 1) {
        limiter.attempt(ALICE, ANTHROPIC, START);
      }
      limiter.attempt(ALICE, ANTHROPIC, START);

      const remaining = REVEAL_ATTEMPTS_PER_USER - REVEAL_ATTEMPTS_PER_CONNECTION;
      for (let n = 0; n < remaining; n += 1) {
        expect(limiter.attempt(ALICE, `other-${n.toString()}`, START)).toBeNull();
      }
    });
  });

  describe("what it holds", () => {
    it("keeps one bucket per user and one per connection", () => {
      limiter.attempt(ALICE, ANTHROPIC, START);

      expect(limiter.size()).toBe(2);
    });

    it("forgets a bucket once its window has passed", () => {
      // Otherwise the map grows with everybody who has ever revealed a key in this process's
      // lifetime, which is a leak with a five-minute useful life.
      limiter.attempt(ALICE, ANTHROPIC, START);

      limiter.attempt(BOB, OLLAMA, at(REVEAL_WINDOW_SECONDS * 2));

      expect(limiter.size()).toBe(2);
    });

    it("cannot confuse a user id with a connection id", () => {
      // The namespaces are prefixed, so the same string in both roles is two buckets.
      const same = "5eed0000-0000-4000-8000-00000000000f";

      for (let n = 0; n < REVEAL_ATTEMPTS_PER_CONNECTION; n += 1) {
        limiter.attempt(same, same, START);
      }

      expect(limiter.attempt(same, same, START)).toMatchObject({ scope: "connection" });
      expect(limiter.attempt(same, "elsewhere", START)).toBeNull();
    });
  });
});
