import type { AdminAccount, PreapprovedEmail } from "@/app/api/accounts";

/**
 * Account approval's fixtures — the dev seed's screenshot rows (Priya waiting, Sam denied, Lee
 * pre-approved), so a suite reads like the page a docs writer will capture.
 */

/** When the page was read: every *… ago* in the suites counts from here. */
export const READ_AT = "2026-10-16T12:00:00.000Z";

/** A waiting account, first signed in three days before {@link READ_AT}. */
export const ADMIN_ACCOUNT: AdminAccount = {
  id: "5eed0149-0000-4000-8000-000000000001",
  name: "Priya Raman",
  email: "priya@contractor.dev",
  githubLogin: "priya-r",
  status: "pending",
  createdAt: "2026-10-13T12:00:00.000Z",
  statusChangedAt: "2026-10-13T12:00:00.000Z",
  statusChangedBy: null,
  statusReason: "held",
};

/** A denied account, refused by an administrator a day before {@link READ_AT}. */
export const DENIED_ACCOUNT: AdminAccount = {
  id: "5eed0149-0000-4000-8000-000000000002",
  name: "Sam",
  email: "sam@unknown.example",
  githubLogin: null,
  status: "denied",
  createdAt: "2026-10-10T12:00:00.000Z",
  statusChangedAt: "2026-10-15T12:00:00.000Z",
  statusChangedBy: "ken@acme-robotics.dev",
  statusReason: "denied_by_admin",
};

/** A pre-approved email with a note, added two days before {@link READ_AT}. */
export const PREAPPROVED: PreapprovedEmail = {
  email: "lee@acme-robotics.dev",
  addedBy: "ken@acme-robotics.dev",
  createdAt: "2026-10-14T12:00:00.000Z",
  note: "starts Monday",
};

/**
 * One account, from {@link ADMIN_ACCOUNT}.
 *
 * @param overrides The fields that differ.
 * @returns The account.
 */
export function account(overrides: Partial<AdminAccount> = {}): AdminAccount {
  return { ...ADMIN_ACCOUNT, ...overrides };
}
