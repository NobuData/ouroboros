import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Reading } from "@/app/api/reading";
import { SWITCHED_OFF, SWITCH_READ_ONLY, switchLabel } from "@/app/providers/cards";
import {
  CANCEL_LABEL,
  SWITCH_OFF_CONFIRM,
  switchOffTitle,
} from "@/app/providers/keys";

/**
 * The provider card's switch (#228) — the one control on a card that changes something, and
 * therefore the one part of the card that can lie.
 *
 * The ticket's criterion is *the enable switch round-trips*, and it is held the way the
 * dashboard's switch is held: an owner's press persists and the route re-reads; a press the
 * service refused goes back, with the reason under the switch; a member's switch renders in
 * its real position, read-only, with the reason. What the action itself does is
 * `card-actions.test.ts`; it is replaced here.
 */

/** What the write answers, per case. */
const setProviderEnabled = vi.fn();

/** What tells the server's own render that the setting moved. */
const refresh = vi.fn();

vi.mock("@/app/providers/card-actions", () => ({
  setProviderEnabled: (id: string, enabled: boolean) => setProviderEnabled(id, enabled),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { ProviderSwitch } = await import("@/app/providers/provider-switch");

/** The seed's Anthropic card. */
const ID = "5eed000c-0000-4000-8000-000000000001";

/** Most tests are about the round trip, not the guard: a connection nothing depends on. */
const NO_DEPS: Reading<readonly string[]> = { ok: true, value: [] };

/** The switch, whatever it is drawn as. */
function control(): HTMLElement {
  return screen.getByRole("switch");
}

/**
 * A write this suite finishes itself — see `auto-merge-switch.test.tsx` for why a
 * never-settling promise would hold up every transition after it.
 */
function deferredWrite(): {
  promise: Promise<{ ok: boolean; enabled?: boolean; reason?: string }>;
  answer: (result: { ok: boolean; enabled?: boolean; reason?: string }) => void;
} {
  let answer!: (result: { ok: boolean; enabled?: boolean; reason?: string }) => void;
  const promise = new Promise<{ ok: boolean; enabled?: boolean; reason?: string }>((resolve) => {
    answer = resolve;
  });

  return { promise, answer };
}

beforeEach(() => {
  setProviderEnabled.mockReset().mockResolvedValue({ ok: true, enabled: false });
  refresh.mockReset();
});

describe("an administrator's press", () => {
  it("is named for what it controls, and carries its position in aria-checked", () => {
    render(<ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister dependents={NO_DEPS} />);

    expect(control()).toHaveAccessibleName(switchLabel("Anthropic Claude"));
    expect(control()).toHaveAttribute("aria-checked", "true");
    expect(control()).not.toHaveAttribute("aria-disabled");
  });

  it("moves the switch before the server has answered", async () => {
    const write = deferredWrite();
    setProviderEnabled.mockReturnValue(write.promise);
    render(<ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister dependents={NO_DEPS} />);

    fireEvent.click(control());

    expect(control()).toHaveAttribute("aria-checked", "false");

    write.answer({ ok: true, enabled: false });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("sends the connection and the position asked for, then re-reads the route", async () => {
    // The round trip: `PATCH {enabled: false}` for this connection, and a refresh so the card
    // is redrawn from the listing rather than from what this browser believes.
    render(<ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister dependents={NO_DEPS} />);

    fireEvent.click(control());

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(setProviderEnabled).toHaveBeenCalledWith(ID, false);
  });

  it("says under the switch that routing skips a card once it is off", async () => {
    render(<ProviderSwitch displayName="Anthropic Claude" enabled={false} id={ID} mayAdminister dependents={NO_DEPS} />);

    expect(screen.getByText(SWITCHED_OFF)).toBeInTheDocument();
    expect(control()).toHaveAccessibleDescription(SWITCHED_OFF);
    expect(screen.queryByRole("alert")).toBeNull();

    await Promise.resolve();
  });

  it("goes back and says why when the write did not take", async () => {
    setProviderEnabled.mockResolvedValue({ ok: false, reason: "The switch could not be saved." });
    render(<ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister dependents={NO_DEPS} />);

    fireEvent.click(control());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The switch could not be saved.");
    expect(alert).toHaveClass("providers-card__switch-note--err");
    expect(control()).toHaveAttribute("aria-checked", "true");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores a second press while the first is in flight", async () => {
    const write = deferredWrite();
    setProviderEnabled.mockReturnValue(write.promise);
    render(<ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister dependents={NO_DEPS} />);

    fireEvent.click(control());
    fireEvent.click(control());

    expect(setProviderEnabled).toHaveBeenCalledTimes(1);

    write.answer({ ok: true, enabled: false });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("draws the server's position once the route has re-read", () => {
    // Between transitions the switch draws its prop, so a change made elsewhere arrives as a
    // changed prop and is drawn — no local copy to fall out of step.
    const { rerender } = render(
      <ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister dependents={NO_DEPS} />,
    );

    rerender(<ProviderSwitch displayName="Anthropic Claude" enabled={false} id={ID} mayAdminister dependents={NO_DEPS} />);

    expect(control()).toHaveAttribute("aria-checked", "false");
  });
});

describe("a member's switch", () => {
  it("renders in its real position, read-only, with the reason as its tooltip and description", () => {
    render(
      <ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister={false} dependents={NO_DEPS} />,
    );

    expect(control()).toHaveAttribute("aria-checked", "true");
    expect(control()).toHaveAttribute("aria-disabled", "true");
    expect(control()).toHaveAttribute("title", SWITCH_READ_ONLY);
    expect(control()).toHaveAccessibleDescription(SWITCH_READ_ONLY);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does nothing when pressed", () => {
    render(
      <ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister={false} dependents={NO_DEPS} />,
    );

    fireEvent.click(control());

    expect(setProviderEnabled).not.toHaveBeenCalled();
    expect(control()).toHaveAttribute("aria-checked", "true");
  });

  it("says the read-only reason rather than the off-state note, one note at a time", () => {
    render(
      <ProviderSwitch displayName="Anthropic Claude" enabled={false} id={ID} mayAdminister={false} dependents={NO_DEPS} />,
    );

    expect(screen.getByText(SWITCH_READ_ONLY)).toBeInTheDocument();
    expect(screen.queryByText(SWITCHED_OFF)).toBeNull();
  });
});

describe("switching off a connection routes depend on", () => {
  const WITH_DEPS: Reading<readonly string[]> = { ok: true, value: ["coder-max", "local-docs"] };

  it("asks first, naming the routes, rather than switching off straight away", () => {
    render(<ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister dependents={WITH_DEPS} />);

    fireEvent.click(control());

    // Nothing has been written yet — the dialog is between the press and the write.
    expect(setProviderEnabled).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: switchOffTitle("Anthropic Claude") });
    expect(within(dialog).getByText("coder-max")).toBeInTheDocument();
    expect(within(dialog).getByText("local-docs")).toBeInTheDocument();
  });

  it("switches off once confirmed, and re-reads the route", async () => {
    render(<ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister dependents={WITH_DEPS} />);

    fireEvent.click(control());
    fireEvent.click(screen.getByRole("button", { name: SWITCH_OFF_CONFIRM }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(setProviderEnabled).toHaveBeenCalledWith(ID, false);
  });

  it("changes nothing when the confirmation is cancelled", () => {
    render(<ProviderSwitch displayName="Anthropic Claude" enabled id={ID} mayAdminister dependents={WITH_DEPS} />);

    fireEvent.click(control());
    fireEvent.click(screen.getByRole("button", { name: CANCEL_LABEL }));

    expect(setProviderEnabled).not.toHaveBeenCalled();
    expect(control()).toHaveAttribute("aria-checked", "true");
  });

  it("switches back on without asking — only taking routes down needs a confirmation", async () => {
    render(<ProviderSwitch displayName="Anthropic Claude" enabled={false} id={ID} mayAdminister dependents={WITH_DEPS} />);

    fireEvent.click(control());

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(setProviderEnabled).toHaveBeenCalledWith(ID, true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before switching off when the routes could not even be read", () => {
    render(
      <ProviderSwitch
        dependents={{ ok: false, reason: "the registry is away" }}
        displayName="Anthropic Claude"
        enabled
        id={ID}
        mayAdminister
      />,
    );

    fireEvent.click(control());

    expect(setProviderEnabled).not.toHaveBeenCalled();
    expect(screen.getByText(/the registry is away/)).toBeInTheDocument();
  });
});
