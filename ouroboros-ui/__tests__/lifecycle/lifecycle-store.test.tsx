import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceLifecycle } from "@/app/api/settings-lifecycle";
import { requestSummaryRefresh } from "@/app/dashboard/summary-refresh";
import { LifecycleProvider, useLifecycle } from "@/app/lifecycle/lifecycle-store";
import { RECOVERY_PATH } from "@/app/paths";
import type { PollAnswer } from "@/app/poll";

import { lifecycle, pausedLifecycle, pendingDeleteLifecycle } from "../helpers/lifecycle";

/**
 * The lifecycle store (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)): one poll
 * for the shell, a write's answer shown at once and then confirmed, and a frozen workspace
 * leaving for the recovery screen.
 */

/**
 * A fresh poll answer.
 *
 * @param payload The lifecycle.
 * @returns The answer.
 */
function fresh(payload: WorkspaceLifecycle): PollAnswer<WorkspaceLifecycle> {
  return { state: "fresh", payload, etag: null, pollAfterSeconds: null };
}

/** The handle the probe last read. */
let handle: ReturnType<typeof useLifecycle>;

/** Draws the state, and keeps the handle. */
function Probe() {
  const read = useLifecycle();

  useEffect(() => {
    handle = read;
  });

  return <p>{read.lifecycle?.state ?? "unknown"}</p>;
}

describe("useLifecycle", () => {
  it("outside a provider knows nothing, and its writes do nothing", async () => {
    render(<Probe />);

    expect(screen.getByText("unknown")).toBeInTheDocument();
    handle.apply(pausedLifecycle());
    await expect(handle.refresh()).resolves.toBeUndefined();
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });
});

describe("LifecycleProvider", () => {
  it("knows nothing before the first answer, then what the poll read", async () => {
    let answer!: (value: PollAnswer<WorkspaceLifecycle>) => void;
    const read = vi.fn(() => new Promise<PollAnswer<WorkspaceLifecycle>>((resolve) => (answer = resolve)));

    render(
      <LifecycleProvider poll={{ read, visible: () => true }}>
        <Probe />
      </LifecycleProvider>,
    );

    expect(screen.getByText("unknown")).toBeInTheDocument();

    await act(async () => {
      answer(fresh(pausedLifecycle()));
    });

    expect(screen.getByText("paused")).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("shows a write's answer at once, and asks the poll to confirm it", async () => {
    let clock = 1_000;
    const read = vi.fn().mockResolvedValue(fresh(pausedLifecycle()));

    render(
      <LifecycleProvider poll={{ read, visible: () => true, now: () => clock }}>
        <Probe />
      </LifecycleProvider>,
    );
    await screen.findByText("paused");

    // The resume landed: the service's next answer will say active.
    read.mockResolvedValue(fresh(lifecycle()));
    clock = 2_000;
    act(() => {
      handle.apply(lifecycle());
    });

    expect(screen.getByText("active")).toBeInTheDocument();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it("lets a poll that answers after a write have the last word", async () => {
    let clock = 1_000;
    const read = vi.fn().mockResolvedValue(fresh(lifecycle()));

    render(
      <LifecycleProvider poll={{ read, visible: () => true, now: () => clock }}>
        <Probe />
      </LifecycleProvider>,
    );
    await screen.findByText("active");

    // Applied as paused — and the service, asked a moment later, says somebody resumed.
    clock = 2_000;
    act(() => {
      handle.apply(pausedLifecycle());
    });
    expect(screen.getByText("paused")).toBeInTheDocument();

    clock = 3_000;
    await act(async () => {
      await handle.refresh();
    });

    await screen.findByText("active");
  });

  it("re-reads when the workspace is switched", async () => {
    const read = vi.fn().mockResolvedValue(fresh(lifecycle()));

    render(
      <LifecycleProvider poll={{ read, visible: () => true }}>
        <Probe />
      </LifecycleProvider>,
    );
    await screen.findByText("active");

    read.mockResolvedValue(fresh(pausedLifecycle()));
    act(() => {
      requestSummaryRefresh();
    });

    await screen.findByText("paused");
  });

  it("leaves for the recovery screen the moment the workspace is pending deletion", async () => {
    const leave = vi.fn();
    const read = vi.fn().mockResolvedValue(fresh(pendingDeleteLifecycle()));

    render(
      <LifecycleProvider leave={leave} poll={{ read, visible: () => true }}>
        <Probe />
      </LifecycleProvider>,
    );

    await vi.waitFor(() => expect(leave).toHaveBeenCalledExactlyOnceWith(RECOVERY_PATH));
  });

  it("stays put for a workspace that is active or paused", async () => {
    const leave = vi.fn();
    const read = vi.fn().mockResolvedValue(fresh(pausedLifecycle()));

    render(
      <LifecycleProvider leave={leave} poll={{ read, visible: () => true }}>
        <Probe />
      </LifecycleProvider>,
    );
    await screen.findByText("paused");

    expect(leave).not.toHaveBeenCalled();
  });
});
