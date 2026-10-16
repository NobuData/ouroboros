import { describe, expect, it, vi } from "vitest";

/**
 * `GET /api/account/status` — the one flag the sidebar's **Accounts** entry needs (account
 * approval), never the rest of the service's status body.
 */

const readAppAdmin = vi.fn<() => Promise<boolean>>();

vi.mock("@/app/accounts/admin-data", () => ({ readAppAdmin: () => readAppAdmin() }));

const { GET } = await import("@/app/api/account/status/route");

describe("the route", () => {
  it("answers the administrator flag alone, uncacheable", async () => {
    readAppAdmin.mockResolvedValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(await response.json()).toEqual({ appAdmin: true });
  });

  it("answers false when the reader is not one", async () => {
    readAppAdmin.mockResolvedValue(false);

    expect(await (await GET()).json()).toEqual({ appAdmin: false });
  });
});
