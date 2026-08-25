import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANCEL_LABEL,
  REFERRERS_LABEL,
  SWITCH_OFF_CONFIRM,
  SWITCH_READ_ONLY,
  SWITCH_UNBOUND,
  type TableRow,
  switchLabel,
  switchOffNote,
  switchOffTitle,
  tableRows,
} from "@/app/registry/table";

import { registryAlias, seededRegistry } from "../helpers/registry";
import { settle } from "../helpers/settle";

/**
 * The allowed-models table's **On** switch (#592) — the one control in a row that changes
 * something, and therefore the one part of the table that can lie.
 *
 * The ticket's criteria are *toggling a switch round-trips through #584 and reflects
 * immediately* and *disabling a referenced alias shows a confirm naming the referrers;
 * cancelling leaves it enabled*, and they are held the way the provider card's switch is held:
 * an owner's press persists and the route re-reads; a press the service refused goes back,
 * with the reason under the switch; a referenced alias asks first; the unbound row's and a
 * member's switches render in their real positions, inert, with the reason. What the action
 * itself does is `switch-actions.test.ts`; it is replaced here.
 */

/** What the write answers, per case. */
const setAliasEnabled = vi.fn();

/** What tells the server's own render that the setting moved. */
const refresh = vi.fn();

vi.mock("@/app/registry/switch-actions", () => ({
  setAliasEnabled: (id: string, enabled: boolean) => setAliasEnabled(id, enabled),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { AliasSwitch } = await import("@/app/registry/alias-switch");

/** The seeded rows, decided, by alias. */
function seeded(alias: string): TableRow {
  const found = tableRows(seededRegistry()).find((row) => row.alias === alias);

  if (found === undefined) throw new Error(`no row for ${alias}`);
  return found;
}

/** A bound, enabled alias nothing references — the round trip with no guard in the way. */
const FREE: TableRow = tableRows([registryAlias({ alias: "scratch", usedBy: 0, references: [] })])[0]!;

/** The seeded `coder-std`: bound, enabled, referenced by two routes. */
const REFERENCED = seeded("coder-std");

/** The seeded orphan: unbound and off. */
const ORPHAN = seeded("gpt5-experiments");

/** The switch, whatever it is drawn as. */
function control(): HTMLElement {
  return screen.getByRole("switch");
}

/**
 * A write this suite finishes itself — a never-settling promise would hold up every
 * transition after it.
 */
function deferredWrite(): {
  promise: Promise<unknown>;
  answer: (result: unknown) => void;
} {
  let answer!: (result: unknown) => void;
  const promise = new Promise<unknown>((resolve) => {
    answer = resolve;
  });

  return { promise, answer };
}

beforeEach(() => {
  setAliasEnabled.mockReset().mockResolvedValue({ ok: true, enabled: false, droppedHops: [] });
  refresh.mockReset();
});

describe("an administrator's press", () => {
  it("is named for what it governs, and carries its position in aria-checked", () => {
    render(<AliasSwitch mayAdminister row={FREE} />);

    expect(control()).toHaveAccessibleName(switchLabel("scratch"));
    expect(control()).toHaveAttribute("aria-checked", "true");
    expect(control()).not.toHaveAttribute("aria-disabled");
  });

  it("moves the switch before the server has answered — reflects immediately", async () => {
    const write = deferredWrite();
    setAliasEnabled.mockReturnValue(write.promise);
    render(<AliasSwitch mayAdminister row={FREE} />);

    fireEvent.click(control());

    expect(control()).toHaveAttribute("aria-checked", "false");

    write.answer({ ok: true, enabled: false, droppedHops: [] });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("sends the alias and the position asked for, then re-reads the route", async () => {
    // The round trip through #584: `PATCH {enabled: false}` for this alias, and a refresh so
    // the row is redrawn from the payload rather than from what this browser believes.
    render(<AliasSwitch mayAdminister row={FREE} />);

    fireEvent.click(control());

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(setAliasEnabled).toHaveBeenCalledWith(FREE.id, false);
  });

  it("goes back and says why when the write did not take", async () => {
    setAliasEnabled.mockResolvedValue({ ok: false, reason: "The switch could not be saved." });
    render(<AliasSwitch mayAdminister row={FREE} />);

    fireEvent.click(control());

    const alert = await screen.findByRole("alert");
    // The alert is the failed write's output; the transition that reverts the optimistic
    // position ends a turn later, and this waits for it (`../helpers/settle.ts`).
    await settle();
    expect(alert).toHaveTextContent("The switch could not be saved.");
    expect(alert).toHaveClass("registry-switch__note--err");
    expect(control()).toHaveAttribute("aria-checked", "true");
    expect(control()).toHaveAccessibleDescription("The switch could not be saved.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores a second press while the first is in flight", async () => {
    const write = deferredWrite();
    setAliasEnabled.mockReturnValue(write.promise);
    render(<AliasSwitch mayAdminister row={FREE} />);

    fireEvent.click(control());
    fireEvent.click(control());

    expect(setAliasEnabled).toHaveBeenCalledTimes(1);

    write.answer({ ok: true, enabled: false, droppedHops: [] });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("draws the server's position once the route has re-read", () => {
    // Between transitions the switch draws its prop, so a change made elsewhere arrives as a
    // changed prop and is drawn — no local copy to fall out of step.
    const { rerender } = render(<AliasSwitch mayAdminister row={FREE} />);

    rerender(<AliasSwitch mayAdminister row={{ ...FREE, enabled: false }} />);

    expect(control()).toHaveAttribute("aria-checked", "false");
  });

  it("switches a disabled alias back on without asking", async () => {
    render(<AliasSwitch mayAdminister row={{ ...REFERENCED, enabled: false }} />);

    fireEvent.click(control());

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(setAliasEnabled).toHaveBeenCalledWith(REFERENCED.id, true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("switching off an alias routes depend on", () => {
  it("asks first, naming the referrers and the consequence, and writes nothing yet", () => {
    render(<AliasSwitch mayAdminister row={REFERENCED} />);

    fireEvent.click(control());

    expect(setAliasEnabled).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: switchOffTitle("coder-std") });
    expect(within(dialog).getByText(switchOffNote(2))).toBeInTheDocument();
    const referrers = within(dialog).getByRole("list", { name: REFERRERS_LABEL });
    expect(within(referrers).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "plan-primary",
      "review-primary",
    ]);
    // Nothing has moved: the switch is still on behind the dialog.
    expect(control()).toHaveAttribute("aria-checked", "true");
  });

  it("switches off once confirmed, and re-reads the route", async () => {
    render(<AliasSwitch mayAdminister row={REFERENCED} />);

    fireEvent.click(control());
    fireEvent.click(screen.getByRole("button", { name: SWITCH_OFF_CONFIRM }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(setAliasEnabled).toHaveBeenCalledWith(REFERENCED.id, false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changes nothing when the confirmation is cancelled — the alias stays enabled", () => {
    render(<AliasSwitch mayAdminister row={REFERENCED} />);

    fireEvent.click(control());
    fireEvent.click(screen.getByRole("button", { name: CANCEL_LABEL }));

    expect(setAliasEnabled).not.toHaveBeenCalled();
    expect(control()).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changes nothing on Escape either", () => {
    render(<AliasSwitch mayAdminister row={REFERENCED} />);

    fireEvent.click(control());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(setAliasEnabled).not.toHaveBeenCalled();
    expect(control()).toHaveAttribute("aria-checked", "true");
  });

  it("does not ask for an alias nothing references", async () => {
    render(<AliasSwitch mayAdminister row={FREE} />);

    fireEvent.click(control());

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the unbound row's switch", () => {
  it("renders off, inert, with the reason as its tooltip", () => {
    render(<AliasSwitch mayAdminister row={ORPHAN} />);

    expect(control()).toHaveAttribute("aria-checked", "false");
    expect(control()).toHaveAttribute("aria-disabled", "true");
    expect(control()).toHaveAttribute("title", SWITCH_UNBOUND);
  });

  it("does nothing when pressed — the contract would refuse it, and this says so first", () => {
    render(<AliasSwitch mayAdminister row={ORPHAN} />);

    fireEvent.click(control());

    expect(setAliasEnabled).not.toHaveBeenCalled();
    expect(control()).toHaveAttribute("aria-checked", "false");
  });

  it("stays reachable, so its explanation is reachable too", () => {
    render(<AliasSwitch mayAdminister row={ORPHAN} />);

    expect((control() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("a member's switch", () => {
  it("renders in its real position, read-only, with the reason as its tooltip", () => {
    render(<AliasSwitch mayAdminister={false} row={REFERENCED} />);

    expect(control()).toHaveAttribute("aria-checked", "true");
    expect(control()).toHaveAttribute("aria-disabled", "true");
    expect(control()).toHaveAttribute("title", SWITCH_READ_ONLY);
  });

  it("does nothing when pressed", () => {
    render(<AliasSwitch mayAdminister={false} row={REFERENCED} />);

    fireEvent.click(control());

    expect(setAliasEnabled).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is told about their role rather than about a binding they could not change either", () => {
    render(<AliasSwitch mayAdminister={false} row={ORPHAN} />);

    expect(control()).toHaveAttribute("title", SWITCH_READ_ONLY);
  });
});
