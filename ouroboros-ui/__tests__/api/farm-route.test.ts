import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FarmPage } from "@/app/api/farm";
import { CACHE_CONTROL } from "@/app/api/poll-response";
import { ETAG_HEADER, POLL_AFTER_HEADER, type PollAnswer } from "@/app/poll";

import { seededFarm } from "../helpers/farm";

/**
 * `GET /api/farm` — the farm page, on the origin the browser can reach (#256). The cadence the
 * service asked for travels as `X-Ouro-Poll-After`; a session that has ended is said plainly.
 */

vi.mock("server-only", () => ({}));

/** What the stubbed reader answers with. Reassigned per case. */
let answer: PollAnswer<FarmPage> = { state: "gone" };

vi.mock("@/app/api/farm-page", () => ({
  FARM_UNAVAILABLE_CODE: "farm_unavailable",
  readFarmPage: () => Promise.resolve(answer),
}));

const { GET } = await import("@/app/api/farm/route");

beforeEach(() => {
  answer = { state: "fresh", payload: seededFarm(), etag: null, pollAfterSeconds: 10 };
});

describe("the route", () => {
  it("answers the page as JSON with the fleet's cadence, uncacheable by anything shared", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(seededFarm());
    expect(response.headers.get(POLL_AFTER_HEADER)).toBe("10");
    expect(response.headers.get("Cache-Control")).toBe(CACHE_CONTROL);
    // The page answers no tag, and this hop does not invent one.
    expect(response.headers.get(ETAG_HEADER)).toBeNull();
  });

  it("tells a poll plainly that the session is over, rather than redirecting it", async () => {
    answer = { state: "gone" };

    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("reports a failed read as this origin's own, carrying the service's sentence", async () => {
    answer = { state: "failed", reason: "Choose a workspace.", pollAfterSeconds: null };

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "farm_unavailable", message: "Choose a workspace." });
  });
});
