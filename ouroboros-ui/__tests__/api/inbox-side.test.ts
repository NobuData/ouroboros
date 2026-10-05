import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { UNREACHABLE_SIDE } from "@/app/inbox/side-view";

import { STUB_BASE_URL, stubClient } from "../helpers/api";
import { inboxSide, seededChannels, seededPolicyCard } from "../helpers/inbox";

/**
 * The inbox's side column (#469): the two service reads behind it, and the read the `/inbox` page's
 * poll is answered from — the rest is `poll-read.ts`'s.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { inbox } = await import("@/app/api/inbox");
const { INBOX_SIDE_UNAVAILABLE_CODE, readInboxSide } = await import("@/app/api/inbox-side");

/** A client answering each path with its own body. */
function service(answers: Readonly<Record<string, { body: unknown; status?: number }>>) {
  return stubClient(
    (request) => answers[new URL(request.url).pathname] ?? { body: { code: "not_found" }, status: 404 },
  );
}

describe("the service reads", () => {
  it("reads the channels' truth", async () => {
    const { client, requests } = service({ "/api/v1/inbox/channels": { body: seededChannels() } });

    expect(await inbox.channels(client)).toEqual(seededChannels());
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${STUB_BASE_URL}/api/v1/inbox/channels`,
    ]);
  });

  it("reads the policy card", async () => {
    const { client, requests } = service({ "/api/v1/inbox/policies": { body: seededPolicyCard() } });

    expect(await inbox.policies(client)).toEqual(seededPolicyCard());
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${STUB_BASE_URL}/api/v1/inbox/policies`,
    ]);
  });

  it("reads both for the side column, each from its own route", async () => {
    const { client, requests } = service({
      "/api/v1/inbox/channels": { body: seededChannels() },
      "/api/v1/inbox/policies": { body: seededPolicyCard() },
    });

    expect(await inbox.side(client)).toEqual(inboxSide());
    expect(requests.map((request) => new URL(request.url).pathname).sort()).toEqual([
      "/api/v1/inbox/channels",
      "/api/v1/inbox/policies",
    ]);
  });

  it("answers nothing when either half is refused — half a column is not the column", async () => {
    const { client } = service({
      "/api/v1/inbox/channels": { body: seededChannels() },
      "/api/v1/inbox/policies": { body: { code: "forbidden", message: "No." }, status: 403 },
    });

    await expect(inbox.side(client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("readInboxSide", () => {
  it("reads with a deadline, and answers both cards", async () => {
    const read = vi.fn().mockResolvedValue(inboxSide());

    const answer = await readInboxSide(read);

    expect(read.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
    expect(answer).toEqual({ state: "fresh", payload: inboxSide(), etag: null, pollAfterSeconds: null });
  });

  it("reads a 401 as gone and a dropped read as unreachable", async () => {
    expect(await readInboxSide(vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated", "Sign in.")))).toEqual({
      state: "gone",
    });
    expect(await readInboxSide(vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_SIDE,
      pollAfterSeconds: null,
    });
  });

  it("reports under this hop's own code", () => {
    expect(INBOX_SIDE_UNAVAILABLE_CODE).toBe("inbox_side_unavailable");
  });
});
