import { describe, expect, it, vi } from "vitest";

import type { PollAnswer } from "@/app/poll";

import { pausedLifecycle } from "../helpers/lifecycle";

/** `GET /api/settings/lifecycle` (#496): whatever the poll's reader answered, as a response. */

vi.mock("server-only", () => ({}));

const readLifecyclePoll = vi.fn<() => Promise<PollAnswer<unknown>>>();

vi.mock("@/app/api/settings-lifecycle-poll", () => ({
  LIFECYCLE_UNAVAILABLE_CODE: "lifecycle_unavailable",
  readLifecyclePoll: () => readLifecyclePoll(),
}));

const { GET } = await import("@/app/api/settings/lifecycle/route");

describe("the route", () => {
  it("answers the lifecycle the reader read", async () => {
    readLifecyclePoll.mockResolvedValue({
      state: "fresh",
      payload: pausedLifecycle(),
      etag: null,
      pollAfterSeconds: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(pausedLifecycle());
  });

  it("answers a session that is gone with 401, and a failed read with 502 under its own code", async () => {
    readLifecyclePoll.mockResolvedValue({ state: "gone" });
    expect((await GET()).status).toBe(401);

    readLifecyclePoll.mockResolvedValue({ state: "failed", reason: "down", pollAfterSeconds: null });
    const failed = await GET();

    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ code: "lifecycle_unavailable", message: "down" });
  });
});
