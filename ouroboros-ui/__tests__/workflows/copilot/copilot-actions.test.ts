import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { SECURITY_PATCH_ID, copilotSession } from "../../helpers/workflow-copilot";

/**
 * The copilot's **Discard draft** server hop (CE.1, #565).
 *
 * A Server Action is a POST endpoint anybody can reach, so the security case comes first: **the
 * call carries the workflow's id and nothing else** — no workspace, no person, nothing about what
 * to discard — and the role gate is the service's. Then the posture: a refusal is a value the
 * dialog draws, and the gate's redirect is the one throw that must travel.
 */

/** What the API answers, per case. */
const discard = vi.fn();

vi.mock("@/app/api/workflow-copilot", () => ({
  workflowCopilot: { discard: (...args: unknown[]) => discard(...args) },
}));

const { discardCopilotDraft } = await import("@/app/workflows/copilot/copilot-actions");

/** What a discard that took answers. */
const DISCARDED = {
  workflowId: SECURITY_PATCH_ID,
  draftDiscarded: true,
  session: copilotSession({ status: "discarded", closedAt: "2026-09-13T11:00:00.000Z" }),
};

beforeEach(() => {
  discard.mockReset().mockResolvedValue(DISCARDED);
});

describe("discardCopilotDraft", () => {
  it("sends the workflow's id and nothing else", async () => {
    await discardCopilotDraft(SECURITY_PATCH_ID);

    expect(discard).toHaveBeenCalledExactlyOnceWith(SECURITY_PATCH_ID);
  });

  it("answers what was discarded", async () => {
    await expect(discardCopilotDraft(SECURITY_PATCH_ID)).resolves.toEqual({ ok: true, value: DISCARDED });
  });

  it.each([
    [409, "copilot_nothing_to_discard", "There is no draft and no active conversation."],
    [409, "dry_run_in_progress", "A dry run of this draft is still running."],
    [403, "forbidden", "Only owners and admins may discard a draft."],
    [404, "workflow_not_found", "No such workflow."],
  ])("hands a %i %s back as a value, never a throw", async (status, code, message) => {
    discard.mockRejectedValue(new ApiError(status, code, message, { why: "because" }));

    await expect(discardCopilotDraft(SECURITY_PATCH_ID)).resolves.toEqual({
      ok: false,
      refusal: { code, message, details: { why: "because" } },
    });
  });

  it("lets the redirect of an expired session through", async () => {
    discard.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(discardCopilotDraft(SECURITY_PATCH_ID)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
