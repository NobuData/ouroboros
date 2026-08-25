import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SecretRow } from "@/app/providers/cards";
import {
  COPIED,
  MASK_NOW,
  REVEAL_RECORDED,
  STEP_UP_TITLE,
  masksIn,
} from "@/app/providers/keys";

/**
 * The key row's live controls (#229): Reveal, Rotate/Save, and everything a revealed value
 * carries.
 *
 * The criteria this suite holds are the reveal's: a click with no recent auth raises the
 * step-up dialog; a revealed value shows its countdown and its audited-notice, offers a copy
 * that claims nothing, and **auto-masks on the timer and on navigating away**. What the
 * server actually answers is `key-actions`'; the clock and the router are the shell's; all
 * three are replaced so this is about the row's own state machine.
 */

const revealCredential = vi.fn();
const clock = vi.hoisted(() => ({ now: 0 }));
const nav = vi.hoisted(() => ({ path: "/models/providers" }));

vi.mock("@/app/providers/key-actions", () => ({
  revealCredential: (id: string, password?: string) => revealCredential(id, password),
  rotateCredential: vi.fn(),
  reauthenticate: vi.fn(),
}));
vi.mock("@/app/shell/clock", () => ({ useSecondsNow: () => clock.now }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => nav.path,
}));

const { KeyRow } = await import("@/app/providers/key-row");

const ID = "5eed000c-0000-4000-8000-000000000001";
const SECRET: SecretRow = { label: "API key", mask: "••••Xq4A", placeholder: null };

/** An expiry 30 seconds ahead of the clock's default reading. */
const EXPIRES_AT = "2026-08-23T10:01:00.000Z";
const EXPIRY_S = Math.floor(Date.parse(EXPIRES_AT) / 1000);

/** A reveal that succeeds with a live value. */
function revealed(value = "sk-ant-api03-real-Xq4A") {
  revealCredential.mockResolvedValue({ ok: true, connectionId: ID, value, expiresAt: EXPIRES_AT });
}

beforeEach(() => {
  revealCredential.mockReset();
  clock.now = EXPIRY_S - 30;
  nav.path = "/models/providers";
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("an administrator's row", () => {
  it("draws the masked value with Reveal and Rotate", () => {
    render(<KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister secret={SECRET} />);

    expect(screen.getByLabelText("API key")).toHaveValue("••••Xq4A");
    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotate" })).toBeInTheDocument();
  });

  it("shows the value, its countdown and the audited-notice once revealed", async () => {
    revealed();
    render(<KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister secret={SECRET} />);

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

    expect(await screen.findByDisplayValue("sk-ant-api03-real-Xq4A")).toBeInTheDocument();
    expect(screen.getByText(masksIn(30))).toBeInTheDocument();
    expect(screen.getByText(REVEAL_RECORDED)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(revealCredential).toHaveBeenCalledWith(ID, undefined);
  });

  it("copies the value and says so, claiming nothing about the clipboard", async () => {
    revealed();
    render(<KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister secret={SECRET} />);

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    await screen.findByDisplayValue("sk-ant-api03-real-Xq4A");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(screen.getByText(COPIED)).toBeInTheDocument());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("sk-ant-api03-real-Xq4A");
  });

  it("auto-masks when the countdown reaches expiry", async () => {
    revealed();
    const view = render(
      <KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister secret={SECRET} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    await screen.findByDisplayValue("sk-ant-api03-real-Xq4A");

    // The shared clock reaches the value's expiry.
    clock.now = EXPIRY_S;
    view.rerender(<KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister secret={SECRET} />);

    await waitFor(() => expect(screen.queryByDisplayValue("sk-ant-api03-real-Xq4A")).toBeNull());
    expect(screen.getByLabelText("API key")).toHaveValue("••••Xq4A");
  });

  it("auto-masks when the reader navigates away", async () => {
    revealed();
    const view = render(
      <KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister secret={SECRET} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    await screen.findByDisplayValue("sk-ant-api03-real-Xq4A");

    // A client-side navigation changes the path this island re-renders on.
    nav.path = "/models/registry";
    view.rerender(<KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister secret={SECRET} />);

    await waitFor(() => expect(screen.queryByDisplayValue("sk-ant-api03-real-Xq4A")).toBeNull());
  });

  it("raises the step-up dialog when the service asks for a recent re-authentication", async () => {
    revealCredential.mockResolvedValue({
      ok: false,
      kind: "step-up",
      methods: ["session", "password"],
      maxAgeSeconds: 300,
    });
    render(<KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister secret={SECRET} />);

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

    expect(await screen.findByRole("dialog", { name: STEP_UP_TITLE })).toBeInTheDocument();
  });

  it("says why under the row when a reveal is refused outright", async () => {
    revealCredential.mockResolvedValue({ ok: false, kind: "refused", reason: "This connection stores no key to reveal." });
    render(<KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister secret={SECRET} />);

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("stores no key");
  });

  it("opens the rotate dialog from Rotate", () => {
    render(<KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister secret={SECRET} />);

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));

    expect(screen.getByRole("dialog", { name: "Rotate Anthropic Claude's key" })).toBeInTheDocument();
  });

  it("draws Save and no Reveal for an empty optional key", () => {
    render(
      <KeyRow
        connectionId={ID}
        displayName="Local vLLM"
        mayAdminister
        secret={{ label: "API key", mask: null, placeholder: "API key — optional" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).toBeNull();
  });
});

describe("a member's row", () => {
  it("shows the masked value but no acting buttons at all", () => {
    render(<KeyRow connectionId={ID} displayName="Anthropic Claude" mayAdminister={false} secret={SECRET} />);

    expect(screen.getByLabelText("API key")).toHaveValue("••••Xq4A");
    expect(screen.queryByRole("button", { name: "Reveal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rotate" })).toBeNull();
    expect(screen.queryByRole("button", { name: MASK_NOW })).toBeNull();
  });
});
