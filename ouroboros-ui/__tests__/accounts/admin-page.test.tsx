import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_TITLE, PENDING_SECTION } from "@/app/accounts/admin";
import type { AdminAccountsReading } from "@/app/accounts/admin-data";

import { ADMIN_ACCOUNT, DENIED_ACCOUNT, PREAPPROVED } from "../helpers/accounts";

/**
 * `/admin/accounts`'s route (account approval): the shell's gate first, then not-found for
 * anybody who is not an application administrator — reading none of the lists for them.
 */

const requireWorkspace = vi.fn();
const readAppAdmin = vi.fn<() => Promise<boolean>>();
const readAdminAccounts = vi.fn<() => Promise<AdminAccountsReading>>();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("@/app/accounts/admin-data", () => ({
  readAppAdmin: () => readAppAdmin(),
  readAdminAccounts: () => readAdminAccounts(),
}));
vi.mock("@/app/accounts/admin-actions", () => ({
  approveAccount: vi.fn(),
  denyAccount: vi.fn(),
  addPreapprovedEmail: vi.fn(),
  removePreapprovedEmail: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => notFound(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const Page = (await import("@/app/(app)/admin/accounts/page")).default;

beforeEach(() => {
  requireWorkspace.mockReset().mockResolvedValue({});
  readAppAdmin.mockReset().mockResolvedValue(true);
  readAdminAccounts.mockReset().mockResolvedValue({
    pending: [ADMIN_ACCOUNT],
    denied: [DENIED_ACCOUNT],
    preapproved: [PREAPPROVED],
  });
  notFound.mockClear();
});

describe("the route", () => {
  it("draws the accounts page for an application administrator", async () => {
    render(await Page());

    expect(screen.getByRole("heading", { level: 1, name: ADMIN_TITLE })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: PENDING_SECTION })).toHaveTextContent(
      "priya@contractor.dev",
    );
  });

  it("answers not-found to anybody else, and reads none of the lists", async () => {
    readAppAdmin.mockResolvedValue(false);

    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(readAdminAccounts).not.toHaveBeenCalled();
  });

  it("goes through the shell's gate before asking anything", async () => {
    requireWorkspace.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));

    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(readAppAdmin).not.toHaveBeenCalled();
  });
});
