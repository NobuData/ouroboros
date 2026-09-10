import {
  ESTIMATION_ATTEMPTS_PER_WINDOW,
  ESTIMATION_WINDOW_SECONDS,
  EstimationLimiter,
} from "./estimation.limiter";

/**
 * The per-workspace counter — L.4's *a per-org rate limit rejects a hammering caller with a
 * designed error* ([#108](https://github.com/NobuData/ouroboros/issues/108)).
 *
 * Every case drives the clock rather than waiting on one: the limiter takes `now` as an
 * argument for exactly that, and a suite that slept through a window would be a minute long and
 * flaky at the end of it.
 *
 * Three properties are the design rather than the implementation, and each has a case:
 *
 *   * **The bucket is the workspace**, so one member cannot spend another workspace's
 *     allowance and three members of one workspace share theirs — which is whose engine quota
 *     it is.
 *   * **A refused attempt is not counted.** A caller hammering a full window would otherwise
 *     push their own recovery away forever, turning a one-minute limit into an indefinite one.
 *   * **The window slides.** A fixed bucket admits twice the limit across a boundary, and the
 *     `retryAfterSeconds` a refusal owes a client falls out of the oldest attempt's age rather
 *     than out of a clock division.
 */

const ACME = "acme-robotics-id";
const OTHER = "kensuenobu-id";

/** The instant every case starts at. */
const START = new Date("2026-09-10T15:00:00.000Z");

/**
 * `START`, plus this many seconds.
 *
 * @param seconds - How far on.
 * @returns The instant.
 */
function at(seconds: number): Date {
  return new Date(START.getTime() + seconds * 1000);
}

/**
 * Fill a workspace's window.
 *
 * @param limiter - The limiter.
 * @param organizationId - Whose window.
 * @param now - When every attempt happens.
 */
function fill(limiter: EstimationLimiter, organizationId: string, now: Date = START): void {
  for (let attempt = 0; attempt < ESTIMATION_ATTEMPTS_PER_WINDOW; attempt += 1) {
    expect(limiter.attempt(organizationId, now)).toBeNull();
  }
}

describe("the limit itself", () => {
  it("is thirty attempts a minute — a person working fast, not a script", () => {
    // Pinned rather than derived, because it is a decision: mockup 03 offers *Re-estimate* one
    // issue at a time, so thirty is two people working through a backlog faster than they can
    // read it. A loop meets it on its second second.
    expect(ESTIMATION_ATTEMPTS_PER_WINDOW).toBe(30);
    expect(ESTIMATION_WINDOW_SECONDS).toBe(60);
  });
});

describe("counting a workspace's attempts", () => {
  let limiter: EstimationLimiter;

  beforeEach(() => {
    limiter = new EstimationLimiter();
  });

  it("admits attempts up to the limit", () => {
    fill(limiter, ACME);
  });

  it("refuses the one after, with a wait", () => {
    fill(limiter, ACME);

    expect(limiter.attempt(ACME, START)).toEqual({
      retryAfterSeconds: ESTIMATION_WINDOW_SECONDS,
    });
  });

  it("counts each workspace on its own, because the quota is the workspace's", () => {
    // One member of a busy workspace must not be able to lock out another workspace, and three
    // members of one workspace must share what that workspace is allowed to spend.
    fill(limiter, ACME);

    expect(limiter.attempt(ACME, START)).not.toBeNull();
    expect(limiter.attempt(OTHER, START)).toBeNull();
  });

  it("does not count a refused attempt", () => {
    // The property that keeps a one-minute limit one minute long: a caller hammering a full
    // window would otherwise keep pushing the oldest attempt forward and never recover.
    fill(limiter, ACME);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limiter.attempt(ACME, at(30))).toEqual({ retryAfterSeconds: 30 });
    }

    // The window still ends where the *first* thirty put it, not thirty attempts later.
    expect(limiter.attempt(ACME, at(60))).toBeNull();
  });

  it("counts down as the window passes", () => {
    fill(limiter, ACME);

    expect(limiter.attempt(ACME, at(14))).toEqual({ retryAfterSeconds: 46 });
  });

  it("rounds the wait up, so a client that waits exactly that long is not refused twice", () => {
    fill(limiter, ACME);

    expect(limiter.attempt(ACME, at(59.5))).toEqual({ retryAfterSeconds: 1 });
  });

  it("admits again the moment the oldest attempt leaves the window", () => {
    fill(limiter, ACME);

    expect(limiter.attempt(ACME, at(ESTIMATION_WINDOW_SECONDS))).toBeNull();
  });

  it("slides rather than resetting, so a full window frees one slot at a time", () => {
    // A fixed bucket would admit thirty more the instant the window turned over — twice the
    // limit across the boundary, which is the thing the sliding window exists to refuse.
    for (let attempt = 0; attempt < ESTIMATION_ATTEMPTS_PER_WINDOW; attempt += 1) {
      expect(limiter.attempt(ACME, at(attempt))).toBeNull();
    }

    // At +60 exactly one attempt (the one at 0) has aged out, so exactly one is admitted.
    expect(limiter.attempt(ACME, at(60))).toBeNull();
    expect(limiter.attempt(ACME, at(60))).not.toBeNull();
  });
});

describe("what the limiter holds", () => {
  it("forgets a workspace once its window empties", () => {
    // Swept on write rather than on a timer: a timer in a singleton is a handle that keeps a
    // process alive. Without the sweep this map would hold a bucket for every workspace that
    // ever asked, each long past being able to refuse anything.
    const limiter = new EstimationLimiter();

    limiter.attempt(ACME, START);
    expect(limiter.size()).toBe(1);

    limiter.attempt(OTHER, at(ESTIMATION_WINDOW_SECONDS + 1));

    expect(limiter.size()).toBe(1);
  });

  it("holds one entry per workspace, not one per attempt", () => {
    const limiter = new EstimationLimiter();

    fill(limiter, ACME);

    expect(limiter.size()).toBe(1);
  });
});
