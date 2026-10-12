import { afterEach, describe, expect, it, vi } from "vitest";

import { UNREACHABLE_DRAFT, UNREADABLE_DRAFT } from "@/app/workflows/copilot/stages";
import { createStagesPoll, isStageDraft, requestStageDraft, stagesEndpoint } from "@/app/workflows/copilot/stages-poll";

import { SECURITY_PATCH_ID, freshDraft, seededStageDraft } from "../../helpers/workflow-copilot";

/**
 * The stage list's poll (CE.3, #567): where it asks, what it accepts as a draft, and what it says
 * when the answer is not one.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the endpoint", () => {
  it("is this origin's route for the workflow, with the id encoded", () => {
    expect(stagesEndpoint(SECURITY_PATCH_ID)).toBe(`/api/workflows/${SECURITY_PATCH_ID}/copilot/draft`);
    expect(stagesEndpoint("a/b?c")).toBe("/api/workflows/a%2Fb%3Fc/copilot/draft");
  });
});

describe("what counts as a draft", () => {
  it("accepts the seeded draft, a draft with no document, and one from before provenance was served", () => {
    expect(isStageDraft(seededStageDraft())).toBe(true);
    expect(isStageDraft(seededStageDraft({ definition: null, warnings: [], nodeProvenance: [], etag: "none" }))).toBe(true);
    expect(isStageDraft({ ...seededStageDraft(), nodeProvenance: undefined })).toBe(true);
  });

  it("refuses what merely answered on that URL", () => {
    const draft = seededStageDraft();

    expect(isStageDraft(null)).toBe(false);
    expect(isStageDraft("<html>")).toBe(false);
    expect(isStageDraft({ code: "forbidden", message: "No." })).toBe(false);
    expect(isStageDraft({ ...draft, label: 3 })).toBe(false);
    expect(isStageDraft({ ...draft, definition: [] })).toBe(false);
    expect(isStageDraft({ ...draft, warnings: [{ node: "a" }] })).toBe(false);
    expect(isStageDraft({ ...draft, warnings: "none" })).toBe(false);
    expect(isStageDraft({ ...draft, nodeProvenance: [{ nodeId: 1, provenance: "human" }] })).toBe(false);
    expect(isStageDraft({ ...draft, nodeProvenance: {} })).toBe(false);
  });
});

describe("one read", () => {
  it("asks the endpoint and hands back the draft", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(seededStageDraft())));
    vi.stubGlobal("fetch", fetcher);

    await expect(requestStageDraft(stagesEndpoint(SECURITY_PATCH_ID), null)).resolves.toMatchObject({
      state: "fresh",
      payload: seededStageDraft(),
    });
    expect(fetcher.mock.calls[0][0]).toBe(stagesEndpoint(SECURITY_PATCH_ID));
  });

  it("says the draft could not be reached when nothing answered", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));

    await expect(requestStageDraft(stagesEndpoint(SECURITY_PATCH_ID), null)).resolves.toMatchObject({
      state: "failed",
      reason: UNREACHABLE_DRAFT,
    });
  });

  it("says the draft could not be read when what answered is not one", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ hello: "world" })));

    await expect(requestStageDraft(stagesEndpoint(SECURITY_PATCH_ID), null)).resolves.toMatchObject({
      state: "failed",
      reason: UNREADABLE_DRAFT,
    });
  });
});

describe("the poll", () => {
  it("reads this workflow's endpoint through the reader it was given", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(() => Promise.resolve(freshDraft(seededStageDraft())));
      const poll = createStagesPoll(SECURITY_PATCH_ID, { read, visible: () => true });

      const stop = poll.start();
      await vi.advanceTimersByTimeAsync(0);
      stop();

      expect(read).toHaveBeenCalledExactlyOnceWith(stagesEndpoint(SECURITY_PATCH_ID), null);
      expect(poll.snapshot().data).toEqual(seededStageDraft());
    } finally {
      vi.useRealTimers();
    }
  });
});
