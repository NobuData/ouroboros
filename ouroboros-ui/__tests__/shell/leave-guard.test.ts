import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isLeaveGuarded,
  requestLeave,
  resetLeaveGuard,
  setLeaveGuard,
} from "@/app/shell/leave-guard";

/**
 * The shell's leave guard (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)):
 * the one slot a page with unsaved work registers in, and the shell's own departures —
 * the palette's navigation, a workspace switch, signing out — ask before they go.
 */

beforeEach(() => {
  resetLeaveGuard();
});

describe("with no page asking", () => {
  it("leaves at once", () => {
    const proceed = vi.fn();

    requestLeave(proceed);

    expect(proceed).toHaveBeenCalledOnce();
    expect(isLeaveGuarded()).toBe(false);
  });
});

describe("with a page asking", () => {
  it("hands the departure to the page instead of making it", () => {
    const proceed = vi.fn();
    const guard = vi.fn();
    setLeaveGuard(guard);

    requestLeave(proceed);

    expect(isLeaveGuarded()).toBe(true);
    expect(proceed).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalledWith(proceed);
  });

  it("lets the page proceed later — after it has asked the reader", () => {
    const proceed = vi.fn();
    let held: (() => void) | undefined;
    setLeaveGuard((next) => {
      held = next;
    });

    requestLeave(proceed);
    expect(proceed).not.toHaveBeenCalled();

    held?.();
    expect(proceed).toHaveBeenCalledOnce();
  });

  it("stops asking once the page releases it", () => {
    const proceed = vi.fn();
    const guard = vi.fn();
    const release = setLeaveGuard(guard);

    release();
    requestLeave(proceed);

    expect(guard).not.toHaveBeenCalled();
    expect(proceed).toHaveBeenCalledOnce();
  });

  it("releases only its own guard, so a late cleanup cannot disarm the page that replaced it", () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = setLeaveGuard(first);
    setLeaveGuard(second);

    // The departed page's effect cleanup, running after the new page registered.
    releaseFirst();
    releaseFirst();
    requestLeave(vi.fn());

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
