import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { POLL_AFTER_HEADER } from "@/app/poll";

import { clientAnswering, stubClient } from "../helpers/api";
import { emptyFarm, seededFarm } from "../helpers/farm";

// The facade sits on the server-side client — see `server.test.ts`.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { farm } = await import("@/app/api/farm");

/**
 * The build farm page's share of AH.6's contract (#254, consumed by #256): one read, the page in
 * one observation, and the cadence hint it comes with.
 */

describe("farm.page", () => {
  it("reads the farm endpoint and hands back the payload as served", async () => {
    const { client, requests } = clientAnswering(seededFarm());

    const page = await farm.page(client);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/farm");
    expect(page).toEqual(seededFarm());
  });

  it("names no workspace, because the workspace is the session's", async () => {
    const { client, requests } = clientAnswering(seededFarm());

    await farm.page(client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("keeps an empty organization's nulls as nulls, and its zeros as zeros", async () => {
    // The distinction is the contract's and load-bearing: a zero invented on the way through
    // would reach the glass as `0m 00s` or `0%`.
    const { client } = clientAnswering(emptyFarm());

    const { stats } = await farm.page(client);

    expect(stats.runnersOnline).toMatchObject({ online: 0, total: 0, note: null });
    expect(stats.buildsToday.total).toBe(0);
    expect(stats.avgBuildTime.seconds).toBeNull();
    expect(stats.avgBuildTime.deltaVsLastWeek).toBeNull();
    expect(stats.cacheHitRate.pct).toBeNull();
  });

  it("rejects with the service's envelope when it refuses", async () => {
    const { client } = clientAnswering(
      { code: "organization_required", message: "Choose a workspace.", details: {} },
      400,
    );

    const failure: unknown = await farm.page(client).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("organization_required");
  });
});

describe("farm.observe", () => {
  it("reads the cadence the service asked for beside the page", async () => {
    const { client } = stubClient(() => ({ body: seededFarm(), headers: { [POLL_AFTER_HEADER]: "10" } }));

    await expect(farm.observe(client)).resolves.toEqual({ page: seededFarm(), pollAfterSeconds: 10 });
  });

  it("answers no cadence when the service sent none, rather than inventing one", async () => {
    const { client } = clientAnswering(seededFarm());

    await expect(farm.observe(client)).resolves.toMatchObject({ pollAfterSeconds: null });
  });

  it("treats a hint it cannot use as no hint", async () => {
    const { client } = stubClient(() => ({ body: seededFarm(), headers: { [POLL_AFTER_HEADER]: "soon" } }));

    await expect(farm.observe(client)).resolves.toMatchObject({ pollAfterSeconds: null });
  });

  it("hands the wire the caller's deadline", async () => {
    const { client, requests } = clientAnswering(seededFarm());
    const controller = new AbortController();

    await farm.observe(client, controller.signal);
    controller.abort();

    expect(requests[0]?.signal.aborted).toBe(true);
  });
});
