import { beforeEach, describe, expect, it, vi } from "vitest";

import { seededCatalog, seededWatch } from "../helpers/research";

/** `GET /api/research/side` (#629): the side column's read, in the poll family's shape. */

const readResearchSide = vi.fn();
const SIDE = { tools: seededCatalog(), watch: seededWatch() };

vi.mock("@/app/api/research-side", () => ({
  RESEARCH_SIDE_UNAVAILABLE_CODE: "research_side_unavailable",
  readResearchSide: () => readResearchSide(),
}));

const { GET } = await import("@/app/api/research/side/route");

beforeEach(() => {
  readResearchSide
    .mockReset()
    .mockResolvedValue({ state: "fresh", payload: SIDE, etag: null, pollAfterSeconds: 30 });
});

describe("GET /api/research/side", () => {
  it("reads once, answers both cards and names the health cycle", async () => {
    const response = await GET();

    expect(readResearchSide).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Ouro-Poll-After")).toBe("30");
    expect(await response.json()).toEqual(SIDE);
  });

  it("answers a failure under this hop's code", async () => {
    readResearchSide.mockResolvedValue({ state: "failed", reason: "Could not be reached.", pollAfterSeconds: 30 });

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "research_side_unavailable", message: "Could not be reached." });
  });

  it("answers a lapsed session as one, so the poll stops asking", async () => {
    readResearchSide.mockResolvedValue({ state: "gone" });

    expect((await GET()).status).toBe(401);
  });
});
