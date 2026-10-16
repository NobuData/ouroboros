import { describe, expect, it, vi } from "vitest";

import type { AccountStatus } from "@/app/api/accounts";
import { ApiError } from "@/app/api/errors";

import { ADMIN_ACCOUNT, DENIED_ACCOUNT, PREAPPROVED } from "../helpers/accounts";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { readAccountStanding } = await import("@/app/accounts/pending-data");
const { readAdminAccounts, readAppAdmin } = await import("@/app/accounts/admin-data");

/**
 * Account approval's server reads: the waiting page's standing, whether the reader is an
 * application administrator, and the accounts page's three lists.
 */

/**
 * A status answer.
 *
 * @param overrides The fields that differ from a pending non-admin.
 * @returns The answer.
 */
function status(overrides: Partial<AccountStatus> = {}): AccountStatus {
  return { status: "pending", appAdmin: false, email: "priya@contractor.dev", ...overrides };
}

describe("readAccountStanding", () => {
  it("is held, with the status and email, for a pending account", async () => {
    await expect(readAccountStanding(() => Promise.resolve(status()))).resolves.toEqual({
      state: "held",
      status: "pending",
      email: "priya@contractor.dev",
    });
  });

  it("is held as denied for a denied account", async () => {
    const standing = await readAccountStanding(() =>
      Promise.resolve(status({ status: "denied" })),
    );

    expect(standing).toMatchObject({ state: "held", status: "denied" });
  });

  it("is approved for an approved account", async () => {
    await expect(
      readAccountStanding(() => Promise.resolve(status({ status: "approved" }))),
    ).resolves.toEqual({ state: "approved" });
  });

  it("is signed-out for a 401", async () => {
    const refused = new ApiError(401, "unauthenticated", "Sign in.", {});

    await expect(readAccountStanding(() => Promise.reject(refused))).resolves.toEqual({
      state: "signed-out",
    });
  });

  it("lets any other failure reject, so an outage is not drawn as a signed-out visitor", async () => {
    const failed = new ApiError(500, "internal_error", "No.", {});

    await expect(readAccountStanding(() => Promise.reject(failed))).rejects.toBe(failed);
  });
});

describe("readAppAdmin", () => {
  it("is true only for an answer that says so", async () => {
    await expect(readAppAdmin(() => Promise.resolve(status({ appAdmin: true })))).resolves.toBe(
      true,
    );
    await expect(readAppAdmin(() => Promise.resolve(status()))).resolves.toBe(false);
  });

  it("is false for any failure, which hides the page and the entry", async () => {
    await expect(
      readAppAdmin(() => Promise.reject(new ApiError(403, "account_denied", "No.", {}))),
    ).resolves.toBe(false);
    await expect(readAppAdmin(() => Promise.reject(new Error("unreachable")))).resolves.toBe(
      false,
    );
  });
});

describe("readAdminAccounts", () => {
  it("reads pending, denied and the pre-approved emails, and hands back the lists", async () => {
    const list = vi.fn((wanted: "pending" | "denied") =>
      Promise.resolve({ accounts: wanted === "pending" ? [ADMIN_ACCOUNT] : [DENIED_ACCOUNT] }),
    );

    const reading = await readAdminAccounts({
      list,
      preapproved: () => Promise.resolve({ emails: [PREAPPROVED] }),
    });

    expect(list.mock.calls.map(([wanted]) => wanted)).toEqual(["pending", "denied"]);
    expect(reading).toEqual({
      pending: [ADMIN_ACCOUNT],
      denied: [DENIED_ACCOUNT],
      preapproved: [PREAPPROVED],
    });
  });

  it("rejects when any read is refused", async () => {
    const refused = new ApiError(403, "app_admin_required", "No.", {});

    await expect(
      readAdminAccounts({
        list: () => Promise.reject(refused),
        preapproved: () => Promise.resolve({ emails: [] }),
      }),
    ).rejects.toBe(refused);
  });
});
