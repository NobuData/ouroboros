import { causeOf, codeOf, describeForLog, failureCode } from "./failure";

/**
 * Reading a thrown thing, and writing it down for an operator.
 *
 * These were the readiness probe's assertions until the engine gateway
 * ([#35](https://github.com/NobuData/ouroboros/issues/35)) needed the same reading — a
 * `fetch` failure is a `TypeError` whose `cause` carries the real diagnosis, and both the
 * probe and the gateway have to look through that wrapper. What is asserted here is the
 * reading; what each caller is allowed to *say* is asserted beside that caller.
 */

/** The error `pg` raises, and the shape `fetch` wraps a connect failure in. */
function connectionRefused(): Error & { code: string } {
  return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
    code: "ECONNREFUSED",
  });
}

/** What undici rejects with when nothing is listening: the wrapper, and the real failure. */
function fetchRefused(): TypeError {
  return new TypeError("fetch failed", { cause: connectionRefused() });
}

describe("causeOf", () => {
  it("hands back the cause `fetch` hides the real failure in", () => {
    expect(causeOf(fetchRefused())).toMatchObject({ code: "ECONNREFUSED" });
  });

  it("has nothing to say about an error that carries none", () => {
    expect(causeOf(new Error("plain"))).toBeUndefined();
  });

  it("survives a throw that was not an object at all", () => {
    expect(causeOf("just a string")).toBeUndefined();
    expect(causeOf(null)).toBeUndefined();
  });
});

describe("codeOf", () => {
  it("reads the symbolic code a driver hangs on a failure", () => {
    expect(codeOf(connectionRefused())).toBe("ECONNREFUSED");
  });

  it("refuses a code that is not a string, because a caller will print it", () => {
    expect(codeOf({ code: 500 })).toBeUndefined();
  });

  it.each([
    ["no code at all", {}],
    ["not an object", "ECONNREFUSED"],
    ["nothing", undefined],
  ])("has nothing to say about %s", (_description, candidate) => {
    expect(codeOf(candidate)).toBeUndefined();
  });
});

describe("failureCode", () => {
  it("reads the code off the error itself", () => {
    expect(failureCode(connectionRefused())).toBe("ECONNREFUSED");
  });

  it("looks through the wrapper `fetch` reports a network failure in", () => {
    // The reason this function exists: without it every transport failure in the process
    // reads as an uncoded `TypeError`, and neither the probe nor the gateway could tell
    // "nothing is listening" from "the name does not resolve".
    expect(failureCode(fetchRefused())).toBe("ECONNREFUSED");
  });

  it("prefers the error's own code to its cause's", () => {
    const wrapped = Object.assign(new TypeError("outer"), {
      code: "OUTER",
      cause: connectionRefused(),
    });

    expect(failureCode(wrapped)).toBe("OUTER");
  });

  it("has nothing to say when neither carries one", () => {
    expect(failureCode(new TypeError("fetch failed", { cause: new Error("why") }))).toBeUndefined();
  });

  it("does not filter what it finds — that is the publishing caller's job", () => {
    // `health/probe.ts` requires a short uppercase token before a code reaches an
    // unauthenticated body. This function is also read by the log, where the whole string
    // is exactly what an operator wants, so the filtering is not here.
    expect(failureCode({ code: "connect ECONNREFUSED 10.0.0.4:5432" })).toBe(
      "connect ECONNREFUSED 10.0.0.4:5432",
    );
  });
});

describe("describeForLog", () => {
  it("keeps the stack, which is the whole point of a server-side record", () => {
    const described = describeForLog(connectionRefused());

    expect(described).toContain("connect ECONNREFUSED 127.0.0.1:5432");
    expect(described.split("\n").length).toBeGreaterThan(1);
  });

  it("falls back to the name and the message when there is no stack", () => {
    const stackless = new Error("no stack here");
    stackless.stack = undefined;

    expect(describeForLog(stackless)).toBe("Error: no stack here");
  });

  it("renders whatever was thrown, because a throw is not obliged to throw an Error", () => {
    expect(describeForLog("just a string")).toBe("just a string");
    expect(describeForLog(undefined)).toBe("undefined");
  });

  it("follows the cause, which is the only place `fetch` puts the real failure", () => {
    // Without this the log for an unreachable engine reads "TypeError: fetch failed" and
    // stops — the operator's half of the diagnosis is the cause, and `Error.stack` omits it.
    const described = describeForLog(fetchRefused());

    expect(described).toContain("fetch failed");
    expect(described).toContain("caused by");
    expect(described).toContain("connect ECONNREFUSED 127.0.0.1:5432");
  });

  it("stops following causes, so a cycle cannot become a stack overflow", () => {
    const looping = new Error("round and round");
    Object.assign(looping, { cause: looping });

    // The assertion is that it returns at all. A cause chain is data from a library, and a
    // library that hands back a cycle must not take the process with it.
    expect(() => describeForLog(looping)).not.toThrow();
    expect(describeForLog(looping).split("caused by").length - 1).toBe(3);
  });
});
