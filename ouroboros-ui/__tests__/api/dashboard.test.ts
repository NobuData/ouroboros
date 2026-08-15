import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { Dashboard } from "@/app/api/dashboard";

import { clientAnswering } from "../helpers/api";
import { dashboardPayload, emptyDashboard } from "../helpers/dashboard";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { ORGANIZATION_REQUIRED_CODE, dashboard } = await import("@/app/api/dashboard");

/**
 * The dashboard aggregate.
 *
 * The operation is one `GET` with no parameters, so most of what is worth holding is about
 * what this module does *not* do: it names no workspace (the session's active organization
 * is the scope), it sends no `If-None-Match` (polling is #87's), and it hands back the body
 * whole rather than picking pieces out of it — eight cards read this payload and a reader
 * that narrowed it would have to be widened by every one of them.
 */

/** The one refusal a screen behind the gate can still meet: a session acting nowhere. */
const NO_ORGANIZATION = {
  code: ORGANIZATION_REQUIRED_CODE,
  message: "Choose a workspace before opening the dashboard.",
  details: {},
};

describe("dashboard.read", () => {
  it("calls the aggregate and returns the body itself", async () => {
    const { client, requests } = clientAnswering(dashboardPayload());

    const payload = await dashboard.read(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/dashboard");
    expect(requests[0]?.method).toBe("GET");
    expect(payload).toEqual(dashboardPayload());
  });

  it("paints the page in one round trip rather than one per card", async () => {
    // Decision F5: the mockup is a single glance-view, and eight cards issuing eight
    // requests would paint eight times.
    const { client, requests } = clientAnswering(dashboardPayload());

    await dashboard.read(client);

    expect(requests).toHaveLength(1);
  });

  it("names no workspace, because the session's active organization is the scope", async () => {
    // There is no workspace in this path and this application sends no `X-Ouro-Tenant`
    // override (`app/api/server.ts`). A header here would be a second opinion about tenancy.
    const { client, requests } = clientAnswering(dashboardPayload());

    await dashboard.read(client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
    expect(new URL(requests[0]!.url).search).toBe("");
  });

  it("sends no conditional header, because the first read has no tag to send", async () => {
    // The `ETag` loop is #87's: a hook with a timer, a stored tag and a browser to run in.
    const { client, requests } = clientAnswering(dashboardPayload());

    await dashboard.read(client);

    expect(requests[0]?.headers.get("If-None-Match")).toBeNull();
  });

  it("returns an empty organization's zeros rather than treating them as absent", async () => {
    // Every field is always present — that is the contract's guarantee, and it is what lets
    // a card render an empty workspace without a fallback branch.
    const { client } = clientAnswering(emptyDashboard());

    const payload = await dashboard.read(client);

    expect(payload.activity).toEqual({ inFlight: 0, queued: 0, mergedSinceMorning: 0 });
    expect(payload.stats.loopsLive.total).toBe(0);
    expect(payload.activeRuns).toEqual([]);
  });

  it("rejects with `organization_required` for a session acting in no workspace", async () => {
    // The first operation in the contract that can answer this code: every other
    // workspace-scoped operation names one in its path.
    const { client } = clientAnswering(NO_ORGANIZATION, 400);

    const caught: unknown = await dashboard.read(client).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe(ORGANIZATION_REQUIRED_CODE);
    expect((caught as ApiError).status).toBe(400);
  });

  it("carries a message written for a person, naming nothing about the service", async () => {
    // It reaches the page head as the subline, so it is read by whoever opened the page.
    const { client } = clientAnswering(NO_ORGANIZATION, 400);

    const caught = (await dashboard.read(client).catch((e: unknown) => e)) as ApiError;

    expect(caught.message).toBe(NO_ORGANIZATION.message);
    expect(caught.message).not.toMatch(/http|:\d{2,5}|ECONN|select /i);
  });

  it("does not read a refusal as a signed-out session", async () => {
    // A `400` is this request being wrong, not this person being unknown — and reading it
    // as the latter would send somebody with a perfectly good session to the login screen.
    const { client } = clientAnswering(NO_ORGANIZATION, 400);

    const caught = (await dashboard.read(client).catch((e: unknown) => e)) as ApiError;

    expect(caught.isUnauthenticated).toBe(false);
  });
});

describe("the typing, which is the reason the client is generated", () => {
  it("types the payload end to end", async () => {
    const { client } = clientAnswering(dashboardPayload());

    const payload: Dashboard = await dashboard.read(client);

    expect(payload.activity.inFlight).toBe(3);
    expect(payload.pulse.mergeRate).toBe(0.92);
    expect(payload.stats.queued.estMinutes).toBe(580);
  });

  it("holds the activity to the three fields the page head composes from", () => {
    // A fourth would be a sentence nobody wrote; a missing one is a compile error in
    // `app/dashboard/view.ts` rather than an `undefined` printed in the page head.
    const payload = dashboardPayload();

    expect(Object.keys(payload.activity).sort()).toEqual([
      "inFlight",
      "mergedSinceMorning",
      "queued",
    ]);
  });
});
