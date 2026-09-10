import { deferred, drainMicrotasks } from "./estimation.fixture";
import { EstimationQueue } from "./estimation.queue";

/**
 * The bound, and the dedupe — L.3's two scheduling acceptance criteria
 * ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * Every assertion here is about *how many* and *which*, and none of them waits for anything:
 * the jobs are promises this file resolves by hand, so *"at most four at once"* is a count
 * rather than a race against a machine's speed. See `estimation.fixture.ts` on `deferred`.
 */

/** One job, and the handle to finish it. */
function job(issueId: string) {
  const gate = deferred<void>();
  const started = { count: 0 };

  return {
    gate,
    started,
    entry: {
      issueId,
      run: async () => {
        started.count += 1;
        return gate.promise;
      },
    },
  };
}

describe("bounded concurrency", () => {
  it("runs no more than the bound, however much is admitted", async () => {
    const queue = new EstimationQueue(2);
    const jobs = ["a", "b", "c", "d"].map((id) => job(id));

    for (const one of jobs) {
      queue.admit(one.entry);
    }

    await drainMicrotasks();

    expect(queue.active).toBe(2);
    expect(queue.depth).toBe(2);
    expect(jobs.map((one) => one.started.count)).toEqual([1, 1, 0, 0]);
  });

  it("starts the next one the moment a slot opens", async () => {
    const queue = new EstimationQueue(1);
    const [first, second] = [job("a"), job("b")];

    queue.admit(first.entry);
    queue.admit(second.entry);
    await drainMicrotasks();

    expect(second.started.count).toBe(0);

    first.gate.resolve();
    await drainMicrotasks();

    expect(second.started.count).toBe(1);
    expect(queue.active).toBe(1);
  });

  it("runs work in the order it arrived", async () => {
    const queue = new EstimationQueue(1);
    const order: string[] = [];

    for (const id of ["first", "second", "third"]) {
      queue.admit({
        issueId: id,
        run: async () => {
          order.push(id);
          return Promise.resolve();
        },
      });
    }

    await queue.settled();

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("treats a bound below one as one, rather than accepting work it never runs", async () => {
    // The configuration schema already refuses 0, so this is the second lock on the one
    // failure this class must not be able to have: a queue that admits and never starts.
    const queue = new EstimationQueue(0);
    const one = job("a");

    queue.admit(one.entry);
    await drainMicrotasks();

    expect(one.started.count).toBe(1);
  });
});

describe("de-duplication", () => {
  it("refuses an issue that is already waiting", () => {
    const queue = new EstimationQueue(1);

    expect(queue.admit(job("a").entry)).toBe(true);
    expect(queue.admit(job("b").entry)).toBe(true);
    // `b` is waiting behind `a`, and a second `b` would be a second estimate of one issue.
    expect(queue.admit(job("b").entry)).toBe(false);
    expect(queue.depth).toBe(1);
  });

  it("refuses an issue that is already running", async () => {
    const queue = new EstimationQueue(2);
    const running = job("a");

    queue.admit(running.entry);
    await drainMicrotasks();

    expect(queue.active).toBe(1);
    expect(queue.admit(job("a").entry)).toBe(false);
    expect(running.started.count).toBe(1);
  });

  it("says which issues it holds, in both states", async () => {
    const queue = new EstimationQueue(1);
    const running = job("running");

    queue.admit(running.entry);
    queue.admit(job("waiting").entry);
    await drainMicrotasks();

    expect(queue.holds("running")).toBe(true);
    expect(queue.holds("waiting")).toBe(true);
    expect(queue.holds("neither")).toBe(false);
  });

  it("accepts the same issue again once it has finished", async () => {
    // Not a duplicate: a re-estimate after an estimate is decision K4's whole shape — the next
    // version — and a queue that remembered forever would refuse the button on the panel.
    const queue = new EstimationQueue(1);
    const first = job("a");

    queue.admit(first.entry);
    await drainMicrotasks();
    first.gate.resolve();
    await queue.settled();

    expect(queue.holds("a")).toBe(false);
    expect(queue.admit(job("a").entry)).toBe(true);
  });
});

describe("settling", () => {
  it("resolves immediately when there is nothing to do", async () => {
    await expect(new EstimationQueue(2).settled()).resolves.toBeUndefined();
  });

  it("waits for everything, including what was still queued", async () => {
    const queue = new EstimationQueue(1);
    const done: string[] = [];

    for (const id of ["a", "b", "c"]) {
      queue.admit({
        issueId: id,
        run: async () => {
          done.push(id);
          return Promise.resolve();
        },
      });
    }

    await queue.settled();

    expect(done).toEqual(["a", "b", "c"]);
    expect(queue.idle).toBe(true);
  });

  it("resolves every waiter, not only the first", async () => {
    const queue = new EstimationQueue(1);
    const one = job("a");

    queue.admit(one.entry);
    const waiters = Promise.all([queue.settled(), queue.settled()]);
    one.gate.resolve();

    await expect(waiters).resolves.toEqual([undefined, undefined]);
  });
});

describe("a job that rejects", () => {
  it("gives its slot back, so a queue cannot shrink itself", async () => {
    // Jobs are documented not to reject — the orchestrator owns failure, because it owns the
    // status a failure implies. "Documented" is not "enforced", and a rejection that took its
    // slot with it would cost this process one unit of capacity for the rest of its life.
    const queue = new EstimationQueue(1);
    const after = job("after");

    queue.admit({ issueId: "boom", run: async () => Promise.reject(new Error("nope")) });
    queue.admit(after.entry);
    await drainMicrotasks();

    expect(after.started.count).toBe(1);
    expect(queue.holds("boom")).toBe(false);
  });

  it("still settles the waiters", async () => {
    const queue = new EstimationQueue(1);

    queue.admit({ issueId: "boom", run: async () => Promise.reject(new Error("nope")) });

    await expect(queue.settled()).resolves.toBeUndefined();
  });
});
