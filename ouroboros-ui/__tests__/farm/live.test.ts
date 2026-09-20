import { describe, expect, it } from "vitest";

import {
  LIVE_TITLE,
  LOG_EMPTY,
  LOG_SWEPT,
  LOG_WAITING,
  type LiveJob,
  bindJob,
  emptyLogNote,
  liveElapsed,
  livePill,
  liveTitle,
  logSheetFacts,
  logSheetLabel,
  newestJob,
  selectedJob,
} from "@/app/farm/live";
import { NOT_MEASURED } from "@/app/farm/view";

import { FARM_READ_AT, LIVE_JOB_ID, liveBuild, seededFarm } from "../helpers/farm";

/**
 * Every decision the live log card makes (#261): which build it is about, and what its header may
 * honestly claim from a log that says *whether* a build is over and nothing about how or when.
 */

/**
 * A build, as the card holds one.
 *
 * @param over Fields to replace.
 * @returns The build.
 */
function job(over: Partial<LiveJob> = {}): LiveJob {
  return {
    id: LIVE_JOB_ID,
    number: "#479",
    title: "Add OTA rollback on failed checksum",
    runner: "forge-01",
    startedAt: "2026-09-19T13:58:19.000Z",
    ...over,
  };
}

/** A build that started after {@link job}. */
const NEWER = job({ id: "newer", number: "#480", title: "Bump SDK", startedAt: "2026-09-19T14:01:00.000Z" });

/** A build that started before it. */
const OLDER = job({ id: "older", number: "#472", title: "HIL sweep", startedAt: "2026-09-19T12:00:00.000Z" });

describe("newestJob", () => {
  it("is the page's live build, with its number written as the table writes it", () => {
    expect(newestJob(seededFarm({ live: liveBuild() }))).toEqual(job());
  });

  it("is nothing when nothing is running, or when the page could not be read", () => {
    expect(newestJob(seededFarm())).toBeNull();
    expect(newestJob(null)).toBeNull();
  });
});

describe("selectedJob", () => {
  const page = seededFarm();
  const forge01 = page.runners.find((runner) => runner.name === "forge-01")!;
  const forge02 = page.runners.find((runner) => runner.name === "forge-02")!;

  it("is the build the selected runner is working on, named by that runner", () => {
    expect(selectedJob(page, forge01.id)).toEqual(job());
  });

  it("is nothing for a runner that is building nothing, one that has left, or no selection", () => {
    expect(selectedJob(page, forge02.id)).toBeNull();
    expect(selectedJob(page, "no-such-runner")).toBeNull();
    expect(selectedJob(page, null)).toBeNull();
    expect(selectedJob(null, forge01.id)).toBeNull();
  });
});

describe("bindJob", () => {
  it("is empty with nothing held, nothing running and nothing selected", () => {
    expect(bindJob(null, null, null)).toBeNull();
  });

  it("takes the newest running build when it holds nothing", () => {
    expect(bindJob(null, NEWER, null)).toBe(NEWER);
  });

  it("puts the reader's selection first, over a newer build", () => {
    expect(bindJob(job(), NEWER, OLDER)).toBe(OLDER);
  });

  it("moves to a build that started after the one it holds", () => {
    expect(bindJob(job(), NEWER, null)).toBe(NEWER);
  });

  it("holds a build that has ended: the page names nothing, and the card does not let go", () => {
    const held = job();

    expect(bindJob(held, null, null)).toBe(held);
  });

  it("holds a build that has ended over an older one still running", () => {
    // Letting go here would hide the terminal state the moment it happened.
    const held = job();

    expect(bindJob(held, OLDER, null)).toBe(held);
  });

  it("returns to the newest build when the reader's selection stops naming one", () => {
    expect(bindJob(OLDER, NEWER, null)).toBe(NEWER);
  });

  it("hands back the held build itself when the page reports it again unchanged", () => {
    const held = job();

    expect(bindJob(held, job(), null)).toBe(held);
    expect(bindJob(held, null, job())).toBe(held);
  });

  it("takes the page's newer reading of the same build", () => {
    const renamed = job({ title: "Add OTA rollback (retitled)" });

    expect(bindJob(job(), renamed, null)).toBe(renamed);
  });

  it("never lets a build with no readable start keep a build with one off the card", () => {
    expect(bindJob(job({ startedAt: null }), OLDER, null)).toBe(OLDER);
    expect(bindJob(job({ startedAt: "not a date" }), OLDER, null)).toBe(OLDER);
  });
});

describe("liveTitle", () => {
  it("is the mockup's title", () => {
    expect(liveTitle(job())).toBe("LIVE — forge-01 · #479 Add OTA rollback on failed checksum");
  });

  it("leaves the runner out when the page named none", () => {
    expect(liveTitle(job({ runner: null }))).toBe("LIVE — #479 Add OTA rollback on failed checksum");
  });

  it("is the card's bare name while nothing is bound", () => {
    expect(liveTitle(null)).toBe(LIVE_TITLE);
  });
});

describe("livePill", () => {
  it("says building, with the pulse, while the log says live — and before it has said anything", () => {
    expect(livePill(true)).toEqual({ label: "building", tone: "accent", dot: "pulse" });
    expect(livePill(null)).toEqual({ label: "building", tone: "accent", dot: "pulse" });
  });

  it("swaps to a neutral finished, with no pulse, the moment the log says it is over", () => {
    expect(livePill(false)).toEqual({ label: "finished", tone: "neutral", dot: "filled" });
  });
});

describe("liveElapsed", () => {
  it("is the mockup's running time while the build runs", () => {
    expect(liveElapsed(job(), true, null, FARM_READ_AT)).toBe("3m 41s");
    expect(liveElapsed(job(), null, null, FARM_READ_AT + 1000)).toBe("3m 42s");
  });

  it("stops at an end the card witnessed, whatever the clock says afterwards", () => {
    const endedAt = FARM_READ_AT + 19_000;

    expect(liveElapsed(job(), false, endedAt, FARM_READ_AT + 3_600_000)).toBe("4m 00s");
  });

  it("claims no time at all for an end nobody witnessed", () => {
    expect(liveElapsed(job(), false, null, FARM_READ_AT + 3_600_000)).toBe(NOT_MEASURED);
  });

  it("claims none for a build with no start", () => {
    expect(liveElapsed(job({ startedAt: null }), true, null, FARM_READ_AT)).toBe(NOT_MEASURED);
  });
});

describe("emptyLogNote", () => {
  it("says nothing while output may still arrive — the pane is a cursor and nothing else", () => {
    expect(emptyLogNote(true, true)).toBe(LOG_WAITING);
    expect(emptyLogNote(null, true)).toBe(LOG_WAITING);
  });

  it("says so when a build ended having printed nothing, or its log was swept", () => {
    expect(emptyLogNote(false, true)).toBe(LOG_EMPTY);
    expect(emptyLogNote(false, false)).toBe(LOG_SWEPT);
    expect(emptyLogNote(true, false)).toBe(LOG_SWEPT);
  });
});

describe("the full-log sheet", () => {
  it("is named for the build", () => {
    expect(logSheetLabel(job())).toBe("Build job #479 — full log");
  });

  it("lists the build, its runner, its state and when it started", () => {
    const clock = (atMs: number) => new Date(atMs).toISOString().slice(11, 16);

    expect(logSheetFacts(job(), true, clock)).toEqual([
      { term: "Job", value: "#479" },
      { term: "Runner", value: "forge-01" },
      { term: "State", value: "building" },
      { term: "Started", value: "13:58" },
    ]);
  });

  it("draws the em dash for what the page did not carry, and the terminal state once it is one", () => {
    const facts = logSheetFacts(job({ runner: null, startedAt: null }), false, String);

    expect(facts.map((fact) => fact.value)).toEqual(["#479", NOT_MEASURED, "finished", NOT_MEASURED]);
  });
});
