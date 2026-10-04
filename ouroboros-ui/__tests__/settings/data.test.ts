import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { DryRunPolicy } from "@/app/api/policies";

import { SERVICE_LIST, membersPage } from "../helpers/members";

/**
 * What the settings hub reads (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491);
 * the Members card's reads, BS.3 [#493](https://github.com/NobuData/ouroboros/issues/493)): each
 * kept as a reading, so a refusal costs its own section and nothing else its place — and the
 * administrator-only service-account list asked for only by an administrator.
 */

vi.mock("server-only", () => ({}));

const read = vi.fn();
const readMembers = vi.fn();
const readServiceAccounts = vi.fn();

vi.mock("@/app/api/policies", () => ({ dryRunPolicy: { read: () => read() } }));
vi.mock("@/app/api/settings-members", () => ({
  settingsMembers: { read: () => readMembers(), serviceAccounts: () => readServiceAccounts() },
}));

const { readSettings } = await import("@/app/settings/data");

/**
 * The gate's answer, for a membership holding some roles.
 *
 * @param roles The roles.
 * @returns The access.
 */
function access(roles: string[]): Parameters<typeof readSettings>[0] {
  return { membership: { roles } } as unknown as Parameters<typeof readSettings>[0];
}

const POLICY: DryRunPolicy = {
  dryRun: true,
  explicit: true,
  reason: "dry-run policy active",
  updatedAt: "2026-09-30T12:00:00.000Z",
  updatedBy: null,
};

beforeEach(() => {
  read.mockReset().mockResolvedValue(POLICY);
  readMembers.mockReset().mockResolvedValue(membersPage());
  readServiceAccounts.mockReset().mockResolvedValue(SERVICE_LIST);
});

describe("the hub's reader", () => {
  it("reads the dry-run policy and the members page through the one read every surface uses", async () => {
    const readings = await readSettings(access(["owner"]));

    expect(readings.dryRun).toEqual({ ok: true, value: POLICY });
    expect(readings.members).toEqual({ ok: true, value: membersPage() });
    expect(readings.serviceAccounts).toEqual(SERVICE_LIST);
    expect(Date.parse(readings.readAt)).not.toBeNaN();
    expect(read).toHaveBeenCalledOnce();
  });

  it("asks for the service-account list only for an owner or an admin", async () => {
    expect((await readSettings(access(["admin"]))).serviceAccounts).toEqual(SERVICE_LIST);

    readServiceAccounts.mockClear();
    const viewer = await readSettings(access(["viewer"]));

    expect(readServiceAccounts).not.toHaveBeenCalled();
    expect(viewer.serviceAccounts).toBeNull();
    expect(viewer.members.ok).toBe(true);
  });

  it("keeps a refusal as a reason to render, never a blank page", async () => {
    read.mockRejectedValue(new ApiError(503, "unavailable", "The service is restarting."));
    readMembers.mockRejectedValue(new ApiError(503, "unavailable", "The service is restarting."));
    readServiceAccounts.mockRejectedValue(new ApiError(403, "forbidden", "Not yours."));

    const readings = await readSettings(access(["owner"]));

    expect(readings.dryRun).toEqual({ ok: false, reason: "The service is restarting." });
    expect(readings.members).toEqual({ ok: false, reason: "The service is restarting." });
    // The list is a refinement: without it the card draws the page's service rows, hint-less.
    expect(readings.serviceAccounts).toBeNull();
  });

  it("lets anything that is not the service's answer keep travelling — a redirect to sign in above all", async () => {
    read.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(readSettings(access(["owner"]))).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
