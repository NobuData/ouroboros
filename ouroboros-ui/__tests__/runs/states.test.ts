import { describe, expect, it } from "vitest";

import {
  INGEST_LAG_AFTER_SECONDS,
  QUEUED_ENTRIES,
  ingestLagHeadline,
  ingestLagSince,
  isQueued,
  lastActivityMs,
} from "@/app/runs/states";

import { SEEDED_STARTED_AT, atSecond, runConsole, seededCommits, timelineStage } from "../helpers/runs";

/**
 * The console's states besides mid-flight (#314), as rules: what counts as queued, what counts as
 * activity, and when a live run has gone quiet.
 */

/** A timeline nobody has started. */
function pendingStages() {
  return [
    timelineStage("issue-queued", "Queued", 1),
    timelineStage("analyze", "Analyze", 2),
    timelineStage("implement", "Implement", 3),
  ];
}

/** A run that started at the seed's start and has reported nothing since. */
function quietRun(over: Parameters<typeof runConsole>[0] = {}) {
  return runConsole({
    stages: [
      timelineStage("analyze", "Analyze", 1, {
        status: "active",
        attempts: [
          {
            attempt: 1,
            status: "active",
            startedAt: atSecond(10),
            finishedAt: null,
            durationSeconds: null,
            note: null,
          },
        ],
      }),
    ],
    changes: { commits: [] },
    ...over,
  });
}

/** Seconds past the seed's start, in epoch milliseconds. */
function ms(seconds: number): number {
  return Date.parse(atSecond(seconds));
}

describe("isQueued", () => {
  it("is a live run whose every stage is pending with no attempt started", () => {
    expect(isQueued(runConsole({ stages: pendingStages() }))).toBe(true);
  });

  it("is a live run with no stage reported at all", () => {
    expect(isQueued(runConsole({ stages: [] }))).toBe(true);
  });

  it("is not a run with a stage under way", () => {
    expect(isQueued(runConsole())).toBe(false);
  });

  it("is not a pending stage that has an attempt started — the attempt is what counts", () => {
    const stages = pendingStages();
    stages[0] = timelineStage("issue-queued", "Queued", 1, {
      attempts: [
        { attempt: 1, status: "pending", startedAt: atSecond(1), finishedAt: null, durationSeconds: null, note: null },
      ],
    });

    expect(isQueued(runConsole({ stages }))).toBe(false);
  });

  it("is never a run that has ended, whatever its timeline", () => {
    expect(isQueued(runConsole({ stages: [], head: { live: false }, run: { status: "canceled" } }))).toBe(false);
  });

  it("has a transcript message that says why the well is empty", () => {
    expect(QUEUED_ENTRIES).toMatch(/queued/);
    expect(QUEUED_ENTRIES).toMatch(/no stage has started/);
  });
});

describe("lastActivityMs", () => {
  it("is the run's start when nothing else has been reported", () => {
    expect(lastActivityMs(runConsole({ stages: [], changes: { commits: [] } }), null)).toBe(
      Date.parse(SEEDED_STARTED_AT),
    );
  });

  it("takes the newest of attempt starts and finishes, commits and the newest entry", () => {
    const snapshot = quietRun({ changes: { commits: seededCommits() } });

    // The second seeded commit is at 12:09:30 — 570 s in.
    expect(lastActivityMs(snapshot, null)).toBe(ms(570));
    expect(lastActivityMs(snapshot, atSecond(600))).toBe(ms(600));
    expect(lastActivityMs(snapshot, atSecond(100))).toBe(ms(570));
  });

  it("counts an attempt's finish", () => {
    const snapshot = quietRun();
    snapshot.timeline.stages[0]!.attempts[0] = {
      ...snapshot.timeline.stages[0]!.attempts[0]!,
      finishedAt: atSecond(90),
    };

    expect(lastActivityMs(snapshot, null)).toBe(ms(90));
  });

  it("skips what cannot be parsed, and is null when nothing can", () => {
    expect(lastActivityMs(quietRun(), "not a date")).toBe(ms(10));
    expect(
      lastActivityMs(runConsole({ stages: [], changes: { commits: [] }, run: { startedAt: "never" } }), null),
    ).toBeNull();
  });
});

describe("ingestLagSince", () => {
  it("is null while the last activity is younger than the threshold", () => {
    expect(ingestLagSince(quietRun(), null, ms(10 + INGEST_LAG_AFTER_SECONDS - 1))).toBeNull();
  });

  it("is the last activity once it is as old as the threshold", () => {
    expect(ingestLagSince(quietRun(), null, ms(10 + INGEST_LAG_AFTER_SECONDS))).toBe(ms(10));
  });

  it("clears the moment a new entry arrives", () => {
    const now = ms(10 + INGEST_LAG_AFTER_SECONDS * 2);

    expect(ingestLagSince(quietRun(), null, now)).toBe(ms(10));
    expect(ingestLagSince(quietRun(), atSecond(10 + INGEST_LAG_AFTER_SECONDS * 2 - 5), now)).toBeNull();
  });

  it("honours a threshold of the caller's", () => {
    expect(ingestLagSince(quietRun(), null, ms(40), 30)).toBe(ms(10));
    expect(ingestLagSince(quietRun(), null, ms(39), 30)).toBeNull();
  });

  it("is never a run that has ended — a finished run is supposed to be quiet", () => {
    const ended = quietRun({ head: { live: false }, run: { status: "merged" } });

    expect(ingestLagSince(ended, null, ms(100_000))).toBeNull();
  });

  it("is never a queued run — it has nothing to report yet", () => {
    expect(ingestLagSince(runConsole({ stages: pendingStages() }), null, ms(100_000))).toBeNull();
  });

  it("is null when no instant can be read", () => {
    const unreadable = runConsole({
      stages: [timelineStage("analyze", "Analyze", 1, { status: "active" })],
      run: { startedAt: "never" },
      changes: { commits: [] },
    });

    expect(ingestLagSince(unreadable, null, ms(100_000))).toBeNull();
  });
});

describe("ingestLagHeadline", () => {
  it("names the last-updated time through the caller's clock", () => {
    expect(ingestLagHeadline(ms(10), () => "14:02")).toBe(
      "No new activity since 14:02 — the run's events have gone quiet.",
    );
  });
});
