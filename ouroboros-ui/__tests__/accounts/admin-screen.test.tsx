import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADD_LABEL,
  ADMIN_TITLE,
  APPROVE_LABEL,
  type AdminWrite,
  CANCEL_LABEL,
  DENIED_EMPTY,
  DENIED_SECTION,
  DENY_LABEL,
  DENY_WARNING,
  EMAIL_LABEL,
  EMAIL_REQUIRED,
  NOTE_LABEL,
  PENDING_EMPTY,
  PENDING_SECTION,
  PREAPPROVED_EMPTY,
  PREAPPROVED_SECTION,
  WORKING_LABEL,
} from "@/app/accounts/admin";
import type { AdminAccountsScreenProps } from "@/app/accounts/admin-screen";
import type { AddedPreapprovedEmail } from "@/app/api/accounts";

import { ADMIN_ACCOUNT, DENIED_ACCOUNT, PREAPPROVED, READ_AT } from "../helpers/accounts";
import { settle } from "../helpers/settle";

/**
 * `/admin/accounts`, rendered (account approval): the three sections and their empty states,
 * approve, deny behind its confirmation, the pre-approved list's add and remove — and the toast
 * that says what each did.
 */

type Write = AdminWrite<null>;

const approveAccount = vi.fn<(id: string) => Promise<Write>>();
const denyAccount = vi.fn<(id: string) => Promise<Write>>();
const addPreapprovedEmail =
  vi.fn<(email: string, note: string) => Promise<AdminWrite<AddedPreapprovedEmail>>>();
const removePreapprovedEmail = vi.fn<(email: string) => Promise<Write>>();
const refresh = vi.fn();

vi.mock("@/app/accounts/admin-actions", () => ({
  approveAccount: (id: string) => approveAccount(id),
  denyAccount: (id: string) => denyAccount(id),
  addPreapprovedEmail: (email: string, note: string) => addPreapprovedEmail(email, note),
  removePreapprovedEmail: (email: string) => removePreapprovedEmail(email),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { AdminAccountsScreen } = await import("@/app/accounts/admin-screen");

const OK: Write = { ok: true, value: null };

/**
 * What the service answers to an add: the entry, lower-cased, and no account approved.
 *
 * @param email The email as typed.
 * @param approvedAccount The waiting account it approved, if any.
 * @returns The answer.
 */
function added(
  email: string,
  approvedAccount: AddedPreapprovedEmail["approvedAccount"] = null,
): AddedPreapprovedEmail {
  return {
    email: email.trim().toLowerCase(),
    addedBy: "ken@acme-robotics.dev",
    createdAt: READ_AT,
    note: null,
    approvedAccount,
  };
}

/**
 * The page with the seed's three rows, or whatever a case overrides.
 *
 * @param overrides The props that differ.
 * @returns The rendered page.
 */
function page(overrides: Partial<AdminAccountsScreenProps> = {}) {
  return render(
    <AdminAccountsScreen
      denied={[DENIED_ACCOUNT]}
      pending={[ADMIN_ACCOUNT]}
      preapproved={[PREAPPROVED]}
      readAt={READ_AT}
      {...overrides}
    />,
  );
}

/**
 * One section, by its heading.
 *
 * @param name The section's heading.
 * @returns The section.
 */
function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  for (const write of [approveAccount, denyAccount, removePreapprovedEmail]) {
    write.mockReset().mockResolvedValue(OK);
  }
  addPreapprovedEmail
    .mockReset()
    .mockImplementation((email) => Promise.resolve({ ok: true, value: added(email) }));
  refresh.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the page", () => {
  it("is titled Accounts and draws the three sections in order", () => {
    const { container } = page();

    expect(screen.getByRole("heading", { level: 1, name: ADMIN_TITLE })).toBeInTheDocument();
    expect(
      [...container.querySelectorAll(".accounts-card")].map((card) => card.className),
    ).toEqual([
      expect.stringContaining("accounts-card--pending"),
      expect.stringContaining("accounts-card--denied"),
      expect.stringContaining("accounts-card--preapproved"),
    ]);
    expect(section(PENDING_SECTION)).toBeInTheDocument();
    expect(section(DENIED_SECTION)).toBeInTheDocument();
    expect(section(PREAPPROVED_SECTION)).toBeInTheDocument();
  });

  it("draws a waiting account's name, email, GitHub login and when it signed in", () => {
    page();

    const row = within(section(PENDING_SECTION)).getByRole("listitem");
    expect(row).toHaveTextContent("Priya Raman");
    expect(row).toHaveTextContent("priya@contractor.dev");
    expect(row).toHaveTextContent("@priya-r");
    expect(row).toHaveTextContent("signed in 3d ago");
    expect(within(row).getByRole("button", { name: APPROVE_LABEL })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: DENY_LABEL })).toBeInTheDocument();
  });

  it("draws a denied account with Approve only, and who denied it", () => {
    page();

    const row = within(section(DENIED_SECTION)).getByRole("listitem");
    expect(row).toHaveTextContent("sam@unknown.example");
    expect(row).toHaveTextContent("denied 1d ago by ken@acme-robotics.dev");
    expect(row.querySelector(".accounts-row__github")).toBeNull();
    expect(within(row).getAllByRole("button").map((button) => button.textContent)).toEqual([
      APPROVE_LABEL,
    ]);
  });

  it("draws a pre-approved email with its note, who added it, and Remove", () => {
    page();

    const row = within(section(PREAPPROVED_SECTION)).getByRole("listitem");
    expect(row).toHaveTextContent("lee@acme-robotics.dev");
    expect(row).toHaveTextContent("starts Monday");
    expect(row).toHaveTextContent("added by ken@acme-robotics.dev · 2d ago");
    expect(
      within(row).getByRole("button", { name: "Remove lee@acme-robotics.dev" }),
    ).toBeInTheDocument();
  });

  it("says plainly when each section is empty", () => {
    page({ pending: [], denied: [], preapproved: [] });

    expect(within(section(PENDING_SECTION)).getByText(PENDING_EMPTY)).toBeInTheDocument();
    expect(within(section(DENIED_SECTION)).getByText(DENIED_EMPTY)).toBeInTheDocument();
    expect(within(section(PREAPPROVED_SECTION)).getByText(PREAPPROVED_EMPTY)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    // The add form stays: an empty list is where the first email is added.
    expect(screen.getByRole("button", { name: ADD_LABEL })).toBeInTheDocument();
  });
});

describe("approving", () => {
  it("approves a waiting account, toasts it and re-reads the page", async () => {
    page();

    fireEvent.click(within(section(PENDING_SECTION)).getByRole("button", { name: APPROVE_LABEL }));
    await settle();

    expect(approveAccount).toHaveBeenCalledExactlyOnceWith(ADMIN_ACCOUNT.id);
    expect(screen.getByRole("status")).toHaveTextContent("Approved priya@contractor.dev.");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("approves a denied account the same way", async () => {
    page();

    fireEvent.click(within(section(DENIED_SECTION)).getByRole("button", { name: APPROVE_LABEL }));
    await settle();

    expect(approveAccount).toHaveBeenCalledExactlyOnceWith(DENIED_ACCOUNT.id);
    expect(screen.getByRole("status")).toHaveTextContent("Approved sam@unknown.example.");
  });

  it("shows a refusal as an error toast and re-reads nothing", async () => {
    approveAccount.mockResolvedValue({ ok: false, reason: "Administrators only." });
    page();

    fireEvent.click(within(section(PENDING_SECTION)).getByRole("button", { name: APPROVE_LABEL }));
    await settle();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Administrators only.");
    expect(alert).toHaveClass("accounts-toast--error");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("holds every other button while one write is out", async () => {
    let finish: (value: Write) => void = () => {};
    approveAccount.mockReturnValue(
      new Promise<Write>((resolve) => {
        finish = resolve;
      }),
    );
    page();

    fireEvent.click(within(section(PENDING_SECTION)).getByRole("button", { name: APPROVE_LABEL }));
    await settle();

    expect(within(section(PENDING_SECTION)).getByRole("button", { name: WORKING_LABEL })).toBeInTheDocument();
    const deny = within(section(PENDING_SECTION)).getByRole("button", { name: DENY_LABEL });
    expect(deny).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(section(DENIED_SECTION)).getByRole("button", { name: APPROVE_LABEL }));
    expect(approveAccount).toHaveBeenCalledOnce();

    await act(async () => {
      finish(OK);
    });
  });
});

describe("denying", () => {
  it("asks first, with the email and what happens next", () => {
    page();

    fireEvent.click(within(section(PENDING_SECTION)).getByRole("button", { name: DENY_LABEL }));

    const dialog = screen.getByRole("alertdialog", { name: "Deny priya@contractor.dev?" });
    expect(dialog).toHaveTextContent(DENY_WARNING);
    expect(DENY_WARNING).toBe("They stay signed out until approved.");
    expect(denyAccount).not.toHaveBeenCalled();
  });

  it("denies on confirmation, toasts it and re-reads the page", async () => {
    page();

    fireEvent.click(within(section(PENDING_SECTION)).getByRole("button", { name: DENY_LABEL }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: DENY_LABEL }));
    await settle();

    expect(denyAccount).toHaveBeenCalledExactlyOnceWith(ADMIN_ACCOUNT.id);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Denied priya@contractor.dev.");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("denies nothing when cancelled", async () => {
    page();

    fireEvent.click(within(section(PENDING_SECTION)).getByRole("button", { name: DENY_LABEL }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: CANCEL_LABEL }));
    await settle();

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(denyAccount).not.toHaveBeenCalled();
  });

  it("reports the app-admin refusal as an error toast", async () => {
    denyAccount.mockResolvedValue({
      ok: false,
      reason: "An application administrator cannot be denied.",
    });
    page();

    fireEvent.click(within(section(PENDING_SECTION)).getByRole("button", { name: DENY_LABEL }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: DENY_LABEL }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "An application administrator cannot be denied.",
    );
  });
});

describe("the pre-approved list", () => {
  /**
   * Fill the add form and submit it.
   *
   * @param email The email to type.
   * @param note The note to type.
   */
  async function add(email: string, note = ""): Promise<void> {
    const card = section(PREAPPROVED_SECTION);
    fireEvent.change(within(card).getByRole("textbox", { name: EMAIL_LABEL }), {
      target: { value: email },
    });
    fireEvent.change(within(card).getByRole("textbox", { name: NOTE_LABEL }), {
      target: { value: note },
    });
    fireEvent.click(within(card).getByRole("button", { name: ADD_LABEL }));
    await settle();
  }

  it("adds an email with its note, toasts it, clears the form and re-reads", async () => {
    page();

    await add("New@Example.dev", "contractor");

    expect(addPreapprovedEmail).toHaveBeenCalledExactlyOnceWith("New@Example.dev", "contractor");
    expect(screen.getByRole("status")).toHaveTextContent("Pre-approved new@example.dev.");
    expect(screen.getByRole("textbox", { name: EMAIL_LABEL })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: NOTE_LABEL })).toHaveValue("");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("says when adding an email also approved somebody waiting with it — from the answer", async () => {
    addPreapprovedEmail.mockResolvedValue({
      ok: true,
      value: added("priya@contractor.dev", { ...ADMIN_ACCOUNT, status: "approved" }),
    });
    page();

    await add("Priya@contractor.dev");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Pre-approved priya@contractor.dev and approved their waiting account.",
    );
  });

  it("does not claim an approval the service did not make, even for a waiting email", async () => {
    // The pending list says Priya is waiting, but the answer approved nobody (a race with
    // another administrator): the toast follows the answer.
    page();

    await add("priya@contractor.dev");

    expect(screen.getByRole("status")).toHaveTextContent(/^Pre-approved priya@contractor\.dev\.$/);
  });

  it("refuses an empty email in place, sending nothing", async () => {
    page();

    await add("   ");

    expect(addPreapprovedEmail).not.toHaveBeenCalled();
    expect(screen.getByText(EMAIL_REQUIRED)).toBeInTheDocument();
  });

  it("keeps what was typed when the service refuses it", async () => {
    addPreapprovedEmail.mockResolvedValue({
      ok: false,
      reason: "That email is already pre-approved.",
    });
    page();

    await add("lee@acme-robotics.dev");

    expect(screen.getByRole("alert")).toHaveTextContent("That email is already pre-approved.");
    expect(screen.getByRole("textbox", { name: EMAIL_LABEL })).toHaveValue("lee@acme-robotics.dev");
  });

  it("removes an email and toasts it", async () => {
    page();

    fireEvent.click(screen.getByRole("button", { name: "Remove lee@acme-robotics.dev" }));
    await settle();

    expect(removePreapprovedEmail).toHaveBeenCalledExactlyOnceWith("lee@acme-robotics.dev");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Removed lee@acme-robotics.dev from the pre-approved list.",
    );
    expect(refresh).toHaveBeenCalledOnce();
  });
});
