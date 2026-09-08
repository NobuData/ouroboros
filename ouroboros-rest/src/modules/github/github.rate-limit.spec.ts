import { FIXTURE_NOW, FIXTURE_WORKSPACE, budgetHeaders } from "./github.fixture";
import { GITHUB_FAILURES, GithubApiError } from "./github.errors";
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  GithubRateLimiter,
  RATE_LIMIT_FLOOR,
  RETRY_AFTER_HEADER,
  type HeaderReader,
} from "./github.rate-limit";

/**
 * The acceptance criterion this file carries: *rate-limit backoff is verified against a
 * mocked 403 + `retry-after` response, and against a low `x-ratelimit-remaining` header.*
 * Both are here, and they are genuinely two mechanisms — a spent hourly budget and a
 * secondary limit are different refusals with different lifetimes, and a guard that
 * conflated them would let one clear the other.
 *
 * The rest is about the property the whole file exists for: **it refuses only on evidence.**
 * A guard with nothing recorded must permit, or a restart would take the product down; a
 * guard whose evidence has expired must permit, or a token would be stood down for an hour
 * after its window turned over.
 */

/** Headers as a reader, from a plain record. */
function reader(headers: Record<string, string>): HeaderReader {
  return (name) => headers[name.toLowerCase()];
}

/** `now` plus some seconds. */
function later(seconds: number): Date {
  return new Date(FIXTURE_NOW.getTime() + seconds * 1000);
}

describe("the GitHub rate guard", () => {
  let limiter: GithubRateLimiter;

  beforeEach(() => {
    limiter = new GithubRateLimiter();
  });

  describe("with nothing observed", () => {
    it("permits the call, because a guard that refuses without evidence is an outage", () => {
      expect(() => {
        limiter.assertMayCall(FIXTURE_WORKSPACE, FIXTURE_NOW);
      }).not.toThrow();
    });

    it("has nothing to report", () => {
      expect(limiter.snapshot(FIXTURE_WORKSPACE)).toBeUndefined();
      expect(limiter.retryAfterSeconds(FIXTURE_WORKSPACE, FIXTURE_NOW)).toBeUndefined();
    });
  });

  describe("reading the budget off a response", () => {
    it("records what the headers said", () => {
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader(budgetHeaders({ remaining: 4321, limit: 5000, resetAt: later(600) })),
        FIXTURE_NOW,
      );

      expect(limiter.snapshot(FIXTURE_WORKSPACE)).toMatchObject({
        remaining: 4321,
        limit: 5000,
        resetAt: later(600),
        observedAt: FIXTURE_NOW,
      });
    });

    it("ignores a response that carried no budget headers, rather than reading it as zero", () => {
      limiter.observe(FIXTURE_WORKSPACE, reader(budgetHeaders({ remaining: 900 })), FIXTURE_NOW);
      limiter.observe(FIXTURE_WORKSPACE, reader({}), FIXTURE_NOW);

      // A route that omits them has not refilled anything, and treating the absence as zero
      // would stand the poller down permanently the first time it met one.
      expect(limiter.snapshot(FIXTURE_WORKSPACE)?.remaining).toBe(900);
    });

    it("ignores a header that is not a whole number", () => {
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader({ "x-ratelimit-remaining": "lots", "x-ratelimit-reset": "soon" }),
        FIXTURE_NOW,
      );

      expect(limiter.snapshot(FIXTURE_WORKSPACE)).toBeUndefined();
    });
  });

  describe("a low x-ratelimit-remaining", () => {
    it("permits while there is more than the floor left", () => {
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader(budgetHeaders({ remaining: RATE_LIMIT_FLOOR + 1, resetAt: later(600) })),
        FIXTURE_NOW,
      );

      expect(() => {
        limiter.assertMayCall(FIXTURE_WORKSPACE, FIXTURE_NOW);
      }).not.toThrow();
    });

    it("refuses at the floor — before exhaustion, which is the whole point", () => {
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader(budgetHeaders({ remaining: RATE_LIMIT_FLOOR, resetAt: later(600) })),
        FIXTURE_NOW,
      );

      // Not zero: the requests still in the budget are the reserve an administrator's own
      // click spends while the poller stands down.
      expect(() => {
        limiter.assertMayCall(FIXTURE_WORKSPACE, FIXTURE_NOW);
      }).toThrow(GithubApiError);
    });

    it("says how long to wait — until the window resets", () => {
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader(budgetHeaders({ remaining: 0, resetAt: later(600) })),
        FIXTURE_NOW,
      );

      expect(limiter.retryAfterSeconds(FIXTURE_WORKSPACE, FIXTURE_NOW)).toBe(600);
    });

    it("carries the reason and the wait on the failure it throws", () => {
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader(budgetHeaders({ remaining: 3, resetAt: later(120) })),
        FIXTURE_NOW,
      );

      try {
        limiter.assertMayCall(FIXTURE_WORKSPACE, FIXTURE_NOW);
        throw new Error("expected the guard to refuse");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(GithubApiError);
        expect((error as GithubApiError).failure).toBe(GITHUB_FAILURES.rateLimited);
        expect((error as GithubApiError).retryAfterSeconds).toBe(120);
      }
    });

    it("permits again once the window has turned over", () => {
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader(budgetHeaders({ remaining: 0, resetAt: later(60) })),
        FIXTURE_NOW,
      );

      // The recorded `remaining` describes a window that no longer exists.
      expect(() => {
        limiter.assertMayCall(FIXTURE_WORKSPACE, later(61));
      }).not.toThrow();
    });
  });

  describe("a secondary limit — the 403 with retry-after", () => {
    it("stands down for as long as GitHub asked", () => {
      const seconds = limiter.pause(
        FIXTURE_WORKSPACE,
        reader({ [RETRY_AFTER_HEADER]: "30" }),
        FIXTURE_NOW,
      );

      expect(seconds).toBe(30);
      expect(limiter.retryAfterSeconds(FIXTURE_WORKSPACE, FIXTURE_NOW)).toBe(30);
      expect(() => {
        limiter.assertMayCall(FIXTURE_WORKSPACE, FIXTURE_NOW);
      }).toThrow(GithubApiError);
    });

    it("falls back to a default when GitHub named no retry-after", () => {
      expect(limiter.pause(FIXTURE_WORKSPACE, reader({}), FIXTURE_NOW)).toBe(
        DEFAULT_RETRY_AFTER_SECONDS,
      );
    });

    it("holds even though the hourly budget says there is plenty left", () => {
      // The case a guard that only watched `remaining` gets wrong: thousands remaining, and
      // every call being refused.
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader(budgetHeaders({ remaining: 4999, resetAt: later(3600) })),
        FIXTURE_NOW,
      );
      limiter.pause(FIXTURE_WORKSPACE, reader({ [RETRY_AFTER_HEADER]: "45" }), FIXTURE_NOW);

      expect(() => {
        limiter.assertMayCall(FIXTURE_WORKSPACE, FIXTURE_NOW);
      }).toThrow(GithubApiError);
    });

    it("is not cleared by the next ordinary response", () => {
      limiter.pause(FIXTURE_WORKSPACE, reader({ [RETRY_AFTER_HEADER]: "45" }), FIXTURE_NOW);
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader(budgetHeaders({ remaining: 4999, resetAt: later(3600) })),
        FIXTURE_NOW,
      );

      expect(limiter.retryAfterSeconds(FIXTURE_WORKSPACE, FIXTURE_NOW)).toBe(45);
    });

    it("expires by the clock rather than by being overwritten", () => {
      limiter.pause(FIXTURE_WORKSPACE, reader({ [RETRY_AFTER_HEADER]: "45" }), FIXTURE_NOW);

      expect(limiter.retryAfterSeconds(FIXTURE_WORKSPACE, later(46))).toBeUndefined();
    });

    it("rounds a part-second wait up, so a retry does not arrive a moment early", () => {
      limiter.pause(FIXTURE_WORKSPACE, reader({ [RETRY_AFTER_HEADER]: "10" }), FIXTURE_NOW);

      expect(
        limiter.retryAfterSeconds(FIXTURE_WORKSPACE, new Date(FIXTURE_NOW.getTime() + 500)),
      ).toBe(10);
    });
  });

  describe("when a token is replaced", () => {
    it("forgets the old token's window, so a fresh token starts with a full budget", () => {
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader(budgetHeaders({ remaining: 0, resetAt: later(3600) })),
        FIXTURE_NOW,
      );
      limiter.pause(FIXTURE_WORKSPACE, reader({ [RETRY_AFTER_HEADER]: "600" }), FIXTURE_NOW);

      limiter.forget(FIXTURE_WORKSPACE);

      expect(limiter.snapshot(FIXTURE_WORKSPACE)).toBeUndefined();
      expect(() => {
        limiter.assertMayCall(FIXTURE_WORKSPACE, FIXTURE_NOW);
      }).not.toThrow();
    });
  });

  describe("between workspaces", () => {
    it("keeps one workspace's exhaustion off another's calls", () => {
      limiter.observe(
        FIXTURE_WORKSPACE,
        reader(budgetHeaders({ remaining: 0, resetAt: later(3600) })),
        FIXTURE_NOW,
      );

      // The limit is per token and there is one token per workspace, so a second workspace
      // is a second budget.
      expect(() => {
        limiter.assertMayCall("org-other", FIXTURE_NOW);
      }).not.toThrow();
    });
  });
});
