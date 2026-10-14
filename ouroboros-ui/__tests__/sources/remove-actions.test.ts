import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  REMOVE_BLOCKED,
  REMOVE_FAILED,
  REMOVE_READ_ONLY,
  REMOVE_UNREAD,
  SOURCE_GONE,
} from "@/app/sources/view";

import { SEEDED_GITHUB_ID } from "../helpers/sources";

const removal = vi.fn();
const remove = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/github-token", () => ({ githubToken: {} }));
vi.mock("@/app/api/sources", () => ({
  sources: { removal: (id: string) => removal(id), remove: (id: string) => remove(id) },
}));

const { readSourceRemoval, removeSource } = await import("@/app/sources/actions");

/**
 * Reading what a removal would take, and carrying it out. Every refusal is a sentence, and
 * the one for a source the analyzer drafted into says what to do instead.
 */

const COUNTS = {
  sourceId: SEEDED_GITHUB_ID,
  displayName: "GitHub · acme-robotics",
  tickets: 77,
  pullRequests: 12,
  draftBatches: 1,
  analyzerDraftBatches: 0,
  removable: true,
};

beforeEach(() => {
  removal.mockReset().mockResolvedValue(COUNTS);
  remove.mockReset().mockResolvedValue(COUNTS);
});

describe("readSourceRemoval", () => {
  it("answers the counts", async () => {
    expect(await readSourceRemoval(SEEDED_GITHUB_ID)).toEqual({ ok: true, removal: COUNTS });
    expect(removal).toHaveBeenCalledExactlyOnceWith(SEEDED_GITHUB_ID);
  });

  it.each([
    ["ticket_source_not_found", 404, SOURCE_GONE],
    ["forbidden", 403, REMOVE_READ_ONLY],
    ["unavailable", 503, REMOVE_UNREAD],
  ])("answers %s with a sentence", async (code, status, sentence) => {
    removal.mockRejectedValue(new ApiError(status, code, "The service's words."));

    expect(await readSourceRemoval(SEEDED_GITHUB_ID)).toEqual({ ok: false, reason: sentence });
  });
});

describe("removeSource", () => {
  it("removes and answers what went", async () => {
    expect(await removeSource(SEEDED_GITHUB_ID)).toEqual({ ok: true, removal: COUNTS });
    expect(remove).toHaveBeenCalledExactlyOnceWith(SEEDED_GITHUB_ID);
  });

  it.each([
    ["ticket_source_in_use", 409, REMOVE_BLOCKED],
    ["ticket_source_not_found", 404, SOURCE_GONE],
    ["forbidden", 403, REMOVE_READ_ONLY],
    ["internal_error", 500, REMOVE_FAILED],
  ])("answers %s with a sentence", async (code, status, sentence) => {
    remove.mockRejectedValue(new ApiError(status, code, "The service's words."));

    expect(await removeSource(SEEDED_GITHUB_ID)).toEqual({ ok: false, reason: sentence });
  });

  it("lets anything that is not the service's answer through", async () => {
    remove.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(removeSource(SEEDED_GITHUB_ID)).rejects.toThrow("NEXT_REDIRECT");
  });
});
