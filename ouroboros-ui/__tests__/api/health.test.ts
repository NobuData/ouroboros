import { describe, expect, it, vi } from "vitest";

import { healthReport } from "../helpers/dashboard";

// The module is server-only for the reason every reader of `OURO_REST_URL` is. Nothing here
// reaches the environment — every case passes its own base URL — but the import needs the
// marker module to resolve.
vi.mock("server-only", () => ({}));

const { READINESS_PATH, READINESS_TIMEOUT_MS, dependency, isHealthReport, readReadiness } =
  await import("@/app/api/health");

/**
 * The readiness probe, which is the one read on the dashboard that does not go through the
 * typed client.
 *
 * Two properties are what that decision buys, and they are what this suite is for:
 *
 * 1. **A `503` is an answer.** The contract has the probe reply `503` carrying the *same*
 *    body as a `200` — it is the response that names which dependency is down — so a reader
 *    that treated the status as the outcome would discard the only thing the card needs.
 * 2. **Nothing it can meet throws.** Its one caller draws a pill either way, and every
 *    failure it can hit means the same thing to that pill.
 */

const BASE = "http://rest.test:4000";

/** A stub `fetch` answering once with a body and a status, recording what it was asked. */
function stub(body: unknown, status = 200) {
  const calls: [string, RequestInit | undefined][] = [];

  return {
    calls,
    fetcher: (input: string, init?: RequestInit) => {
      calls.push([input, init]);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  };
}

describe("readReadiness", () => {
  it("asks the probe at the path the contract publishes", async () => {
    const { calls, fetcher } = stub(healthReport());

    await readReadiness(fetcher, BASE);

    expect(calls[0]?.[0]).toBe(`${BASE}${READINESS_PATH}`);
    expect(READINESS_PATH).toBe("/health/ready");
  });

  it("returns the report a healthy service answers with", async () => {
    const report = healthReport();
    const { fetcher } = stub(report);

    expect(await readReadiness(fetcher, BASE)).toEqual(report);
  });

  it("returns the body of a 503 too, because that is the answer and not the failure", async () => {
    // The whole reason this module exists rather than one more line over the typed client:
    // the client's middleware would turn this into a thrown `client_unreadable_error` and
    // the card would learn nothing about which dependency is down.
    const report = healthReport({
      database: { status: "down", message: "SELECT 1 failed (ECONNREFUSED)" },
      engine: { status: "up" },
    });
    const { fetcher } = stub(report, 503);

    expect(await readReadiness(fetcher, BASE)).toEqual(report);
  });

  it("never caches, because a status pill is a claim about this moment", async () => {
    const { calls, fetcher } = stub(healthReport());

    await readReadiness(fetcher, BASE);

    expect(calls[0]?.[1]?.cache).toBe("no-store");
  });

  it("bounds its own wait, so a hung service does not hang the page", async () => {
    const { calls, fetcher } = stub(healthReport());

    await readReadiness(fetcher, BASE);

    expect(calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    // Longer than the two seconds the service bounds each of its own checks at, so a
    // timeout here means the service is not answering rather than that it is still waiting
    // on Postgres — which is a `503` with a message the card should render.
    expect(READINESS_TIMEOUT_MS).toBeGreaterThan(2_000);
  });

  it("answers null when the service cannot be reached at all", async () => {
    const failing = () => Promise.reject(new TypeError("fetch failed"));

    expect(await readReadiness(failing, BASE)).toBeNull();
  });

  it("answers null when the wait is aborted", async () => {
    const aborting = () => Promise.reject(new DOMException("timed out", "TimeoutError"));

    expect(await readReadiness(aborting, BASE)).toBeNull();
  });

  it("answers null when something that is not the probe replies on that URL", async () => {
    // A proxy, a captive portal or a base URL pointing at the wrong service can all reply
    // `200` with something else entirely, and none of them are evidence about a database.
    const { fetcher } = stub({ hello: "world" });

    expect(await readReadiness(fetcher, BASE)).toBeNull();
  });

  it("answers null when the body is not JSON at all", async () => {
    const html = () => Promise.resolve(new Response("<html>502 Bad Gateway</html>"));

    expect(await readReadiness(html, BASE)).toBeNull();
  });

  it("forwards no credentials, because the route answers without authentication", async () => {
    // There is no session cookie to forward and no workspace header to set. Sending either
    // to an unauthenticated route would be spending a credential for nothing.
    const { calls, fetcher } = stub(healthReport());

    await readReadiness(fetcher, BASE);

    expect(calls[0]?.[1]?.headers).toBeUndefined();
  });
});

describe("isHealthReport", () => {
  it("accepts what the contract describes", () => {
    expect(isHealthReport(healthReport())).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "ok"],
    ["an array", []],
    ["an error envelope", { code: "internal_error", message: "…", details: {} }],
    ["a report with no details map", { status: "ok", info: {}, error: {} }],
  ])("rejects %s", (_name, value) => {
    expect(isHealthReport(value)).toBe(false);
  });
});

describe("dependency", () => {
  it("reads from `details`, which holds every dependency whatever it reported", () => {
    // `info` and `error` are the same rows partitioned, so a reader that consulted one of
    // them would have to consult the other to learn nothing new.
    const report = healthReport({
      database: { status: "down", message: "SELECT 1 timed out after 2000 ms" },
      engine: { status: "up" },
    });

    expect(dependency(report, "database")?.status).toBe("down");
    expect(dependency(report, "database")?.message).toBe("SELECT 1 timed out after 2000 ms");
    expect(dependency(report, "engine")?.status).toBe("up");
  });

  it("answers undefined for a dependency the report does not name", () => {
    expect(dependency(healthReport(), "redis")).toBeUndefined();
  });

  it("answers undefined when there is no report, which is the same kind of nothing", () => {
    // A dependency the service has stopped reporting on is as unknown as one nobody could
    // ask about, and the card draws both the same way.
    expect(dependency(null, "database")).toBeUndefined();
  });
});
