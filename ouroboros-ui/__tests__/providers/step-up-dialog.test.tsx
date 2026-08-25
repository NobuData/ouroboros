import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PASSWORD_REQUIRED,
  STEP_UP_FAILED,
  STEP_UP_SIGN_IN,
} from "@/app/providers/keys";

/**
 * The step-up challenge (#229): the friction the reveal earns, made to read as intentional.
 *
 * It collects a password and hands it to the reveal; a *success* or a *plain refusal* goes
 * back to the key row through `onResult`, while a *further step-up* — a wrong password —
 * keeps the dialog open and says {@link STEP_UP_FAILED} and nothing more specific, because
 * the service answers a wrong password exactly as an absent one. The fresh-sign-in path is
 * always offered, and is the only method a GitHub-only account has.
 */

const revealCredential = vi.fn();

vi.mock("@/app/providers/key-actions", () => ({
  revealCredential: (id: string, password?: string) => revealCredential(id, password),
  reauthenticate: vi.fn(),
}));

const { StepUpDialog } = await import("@/app/providers/step-up-dialog");

const ID = "5eed000c-0000-4000-8000-000000000001";

/** Render the dialog with both methods offered. */
function open(onResult = vi.fn(), methods: ("session" | "password")[] = ["session", "password"]) {
  render(
    <StepUpDialog
      connectionId={ID}
      displayName="Anthropic Claude"
      maxAgeSeconds={300}
      methods={methods}
      onResult={onResult}
    />,
  );
  return onResult;
}

beforeEach(() => {
  revealCredential.mockReset();
});

describe("the password path", () => {
  it("will not submit an empty password", () => {
    open();
    fireEvent.submit(screen.getByLabelText("Your password").closest("form")!);

    expect(revealCredential).not.toHaveBeenCalled();
    expect(screen.getByText(PASSWORD_REQUIRED)).toBeInTheDocument();
  });

  it("confirms with the password, and hands a success back to the caller", async () => {
    const revealed = { ok: true, connectionId: ID, value: "sk-real", expiresAt: "2026-08-23T10:01:00.000Z" };
    revealCredential.mockResolvedValue(revealed);
    const onResult = open();

    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and reveal" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(revealed));
    expect(revealCredential).toHaveBeenCalledWith(ID, "hunter2");
  });

  it("stays open and says the same thing for a wrong password as for none", async () => {
    // A further step-up means the password did not confirm it.
    revealCredential.mockResolvedValue({ ok: false, kind: "step-up", methods: ["session", "password"], maxAgeSeconds: 300 });
    const onResult = open();

    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and reveal" }));

    expect(await screen.findByText(STEP_UP_FAILED)).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("hands a plain refusal back rather than keeping the dialog", async () => {
    const refusal = { ok: false, kind: "refused", reason: "Too many attempts." };
    revealCredential.mockResolvedValue(refusal);
    const onResult = open();

    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and reveal" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(refusal));
  });
});

describe("the sign-in path", () => {
  it("is always offered, over a form that posts the re-authentication action", () => {
    open();

    expect(screen.getByRole("button", { name: STEP_UP_SIGN_IN })).toBeInTheDocument();
  });

  it("is the only control when the challenge named no method this page can offer", () => {
    open(vi.fn(), []);

    expect(screen.queryByLabelText("Your password")).toBeNull();
    expect(screen.getByRole("button", { name: STEP_UP_SIGN_IN })).toBeInTheDocument();
  });
});
