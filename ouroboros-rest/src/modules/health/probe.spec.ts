import { PROBE_TIMEOUT_MS, ProbeTimeoutError, describeFailure, withTimeout } from "./probe";
import { connectionRefused, fetchRefused, fetchTimedOut } from "./probe.fixture";

/**
 * The two rules every probe obeys: it is bounded, and it does not narrate.
 *
 * The second one is the reason this file is longer than the code it covers. `/health/ready`
 * answers without authentication, so what may appear in its body is a security property
 * rather than a formatting preference — and the assertions that a host, a port and a
 * connection string never reach it are the ones that have to fail when someone decides a
 * driver's own message would be more helpful.
 */

describe("withTimeout", () => {
  it("hands back what the probe answered, when it answered in time", async () => {
    await expect(withTimeout(Promise.resolve("answered"), 1000)).resolves.toBe("answered");
  });

  it("hands back the probe's own failure, unchanged", async () => {
    const refused = connectionRefused();

    await expect(withTimeout(Promise.reject(refused), 1000)).rejects.toBe(refused);
  });

  it("gives up when the probe does not answer", async () => {
    const never = new Promise<void>(() => undefined);

    await expect(withTimeout(never, 1)).rejects.toThrow(ProbeTimeoutError);
  });

  it("names the deadline it gave up on", async () => {
    const never = new Promise<void>(() => undefined);

    await expect(withTimeout(never, 5)).rejects.toThrow("gave up after 5 ms");
  });

  it("defaults to the probe deadline the module publishes", () => {
    // Asserted rather than assumed: the pool's timeouts, the fetch abort and this default
    // are one number, and a probe with three different deadlines has none.
    expect(PROBE_TIMEOUT_MS).toBe(2000);
  });

  it("leaves no timer behind when the probe wins the race", async () => {
    // A stray two-second timer per poll is a probe that keeps the event loop busy for as
    // long as the process runs — and a test runner that hangs after its last assertion.
    // Counted rather than trusted, because `clearTimeout` in a `finally` is exactly the
    // line a refactor drops.
    jest.useFakeTimers();

    try {
      await withTimeout(Promise.resolve("answered"));

      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("describeFailure", () => {
  it("says the probe timed out, and how long it waited", () => {
    expect(describeFailure(new ProbeTimeoutError(PROBE_TIMEOUT_MS))).toBe(
      `timed out after ${PROBE_TIMEOUT_MS} ms`,
    );
  });

  it("recognises the runtime's own abort as a timeout", () => {
    expect(describeFailure(fetchTimedOut())).toBe(`timed out after ${PROBE_TIMEOUT_MS} ms`);
  });

  it("publishes the driver's code, which is the actionable half", () => {
    expect(describeFailure(connectionRefused())).toBe("failed (ECONNREFUSED)");
  });

  it("looks through the wrapper `fetch` reports a network failure in", () => {
    expect(describeFailure(fetchRefused())).toBe("failed (ECONNREFUSED)");
  });

  it("publishes a SQLSTATE, which names a rejected login without describing it", () => {
    const rejected = Object.assign(new Error('password authentication failed for user "app"'), {
      code: "28P01",
    });

    expect(describeFailure(rejected)).toBe("failed (28P01)");
  });

  it("says only that it failed, when there is no code", () => {
    expect(describeFailure(new Error("timeout exceeded when trying to connect"))).toBe("failed");
  });

  it.each([
    ["a message dressed as a code", { code: "connect ECONNREFUSED 10.0.0.4:5432" }],
    ["a code that is not a string", { code: 500 }],
    ["a code that is too long to be one", { code: "A".repeat(33) }],
    ["a lower-case code", { code: "econnrefused" }],
    ["no code at all", {}],
    ["not an object", "ECONNREFUSED"],
    ["nothing", undefined],
  ])("suppresses %s", (_description, error) => {
    expect(describeFailure(error)).toBe("failed");
  });

  it.each([
    ["the host and port it could not reach", connectionRefused()],
    ["the wrapper's own text", fetchRefused()],
  ])("never echoes %s", (_description, error) => {
    const described = describeFailure(error);

    expect(described).not.toContain("127.0.0.1");
    expect(described).not.toContain("5432");
    expect(described).not.toContain("fetch failed");
  });
});
