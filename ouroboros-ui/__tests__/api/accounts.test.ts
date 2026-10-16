import { describe, expect, it, vi } from "vitest";

import type { AccountStatus, AddedPreapprovedEmail, AdminAccount } from "@/app/api/accounts";

import { createApiClient } from "@/app/api/client";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { ADMIN_ACCOUNT, PREAPPROVED } from "../helpers/accounts";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { accountStatus, adminAccounts } = await import("@/app/api/accounts");

/**
 * Account approval's resource facade over the generated routes: each call reaches the right
 * path with the right method, and returns the body itself.
 */

const BASE = "http://rest.test:4000";

describe("accountStatus.read", () => {
  it("GETs the caller's own status and returns it", async () => {
    const status: AccountStatus = { status: "pending", appAdmin: false, email: "p@x.dev" };
    const { client, requests } = clientAnswering(status);

    expect(await accountStatus.read(client)).toEqual(status);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(`${BASE}/api/v1/account/status`);
  });
});

describe("adminAccounts", () => {
  it("lists one status's accounts by query", async () => {
    const { client, requests } = clientAnswering({ accounts: [ADMIN_ACCOUNT] });

    const list = await adminAccounts.list("denied", client);

    expect(requests[0]?.url).toBe(`${BASE}/api/v1/admin/accounts?status=denied`);
    expect(list.accounts).toEqual([ADMIN_ACCOUNT]);
  });

  it("approves and denies by the user's id, with a POST each", async () => {
    const approved: AdminAccount = { ...ADMIN_ACCOUNT, status: "approved" };
    const first = clientAnswering(approved);
    expect(await adminAccounts.approve("u 1", first.client)).toEqual(approved);
    expect(first.requests[0]?.method).toBe("POST");
    expect(first.requests[0]?.url).toBe(`${BASE}/api/v1/admin/accounts/u%201/approve`);

    const second = clientAnswering({ ...ADMIN_ACCOUNT, status: "denied" });
    await adminAccounts.deny(ADMIN_ACCOUNT.id, second.client);
    expect(second.requests[0]?.method).toBe("POST");
    expect(second.requests[0]?.url).toBe(
      `${BASE}/api/v1/admin/accounts/${ADMIN_ACCOUNT.id}/deny`,
    );
  });

  it("reads the pre-approved emails", async () => {
    const { client, requests } = clientAnswering({ emails: [PREAPPROVED] });

    expect((await adminAccounts.preapproved(client)).emails).toEqual([PREAPPROVED]);
    expect(requests[0]?.url).toBe(`${BASE}/api/v1/admin/preapproved-emails`);
  });

  it("adds an email with its note as the JSON body", async () => {
    const added: AddedPreapprovedEmail = { ...PREAPPROVED, approvedAccount: null };
    const { client, requests } = clientAnswering(added, 201);

    await expect(
      adminAccounts.addPreapproved({ email: "lee@acme-robotics.dev", note: "starts Monday" }, client),
    ).resolves.toEqual(added);

    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual({
      email: "lee@acme-robotics.dev",
      note: "starts Monday",
    });
  });

  it("removes an email by its encoded address, accepting the 204", async () => {
    // A `204` carries no body at all, which the shared stub (always JSON) cannot answer.
    const requests: Request[] = [];
    const client = createApiClient({
      baseUrl: STUB_BASE_URL,
      fetch: (request) => {
        requests.push(request);
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });

    await expect(
      adminAccounts.removePreapproved("lee@acme-robotics.dev", client),
    ).resolves.toBeUndefined();
    expect(requests[0]?.method).toBe("DELETE");
    expect(requests[0]?.url).toBe(
      `${BASE}/api/v1/admin/preapproved-emails/lee%40acme-robotics.dev`,
    );
  });

  it("lets a refusal reject as the service's ApiError", async () => {
    const { client } = clientAnswering(
      { code: "app_admin_required", message: "Administrators only.", details: {} },
      403,
    );

    await expect(adminAccounts.list("pending", client)).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "app_admin_required",
    });
  });
});
