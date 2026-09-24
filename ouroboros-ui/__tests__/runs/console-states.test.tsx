import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunConsole, RunEventsPage } from "@/app/api/runs";
import { clockTime } from "@/app/dashboard/view";
import type { PollAnswer } from "@/app/poll";
import type { RunPollOptions } from "@/app/runs/console-poll";
import { CONTROLS_LABEL } from "@/app/runs/controls";
import type { ControlsPollOptions } from "@/app/runs/controls-poll";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";
import { RunScreen } from "@/app/runs/run-screen";
import { RUN_MISSING_BACK, RUN_MISSING_NOTE, RUN_MISSING_TITLE } from "@/app/runs/run-missing";
import { RUN_LOADING_LABEL, SKELETON_SIDE_ROWS, SKELETON_STEPS } from "@/app/runs/run-skeleton";
import {
  INGEST_LAG_AFTER_SECONDS,
  INGEST_LAG_REASON,
  INGEST_LAG_RETRY,
  QUEUED_ENTRIES,
} from "@/app/runs/states";
import { NO_ENTRIES, STEER_ENDED, STEER_READ_ONLY, STREAMING } from "@/app/runs/transcript";
import type { TranscriptStreamOptions } from "@/app/runs/transcript-stream";
import { SIMULATED_HEADLINE, STALE_HEADLINE, UNREAD_HEADLINE } from "@/app/runs/view";

import {
  SEEDED_RUN_ID,
  atSecond,
  eventsPage,
  runConsole,
  seededEntries,
  timelineStage,
} from "../helpers/runs";

/**
 * The run console's states besides mid-flight (#314), rendered through the whole screen: a run
 * that has ended, a run still queued, a run whose events have gone quiet, the watermark, the
 * member's and the viewer's views, the skeleton, and the two errors — a run that could not be
 * read and a run that does not exist.
 */

// The Server Action is never reached here: no case presses a control.
vi.mock("@/app/runs/control-actions", () => ({ submitRunControl: vi.fn() }));

/** A poll that never answers — the page shows the server's first read. */
const QUIET: RunPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** A controls poll that never answers. */
const QUIET_CONTROLS: ControlsPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** The transcript's pages. Each read takes the next; the last is repeated. */
let pages: RunEventsPage[];

/** The transcript, answering {@link pages}. */
const STREAM: TranscriptStreamOptions = {
  visible: () => true,
  read: () => {
    const page = pages.length > 1 ? pages.shift()! : pages[0]!;
    return Promise.resolve<PollAnswer<RunEventsPage>>({
      state: "fresh",
      payload: page,
      etag: null,
      pollAfterSeconds: page.pollAfter,
    });
  },
};

/** When the seeded run finished, in the terminal cases. */
const FINISHED_AT = atSecond(1800);

/**
 * A run that has ended.
 *
 * @param status How it ended.
 * @returns The snapshot, with a pull request number whatever the outcome.
 */
function ended(status: "merged" | "failed" | "canceled"): RunConsole {
  return runConsole({
    run: { status, finishedAt: FINISHED_AT, prNumber: 512 },
    head: { live: false },
    wallClock: { finishedAt: FINISHED_AT, elapsedSeconds: 1800 },
  });
}

/** A run no stage of which has started. */
function queued(): RunConsole {
  return runConsole({
    stages: [
      timelineStage("issue-queued", "Queued", 1),
      timelineStage("analyze", "Analyze", 2),
      timelineStage("implement", "Implement", 3),
    ],
    changes: { files: [], commits: [], totals: { files: 0, additions: 0, deletions: 0 } },
  });
}

/**
 * Draw the screen.
 *
 * @param initial The server's first read.
 * @param options Who is reading, and the seams.
 * @returns The render result.
 */
function draw(
  initial: RunConsole | null,
  options: {
    mayControl?: boolean;
    mayContribute?: boolean;
    poll?: RunPollOptions;
    initialError?: string | null;
  } = {},
) {
  return render(
    <RunScreen
      controlsPoll={QUIET_CONTROLS}
      id={SEEDED_RUN_ID}
      initial={initial}
      initialError={options.initialError ?? null}
      mayContribute={options.mayContribute ?? true}
      mayControl={options.mayControl ?? true}
      origin={DASHBOARD_ORIGIN}
      poll={options.poll ?? QUIET}
      transcript={STREAM}
    />,
  );
}

/** Let the stream's first read land. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/**
 * Let the clock run.
 *
 * @param seconds How far.
 */
async function advance(seconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  });
}

/** The head's meta row. */
function meta(): HTMLElement {
  return document.querySelector(".run-head__meta") as HTMLElement;
}

/** What the elapsed figure reads. */
function elapsed(): string {
  return document.querySelector(".run-head__elapsed")?.textContent ?? "";
}

/** The transcript card. */
function transcript(): HTMLElement {
  return screen.getByRole("region", { name: "Agent transcript" });
}

/** The steering input. */
function steerInput(): HTMLElement {
  return within(transcript()).getByRole("textbox", { name: "Steer the loop" });
}

beforeEach(() => {
  pages = [eventsPage()];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a run that has ended", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse(FINISHED_AT) + 60_000 });
    pages = [eventsPage({ live: false })];
  });

  it("freezes elapsed — the figure does not move however long the page stays open", async () => {
    draw(ended("merged"));
    await settle();

    expect(elapsed()).toBe("30m 00s");
    await advance(90);
    expect(elapsed()).toBe("30m 00s");
  });

  it("draws the outcome pill, still rather than pulsing", async () => {
    // A neutral chip is the base class alone — canceled is a person's decision, not an outcome.
    for (const [status, hue] of [
      ["merged", /\bou-chip--ok\b/],
      ["failed", /\bou-chip--err\b/],
      ["canceled", /^ou-chip$/],
    ] as const) {
      const { unmount } = draw(ended(status));
      await settle();

      const pill = meta().firstElementChild as HTMLElement;
      expect(pill).toHaveTextContent(status);
      expect(pill.className).toMatch(hue);
      expect(pill.querySelector(".ou-chip__dot--pulse")).toBeNull();
      unmount();
    }
  });

  it("closes steering with the reason printed, and quiets the streaming pill", async () => {
    draw(ended("failed"));
    await settle();

    expect(steerInput()).toBeDisabled();
    expect(transcript()).toHaveTextContent(STEER_ENDED);
    expect(within(transcript()).queryByText(STREAMING)).toBeNull();
    // The transcript stays readable.
    expect(within(transcript()).getAllByRole("article")).toHaveLength(seededEntries().length);
  });

  it("draws no controls, even for an owner", async () => {
    draw(ended("canceled"), { mayControl: true });
    await settle();

    expect(screen.queryByRole("group", { name: CONTROLS_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause loop|Resume|Abort run|Take over/ })).toBeNull();
  });

  it("links the pull request once merged, in a new tab", async () => {
    draw(ended("merged"));
    await settle();

    const link = within(meta()).getByRole("link", { name: /PR #512/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/helios-firmware/pull/512");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("offers no pull request for a run that failed or was canceled", async () => {
    for (const status of ["failed", "canceled"] as const) {
      const { unmount } = draw(ended(status));
      await settle();

      expect(within(meta()).queryByRole("link", { name: /PR #/ })).toBeNull();
      unmount();
    }
  });

  it("never says its events have gone quiet — a finished run is supposed to be", async () => {
    draw(ended("merged"));
    await settle();
    await advance(INGEST_LAG_AFTER_SECONDS * 10);

    expect(screen.queryByText(INGEST_LAG_REASON)).toBeNull();
  });
});

describe("a queued run", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse(atSecond(5)) });
    pages = [eventsPage({ entries: [], nextAfter: 0 })];
  });

  it("draws every stage pending and says why the transcript is empty", async () => {
    draw(queued());
    await settle();

    const steps = document.querySelectorAll(".run-step");
    expect(steps).toHaveLength(3);
    expect(document.querySelectorAll(".run-step--pending")).toHaveLength(3);
    expect(document.querySelector(".run-step--active")).toBeNull();

    expect(transcript()).toHaveTextContent(QUEUED_ENTRIES);
    expect(transcript()).not.toHaveTextContent(NO_ENTRIES);
  });

  it("does not call a long queue an ingest stall", async () => {
    draw(queued());
    await settle();
    await advance(INGEST_LAG_AFTER_SECONDS * 5);

    expect(screen.queryByText(INGEST_LAG_REASON)).toBeNull();
  });

  it("says nothing has been written, not that it is queued, once a stage has started", async () => {
    draw(runConsole());
    await settle();

    expect(transcript()).toHaveTextContent(NO_ENTRIES);
    expect(transcript()).not.toHaveTextContent(QUEUED_ENTRIES);
  });
});

describe("the ingest-lag banner", () => {
  /** The seeded transcript's newest entry — 739 s into the run. */
  const NEWEST = Date.parse(atSecond(739));

  it("is not drawn while the newest activity is younger than the threshold", async () => {
    vi.useFakeTimers({ now: NEWEST + (INGEST_LAG_AFTER_SECONDS - 5) * 1000 });
    draw(runConsole());
    await settle();

    expect(screen.queryByText(INGEST_LAG_REASON)).toBeNull();
  });

  it("appears once the events go stale on an active run, naming the last-updated time", async () => {
    vi.useFakeTimers({ now: NEWEST + (INGEST_LAG_AFTER_SECONDS - 5) * 1000 });
    draw(runConsole());
    await settle();
    await advance(5);

    const banner = screen.getByText(INGEST_LAG_REASON).closest(".ou-retry") as HTMLElement;
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent(`No new activity since ${clockTime(NEWEST)}`);
  });

  it("measures from the transcript, not only the snapshot — a fresh entry keeps it away", async () => {
    // The snapshot's own newest instant is the second commit, at 570 s: stale by 739 + 115 s.
    vi.useFakeTimers({ now: NEWEST + (INGEST_LAG_AFTER_SECONDS - 5) * 1000 });
    const { unmount } = draw(runConsole());
    await settle();

    expect(screen.queryByText(INGEST_LAG_REASON)).toBeNull();
    unmount();

    // The same instant with no transcript held: only the snapshot's 570 s is left to go by.
    pages = [eventsPage({ entries: [], nextAfter: 0 })];
    draw(runConsole());
    await settle();

    expect(screen.getByText(INGEST_LAG_REASON)).toBeInTheDocument();
  });

  it("clears on its own when the next activity arrives", async () => {
    vi.useFakeTimers({ now: NEWEST + INGEST_LAG_AFTER_SECONDS * 1000 });
    const later = { ...seededEntries()[0]!, seq: 10, ts: new Date(NEWEST + INGEST_LAG_AFTER_SECONDS * 1000).toISOString() };
    pages = [eventsPage(), eventsPage({ after: 9, entries: [later], nextAfter: 10 })];
    draw(runConsole());
    await settle();

    expect(screen.getByText(INGEST_LAG_REASON)).toBeInTheDocument();

    await advance(eventsPage().pollAfter);
    expect(screen.queryByText(INGEST_LAG_REASON)).toBeNull();
  });

  it("asks the service again when its retry is pressed", async () => {
    vi.useFakeTimers({ now: NEWEST + INGEST_LAG_AFTER_SECONDS * 1000 });
    const read = vi.fn(() => new Promise<PollAnswer<RunConsole>>(() => {}));
    draw(runConsole(), { poll: { read, visible: () => true } });
    await settle();
    const before = read.mock.calls.length;

    const banner = screen.getByText(INGEST_LAG_REASON).closest(".ou-retry") as HTMLElement;
    fireEvent.click(within(banner).getByRole("button", { name: INGEST_LAG_RETRY }));
    await settle();

    expect(read.mock.calls.length).toBeGreaterThan(before);
  });

  it("gives way to a failed refresh, which already says the page is out of date", async () => {
    vi.useFakeTimers({ now: NEWEST + INGEST_LAG_AFTER_SECONDS * 2000 });
    const read = vi.fn(() =>
      Promise.resolve<PollAnswer<RunConsole>>({
        state: "failed",
        reason: "The run could not be reached.",
        pollAfterSeconds: null,
      }),
    );
    draw(runConsole(), { poll: { read, visible: () => true } });
    await settle();

    expect(screen.getByText(STALE_HEADLINE)).toBeInTheDocument();
    expect(screen.queryByText(INGEST_LAG_REASON)).toBeNull();
    expect(screen.getAllByRole("status").filter((node) => node.classList.contains("ou-retry"))).toHaveLength(1);
  });
});

describe("the simulated watermark", () => {
  it("frames a simulated run in every state — live and ended", async () => {
    vi.useFakeTimers({ now: Date.parse(FINISHED_AT) });

    for (const snapshot of [
      runConsole({ head: { simulated: true } }),
      runConsole({ head: { simulated: true, live: false }, run: { status: "canceled", finishedAt: FINISHED_AT } }),
    ]) {
      const { unmount } = draw(snapshot);
      await settle();

      expect(screen.getByRole("note")).toHaveTextContent(SIMULATED_HEADLINE);
      unmount();
    }
  });
});

describe("who is reading", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse(atSecond(760)) });
  });

  it("a member may steer and nothing else — pause, abort and take-over are absent", async () => {
    draw(runConsole(), { mayControl: false, mayContribute: true });
    await settle();

    expect(screen.queryByRole("group", { name: CONTROLS_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause loop|Resume|Abort run|Take over/ })).toBeNull();
    expect(steerInput()).toBeEnabled();
  });

  it("a viewer reads, and is told why they cannot steer", async () => {
    draw(runConsole(), { mayControl: false, mayContribute: false });
    await settle();

    expect(steerInput()).toBeDisabled();
    expect(transcript()).toHaveTextContent(STEER_READ_ONLY);
  });

  it("an owner is served the controls", async () => {
    draw(runConsole(), { mayControl: true });
    await settle();

    expect(screen.getByRole("group", { name: CONTROLS_LABEL })).toBeInTheDocument();
  });
});

describe("loading", () => {
  it("draws a skeleton for the head, the stepper, the transcript and all three cards", async () => {
    const Loading = (await import("@/app/(app)/runs/[id]/loading")).default;
    render(<Loading />);

    const main = screen.getByRole("main", { name: RUN_LOADING_LABEL });
    expect(main).toHaveAttribute("aria-busy", "true");
    // The head's bars sit under the eyebrow, in the head's own title column — not beside it.
    expect(main.querySelector(".run-head__main .run-skeleton__bar--title")).not.toBeNull();
    expect(main.querySelectorAll(".run-skeleton__step")).toHaveLength(SKELETON_STEPS);
    expect(main.querySelector(".run-skeleton__well")).not.toBeNull();
    expect(main.querySelectorAll(".run__side .run-skeleton__card")).toHaveLength(SKELETON_SIDE_ROWS.length);
  });

  it("hides every bar from the accessibility tree — the page says loading once", async () => {
    const Loading = (await import("@/app/(app)/runs/[id]/loading")).default;
    render(<Loading />);

    const region = document.querySelector(".run-skeleton__region") as HTMLElement;
    expect(region).toHaveAttribute("aria-hidden");
    expect(document.querySelector(".run-skeleton")).toHaveAttribute("aria-hidden");
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("errors", () => {
  it("a run that could not be read says so, with a retry, and draws nothing it does not have", () => {
    draw(null, { initialError: "The service is down." });

    const banner = screen.getByText(UNREAD_HEADLINE).closest(".ou-retry") as HTMLElement;
    expect(banner).toHaveTextContent("The service is down.");
    expect(within(banner).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("region", { name: "Agent transcript" })).toBeNull();
    expect(screen.queryByText(INGEST_LAG_REASON)).toBeNull();
  });

  it("a run that does not exist is the console's own not-found page, with the way back", async () => {
    const NotFound = (await import("@/app/(app)/runs/[id]/not-found")).default;
    render(<NotFound />);

    expect(screen.getByText("Run Console")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(RUN_MISSING_TITLE);
    expect(screen.getByText(RUN_MISSING_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: RUN_MISSING_BACK })).toHaveAttribute("href", DASHBOARD_ORIGIN.route);
  });
});
