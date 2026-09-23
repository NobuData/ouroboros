import { describe, expect, it } from "vitest";

import {
  CONTROL_PHASE_LABEL,
  NO_RESPONSE,
  PAUSE_LABEL,
  REJECTED_FALLBACK,
  RESUME_LABEL,
  SENDING_REASON,
  abortConfirmLabel,
  abortFieldLabel,
  abortKeeps,
  abortTitle,
  chipOf,
  confirmationMatches,
  controlKey,
  deliveryChip,
  isOutstanding,
  loopControls,
  mergeControls,
  pendingReason,
  takeoverNeedsPause,
  toggleView,
} from "@/app/runs/controls";

import { runControl } from "../helpers/runs";

/**
 * The run controls' rules (#310), without rendering: what the queue says about the loop, what
 * the toggle reads, what each delivery chip says — and that an expired control is never drawn
 * as a success.
 */

describe("isOutstanding", () => {
  it("is true while a control is queued or fetched, and false once anybody has answered", () => {
    expect(isOutstanding(runControl({ state: "pending" }))).toBe(true);
    expect(isOutstanding(runControl({ state: "delivered" }))).toBe(true);
    expect(isOutstanding(runControl({ state: "acked" }))).toBe(false);
    expect(isOutstanding(runControl({ state: "expired" }))).toBe(false);
    expect(isOutstanding(runControl({ state: "rejected" }))).toBe(false);
  });
});

describe("loopControls", () => {
  it("reads an empty queue as a running loop with nothing on its way", () => {
    expect(loopControls([])).toEqual({
      paused: false,
      latestToggle: null,
      latestAbort: null,
      pendingToggle: null,
      pendingAbort: null,
    });
  });

  it("is paused only once a pause is acknowledged — a sent one has stopped nothing", () => {
    expect(loopControls([runControl({ kind: "pause", state: "pending" })]).paused).toBe(false);
    expect(loopControls([runControl({ kind: "pause", state: "delivered" })]).paused).toBe(false);
    expect(loopControls([runControl({ kind: "pause", state: "acked" })]).paused).toBe(true);
  });

  it("reads the newest acknowledged pause-or-resume, not the newest control", () => {
    const resumed = [
      runControl({ kind: "resume", state: "acked" }),
      runControl({ kind: "pause", state: "acked" }),
    ];
    expect(loopControls(resumed).paused).toBe(false);

    // A resume on its way has not resumed anything yet.
    const resuming = [
      runControl({ kind: "resume", state: "pending" }),
      runControl({ kind: "pause", state: "acked" }),
    ];
    expect(loopControls(resuming).paused).toBe(true);
    expect(loopControls(resuming).pendingToggle?.kind).toBe("resume");
  });

  it("ignores an expired pause when deciding whether the loop is paused", () => {
    expect(loopControls([runControl({ kind: "pause", state: "expired" })]).paused).toBe(false);
  });

  it("keeps steering and aborts out of the toggle, and reports each separately", () => {
    const steer = runControl({ kind: "steer", state: "acked" });
    const abort = runControl({ kind: "abort", state: "delivered" });
    const pause = runControl({ kind: "pause", state: "expired" });

    const loop = loopControls([steer, abort, pause]);
    expect(loop.latestToggle).toBe(pause);
    expect(loop.latestAbort).toBe(abort);
    expect(loop.pendingAbort).toBe(abort);
    expect(loop.pendingToggle).toBeNull();
  });
});

describe("mergeControls", () => {
  it("puts a control the poll has not seen yet in front", () => {
    const old = runControl({ state: "acked" });
    const fresh = runControl({ kind: "resume" });

    expect(mergeControls([old], fresh)).toEqual([fresh, old]);
    expect(mergeControls(null, fresh)).toEqual([fresh]);
  });

  it("prefers the poll's copy once it has the control — it is the newer", () => {
    const submitted = runControl({ state: "pending" });
    const polled = { ...submitted, state: "acked" as const };

    expect(mergeControls([polled], submitted)).toEqual([polled]);
  });

  it("is the poll's list when nothing was submitted", () => {
    const list = [runControl()];

    expect(mergeControls(list, null)).toBe(list);
    expect(mergeControls(null, null)).toEqual([]);
  });
});

describe("toggleView", () => {
  it("offers to pause a running loop, and to resume a paused one", () => {
    expect(toggleView(loopControls([]), false)).toEqual({
      kind: "pause",
      label: PAUSE_LABEL,
      reason: undefined,
    });
    expect(toggleView(loopControls([runControl({ state: "acked" })]), false)).toEqual({
      kind: "resume",
      label: RESUME_LABEL,
      reason: undefined,
    });
  });

  it("is inert, and says why, while this page is sending", () => {
    expect(toggleView(loopControls([]), true).reason).toBe(SENDING_REASON);
  });

  it("is inert while a pause or resume is on its way, rather than queueing a second", () => {
    const view = toggleView(loopControls([runControl({ kind: "pause", state: "delivered" })]), false);

    expect(view.label).toBe(PAUSE_LABEL);
    expect(view.reason).toBe(pendingReason("pause"));
  });
});

describe("pendingReason", () => {
  it("names the kind already on its way, with the right article", () => {
    expect(pendingReason("pause")).toBe("A pause is already on its way — waiting for the run to answer.");
    expect(pendingReason("abort")).toBe("An abort is already on its way — waiting for the run to answer.");
  });
});

describe("deliveryChip", () => {
  it("moves sending → sent → received in the accent, pulsing", () => {
    expect(deliveryChip("pause", "sending")).toEqual({ label: "Pause · sending", tone: "accent", dot: "pulse", detail: null });
    expect(deliveryChip("pause", "pending").label).toBe("Pause · sent");
    expect(deliveryChip("pause", "delivered").label).toBe("Pause · received");
    expect(deliveryChip("pause", "delivered").dot).toBe("pulse");
  });

  it("settles on acknowledged in the ok hue, carrying the executor's words", () => {
    expect(deliveryChip("resume", "acked", "resumed at stage implement")).toEqual({
      label: "Resume · acknowledged",
      tone: "ok",
      dot: "filled",
      detail: "resumed at stage implement",
    });
  });

  it("renders an expired control as no response — never as a success", () => {
    const chip = deliveryChip("pause", "expired");

    expect(chip.label).toBe(`Pause · ${NO_RESPONSE}`);
    expect(chip.label).toContain("no response — run may be between stages");
    expect(chip.tone).toBe("warn");
    expect(chip.tone).not.toBe("ok");
    expect(chip.label).not.toContain(CONTROL_PHASE_LABEL.acked);
  });

  it("draws a rejection with the service's reason, or a plain word without one", () => {
    expect(deliveryChip("abort", "rejected", "The run has already finished.")).toMatchObject({
      label: "Abort · The run has already finished.",
      tone: "err",
    });
    expect(deliveryChip("abort", "rejected").label).toBe(`Abort · ${REJECTED_FALLBACK}`);
  });

  it("is what chipOf draws for a queued control", () => {
    const control = runControl({ kind: "abort", state: "acked", detail: "aborted at a safe boundary" });

    expect(chipOf(control)).toEqual(deliveryChip("abort", "acked", "aborted at a safe boundary"));
  });
});

describe("takeoverNeedsPause", () => {
  it("pauses a running loop with nothing on its way", () => {
    expect(takeoverNeedsPause(loopControls([]))).toBe(true);
  });

  it("does not pause a loop already paused, or one whose pause is on its way", () => {
    expect(takeoverNeedsPause(loopControls([runControl({ state: "acked" })]))).toBe(false);
    expect(takeoverNeedsPause(loopControls([runControl({ state: "pending" })]))).toBe(false);
  });

  it("pauses again after an expired pause — that one never landed", () => {
    expect(takeoverNeedsPause(loopControls([runControl({ state: "expired" })]))).toBe(true);
  });
});

describe("confirmationMatches", () => {
  it("accepts the loop number, trimmed, with one optional leading #", () => {
    expect(confirmationMatches("1847", 1847)).toBe(true);
    expect(confirmationMatches("  1847 ", 1847)).toBe(true);
    expect(confirmationMatches("#1847", 1847)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(confirmationMatches("", 1847)).toBe(false);
    expect(confirmationMatches("184", 1847)).toBe(false);
    expect(confirmationMatches("18470", 1847)).toBe(false);
    expect(confirmationMatches("##1847", 1847)).toBe(false);
    expect(confirmationMatches("Loop #1847", 1847)).toBe(false);
  });
});

describe("the abort dialog's words", () => {
  it("names the loop in the title, the field and the button", () => {
    expect(abortTitle(1847)).toBe("Abort Loop #1847?");
    expect(abortFieldLabel(1847)).toBe("Type 1847 to confirm");
    expect(abortConfirmLabel(1847)).toBe("Abort Loop #1847");
  });

  it("states that the branch is preserved and the run marked canceled", () => {
    expect(abortKeeps("loop/482-canbus-flake")).toContain("marked canceled");
    expect(abortKeeps("loop/482-canbus-flake")).toContain("loop/482-canbus-flake is preserved");
    expect(abortKeeps(null)).toContain("marked canceled");
  });
});

describe("controlKey", () => {
  it("is a fresh key per press", () => {
    expect(controlKey()).not.toBe(controlKey());
    expect(controlKey()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
