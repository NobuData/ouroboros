import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OLD_KEY_ACTIVE,
  SECRET_REQUIRED,
  TRY_AGAIN,
} from "@/app/providers/keys";

/**
 * The rotate (and first-save) dialog (#229): the state machine rendered honestly.
 *
 * The criterion this suite exists for is the failure path — *a failed rotation leaves the
 * old key working, and the UI says so explicitly*. The dialog draws entering → validating →
 * succeeded / failed, and the failed state stands the sentence {@link OLD_KEY_ACTIVE} beside
 * the provider's reason. What the server answers is `key-actions`'; the router is the shell's.
 */

const rotateCredential = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/providers/key-actions", () => ({
  rotateCredential: (id: string, secret: string) => rotateCredential(id, secret),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { SecretDialog } = await import("@/app/providers/secret-dialog");

const ID = "5eed000c-0000-4000-8000-000000000001";

/** A rotation this test finishes itself, so the validating state can be observed. */
function deferred() {
  let settle!: (value: { ok: boolean; mask?: string | null; reason?: string }) => void;
  const promise = new Promise<{ ok: boolean; mask?: string | null; reason?: string }>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

beforeEach(() => {
  rotateCredential.mockReset();
  refresh.mockReset();
});

/** Render the rotate dialog and type a new key. */
function open(mode: "rotate" | "save" = "rotate", onClose = vi.fn()) {
  render(<SecretDialog connectionId={ID} displayName="Anthropic Claude" mode={mode} onClose={onClose} />);
  return onClose;
}

describe("the rotate dialog", () => {
  it("will not submit an empty key", () => {
    open();
    fireEvent.submit(screen.getByLabelText("New key").closest("form")!);

    expect(rotateCredential).not.toHaveBeenCalled();
    expect(screen.getByText(SECRET_REQUIRED)).toBeInTheDocument();
  });

  it("passes through validating to a swapped state, and refreshes on close", async () => {
    const write = deferred();
    rotateCredential.mockReturnValue(write.promise);
    const onClose = open();

    fireEvent.change(screen.getByLabelText("New key"), { target: { value: "sk-new-7Kd2" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and swap" }));

    // Validating — the state announces itself.
    expect(await screen.findByText(/Checking the new key/)).toBeInTheDocument();

    write.settle({ ok: true, mask: "••••7Kd2" });

    expect(await screen.findByText(/Swapped\. The key now ends in ••••7Kd2\./)).toBeInTheDocument();
    expect(rotateCredential).toHaveBeenCalledWith(ID, "sk-new-7Kd2");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("on failure says the reason AND that the old key is still active — not a toast", async () => {
    rotateCredential.mockResolvedValue({ ok: false, reason: "The provider refused the new key — key rejected (401)." });
    open();

    fireEvent.change(screen.getByLabelText("New key"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and swap" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("key rejected (401)");
    // The whole point of the ticket, stated plainly beside the reason.
    expect(screen.getByText(OLD_KEY_ACTIVE)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns to the field from the failed state on Try again", async () => {
    rotateCredential.mockResolvedValue({ ok: false, reason: "refused" });
    open();

    fireEvent.change(screen.getByLabelText("New key"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and swap" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: TRY_AGAIN }));

    expect(screen.getByLabelText("New key")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not refresh when closed from a state that never swapped", async () => {
    rotateCredential.mockResolvedValue({ ok: false, reason: "refused" });
    const onClose = open();

    fireEvent.change(screen.getByLabelText("New key"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and swap" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(refresh).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(false);
  });
});

describe("the save dialog", () => {
  it("titles and submits itself as a first save", async () => {
    rotateCredential.mockResolvedValue({ ok: true, mask: "••••7Kd2" });
    open("save");

    expect(screen.getByRole("heading", { name: "Save a key for Anthropic Claude" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "sk-first" } });
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));

    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
  });
});
