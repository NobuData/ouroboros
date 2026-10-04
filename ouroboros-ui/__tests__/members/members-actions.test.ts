import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { WRITE_FAILED } from "@/app/members/view";

import { PRIYA, secretFor } from "../helpers/members";

/**
 * The card's Server Actions (BS.3, #493): a refusal from the service becomes a value with its own
 * sentence and code — so the card can roll back and say why — and anything else keeps travelling.
 */

const invite = vi.fn();
const update = vi.fn();
const createServiceAccount = vi.fn();

vi.mock("@/app/api/settings-members", () => ({
  settingsMembers: {
    invite: (...args: unknown[]) => invite(...args),
    update: (...args: unknown[]) => update(...args),
    createServiceAccount: (...args: unknown[]) => createServiceAccount(...args),
    resend: vi.fn(),
    revoke: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    rotateServiceAccount: vi.fn(),
    revokeServiceAccount: vi.fn(),
  },
}));

const actions = await import("@/app/members/members-actions");

beforeEach(() => {
  invite.mockReset();
  update.mockReset();
  createServiceAccount.mockReset();
});

describe("the members card's Server Actions", () => {
  it("hand back what the service answered", async () => {
    invite.mockResolvedValue(PRIYA);

    expect(await actions.inviteMember("priya@acme.dev", "admin")).toEqual({ ok: true, value: PRIYA });
    expect(invite).toHaveBeenCalledWith("priya@acme.dev", "admin");
  });

  it("keep a refusal as its sentence and code", async () => {
    update.mockRejectedValue(
      new ApiError(409, "owner_protected", "This is the workspace's last owner."),
    );

    expect(await actions.updateMember("mem-ken", { role: "viewer" })).toEqual({
      ok: false,
      reason: "This is the workspace's last owner.",
      code: "owner_protected",
    });
  });

  it("say nothing changed when the refusal carries no sentence", async () => {
    update.mockRejectedValue(new ApiError(500, "internal_error", ""));

    expect(await actions.updateMember("mem-maya", { canApproveLoops: false })).toMatchObject({
      ok: false,
      reason: WRITE_FAILED,
    });
  });

  it("answer nothing for a revoke and a remove that landed", async () => {
    expect(await actions.revokeInvitation("inv-priya")).toEqual({ ok: true, value: null });
    expect(await actions.removeMember("mem-jorge")).toEqual({ ok: true, value: null });
  });

  it("pass a created token through, and only in that answer", async () => {
    createServiceAccount.mockResolvedValue(secretFor("ci-bot"));

    expect(await actions.createServiceAccount("ci-bot", ["api.read"])).toEqual({
      ok: true,
      value: secretFor("ci-bot"),
    });
  });

  it("let anything that is not the service's answer keep travelling", async () => {
    invite.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(actions.inviteMember("a@b.dev", "viewer")).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
