import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TestParseWarning, TestRunPage, TestRunTimeline } from "@/app/api/test-results";
import { clockTime } from "@/app/dashboard/view";
import { DASHBOARD_PATH, runPath, workflowPath } from "@/app/paths";
import type { PollAnswer } from "@/app/poll";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";
import { INGEST_LAG_AFTER_SECONDS } from "@/app/runs/states";
import { MARK_ROUTE_TITLE } from "@/app/test-results/mark-route-slot";
import type { TestsPollOptions } from "@/app/test-results/poll";
import {
  NO_RESULTS_NOTE,
  NO_RESULTS_TITLE,
  NO_TEST_STAGE_TITLE,
  OPEN_RUN_CONSOLE,
  OPEN_WORKFLOW,
  PARSE_WARNINGS_LABEL,
  PARSE_WARNING_MISSING,
  PARTIAL_LABEL,
  TESTS_LAG_REASON,
  TESTS_LAG_RETRY,
  noTestStageNote,
} from "@/app/test-results/states";
import {
  SKELETON_ATTEMPTS,
  SKELETON_CARD_ROWS,
  SKELETON_STATS,
  SKELETON_SUITES,
  TESTS_LOADING_LABEL,
  TestsLoading,
} from "@/app/test-results/tests-loading";
import {
  TESTS_MISSING_BACK,
  TESTS_MISSING_NOTE,
  TESTS_MISSING_TITLE,
  TestsMissing,
} from "@/app/test-results/tests-missing";
import { TestsScreen } from "@/app/test-results/tests-screen";
import {
  ACTIONS_LABEL,
  STALE_HEADLINE,
  STRIP_LABEL,
  TESTS_EYEBROW,
  UNREAD_HEADLINE,
  VIEWER_REASON,
} from "@/app/test-results/view";

import { SEEDED_RUN_ID } from "../helpers/runs";
import { attempt, gate, page, seededAttempts, strip, timeline } from "../helpers/test-results";

/**
 * The test-results page's states besides *results already parsed* (#342), rendered through the
 * whole screen: a build still running, a workflow with no test stage, a run without results, a
 * report that parsed in part, uploads gone quiet, who is reading, the skeleton, and the errors — a
 * run that could not be read, a run that does not exist and a build the run never made.
 */

// The Server Action is never reached here: no case presses a re-run.
vi.mock("@/app/test-results/rerun-actions", () => ({ requestRerun: vi.fn() }));

/** A poll that never answers — the page shows the server's first read. */
function quiet<T>(): TestsPollOptions<T> {
  return { read: () => new Promise(() => {}), visible: () => true };
}

/** A poll that fails. */
function failing<T>(reason: string): TestsPollOptions<T> {
  const answer: PollAnswer<T> = { state: "failed", reason, pollAfterSeconds: null };

  return { read: () => Promise.resolve(answer), visible: () => true };
}

/** When the helper's attempt last received a report. */
const LAST_RECEIVED = Date.parse("2026-09-19T14:44:31.000Z");

/** Build 3, still running, forty cases in. */
const RUNNING = attempt(3, {
  status: "running",
  selection: "failed",
  strip: strip({ total: 40, passed: 40, failed: 0, failedCases: [], flaky: 0, flakyCases: [] }),
});

/** The seeded run with Build 3 still running. */
function runningTimeline(): TestRunTimeline {
  const [one, two] = seededAttempts();

  return timeline({ attempts: [one!, two!, RUNNING] });
}

/** The truncated JUnit file of the issue's story. */
const TRUNCATED: TestParseWarning = {
  code: "xml_truncated",
  file: "junit-telemetry.xml",
  message: "The document ended inside <testsuite>; 40 cases closed before it.",
  at: "line 212",
};

/**
 * Draw the screen.
 *
 * @param options What to pass besides the seed.
 * @returns The Testing Library render result.
 */
function draw(
  options: {
    initial?: TestRunTimeline | null;
    initialError?: string | null;
    initialAttempt?: number | null;
    initialPage?: TestRunPage | null;
    hasTestStage?: boolean | null;
    mayContribute?: boolean;
    timelinePoll?: TestsPollOptions<TestRunTimeline>;
  } = {},
) {
  return render(
    <TestsScreen
      failurePoll={quiet()}
      farmPoll={quiet()}
      gatePoll={quiet()}
      hasTestStage={options.hasTestStage ?? null}
      hintsPoll={quiet()}
      initial={options.initial === undefined ? timeline() : options.initial}
      initialAttempt={options.initialAttempt ?? null}
      initialError={options.initialError ?? null}
      initialGate={gate()}
      initialPage={options.initialPage ?? null}
      mayContribute={options.mayContribute ?? true}
      origin={DASHBOARD_ORIGIN}
      pagePoll={quiet()}
      readAt={LAST_RECEIVED}
      runId={SEEDED_RUN_ID}
      timelinePoll={options.timelinePoll ?? quiet()}
      trackerUrl={null}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: LAST_RECEIVED + 1000, shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("a build that is still running", () => {
  it("labels its figures partial, above the strip they qualify", () => {
    draw({ initial: runningTimeline() });

    const note = screen.getByText(PARTIAL_LABEL).closest("p")!;
    expect(note).toHaveAttribute("role", "status");
    expect(note).toHaveTextContent("Build 3 is still running — 40 cases have been reported so far.");
    expect(note).toHaveTextContent("not the final result");
    expect(
      note.compareDocumentPosition(screen.getByRole("region", { name: STRIP_LABEL })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("never draws a mid-parse count in a verdict's hue", () => {
    const behind = { ...RUNNING, strip: strip({ total: 63, passed: 40, failed: 0, failedCases: [] }) };
    draw({ initial: timeline({ attempts: [behind] }) });

    const pill = document.querySelector(".tests-head__meta .ou-chip")!;
    expect(pill).toHaveTextContent("40/63 passed · running");
    expect(pill).toHaveClass("ou-chip--accent");
    expect(pill).not.toHaveClass("ou-chip--err");
    expect(pill).not.toHaveClass("ou-chip--warn");
  });

  it("draws the live attempt card pulsing", () => {
    draw({ initial: runningTimeline() });

    const live = document.querySelector(".tests-timeline__card--live");
    expect(live).not.toBeNull();
    expect(live!.querySelector(".tests-timeline__pulse")).not.toBeNull();
  });

  it("drops the label once the build has finished", () => {
    draw();

    expect(screen.queryByText(PARTIAL_LABEL)).toBeNull();
  });

  it("labels only the running build, not a finished one beside it", () => {
    draw({ initial: runningTimeline(), initialAttempt: 2 });

    expect(screen.queryByText(PARTIAL_LABEL)).toBeNull();
  });
});

describe("a run with nothing to show", () => {
  it("says the workflow has no test stage, and links to the workflow", () => {
    draw({ initial: timeline({ attempts: [] }), hasTestStage: false });

    expect(screen.getByText(NO_TEST_STAGE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(noTestStageNote("standard-fix v14"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: OPEN_WORKFLOW })).toHaveAttribute(
      "href",
      workflowPath("standard-fix"),
    );
    expect(screen.queryByText(NO_RESULTS_TITLE)).toBeNull();
  });

  it("says a run whose workflow tests has no results yet, and links to its console", () => {
    draw({ initial: timeline({ attempts: [] }), hasTestStage: true });

    expect(screen.getByText(NO_RESULTS_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_RESULTS_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: OPEN_RUN_CONSOLE })).toHaveAttribute(
      "href",
      runPath(SEEDED_RUN_ID, DASHBOARD_ORIGIN.id),
    );
  });

  it("does not claim the workflow has no test stage when its stages could not be read", () => {
    draw({ initial: timeline({ attempts: [] }), hasTestStage: null });

    expect(screen.getByText(NO_RESULTS_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(NO_TEST_STAGE_TITLE)).toBeNull();
  });

  it("keeps the head, and draws no strip, no cards and no actions", () => {
    draw({ initial: timeline({ attempts: [] }), hasTestStage: false });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#482");
    expect(screen.queryByRole("region", { name: STRIP_LABEL })).toBeNull();
    expect(screen.queryByRole("group", { name: ACTIONS_LABEL })).toBeNull();
    expect(screen.queryByText(MARK_ROUTE_TITLE)).toBeNull();
  });
});

describe("the parse-warning banner", () => {
  it("names the file, what failed to parse and what is missing", () => {
    draw({ initialPage: page({ parseWarnings: [TRUNCATED] }) });

    const banner = screen.getByRole("status", { name: PARSE_WARNINGS_LABEL });
    expect(banner).toHaveTextContent("1 report file could not be fully read");
    expect(banner).toHaveTextContent("Build 3's results are incomplete");
    expect(within(banner).getByText("junit-telemetry.xml · line 212")).toBeInTheDocument();
    expect(within(banner).getByText(TRUNCATED.message)).toBeInTheDocument();
    expect(within(banner).getByText(PARSE_WARNING_MISSING.xml_truncated)).toBeInTheDocument();
  });

  it("lists every warning", () => {
    draw({
      initialPage: page({
        parseWarnings: [
          TRUNCATED,
          { code: "coverage_unreadable", file: "lcov.info", message: "No line counts." },
        ],
      }),
    });

    const banner = screen.getByRole("status", { name: PARSE_WARNINGS_LABEL });
    expect(within(banner).getAllByRole("listitem")).toHaveLength(2);
    expect(within(banner).getByText("lcov.info")).toBeInTheDocument();
  });

  it("is absent when the parser read everything", () => {
    draw({ initialPage: page() });

    expect(screen.queryByRole("status", { name: PARSE_WARNINGS_LABEL })).toBeNull();
  });

  it("is never drawn from another build's page", () => {
    draw({ initialAttempt: 2, initialPage: page({ parseWarnings: [TRUNCATED] }) });

    expect(screen.queryByRole("status", { name: PARSE_WARNINGS_LABEL })).toBeNull();
  });
});

describe("the ingest-lag banner", () => {
  /** The banner's headline, at the helper's last-received instant. */
  const HEADLINE = `No results received since ${clockTime(LAST_RECEIVED)} — Build 3's uploads have gone quiet.`;

  it("appears once a running build's uploads go stale, stating the last-received time", () => {
    draw({ initial: runningTimeline() });
    expect(screen.queryByText(HEADLINE)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(INGEST_LAG_AFTER_SECONDS * 1000);
    });

    expect(screen.getByText(HEADLINE)).toBeInTheDocument();
    expect(screen.getByText(TESTS_LAG_REASON)).toBeInTheDocument();
  });

  it("asks the service again when pressed", () => {
    const read = vi.fn(() => new Promise<PollAnswer<TestRunTimeline>>(() => {}));
    draw({ initial: runningTimeline(), timelinePoll: { read, visible: () => true } });
    act(() => {
      vi.advanceTimersByTime(INGEST_LAG_AFTER_SECONDS * 1000);
    });
    const asked = read.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: TESTS_LAG_RETRY }));

    expect(read.mock.calls.length).toBeGreaterThan(asked);
  });

  it("is never drawn for a build that has finished", () => {
    draw();

    act(() => {
      vi.advanceTimersByTime(INGEST_LAG_AFTER_SECONDS * 10_000);
    });

    expect(screen.queryByText(HEADLINE)).toBeNull();
  });

  it("gives way to a failed refresh's banner", async () => {
    vi.setSystemTime(LAST_RECEIVED + INGEST_LAG_AFTER_SECONDS * 2000);
    draw({ initial: runningTimeline(), timelinePoll: failing("The service is down.") });

    expect(await screen.findByText(STALE_HEADLINE)).toBeInTheDocument();
    expect(screen.queryByText(HEADLINE)).toBeNull();
  });
});

describe("who is reading", () => {
  it("lets a member start a re-run, and offers no waive", () => {
    draw({ mayContribute: true });

    expect(screen.queryByText(VIEWER_REASON)).toBeNull();
    expect(screen.queryByRole("button", { name: /waive/i })).toBeNull();
  });

  it("tells a viewer why the re-runs are off", () => {
    draw({ mayContribute: false });

    expect(screen.getByText(VIEWER_REASON)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /waive/i })).toBeNull();
  });
});

describe("loading", () => {
  it("draws every region's skeleton, hidden from the accessibility tree", () => {
    const { container } = render(<TestsLoading />);

    const main = screen.getByRole("main", { name: TESTS_LOADING_LABEL });
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(TESTS_EYEBROW)).toBeInTheDocument();
    expect(container.querySelector(".tests-skeleton__bar--title")).not.toBeNull();
    expect(container.querySelector(".tests-skeleton__bar--meta")).not.toBeNull();
    expect(container.querySelectorAll(".tests-skeleton__attempt")).toHaveLength(SKELETON_ATTEMPTS);
    expect(container.querySelectorAll(".tests-skeleton__stat")).toHaveLength(SKELETON_STATS);
    // The timeline, the suites, and the cards under them.
    expect(container.querySelectorAll(".tests-skeleton__card")).toHaveLength(2 + SKELETON_CARD_ROWS.length);
    expect(container.querySelectorAll(".tests-skeleton__bar--row")).toHaveLength(
      SKELETON_SUITES + SKELETON_CARD_ROWS.reduce((sum, rows) => sum + rows, 0),
    );
    for (const bar of container.querySelectorAll(".tests-skeleton__bar")) {
      expect(bar.closest("[aria-hidden]")).not.toBeNull();
    }
  });

  it("is one main landmark with no chrome of its own", () => {
    const { container } = render(<TestsLoading />);

    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("header, nav")).toBeNull();
  });
});

describe("errors", () => {
  it("draws a run that could not be read as a banner, with nothing invented beneath it", () => {
    draw({ initial: null, initialError: "The service is down." });

    expect(screen.getByText(UNREAD_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("The service is down.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText(NO_RESULTS_TITLE)).toBeNull();
  });

  it("draws a run that does not exist inside the shell, with the way back", () => {
    const { container } = render(<TestsMissing />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TESTS_MISSING_TITLE);
    expect(screen.getByText(TESTS_MISSING_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: TESTS_MISSING_BACK })).toHaveAttribute("href", DASHBOARD_PATH);
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("says which build is shown when the address names one the run never made", () => {
    draw({ initialAttempt: 9 });

    expect(
      screen.getByText("Build 9 does not exist for this run — showing Build 3, the latest."),
    ).toHaveAttribute("role", "status");
    expect(screen.getByText("Test Results · Run #1847 · Build 3")).toBeInTheDocument();
  });

  it("drops that notice once the reader picks a build that exists", () => {
    draw({ initialAttempt: 9 });

    fireEvent.click(
      within(screen.getByRole("region", { name: "Build attempts" })).getByRole("button", {
        name: /^Build 2\b/,
      }),
    );

    expect(screen.queryByText(/does not exist for this run/)).toBeNull();
  });
});
