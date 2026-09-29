import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TestCaseFailureDetail, TestRunHints, TestRunPage } from "@/app/api/test-results";
import type { PollAnswer } from "@/app/poll";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";
import {
  AI_SLOT_TITLE,
  FAILURE_TITLE,
  HEURISTIC_CHIP,
  LOG_LABEL,
  NEXT_FAILURE,
  NO_FAILURES,
  NO_HINT,
  PATH_LABEL,
  PREVIOUS_FAILURE,
  READING_FAILURES,
  TRIAGE_EYEBROW,
  didNotFail,
  noFailuresIn,
} from "@/app/test-results/failure";
import { MARK_ROUTE_TITLE } from "@/app/test-results/mark-route";
import { PHYSICAL_TITLE } from "@/app/test-results/physical";
import { type TestsPollOptions, failureUrl, hintsUrl } from "@/app/test-results/poll";
import { SUITES_TITLE } from "@/app/test-results/suites";
import { TestsScreen } from "@/app/test-results/tests-screen";
import { TIMELINE_TITLE } from "@/app/test-results/timeline";

import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  BUILD_1_ID,
  BUILD_3_ID,
  FLAKY_CASE,
  OVERSHOOT_CASE,
  OVERSHOOT_PATH,
  attempt,
  caseFailure,
  gate,
  hints,
  mockupPage,
  page,
  seededSuites,
  timeline,
} from "../helpers/test-results";

/**
 * The failure-detail card on the test-results screen (#339): it is bound by the suites card's
 * and the physical-tests card's selections, re-binds when either changes, pages among the
 * failures in scope from the keyboard, and asks this origin for the bound case's failure and the
 * attempt's hints.
 */

vi.mock("@/app/test-results/rerun-actions", () => ({ requestRerun: vi.fn() }));
vi.mock("@/app/test-results/mark-route-actions", () => ({
  classifyFailure: vi.fn(),
  waiveFailure: vi.fn(),
  setRunIntent: vi.fn(),
}));

/** The failing rig case, as the physical-tests card names it. */
const OVERSHOOT = "Motor overshoot on e-stop release";

/** The flaky case's path. */
const FLAKY_PATH = "tests/integration/test_can.py";

/** A poll that never answers — the page shows the server's first read. */
function quiet<T>(): TestsPollOptions<T> {
  return { read: () => new Promise(() => {}), visible: () => true };
}

/** A poll read through `fetch`, as production reads it. */
function live<T>(): TestsPollOptions<T> {
  return { visible: () => true };
}

/** Every address `fetch` was asked for. */
let asked: string[] = [];

/**
 * Answer this origin's failure and hints reads.
 *
 * @param options The hints, or `null` to fail their read.
 */
function serve(options: { hints?: TestRunHints | null } = {}): void {
  asked = [];

  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      asked.push(url);

      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
        );

      if (url.endsWith("/hints")) {
        return options.hints === null
          ? json({ code: "triage_hints_unavailable", message: "The hints are unavailable." }, 502)
          : json(options.hints ?? hints());
      }

      const caseId = /\/cases\/([^/]+)\/failure$/.exec(url)?.[1] ?? "";
      const testRunId = /\/test-runs\/([^/]+)\//.exec(url)?.[1] ?? "";

      return json(
        caseId === FLAKY_CASE.caseId
          ? caseFailure({
              testRunId,
              caseId,
              name: FLAKY_CASE.name,
              path: FLAKY_PATH,
              message: "ring buffer not drained within 50 ms",
              logExcerpt: null,
            })
          : caseFailure({ testRunId, caseId }),
      );
    }),
  );
}

/**
 * Draw the screen at an address.
 *
 * @param options The selections the address names, the first read's page and the page's poll.
 * @returns The Testing Library render result.
 */
function draw(
  options: {
    initialSuite?: string | null;
    initialCase?: string | null;
    initialPage?: TestRunPage | null;
    pagePoll?: TestsPollOptions<TestRunPage>;
    hintsPoll?: TestsPollOptions<TestRunHints>;
    failurePoll?: TestsPollOptions<TestCaseFailureDetail>;
  } = {},
) {
  window.history.replaceState(null, "", `/runs/${SEEDED_RUN_ID}/tests`);

  return render(
    <TestsScreen
      failurePoll={options.failurePoll ?? live()}
      farmPoll={quiet()}
      gatePoll={quiet()}
      hintsPoll={options.hintsPoll ?? live()}
      initial={timeline()}
      initialAttempt={null}
      initialCase={options.initialCase ?? null}
      initialError={null}
      initialGate={gate()}
      initialPage={options.initialPage === undefined ? mockupPage() : options.initialPage}
      initialSuite={options.initialSuite ?? null}
      origin={DASHBOARD_ORIGIN}
      pagePoll={options.pagePoll ?? quiet()}
      runId={SEEDED_RUN_ID}
      timelinePoll={quiet()}
      trackerUrl={null}
    />,
  );
}

/** The failure-detail card. */
function card() {
  return within(screen.getByRole("region", { name: FAILURE_TITLE }));
}

/** The suites card. */
function suites() {
  return within(screen.getByRole("region", { name: SUITES_TITLE }));
}

/** The physical-tests card. */
function physical() {
  return within(screen.getByRole("region", { name: PHYSICAL_TITLE }));
}

/** What the pager counts. */
function count(): string | null {
  return card().queryByRole("img", { name: /^Failure \d+ of \d+$/ })?.textContent ?? null;
}

/** The path on the card. */
function path(): string | null {
  return card().queryByRole("group", { name: PATH_LABEL })?.textContent ?? null;
}

/** Let the polls' answers land. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("the failure-detail card on the screen", () => {
  it("sits beneath the physical-tests card and above Mark & Route", () => {
    serve();
    draw();

    const above = screen.getByRole("region", { name: PHYSICAL_TITLE });
    const failure = screen.getByRole("region", { name: FAILURE_TITLE });
    const below = screen.getByRole("region", { name: MARK_ROUTE_TITLE });

    expect(above.compareDocumentPosition(failure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(failure.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("holds every failure of the build when nothing is selected, bound to the first", async () => {
    serve();
    draw();
    await settle();

    expect(count()).toBe("1 of 2");
    expect(path()).toBe(`${FLAKY_PATH}::${FLAKY_CASE.name}`);
    expect(card().getByText("build 3")).toBeInTheDocument();
    expect(asked).toContain(failureUrl(BUILD_3_ID, FLAKY_CASE.caseId));
    expect(asked).toContain(hintsUrl(BUILD_3_ID));
  });

  it("draws the seeded failure: the path, the log, the heuristic hint and the honest slot", async () => {
    serve();
    draw({ initialCase: OVERSHOOT });
    await settle();

    const triage = within(card().getByRole("region", { name: TRIAGE_EYEBROW }));

    expect(count()).toBe("1 of 1");
    expect(path()).toBe(`${OVERSHOOT_PATH}::overshoot_under_load`);
    expect(card().getByRole("group", { name: LOG_LABEL })).toHaveTextContent("AssertionError: max overshoot 2.4% > limit 2.0%");
    expect(triage.getByText(HEURISTIC_CHIP)).toBeInTheDocument();
    expect(triage.getByText(/new failure ∩ diff-path overlap → product bug/)).toBeInTheDocument();
    expect(triage.getByText(AI_SLOT_TITLE)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: FAILURE_TITLE }).querySelector(".ou-chip--model")).toBeNull();
  });

  it("says no rule fired for a failure the hints do not name", async () => {
    serve();
    draw();
    await settle();

    expect(within(card().getByRole("region", { name: TRIAGE_EYEBROW })).getByText(NO_HINT)).toBeInTheDocument();
  });

  it("says why the hints could not be read, and still draws the failure and the slot", async () => {
    serve({ hints: null });
    draw({ initialCase: OVERSHOOT });
    await settle();

    const triage = within(card().getByRole("region", { name: TRIAGE_EYEBROW }));

    expect(triage.getByText("The hints are unavailable.")).toBeInTheDocument();
    expect(triage.getByText(AI_SLOT_TITLE)).toBeInTheDocument();
    expect(path()).toBe(`${OVERSHOOT_PATH}::overshoot_under_load`);
  });

  it("says it is reading until the attempt's page has been read, and asks for nothing", async () => {
    serve();
    draw({ initialPage: null });
    await settle();

    expect(card().getByText(READING_FAILURES)).toBeInTheDocument();
    expect(asked).toEqual([]);
  });

  it("asks for neither a failure nor the hints for a build with no failures", async () => {
    serve();
    draw({ initialPage: page({ suites: seededSuites().filter((each) => each.counts.failed + each.counts.flaky === 0) }) });
    await settle();

    expect(card().getByText(NO_FAILURES)).toBeInTheDocument();
    expect(asked).toEqual([]);
  });
});

describe("re-binding from the other cards", () => {
  it("binds to the suite selected in the suites card", async () => {
    serve();
    draw();
    await settle();

    fireEvent.click(suites().getByRole("button", { name: "PHYSICAL · HIL rig" }));
    await settle();

    expect(count()).toBe("1 of 1");
    expect(path()).toBe(`${OVERSHOOT_PATH}::overshoot_under_load`);
  });

  it("says a selected suite has no failures", async () => {
    serve();
    draw();

    fireEvent.click(suites().getByRole("button", { name: "motor control" }));
    await settle();

    expect(card().getByText(noFailuresIn("motor control", 3))).toBeInTheDocument();
    expect(count()).toBeNull();
  });

  it("binds to the case selected in the physical-tests card, and back when it is cleared", async () => {
    serve();
    draw();
    await settle();

    fireEvent.click(physical().getByRole("button", { name: OVERSHOOT }));
    await settle();

    expect(count()).toBe("1 of 1");
    expect(path()).toBe(`${OVERSHOOT_PATH}::overshoot_under_load`);

    fireEvent.click(physical().getByRole("button", { name: OVERSHOOT }));
    await settle();

    expect(count()).toBe("1 of 2");
    expect(path()).toBe(`${FLAKY_PATH}::${FLAKY_CASE.name}`);
  });

  it("says a selected case did not fail, rather than drawing another case's failure", async () => {
    serve();
    draw();

    fireEvent.click(physical().getByRole("button", { name: "Power-loss mid-flash recovery" }));
    await settle();

    expect(card().getByText(didNotFail("Power-loss mid-flash recovery", 3))).toBeInTheDocument();
    expect(path()).toBeNull();
  });

  it("starts again from the first failure when a selection changes after paging", async () => {
    serve();
    draw();
    await settle();

    fireEvent.click(card().getByRole("button", { name: NEXT_FAILURE }));
    await settle();
    expect(count()).toBe("2 of 2");

    fireEvent.click(suites().getByRole("button", { name: "telemetry integration" }));
    await settle();

    expect(count()).toBe("1 of 1");
    expect(path()).toBe(`${FLAKY_PATH}::${FLAKY_CASE.name}`);
  });

  it("changes neither selection when the pager moves", async () => {
    serve();
    draw();
    await settle();

    fireEvent.click(card().getByRole("button", { name: NEXT_FAILURE }));
    await settle();

    expect(window.location.search).toBe("");
    expect(suites().queryByRole("button", { pressed: true })).toBeNull();
    expect(physical().queryByRole("button", { pressed: true })).toBeNull();
  });
});

describe("the pager on the screen", () => {
  it("pages to the next failure and reads it", async () => {
    serve();
    draw();
    await settle();

    fireEvent.click(card().getByRole("button", { name: NEXT_FAILURE }));
    await settle();

    expect(count()).toBe("2 of 2");
    expect(path()).toBe(`${OVERSHOOT_PATH}::overshoot_under_load`);
    expect(within(card().getByRole("region", { name: TRIAGE_EYEBROW })).getByText(HEURISTIC_CHIP)).toBeInTheDocument();
  });

  it("is driven from the keyboard, keeping focus on the pager", async () => {
    serve();
    draw();
    await settle();

    const next = card().getByRole("button", { name: NEXT_FAILURE });
    next.focus();

    fireEvent.keyDown(next, { key: "ArrowRight" });
    await settle();
    expect(count()).toBe("2 of 2");
    expect(card().getByRole("button", { name: NEXT_FAILURE })).toHaveFocus();

    fireEvent.keyDown(card().getByRole("button", { name: NEXT_FAILURE }), { key: "Home" });
    await settle();
    expect(count()).toBe("1 of 2");

    fireEvent.keyDown(card().getByRole("button", { name: PREVIOUS_FAILURE }), { key: "End" });
    await settle();
    expect(count()).toBe("2 of 2");
  });

  it("never draws one case's log under another's pager", async () => {
    serve();
    draw();
    await settle();

    fireEvent.click(card().getByRole("button", { name: NEXT_FAILURE }));

    // Paged, and the new failure not yet read: the first one's path is gone already.
    expect(count()).toBe("2 of 2");
    expect(path()).toBeNull();
  });
});

describe("an attempt switch", () => {
  it("reads the other build's failures under the other build's tag", async () => {
    const buildOne = page({ testRun: attempt(1), suites: seededSuites().filter((each) => each.kind === "physical") });
    const answer: PollAnswer<TestRunPage> = { state: "fresh", payload: buildOne, etag: null, pollAfterSeconds: null };
    let current = "";

    serve({ hints: { testRunId: BUILD_1_ID, cases: [] } });
    draw({
      pagePoll: {
        visible: () => true,
        read: () => (current === BUILD_1_ID ? Promise.resolve(answer) : new Promise(() => {})),
      },
    });
    await settle();

    current = BUILD_1_ID;
    fireEvent.click(
      within(screen.getByRole("region", { name: TIMELINE_TITLE })).getByRole("button", { name: /^Build 1\b/ }),
    );
    await settle();

    expect(card().getByText("build 1")).toBeInTheDocument();
    expect(count()).toBe("1 of 1");
    expect(asked).toContain(failureUrl(BUILD_1_ID, OVERSHOOT_CASE.caseId));
    expect(asked).toContain(hintsUrl(BUILD_1_ID));
  });
});
