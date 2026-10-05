import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import type { DryRunPolicy } from "@/app/api/policies";

import { auditToday } from "../helpers/audit-log";
import { integrations, notificationRoutes } from "../helpers/integrations";
import { SERVICE_LIST, membersPage } from "../helpers/members";
import { orgPolicyV7 } from "../helpers/org-policy";
import { webhookList } from "../helpers/webhooks";
import { retentionSettings, workspaceSettings } from "../helpers/workspace";

/**
 * What the settings hub reads (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491);
 * the Members card's reads, BS.3 [#493](https://github.com/NobuData/ouroboros/issues/493)): each
 * kept as a reading, so a refusal costs its own section and nothing else its place — and the
 * administrator-only service-account list asked for only by an administrator. BS.5's reads
 * ([#495](https://github.com/NobuData/ouroboros/issues/495)) keep both rules: the audit log and
 * the webhook endpoints are an administrator's, the grid and the routes are every member's.
 */

vi.mock("server-only", () => ({}));

const read = vi.fn();
const readPolicy = vi.fn();
const readMembers = vi.fn();
const readServiceAccounts = vi.fn();
const readWorkspace = vi.fn();
const readRetention = vi.fn();
const readAuditToday = vi.fn();
const readWebhooks = vi.fn();
const readIntegrations = vi.fn();
const readRoutes = vi.fn();

vi.mock("@/app/api/policies", () => ({ dryRunPolicy: { read: () => read() } }));
vi.mock("@/app/api/org-policy", () => ({ orgPolicy: { read: () => readPolicy() } }));
vi.mock("@/app/api/settings-workspace", () => ({
  settingsWorkspace: { read: () => readWorkspace(), retention: () => readRetention() },
}));
vi.mock("@/app/api/settings-members", () => ({
  settingsMembers: { read: () => readMembers(), serviceAccounts: () => readServiceAccounts() },
}));
vi.mock("@/app/api/settings-audit", () => ({ settingsAudit: { today: () => readAuditToday() } }));
vi.mock("@/app/api/settings-webhooks", () => ({ settingsWebhooks: { list: () => readWebhooks() } }));
vi.mock("@/app/api/settings-integrations", () => ({
  settingsIntegrations: { read: () => readIntegrations(), routes: () => readRoutes() },
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
  readPolicy.mockReset().mockResolvedValue(orgPolicyV7());
  readMembers.mockReset().mockResolvedValue(membersPage());
  readServiceAccounts.mockReset().mockResolvedValue(SERVICE_LIST);
  readWorkspace.mockReset().mockResolvedValue(workspaceSettings());
  readRetention.mockReset().mockResolvedValue(retentionSettings());
  readAuditToday.mockReset().mockResolvedValue(auditToday());
  readWebhooks.mockReset().mockResolvedValue(webhookList());
  readIntegrations.mockReset().mockResolvedValue(integrations());
  readRoutes.mockReset().mockResolvedValue(notificationRoutes());
});

describe("the hub's reader", () => {
  it("reads the dry-run policy and the members page through the one read every surface uses", async () => {
    const readings = await readSettings(access(["owner"]));

    expect(readings.dryRun).toEqual({ ok: true, value: POLICY });
    expect(readings.policy).toEqual({ ok: true, value: orgPolicyV7() });
    expect(readings.members).toEqual({ ok: true, value: membersPage() });
    expect(readings.workspace).toEqual({ ok: true, value: workspaceSettings() });
    expect(readings.retention).toEqual({ ok: true, value: retentionSettings() });
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
    readRetention.mockRejectedValue(new ApiError(503, "unavailable", "The service is restarting."));
    readPolicy.mockRejectedValue(new ApiError(503, "unavailable", "The service is restarting."));

    const readings = await readSettings(access(["owner"]));

    // The policy document and the dry-run switch are two reads: either can fail alone.
    expect(readings.policy).toEqual({ ok: false, reason: "The service is restarting." });

    // The workspace card's two reads fail apart: one refusal is one reason.
    expect(readings.workspace.ok).toBe(true);
    expect(readings.retention).toEqual({ ok: false, reason: "The service is restarting." });

    expect(readings.dryRun).toEqual({ ok: false, reason: "The service is restarting." });
    expect(readings.members).toEqual({ ok: false, reason: "The service is restarting." });
    // The list is a refinement: without it the card draws the page's service rows, hint-less.
    expect(readings.serviceAccounts).toBeNull();
  });

  it("reads the audit card, the webhook endpoints, the grid and the routes for an administrator", async () => {
    const readings = await readSettings(access(["admin"]));

    expect(readings.audit).toEqual({ ok: true, value: auditToday() });
    expect(readings.webhooks).toEqual(webhookList());
    expect(readings.integrations).toEqual({ ok: true, value: integrations() });
    expect(readings.routes).toEqual({ ok: true, value: notificationRoutes() });
  });

  it("never asks for the audit log or the webhook endpoints for a reader the service would refuse", async () => {
    const viewer = await readSettings(access(["viewer"]));

    expect(readAuditToday).not.toHaveBeenCalled();
    expect(readWebhooks).not.toHaveBeenCalled();
    expect(viewer.audit).toBeNull();
    expect(viewer.webhooks).toBeNull();
    // The grid and the routes are every member's to read.
    expect(viewer.integrations.ok).toBe(true);
    expect(viewer.routes.ok).toBe(true);
  });

  it("keeps each of BS.5's refusals to its own seat", async () => {
    const down = new ApiError(503, "unavailable", "The service is restarting.");
    readAuditToday.mockRejectedValue(down);
    readWebhooks.mockRejectedValue(down);
    readIntegrations.mockRejectedValue(down);
    readRoutes.mockRejectedValue(down);

    const readings = await readSettings(access(["owner"]));

    expect(readings.audit).toEqual({ ok: false, reason: "The service is restarting." });
    // The endpoints are a refinement: without them the SIEM row says its status is unavailable.
    expect(readings.webhooks).toBeNull();
    expect(readings.integrations).toEqual({ ok: false, reason: "The service is restarting." });
    expect(readings.routes).toEqual({ ok: false, reason: "The service is restarting." });
    expect(readings.workspace.ok).toBe(true);
  });

  it("lets anything that is not the service's answer keep travelling — a redirect to sign in above all", async () => {
    read.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(readSettings(access(["owner"]))).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});
