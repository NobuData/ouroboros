import { FAKE_FAILURES } from "../providers/adapters/fake.adapter.fixture";
import { CONNECTED_PILL, PROVIDER_ERROR_PILLS } from "../providers/provider.errors";
import { testResource } from "./connection-test";

/**
 * The card foot's answer ([#230](https://github.com/NobuData/ouroboros/issues/230), decision
 * **P9**) — a validation composed for the card, through the taxonomy rather than by
 * special-casing. The fake's recorded failures are the phrases a card will actually print.
 */

const CONNECTION = "5eed000c-0000-4000-8000-000000000003";
const AT = new Date("2026-08-25T10:00:00.000Z");

describe("a test that passed", () => {
  const resource = testResource(CONNECTION, { status: "ok", latencyMs: 38, detail: "200" }, AT);

  it("is `connected`, active, and carries the measured latency for the `· 38ms`", () => {
    expect(resource).toEqual({
      connectionId: CONNECTION,
      checkedAt: "2026-08-25T10:00:00.000Z",
      status: "active",
      pill: CONNECTED_PILL,
      note: "200",
      latencyMs: 38,
      errorClass: null,
      retryable: false,
      detail: "200",
    });
  });

  it("keeps the adapter's detail whole, seats and all", () => {
    expect(
      testResource(CONNECTION, { status: "ok", latencyMs: 12, detail: "200 · 4 seats" }, AT).note,
    ).toBe("200 · 4 seats");
  });
});

describe("a test that failed", () => {
  it("draws mockup 07's Copilot foot: degraded upstream, `503 upstream · retrying`, no latency", () => {
    const resource = testResource(CONNECTION, FAKE_FAILURES.upstream, AT);

    expect(resource).toMatchObject({
      status: "error",
      pill: PROVIDER_ERROR_PILLS.upstream,
      note: `${FAKE_FAILURES.upstream.detail} · retrying`,
      latencyMs: null,
      errorClass: "upstream",
      retryable: true,
      detail: FAKE_FAILURES.upstream.detail,
    });
  });

  it("says nothing about retrying a refused key, because a retry can only waste time", () => {
    const resource = testResource(CONNECTION, FAKE_FAILURES.auth, AT);

    expect(resource).toMatchObject({
      status: "error",
      pill: PROVIDER_ERROR_PILLS.auth,
      note: FAKE_FAILURES.auth.detail,
      retryable: false,
      errorClass: "auth",
    });
    expect(resource.note).not.toContain("retrying");
  });

  it.each(["network", "rate_limit"] as const)("marks %s retryable, as the taxonomy does", (cls) => {
    expect(testResource(CONNECTION, FAKE_FAILURES[cls], AT)).toMatchObject({
      retryable: true,
      errorClass: cls,
      latencyMs: null,
    });
  });

  it("coarsens every class to the column's `error` — the pill is the finer instrument", () => {
    for (const failure of Object.values(FAKE_FAILURES)) {
      expect(testResource(CONNECTION, failure, AT).status).toBe("error");
    }
  });
});
