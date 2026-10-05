import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { WORKSPACE_NOT_SAVED, retentionNotSaved } from "@/app/settings/workspace";

/**
 * The Workspace card's Server Action (BS.2, #492): the workspace write first, the tiers second;
 * a refused first write sends nothing else, and a refused second one says what landed and re-reads
 * the page so only the tiers stay unsaved.
 */

const update = vi.fn();
const updateRetention = vi.fn();
const refresh = vi.fn();

vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/app/api/settings-workspace", () => ({
  settingsWorkspace: {
    update: (...args: unknown[]) => update(...args),
    updateRetention: (...args: unknown[]) => updateRetention(...args),
  },
}));

const { saveWorkspaceCard } = await import("@/app/settings/workspace-actions");

beforeEach(() => {
  update.mockReset().mockResolvedValue({});
  updateRetention.mockReset().mockResolvedValue({});
  refresh.mockReset();
});

describe("saveWorkspaceCard", () => {
  it("sends each body to its resource, workspace first", async () => {
    const order: string[] = [];
    update.mockImplementation(() => {
      order.push("workspace");
      return Promise.resolve({});
    });
    updateRetention.mockImplementation(() => {
      order.push("retention");
      return Promise.resolve({});
    });

    const result = await saveWorkspaceCard({
      workspace: { name: "acme" },
      retention: { loopDays: 7 },
      retentionFields: ["loopDays"],
    });

    expect(result).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ name: "acme" });
    expect(updateRetention).toHaveBeenCalledWith({ loopDays: 7 });
    expect(order).toEqual(["workspace", "retention"]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sends only the resources that changed", async () => {
    await saveWorkspaceCard({ retention: { classes: { audit: 730 } }, retentionFields: ["audit"] });

    expect(update).not.toHaveBeenCalled();
    expect(updateRetention).toHaveBeenCalledWith({ classes: { audit: 730 } });
  });

  it("sends nothing more after the workspace write is refused, and routes the field", async () => {
    update.mockRejectedValue(
      new ApiError(409, "domain_taken", "That domain is already used by another workspace.", {
        fields: { domain: ["That domain is already used by another workspace."] },
      }),
    );

    const result = await saveWorkspaceCard({
      workspace: { domain: "taken.dev" },
      retention: { loopDays: 7 },
      retentionFields: ["loopDays"],
    });

    expect(updateRetention).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      reason: `${WORKSPACE_NOT_SAVED} That domain is already used by another workspace.`,
      fields: { domain: "That domain is already used by another workspace." },
    });
  });

  it("says what landed when only the tiers are refused, and re-reads the page", async () => {
    updateRetention.mockRejectedValue(
      new ApiError(422, "retention_out_of_bounds", "Retention for audit must be at least 90 days.", {
        fields: { "classes.audit": ["Retention for audit must be at least 90 days."] },
      }),
    );

    const result = await saveWorkspaceCard({
      workspace: { name: "acme" },
      retention: { classes: { audit: 30 } },
      retentionFields: ["audit"],
    });

    expect(result).toEqual({
      ok: false,
      reason: retentionNotSaved("Retention for audit must be at least 90 days."),
      fields: { audit: "Retention for audit must be at least 90 days." },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not re-read when nothing landed", async () => {
    updateRetention.mockRejectedValue(new ApiError(403, "forbidden_role", "Owners and admins only."));

    const result = await saveWorkspaceCard({ retention: { loopDays: 7 }, retentionFields: ["loopDays"] });

    expect(result).toEqual({
      ok: false,
      reason: `${WORKSPACE_NOT_SAVED} Owners and admins only.`,
      fields: {},
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lets anything that is not the service's answer keep travelling", async () => {
    update.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(
      saveWorkspaceCard({ workspace: { name: "acme" }, retentionFields: [] }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
