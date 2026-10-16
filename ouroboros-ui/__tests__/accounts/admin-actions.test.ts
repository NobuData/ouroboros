import { beforeEach, describe, expect, it, vi } from "vitest";

import { WRITE_FAILED } from "@/app/accounts/admin";
import { ApiError } from "@/app/api/errors";

import { ADMIN_ACCOUNT, PREAPPROVED } from "../helpers/accounts";

/**
 * The accounts page's Server Actions (account approval): each calls its one route, a service
 * refusal comes back as the sentence for the toast, and anything else keeps travelling.
 */

vi.mock("server-only", () => ({}));

const api = {
  approve: vi.fn(),
  deny: vi.fn(),
  addPreapproved: vi.fn(),
  removePreapproved: vi.fn(),
};

vi.mock("@/app/api/accounts", () => ({
  adminAccounts: {
    approve: (id: string) => api.approve(id),
    deny: (id: string) => api.deny(id),
    addPreapproved: (input: unknown) => api.addPreapproved(input),
    removePreapproved: (email: string) => api.removePreapproved(email),
  },
}));

const { addPreapprovedEmail, approveAccount, denyAccount, removePreapprovedEmail } = await import(
  "@/app/accounts/admin-actions"
);

beforeEach(() => {
  for (const call of Object.values(api)) call.mockReset().mockResolvedValue(undefined);
});

describe("approveAccount and denyAccount", () => {
  it("call their route with the user's id and report success", async () => {
    await expect(approveAccount("u1")).resolves.toEqual({ ok: true, value: null });
    await expect(denyAccount("u2")).resolves.toEqual({ ok: true, value: null });

    expect(api.approve).toHaveBeenCalledExactlyOnceWith("u1");
    expect(api.deny).toHaveBeenCalledExactlyOnceWith("u2");
  });

  it("turn a refusal into its sentence", async () => {
    api.deny.mockRejectedValue(
      new ApiError(409, "cannot_deny_app_admin", "An application administrator cannot be denied."),
    );

    await expect(denyAccount("u1")).resolves.toEqual({
      ok: false,
      reason: "An application administrator cannot be denied.",
    });
  });

  it("fall back to a sentence of their own for a refusal that carried none", async () => {
    api.approve.mockRejectedValue(new ApiError(500, "internal_error", " "));

    await expect(approveAccount("u1")).resolves.toEqual({ ok: false, reason: WRITE_FAILED });
  });

  it("let anything that is not a refusal keep travelling", async () => {
    const signal = new Error("NEXT_REDIRECT");
    api.approve.mockRejectedValue(signal);

    await expect(approveAccount("u1")).rejects.toBe(signal);
  });
});

describe("addPreapprovedEmail", () => {
  it("returns the service's answer, approved account and all", async () => {
    const answer = { ...PREAPPROVED, approvedAccount: ADMIN_ACCOUNT };
    api.addPreapproved.mockResolvedValue(answer);

    await expect(addPreapprovedEmail("lee@acme-robotics.dev", "")).resolves.toEqual({
      ok: true,
      value: answer,
    });
  });

  it("sends the trimmed email and note", async () => {
    await addPreapprovedEmail("  lee@acme-robotics.dev ", " starts Monday ");

    expect(api.addPreapproved).toHaveBeenCalledExactlyOnceWith({
      email: "lee@acme-robotics.dev",
      note: "starts Monday",
    });
  });

  it("leaves an empty note out rather than sending one", async () => {
    await addPreapprovedEmail("lee@acme-robotics.dev", "   ");

    expect(api.addPreapproved).toHaveBeenCalledExactlyOnceWith({ email: "lee@acme-robotics.dev" });
  });

  it("reports a duplicate as the service's sentence", async () => {
    api.addPreapproved.mockRejectedValue(
      new ApiError(409, "already_preapproved", "That email is already pre-approved."),
    );

    await expect(addPreapprovedEmail("lee@acme-robotics.dev", "")).resolves.toEqual({
      ok: false,
      reason: "That email is already pre-approved.",
    });
  });
});

describe("removePreapprovedEmail", () => {
  it("removes the email it was given", async () => {
    await expect(removePreapprovedEmail("lee@acme-robotics.dev")).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(api.removePreapproved).toHaveBeenCalledExactlyOnceWith("lee@acme-robotics.dev");
  });
});
