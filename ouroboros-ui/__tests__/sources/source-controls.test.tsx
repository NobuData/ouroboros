import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StatusOutcome, StatusReading, SyncOutcome, TestOutcome } from "@/app/sources/actions";
import {
  PAUSE_LABEL,
  PAUSE_READ_ONLY,
  RESUME_LABEL,
  SYNC_LABEL,
  SYNC_PAUSED,
  SYNC_READ_ONLY,
  SYNC_RUNNING,
  SYNC_STARTED,
  TESTING,
  TEST_LABEL,
  TEST_READ_ONLY,
  syncTooSoon,
  syncWaitReason,
} from "@/app/sources/view";

import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { SEEDED_GITHUB_ID, failedSource, jiraSource, refusedTest, source, statusReport, testResult } from "../helpers/sources";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  testSource: vi.fn<(id: string) => Promise<TestOutcome>>(),
  syncSource: vi.fn<(id: string) => Promise<SyncOutcome>>(),
  readSourceStatus: vi.fn<(id: string) => Promise<StatusReading>>(),
  setSourceStatus: vi.fn<(id: string, status: string) => Promise<StatusOutcome>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/app/sources/actions", () => ({
  testSource: (id: string) => state.testSource(id),
  syncSource: (id: string) => state.syncSource(id),
  readSourceStatus: (id: string) => state.readSourceStatus(id),
  setSourceStatus: (id: string, status: string) => state.setSourceStatus(id, status),
}));

const { SYNC_POLL_MS, SourceControls } = await import("@/app/sources/source-controls");

/**
 * A row's live controls ([#141](https://github.com/NobuData/ouroboros/issues/141)): the test
 * note draws what the provider said, the sync is refused where the service would refuse it
 * and watched where it is accepted, and the pause is a position rather than a toggle.
 */

function controls(over: Partial<Parameters<typeof SourceControls>[0]> = {}) {
  return render(
    <SourceControls mayAdminister source={source()} status={statusReport()} {...over} />,
  );
}

beforeEach(() => {
  for (const fn of Object.values(state)) fn.mockReset();
  state.testSource.mockResolvedValue({ ok: true, result: testResult() });
  state.syncSource.mockResolvedValue({ ok: true, status: statusReport({ running: true }) });
  state.readSourceStatus.mockResolvedValue({ ok: true, status: statusReport() });
  state.setSourceStatus.mockResolvedValue({ ok: true, status: "paused" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Test connection", () => {
  it("draws a pass as the provider's own detail, in the ok hue, and writes nothing", async () => {
    controls();

    fireEvent.click(screen.getByRole("button", { name: TEST_LABEL }));

    expect(await screen.findByText(TESTING)).toBeInTheDocument();

    const note = await screen.findByRole("status");

    expect(note).toHaveTextContent("✓ acme-robotics · 4 repositories");
    expect(note).toHaveClass("sources-row__note--ok");
    expect(state.testSource).toHaveBeenCalledWith(SEEDED_GITHUB_ID);
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it("draws a refused token as the taxonomy's sentence and the provider's words, in the error hue", async () => {
    state.testSource.mockResolvedValue({ ok: true, result: refusedTest() });
    controls();

    fireEvent.click(screen.getByRole("button", { name: TEST_LABEL }));

    const note = await screen.findByText(/credentials rejected — GitHub refused the token/);

    expect(note).toHaveClass("sources-row__note--err");
  });

  it("draws a refusal of the request as an alert", async () => {
    state.testSource.mockResolvedValue({ ok: false, reason: "no" });
    controls();

    fireEvent.click(screen.getByRole("button", { name: TEST_LABEL }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no");
  });

  it("is inert for a member, with the reason", () => {
    controls({ mayAdminister: false });

    expect(screen.getByRole("button", { name: TEST_LABEL })).toHaveAttribute("title", TEST_READ_ONLY);
    fireEvent.click(screen.getByRole("button", { name: TEST_LABEL }));
    expect(state.testSource).not.toHaveBeenCalled();
  });
});

describe("Sync now", () => {
  it("is inert where the service would refuse: a member, a paused row, a running sync, the interval", () => {
    const { unmount: a } = controls({ mayAdminister: false });
    expect(screen.getByRole("button", { name: SYNC_LABEL })).toHaveAttribute("title", SYNC_READ_ONLY);
    a();

    const { unmount: b } = controls({ source: jiraSource(), status: null });
    expect(screen.getByRole("button", { name: SYNC_LABEL })).toHaveAttribute("title", SYNC_PAUSED);
    b();

    const { unmount: c } = controls({ status: statusReport({ running: true }) });
    expect(screen.getByRole("button", { name: SYNC_LABEL })).toHaveAttribute("title", SYNC_RUNNING);
    c();

    controls({ status: statusReport({ retryAfterSeconds: 22 }) });
    expect(screen.getByRole("button", { name: SYNC_LABEL })).toHaveAttribute("title", syncWaitReason(22));
  });

  it("is live for a failed source, because syncing is how a person retries", () => {
    controls({ source: failedSource(), status: null });

    expect(screen.getByRole("button", { name: SYNC_LABEL })).not.toHaveAttribute("aria-disabled");
  });

  it("starts a sync, refreshes the row, and watches until it lands", async () => {
    vi.useFakeTimers();
    state.readSourceStatus
      .mockResolvedValueOnce({ ok: true, status: statusReport({ running: true }) })
      .mockResolvedValueOnce({ ok: true, status: statusReport({ running: false }) });
    controls();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: SYNC_LABEL }));
    });

    expect(state.syncSource).toHaveBeenCalledWith(SEEDED_GITHUB_ID);
    expect(screen.getByRole("status")).toHaveTextContent(SYNC_STARTED);
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: SYNC_LABEL })).toHaveAttribute("title", SYNC_RUNNING);

    // First read: still running. Second: landed — the route refreshes again and the note
    // says what the sync did.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_POLL_MS);
    });
    expect(state.readSourceStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_POLL_MS);
    });
    expect(state.readSourceStatus).toHaveBeenCalledTimes(2);
    expect(state.refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("last sync imported 2 · updated 1 · unchanged 6");
  });

  it("draws the service's refusal as an alert, and offers the control again", async () => {
    state.syncSource.mockResolvedValue({ ok: false, reason: syncTooSoon(9) });
    controls();

    fireEvent.click(screen.getByRole("button", { name: SYNC_LABEL }));

    expect(await screen.findByRole("alert")).toHaveTextContent(syncTooSoon(9));
    expect(state.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: SYNC_LABEL })).not.toHaveAttribute("aria-disabled");
  });
});

describe("Pause and Resume", () => {
  it("pauses an active source, as a position, and refreshes", async () => {
    controls();

    fireEvent.click(screen.getByRole("button", { name: PAUSE_LABEL }));

    await waitFor(() => {
      expect(state.setSourceStatus).toHaveBeenCalledWith(SEEDED_GITHUB_ID, "paused");
    });
    await waitFor(() => {
      expect(state.refresh).toHaveBeenCalledOnce();
    });
  });

  it("resumes a paused source and a failed one alike, which is how an error is cleared", async () => {
    state.setSourceStatus.mockResolvedValue({ ok: true, status: "active" });
    const { unmount } = controls({ source: jiraSource(), status: null });

    fireEvent.click(screen.getByRole("button", { name: RESUME_LABEL }));

    await waitFor(() => {
      expect(state.setSourceStatus).toHaveBeenCalledWith(jiraSource().id, "active");
    });
    unmount();

    controls({ source: failedSource(), status: null });
    expect(screen.getByRole("button", { name: RESUME_LABEL })).toBeInTheDocument();
  });

  it("draws a refusal beside the control", async () => {
    state.setSourceStatus.mockResolvedValue({ ok: false, reason: "no" });
    controls();

    fireEvent.click(screen.getByRole("button", { name: PAUSE_LABEL }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no");
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it("is inert for a member, with the reason", () => {
    controls({ mayAdminister: false });

    expect(screen.getByRole("button", { name: PAUSE_LABEL })).toHaveAttribute("title", PAUSE_READ_ONLY);
  });
});

describe("both palettes", () => {
  it("draws the same markup in both", () => {
    const [light, dark] = renderInBothPalettes(
      <SourceControls mayAdminister source={source()} status={statusReport()} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
