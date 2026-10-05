import { beforeEach, describe, expect, it, vi } from "vitest";

import { inboxSide } from "../helpers/inbox";

/** `GET /api/inbox/side` (#469): the side column's read, answered in the poll family's shape. */

const readInboxSide = vi.fn();

vi.mock("@/app/api/inbox-side", () => ({
  INBOX_SIDE_UNAVAILABLE_CODE: "inbox_side_unavailable",
  readInboxSide: () => readInboxSide(),
}));

const { GET } = await import("@/app/api/inbox/side/route");

beforeEach(() => {
  readInboxSide
    .mockReset()
    .mockResolvedValue({ state: "fresh", payload: inboxSide(), etag: null, pollAfterSeconds: null });
});

describe("GET /api/inbox/side", () => {
  it("reads once and answers both cards", async () => {
    const response = await GET();

    expect(readInboxSide).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(inboxSide());
  });

  it("answers a failure under this hop's code", async () => {
    readInboxSide.mockResolvedValue({
      state: "failed",
      reason: "The inbox's channels and policies could not be reached.",
      pollAfterSeconds: null,
    });

    const response = await GET();

    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({
      code: "inbox_side_unavailable",
      message: "The inbox's channels and policies could not be reached.",
    });
  });

  it("answers a lapsed session as one, so the poll stops asking", async () => {
    readInboxSide.mockResolvedValue({ state: "gone" });

    expect((await GET()).status).toBe(401);
  });
});
