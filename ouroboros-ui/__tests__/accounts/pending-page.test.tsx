import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountStanding } from "@/app/accounts/pending-data";
import {
  ACCOUNT_EYEBROW,
  DENIED_LEAD,
  DENIED_TITLE,
  PENDING_LEAD,
  PENDING_TITLE,
  SIGN_OUT_LABEL,
} from "@/app/accounts/pending";
import { DASHBOARD_PATH, LOGIN_PATH } from "@/app/paths";

/**
 * `/account-pending` — the waiting page (account approval): the pending and denied copy, the
 * **Sign out** action, and where an approved or signed-out visitor is sent instead.
 */

const readAccountStanding = vi.fn<() => Promise<AccountStanding>>();
const signOutOfSession = vi.fn<() => Promise<void>>();
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock("@/app/accounts/pending-data", () => ({
  readAccountStanding: () => readAccountStanding(),
}));
vi.mock("@/app/shell/actions", () => ({ signOutOfSession: () => signOutOfSession() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

const Page = (await import("@/app/(auth)/account-pending/page")).default;
const { PendingScreen } = await import("@/app/accounts/pending-screen");

beforeEach(() => {
  readAccountStanding
    .mockReset()
    .mockResolvedValue({ state: "held", status: "pending", email: "priya@contractor.dev" });
  signOutOfSession.mockReset().mockResolvedValue(undefined);
  redirect.mockClear();
});

describe("the route", () => {
  it("draws the pending copy for an account waiting for approval", async () => {
    render(await Page());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PENDING_TITLE);
    expect(screen.getByText(PENDING_LEAD)).toBeInTheDocument();
    expect(screen.getByText("Signed in as priya@contractor.dev")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SIGN_OUT_LABEL })).toBeInTheDocument();
  });

  it("draws the denied copy for a denied account", async () => {
    readAccountStanding.mockResolvedValue({
      state: "held",
      status: "denied",
      email: "sam@unknown.example",
    });

    render(await Page());

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(DENIED_TITLE);
    expect(screen.getByText(DENIED_LEAD)).toBeInTheDocument();
    expect(screen.queryByText(PENDING_TITLE)).toBeNull();
    expect(screen.getByRole("button", { name: SIGN_OUT_LABEL })).toBeInTheDocument();
  });

  it("sends an approved account to the dashboard", async () => {
    readAccountStanding.mockResolvedValue({ state: "approved" });

    await expect(Page()).rejects.toThrow(`NEXT_REDIRECT:${DASHBOARD_PATH}`);
  });

  it("sends nobody signed in to the login screen", async () => {
    readAccountStanding.mockResolvedValue({ state: "signed-out" });

    await expect(Page()).rejects.toThrow(`NEXT_REDIRECT:${LOGIN_PATH}`);
  });

  it("lets a failed read reach the error boundary", async () => {
    readAccountStanding.mockRejectedValue(new Error("outage"));

    await expect(Page()).rejects.toThrow("outage");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("the screen", () => {
  it("is one named main region with the eyebrow over the title", () => {
    render(<PendingScreen email="priya@contractor.dev" status="pending" />);

    const main = screen.getByRole("main", { name: PENDING_TITLE });
    expect(main).toHaveClass("accounts-pending");
    expect(main.querySelector(".accounts-pending__card")).not.toHaveClass(
      "accounts-pending__card--denied",
    );
    expect(screen.getByText(ACCOUNT_EYEBROW)).toBeInTheDocument();
  });

  it("marks the denied card so it draws in the error colours", () => {
    const { container } = render(<PendingScreen email="s@x.example" status="denied" />);

    expect(container.querySelector(".accounts-pending__card--denied")).not.toBeNull();
  });

  it("signs out through the shell's action, as a form", async () => {
    render(<PendingScreen email="priya@contractor.dev" status="pending" />);

    const button = screen.getByRole("button", { name: SIGN_OUT_LABEL });
    expect(button).toHaveAttribute("type", "submit");
    expect(button.closest("form")).not.toBeNull();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(signOutOfSession).toHaveBeenCalledOnce();
  });
});
