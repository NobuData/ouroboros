import { describe, expect, it } from "vitest";

import type { RunStatus } from "@/app/api/dashboard";
import {
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  loopLabel,
  runEyebrow,
  runElapsed,
  runHead,
  runHeadline,
  trackerUrl,
  workflowCaption,
} from "@/app/runs/view";

import { SEEDED_ELAPSED_SECONDS, SEEDED_STARTED_AT, runConsole } from "../helpers/runs";

/**
 * The run console's head as data (#309): each rule on its own, then the seed through
 * `runHead` against the mockup's own strings.
 */

describe("the seeded head", () => {
  it("reads as the mockup: eyebrow, headline and all five meta elements", () => {
    const view = runHead(runConsole());

    expect(view.eyebrow).toBe("Run Console · Loop #1847");
    expect(view.headline).toBe("#482 — Fix flaky CAN-bus telemetry test");
    expect(view.statusLabel).toBe("coding");
    expect(view.statusDot).toBe("pulse");
    expect(view.workflow).toBe("standard-fix v14");
    expect(view.model).toBe("claude-fable-5");
    expect(view.branch).toBe("loop/482-canbus-flake");
    expect(view.elapsed).toEqual({
      live: true,
      startedAtSeconds: Date.parse(SEEDED_STARTED_AT) / 1000,
      serverSeconds: SEEDED_ELAPSED_SECONDS,
    });
    expect(view.trackerUrl).toBe("https://github.com/acme/helios-firmware/issues/482");
    expect(view.simulated).toBe(false);
    expect(view.loopLabel).toBe("Loop #1847");
  });
});

describe("the status pill", () => {
  it("reflects the run's real status, not a literal `coding`", () => {
    const statuses: RunStatus[] = ["coding", "building", "review", "merged", "needs_human", "failed", "canceled"];

    for (const status of statuses) {
      const view = runHead(runConsole({ run: { status } }));

      expect(view.statusLabel).toBe(RUN_STATUS_LABEL[status]);
      expect(view.statusTone).toBe(RUN_STATUS_TONE[status]);
    }

    expect(RUN_STATUS_LABEL.needs_human).toBe("needs human");
    expect(RUN_STATUS_TONE.merged).toBe("ok");
    expect(RUN_STATUS_TONE.failed).toBe("err");
    expect(RUN_STATUS_TONE.canceled).toBe("neutral");
  });

  it("pulses only while the run is live", () => {
    expect(runHead(runConsole({ head: { live: true } })).statusDot).toBe("pulse");
    expect(runHead(runConsole({ run: { status: "merged" }, head: { live: false } })).statusDot).toBe("filled");
  });
});

describe("the pieces", () => {
  it("names the loop", () => {
    expect(loopLabel(7)).toBe("Loop #7");
    expect(runEyebrow(7)).toBe("Run Console · Loop #7");
  });

  it("sets the headline as key — title", () => {
    expect(runHeadline(12, "Fix it")).toBe("#12 — Fix it");
  });

  it("pins the workflow's version, and invents none when nothing was pinned", () => {
    expect(workflowCaption("standard-fix", 14)).toBe("standard-fix v14");
    expect(workflowCaption("standard-fix", null)).toBe("standard-fix");
    expect(runHead(runConsole({ head: { workflowVersion: null } })).workflow).toBe("standard-fix");
  });

  it("carries a missing branch as null rather than a placeholder string", () => {
    expect(runHead(runConsole({ head: { branchName: null } })).branch).toBeNull();
  });

  it("carries the simulated watermark from the head", () => {
    expect(runHead(runConsole({ head: { simulated: true } })).simulated).toBe(true);
  });
});

describe("the tracker link", () => {
  it("is the issue's page on GitHub, with every segment encoded", () => {
    expect(trackerUrl({ owner: "acme", name: "helios-firmware" }, 482)).toBe(
      "https://github.com/acme/helios-firmware/issues/482",
    );
    expect(trackerUrl({ owner: "a/b", name: "c?d" }, 1)).toBe("https://github.com/a%2Fb/c%3Fd/issues/1");
  });

  it("is absent rather than guessed when the repository or the number cannot make one", () => {
    expect(trackerUrl(undefined, 482)).toBeNull();
    expect(trackerUrl({ owner: "acme", name: "x" }, 0)).toBeNull();
    expect(trackerUrl({ owner: "acme", name: "x" }, 1.5)).toBeNull();
    expect(runHead(runConsole({ head: { repository: undefined } })).trackerUrl).toBeNull();
  });
});

describe("elapsed", () => {
  it("anchors a live run to the server's start, carrying the server's figure as a floor", () => {
    expect(runElapsed(runConsole())).toEqual({
      live: true,
      startedAtSeconds: Date.parse(SEEDED_STARTED_AT) / 1000,
      serverSeconds: SEEDED_ELAPSED_SECONDS,
    });
  });

  it("anchors to the same second whatever the snapshot's asOf — a later poll moves no anchor", () => {
    const first = runElapsed(runConsole());
    const later = runElapsed(runConsole({ asOf: "2026-09-19T12:20:00.000Z", wallClock: { elapsedSeconds: 1200 } }));

    expect(later.live && first.live && later.startedAtSeconds === first.startedAtSeconds).toBe(true);
  });

  it("freezes a finished run at its stated duration", () => {
    const finished = runConsole({
      run: { status: "merged" },
      head: { live: false },
      wallClock: { finishedAt: "2026-09-19T12:30:00.000Z", elapsedSeconds: 1800 },
    });

    expect(runElapsed(finished)).toEqual({ live: false, seconds: 1800 });
  });

  it("does not tick from nothing when the start cannot be read", () => {
    expect(runElapsed(runConsole({ wallClock: { startedAt: "not a date" } }))).toEqual({
      live: false,
      seconds: SEEDED_ELAPSED_SECONDS,
    });
  });
});
