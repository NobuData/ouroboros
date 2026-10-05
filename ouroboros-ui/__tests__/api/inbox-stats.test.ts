import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_STATS } from "@/app/inbox/stats-view";

import { STUB_BASE_URL, stubClient } from "../helpers/api";
import { coldStats, inboxStats } from "../helpers/inbox";

/**
 * The week's stat card (#470): the service read behind it, the read the `/inbox` page's poll is
 * answered from, and the two early wakes — one item and all of them.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { inbox } = await import("@/app/api/inbox");
const { INBOX_STATS_UNAVAILABLE_CODE, readInboxStats } = await import("@/app/api/inbox-stats");

/** A client answering each path with its own body. */
function service(answers: Readonly<Record<string, { body: unknown; status?: number }>>) {
  return stubClient(
    (request) => answers[new URL(request.url).pathname] ?? { body: { code: "not_found" }, status: 404 },
  );
}

describe("the service reads", () => {
  it("reads this week's figures", async () => {
    const { client, requests } = service({ "/api/v1/inbox/stats": { body: inboxStats() } });

    expect(await inbox.stats(client)).toEqual(inboxStats());
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${STUB_BASE_URL}/api/v1/inbox/stats`,
    ]);
  });

  it("passes a cold week's nulls and em dashes through untouched", async () => {
    const { client } = service({ "/api/v1/inbox/stats": { body: coldStats() } });

    expect(await inbox.stats(client)).toEqual(coldStats());
  });

  it("refuses with the service's error", async () => {
    const { client } = service({ "/api/v1/inbox/stats": { body: { code: "internal", message: "No." }, status: 500 } });

    await expect(inbox.stats(client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("the early wakes", () => {
  it("wakes one item at its own path, with no body", async () => {
    const { client, requests } = service({
      "/api/v1/inbox/items/item-1/unsnooze": { body: { unsnoozed: ["item-1"] } },
    });

    expect(await inbox.unsnooze("item-1", client)).toEqual({ unsnoozed: ["item-1"] });
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST ${STUB_BASE_URL}/api/v1/inbox/items/item-1/unsnooze`,
    ]);
  });

  it("wakes them all", async () => {
    const { client, requests } = service({ "/api/v1/inbox/unsnooze-all": { body: { unsnoozed: ["a", "b"] } } });

    expect(await inbox.unsnoozeAll(client)).toEqual({ unsnoozed: ["a", "b"] });
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST ${STUB_BASE_URL}/api/v1/inbox/unsnooze-all`,
    ]);
  });

  it("refuses a viewer with the service's sentence", async () => {
    const { client } = service({
      "/api/v1/inbox/items/item-1/unsnooze": { body: { code: "forbidden", message: "Viewers may not." }, status: 403 },
    });

    await expect(inbox.unsnooze("item-1", client)).rejects.toMatchObject({ status: 403, message: "Viewers may not." });
  });
});

describe("readInboxStats", () => {
  it("reads with a deadline, and answers the week", async () => {
    const read = vi.fn().mockResolvedValue(inboxStats());

    const answer = await readInboxStats(read);

    expect(read.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({ state: "fresh", payload: inboxStats(), etag: null, pollAfterSeconds: null });
  });

  it("reads a 401 as gone and a dropped read as unreachable", async () => {
    expect(await readInboxStats(vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(await readInboxStats(vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_STATS,
      pollAfterSeconds: null,
    });
  });

  it("reports under this hop's own code", () => {
    expect(INBOX_STATS_UNAVAILABLE_CODE).toBe("inbox_stats_unavailable");
  });
});
