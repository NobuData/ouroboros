import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { HEALTH_CYCLE_SECONDS, UNREACHABLE_SIDE } from "@/app/research/side";

import { STUB_BASE_URL, stubClient } from "../helpers/api";
import { seededCatalog, seededWatch, seededWatchItems } from "../helpers/research";

/**
 * The Research side column's reads and writes against the service (CN.3, #629), and the read its
 * poll is answered from.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { research } = await import("@/app/api/research");
const { RESEARCH_SIDE_UNAVAILABLE_CODE, readResearchSide } = await import("@/app/api/research-side");

const ITEM = "5eed0096-0000-4000-8000-000000000101";

describe("the service calls", () => {
  it("reads the watch card", async () => {
    const { client, requests } = stubClient(() => ({ body: seededWatch() }));

    expect(await research.watch(client)).toEqual(seededWatch());
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${STUB_BASE_URL}/api/v1/research/regression-watch`,
    ]);
  });

  it("stores a tool's settings under its slug", async () => {
    const [web] = seededCatalog().tools;
    const { client, requests } = stubClient(() => ({ body: web }));

    expect(await research.enableTool("web", { provider: "searxng" }, client)).toEqual(web);
    expect(requests[0].method).toBe("PUT");
    expect(requests[0].url).toBe(`${STUB_BASE_URL}/api/v1/research/tools/web`);
    expect(await requests[0].json()).toEqual({ config: { provider: "searxng" } });
  });

  it("dismisses an item with its reason", async () => {
    const [item] = seededWatchItems();
    const { client, requests } = stubClient(() => ({ body: { ...item, status: "dismissed" } }));

    expect((await research.dismissWatchItem(ITEM, "a sensor swap, not a regression", client)).status).toBe(
      "dismissed",
    );
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe(`${STUB_BASE_URL}/api/v1/research/regression-watch/items/${ITEM}/dismiss`);
    expect(await requests[0].json()).toEqual({ reason: "a sensor swap, not a regression" });
  });

  it("captures a release's baselines", async () => {
    const answer = { repository: "acme-robotics/helios-firmware", releaseTag: "v2.0.4", captured: [], skipped: [] };
    const { client, requests } = stubClient(() => ({ body: answer }));

    expect(
      await research.captureBaselines({ repository: "acme-robotics/helios-firmware", releaseTag: "v2.0.4" }, client),
    ).toEqual(answer);
    expect(requests[0].url).toBe(`${STUB_BASE_URL}/api/v1/research/regression-watch/baselines`);
    expect(await requests[0].json()).toEqual({
      repository: "acme-robotics/helios-firmware",
      releaseTag: "v2.0.4",
    });
  });
});

describe("the side column's poll read", () => {
  it("answers both cards and asks to be asked again after one health cycle", async () => {
    const side = { tools: seededCatalog(), watch: seededWatch() };

    expect(await readResearchSide(() => Promise.resolve(side))).toEqual({
      state: "fresh",
      payload: side,
      etag: null,
      pollAfterSeconds: HEALTH_CYCLE_SECONDS,
    });
  });

  it("hands the read a deadline", async () => {
    const read = vi.fn().mockResolvedValue({ tools: seededCatalog(), watch: seededWatch() });

    await readResearchSide(read);

    expect(read.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("says the column could not be reached when nothing answers, and still names its cycle", async () => {
    expect(await readResearchSide(() => Promise.reject(new TypeError("fetch failed")))).toEqual({
      state: "failed",
      reason: UNREACHABLE_SIDE,
      pollAfterSeconds: HEALTH_CYCLE_SECONDS,
    });
  });

  it("passes the service's own sentence on", async () => {
    const refusal = new ApiError(500, "internal_error", "The service failed.");

    expect(await readResearchSide(() => Promise.reject(refusal))).toMatchObject({
      state: "failed",
      reason: "The service failed.",
    });
  });

  it("reports a lapsed session as gone, so the poll stops", async () => {
    const lapsed = new ApiError(401, "unauthenticated", "Sign in.");

    expect(await readResearchSide(() => Promise.reject(lapsed))).toEqual({ state: "gone" });
  });

  it("names this hop's own failure code", () => {
    expect(RESEARCH_SIDE_UNAVAILABLE_CODE).toBe("research_side_unavailable");
  });
});
