import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { clientAnswering, stubClient } from "../helpers/api";
import { DEVOPS_BOT, PRIYA, SERVICE_LIST, membersPage, secretFor } from "../helpers/members";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { settingsMembers } = await import("@/app/api/settings-members");

/**
 * The Members & Roles card's operations (#493 over #485): every write goes through
 * `/api/v1/settings/…` — never the organization plugin's routes — and each sends what it was
 * given, no more.
 */

/**
 * The method and path of the one request a call made.
 *
 * @param requests The requests the stub saw.
 * @returns `METHOD /path`.
 */
function sent(requests: Request[]): string {
  expect(requests).toHaveLength(1);
  return `${requests[0].method} ${new URL(requests[0].url).pathname}`;
}

describe("settingsMembers", () => {
  it("reads the card in one request", async () => {
    const { client, requests } = clientAnswering(membersPage());

    expect(await settingsMembers.read(client)).toEqual(membersPage());
    expect(sent(requests)).toBe("GET /api/v1/settings/members");
  });

  it("invites by address and role", async () => {
    const { client, requests } = clientAnswering(PRIYA, 201);

    await settingsMembers.invite("priya@acme.dev", "viewer", client);

    expect(sent(requests)).toBe("POST /api/v1/settings/members/invitations");
    expect(await requests[0].json()).toEqual({ email: "priya@acme.dev", role: "viewer" });
  });

  it("resends and revokes an invitation by id", async () => {
    const resend = clientAnswering(PRIYA);
    await settingsMembers.resend("inv-priya", resend.client);
    expect(sent(resend.requests)).toBe("POST /api/v1/settings/members/invitations/inv-priya/resend");

    const revoke = stubClient(() => ({ body: undefined, status: 204 }));
    await settingsMembers.revoke("inv-priya", revoke.client);
    expect(sent(revoke.requests)).toBe("DELETE /api/v1/settings/members/invitations/inv-priya");
  });

  it("changes a member's capability, sending only that", async () => {
    const { client, requests } = clientAnswering(membersPage().members[1]);

    await settingsMembers.update("mem-maya", { canApproveLoops: false }, client);

    expect(sent(requests)).toBe("PATCH /api/v1/settings/members/mem-maya");
    expect(await requests[0].json()).toEqual({ canApproveLoops: false });
  });

  it("removes a member", async () => {
    const { client, requests } = stubClient(() => ({ body: undefined, status: 204 }));

    await settingsMembers.remove("mem-jorge", client);

    expect(sent(requests)).toBe("DELETE /api/v1/settings/members/mem-jorge");
  });

  it("keeps the last-owner refusal as the service's own error", async () => {
    const { client } = clientAnswering(
      { code: "owner_protected", message: "This is the workspace's last owner.", details: {} },
      409,
    );

    await expect(settingsMembers.update("mem-ken", { role: "viewer" }, client)).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("lists, creates, rotates and revokes service accounts on their own routes", async () => {
    const list = clientAnswering(SERVICE_LIST);
    expect(await settingsMembers.serviceAccounts(list.client)).toEqual(SERVICE_LIST);
    expect(sent(list.requests)).toBe("GET /api/v1/settings/service-accounts");

    const create = clientAnswering(secretFor("ci-bot"), 201);
    expect((await settingsMembers.createServiceAccount("ci-bot", ["api.read"], create.client)).token).toBe(
      secretFor("ci-bot").token,
    );
    expect(sent(create.requests)).toBe("POST /api/v1/settings/service-accounts");
    expect(await create.requests[0].json()).toEqual({ name: "ci-bot", scopes: ["api.read"] });

    const rotate = clientAnswering(secretFor("devops-bot"));
    await settingsMembers.rotateServiceAccount(DEVOPS_BOT.id, rotate.client);
    expect(sent(rotate.requests)).toBe(`POST /api/v1/settings/service-accounts/${DEVOPS_BOT.id}/rotate`);

    const revoke = clientAnswering({ ...DEVOPS_BOT, token: null, disabledAt: DEVOPS_BOT.createdAt });
    await settingsMembers.revokeServiceAccount(DEVOPS_BOT.id, revoke.client);
    expect(sent(revoke.requests)).toBe(`POST /api/v1/settings/service-accounts/${DEVOPS_BOT.id}/revoke`);
  });

  it("never calls the organization plugin's routes", async () => {
    const { client, requests } = clientAnswering(membersPage());

    await settingsMembers.read(client);

    expect(new URL(requests[0].url).pathname).not.toContain("/api/auth/organization");
  });
});
