import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceLifecycle } from "@/app/api/settings-lifecycle";
import type { LifecycleOutcome } from "@/app/lifecycle/outcome";
import {
  COUNTDOWN_LABEL,
  COUNTDOWN_TICK_MS,
  FROZEN_FACTS,
  NON_OWNER_NOTE,
  OWNER_NOTE,
  RESTORE_FAILED,
  RESTORE_LABEL,
  SIGN_OUT_LABEL,
  WINDOW_CLOSED,
} from "@/app/lifecycle/recovery";
import { DASHBOARD_PATH } from "@/app/paths";

import { CHANGED_AT, PURGE_AFTER, lifecycle } from "../helpers/lifecycle";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The pending-delete lockout screen, rendered (BS.6,
 * [#496](https://github.com/NobuData/ouroboros/issues/496)): a live countdown, what is frozen,
 * **Restore** for an owner — and for anybody else an explanation of who can act, never a dead
 * end.
 */

const restoreWorkspace = vi.fn<() => Promise<LifecycleOutcome<WorkspaceLifecycle>>>();
const switchWorkspace = vi.fn<(id: string) => Promise<string | null>>();
const signOutOfSession = vi.fn<() => Promise<void>>();

vi.mock("@/app/lifecycle/lifecycle-actions", () => ({
  restoreWorkspace: () => restoreWorkspace(),
}));
vi.mock("@/app/shell/switch-workspace", () => ({
  switchWorkspace: (id: string) => switchWorkspace(id),
}));
vi.mock("@/app/shell/actions", () => ({ signOutOfSession: () => signOutOfSession() }));

const { RecoveryScreen } = await import("@/app/lifecycle/recovery-screen");

/** A minute after the deletion was requested. */
const JUST_AFTER = Date.parse(CHANGED_AT) + 60_000;

const leave = vi.fn<(path: string) => void>();

/**
 * The screen for a reader.
 *
 * @param props Props to replace.
 * @returns The element.
 */
function recovery(props: Partial<Parameters<typeof RecoveryScreen>[0]> = {}) {
  return (
    <RecoveryScreen
      leave={leave}
      now={() => JUST_AFTER}
      others={[{ id: "org-personal", name: "ken-personal" }]}
      purgeAfter={PURGE_AFTER}
      restorable
      workspaceName="acme-robotics"
      {...props}
    />
  );
}

beforeEach(() => {
  restoreWorkspace.mockReset();
  switchWorkspace.mockReset();
  leave.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("what it says", () => {
  it("names the workspace, the day the window closes, and what is frozen", () => {
    render(recovery());

    const main = screen.getByRole("main", { name: "acme-robotics is scheduled for deletion" });

    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(
      "acme-robotics is scheduled for deletion",
    );
    expect(main).toHaveTextContent("Its data is kept until 2026-11-04 (UTC), then destroyed.");
    expect(within(main).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      ...FROZEN_FACTS,
    ]);
  });

  it("counts down — 29d 23h to recover — and moves as time does", () => {
    vi.useFakeTimers();
    let clock = JUST_AFTER;
    render(recovery({ now: () => clock }));

    const timer = screen.getByRole("timer", { name: COUNTDOWN_LABEL });
    expect(timer).toHaveTextContent("29d 23h to recover");

    clock += 60 * 60_000;
    act(() => {
      vi.advanceTimersByTime(COUNTDOWN_TICK_MS);
    });

    expect(timer).toHaveTextContent("29d 22h to recover");
  });

  it("says the window is closed once it is, and still offers the restore", () => {
    render(recovery({ now: () => Date.parse(PURGE_AFTER) + 1 }));

    expect(screen.getByRole("timer")).toHaveTextContent(WINDOW_CLOSED);
    expect(screen.getByRole("button", { name: RESTORE_LABEL })).toBeInTheDocument();
  });
});

describe("an owner", () => {
  it("is told what restoring does, and offered it", () => {
    render(recovery());

    expect(screen.getByRole("note")).toHaveTextContent(OWNER_NOTE);
    expect(screen.getByRole("button", { name: RESTORE_LABEL })).toBeInTheDocument();
  });

  it("restores, and leaves for the dashboard", async () => {
    restoreWorkspace.mockResolvedValue({ ok: true, value: lifecycle() });
    render(recovery());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RESTORE_LABEL }));
    });

    expect(restoreWorkspace).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledExactlyOnceWith(DASHBOARD_PATH);
  });

  it("stays on the screen with the service's sentence when the restore is refused", async () => {
    restoreWorkspace.mockResolvedValue({
      ok: false,
      reason: "The purge has begun; this workspace cannot be restored.",
      code: "workspace_state_conflict",
    });
    render(recovery());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RESTORE_LABEL }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The purge has begun; this workspace cannot be restored.",
    );
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: RESTORE_LABEL })).toBeInTheDocument();
  });

  it("says something when the refusal carried no sentence, and sends one restore for two presses", async () => {
    let answer!: (outcome: LifecycleOutcome<WorkspaceLifecycle>) => void;
    restoreWorkspace.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(recovery());

    const button = screen.getByRole("button", { name: RESTORE_LABEL });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(restoreWorkspace).toHaveBeenCalledOnce();

    await act(async () => {
      answer({ ok: false, reason: "", code: "unavailable" });
    });

    expect(screen.getByRole("alert")).toHaveTextContent(RESTORE_FAILED);
  });
});

describe("anybody else", () => {
  it("sees the frozen state and who can act — and no restore", () => {
    render(recovery({ restorable: false }));

    expect(screen.getByRole("note")).toHaveTextContent(NON_OWNER_NOTE);
    expect(screen.queryByRole("button", { name: RESTORE_LABEL })).toBeNull();
    expect(screen.getByRole("timer")).toHaveTextContent("29d 23h to recover");
    expect(document.querySelector("[disabled], [aria-disabled='true']")).toBeNull();
  });

  it("claims no figure when the refusal did not say when the window closes", () => {
    render(recovery({ restorable: false, purgeAfter: null }));

    expect(screen.getByRole("timer")).toHaveTextContent("30-day recovery window");
  });
});

describe("the ways out", () => {
  it("opens another workspace, and leaves for its dashboard", async () => {
    switchWorkspace.mockResolvedValue(null);
    render(recovery({ restorable: false }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open ken-personal" }));
    });

    expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith("org-personal");
    expect(leave).toHaveBeenCalledExactlyOnceWith(DASHBOARD_PATH);
  });

  it("says why when the other workspace could not be opened", async () => {
    switchWorkspace.mockResolvedValue("That workspace could not be opened.");
    render(recovery({ restorable: false }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open ken-personal" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("That workspace could not be opened.");
    expect(leave).not.toHaveBeenCalled();
  });

  it("always offers signing out, as a form anybody can submit", () => {
    render(recovery({ restorable: false, others: [] }));

    const signOut = screen.getByRole("button", { name: SIGN_OUT_LABEL });

    expect(signOut).toHaveAttribute("type", "submit");
    expect(signOut.closest("form")).not.toBeNull();
  });
});

describe("both palettes", () => {
  it("draws the same markup in both, for an owner and for anybody else", () => {
    for (const restorable of [true, false]) {
      const [light, dark] = renderInBothPalettes(recovery({ restorable }));

      expect(maskIds(light!), String(restorable)).toBe(maskIds(dark!));
      expect(light).toContain("lifecycle-recovery__countdown");
    }
  });
});
