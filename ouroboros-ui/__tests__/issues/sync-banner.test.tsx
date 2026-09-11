import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHECKING_LABEL,
  CHECK_AGAIN_LABEL,
  PAUSE_HEADLINE,
  SYNC_UNREAD_HEADLINE,
  type SyncBannerState,
  firstSyncProgress,
} from "@/app/issues/states";
import { SyncBanner } from "@/app/issues/sync-banner";

import { PAUSE_MESSAGES, READ_AT, UNSYNCED_REASON } from "../helpers/issues";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The sync banner (#120) — DASH-I.7's box over the backlog's rows, as a component.
 *
 * What only a render can show: that a pause is the design system's retry banner with the
 * kind as its headline and the service's sentence as its reason, that a rate limit's wait
 * counts down against the reader's clock, that an unread status says so, that the first
 * sync's progress is a status line rather than a warning, that nothing is drawn when there is
 * nothing to say, and that the control reports its own state through its label and is never
 * inert. What each state *is* is `states.test.ts`'s.
 */

/** A paused banner, for the reason given. */
function pausedState(
  pause: keyof typeof PAUSE_HEADLINE,
  retryAfterSeconds: number | null = null,
): SyncBannerState {
  return {
    kind: "paused",
    pause,
    headline: PAUSE_HEADLINE[pause],
    reason: PAUSE_MESSAGES[pause],
    retryAfterSeconds,
  };
}

/** The banner, over the seeded read instant, with a recorded control. */
function banner(state: SyncBannerState, over: { checking?: boolean; onCheck?: () => void } = {}) {
  return (
    <SyncBanner
      checking={over.checking ?? false}
      onCheck={over.onCheck ?? (() => {})}
      readAtSeconds={Math.floor(READ_AT / 1000)}
      state={state}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(READ_AT);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a paused loop", () => {
  it("is the retry banner, with the kind as its headline and the service's sentence as its reason", () => {
    render(banner(pausedState("unauthorized")));

    const box = screen.getByRole("status");

    expect(box).toHaveClass("ou-retry", "issues-sync");
    expect(box).toHaveTextContent(PAUSE_HEADLINE.unauthorized);
    expect(box).toHaveTextContent(PAUSE_MESSAGES.unauthorized);
    expect(screen.getByRole("button", { name: CHECK_AGAIN_LABEL })).toBeInTheDocument();
  });

  it("counts a rate limit's wait down against the reader's clock", async () => {
    render(banner(pausedState("rate_limited", 1180)));

    expect(screen.getByRole("status")).toHaveTextContent("Resumes in about 20 minutes.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19 * 60 * 1000 + 30_000);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Resumes in 10 seconds.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Resumes any moment now.");
  });

  it("promises no wait the service did not give", () => {
    render(banner(pausedState("rate_limited")));

    expect(screen.getByRole("status")).not.toHaveTextContent(/Resumes in/);
  });
});

describe("the control", () => {
  it("asks when pressed, and is never inert", () => {
    const onCheck = vi.fn();
    render(banner(pausedState("upstream_error"), { onCheck }));

    const control = screen.getByRole("button", { name: CHECK_AGAIN_LABEL });

    expect(control).not.toBeDisabled();
    expect(control).not.toHaveAttribute("aria-disabled");
    fireEvent.click(control);

    expect(onCheck).toHaveBeenCalledOnce();
  });

  it("reports an ask in flight through its label, and stays pressable", () => {
    render(banner(pausedState("upstream_error"), { checking: true }));

    const control = screen.getByRole("button", { name: CHECKING_LABEL });

    expect(control).not.toBeDisabled();
  });
});

describe("a status that could not be read", () => {
  it("says so, with the reason, and offers the same way out", () => {
    render(banner({ kind: "unread", reason: UNSYNCED_REASON }));

    const box = screen.getByRole("status");

    expect(box).toHaveTextContent(SYNC_UNREAD_HEADLINE);
    expect(box).toHaveTextContent(UNSYNCED_REASON);
    expect(screen.getByRole("button", { name: CHECK_AGAIN_LABEL })).toBeInTheDocument();
  });
});

describe("the first sync over rows", () => {
  it("is a status line in the muted ink, not the warning box, with no control", () => {
    render(banner({ kind: "first-sync", message: firstSyncProgress(120) }));

    const line = screen.getByRole("status");

    expect(line).toHaveClass("issues-sync__progress");
    expect(line).not.toHaveClass("ou-retry");
    expect(line).toHaveTextContent("First sync running — 120 open issues so far…");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("nothing to say", () => {
  it("draws nothing at all", () => {
    const { container } = render(banner({ kind: "none" }));

    expect(container).toBeEmptyDOMElement();
  });
});

describe("both palettes", () => {
  it("render the same markup, so the theme is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(banner(pausedState("rate_limited", 1180)));

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
