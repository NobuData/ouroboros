import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FarmPage } from "@/app/api/farm";
import type { TestRunPage } from "@/app/api/test-results";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import type { PollAnswer } from "@/app/poll";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";
import {
  PHYSICAL_TITLE,
  RIG_ONLINE,
  caseCleared,
  caseOutOfScope,
  simulatedScope,
} from "@/app/test-results/physical";
import type { TestsPollOptions } from "@/app/test-results/poll";
import { SUITES_TITLE } from "@/app/test-results/suites";
import { TestsScreen, withCase } from "@/app/test-results/tests-screen";
import { TIMELINE_TITLE } from "@/app/test-results/timeline";

import { farmRunner, seededFarm } from "../helpers/farm";
import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  BUILD_1_ID,
  attempt,
  gate,
  mockupPage,
  mockupRigSuite,
  page,
  seededSuites,
  timeline,
} from "../helpers/test-results";

/**
 * The physical-tests card on the test-results screen (#338): the selected case is in the address
 * and restores from it, it stays in step with the suites card's selection and the attempt on
 * screen, and the farm is asked whether a rig is online only while a rig is drawn.
 */

vi.mock("@/app/test-results/rerun-actions", () => ({ requestRerun: vi.fn() }));
vi.mock("@/app/test-results/mark-route-actions", () => ({
  classifyFailure: vi.fn(),
  waiveFailure: vi.fn(),
  setRunIntent: vi.fn(),
}));

/** The failing row's case. */
const OVERSHOOT = "Motor overshoot on e-stop release";

/** The rig's suite. */
const RIG_SUITE = "PHYSICAL · HIL rig";

/** A poll that never answers — the page shows the server's first read. */
function quiet<T>(): TestsPollOptions<T> {
  return { read: () => new Promise(() => {}), visible: () => true };
}

/**
 * A farm poll that answers with a fleet, and counts how often it was asked.
 *
 * @param fleet The farm page.
 * @returns The seam, and its count.
 */
function farmOf(fleet: FarmPage): FarmPollOptions & { asked: () => number } {
  let asked = 0;
  const answer: PollAnswer<FarmPage> = { state: "fresh", payload: fleet, etag: null, pollAfterSeconds: null };

  return {
    asked: () => asked,
    visible: () => true,
    read: () => {
      asked += 1;

      return Promise.resolve(answer);
    },
  };
}

/**
 * A page poll answering a page for Build 1 and nothing for the others.
 *
 * @param buildOne Build 1's page.
 * @param current What names the attempt on screen.
 * @returns The seam.
 */
function pagingBuildOne(buildOne: TestRunPage, current: () => string): TestsPollOptions<TestRunPage> {
  return {
    visible: () => true,
    read: () => {
      if (current() !== BUILD_1_ID) return new Promise(() => {});

      const answer: PollAnswer<TestRunPage> = { state: "fresh", payload: buildOne, etag: null, pollAfterSeconds: null };

      return Promise.resolve(answer);
    },
  };
}

/**
 * Draw the screen at an address.
 *
 * @param options The address's query, the selections it names, the first read's page and the polls.
 * @returns The Testing Library render result.
 */
function draw(
  options: {
    search?: string;
    initialSuite?: string | null;
    initialCase?: string | null;
    initialPage?: TestRunPage | null;
    pagePoll?: TestsPollOptions<TestRunPage>;
    farmPoll?: FarmPollOptions;
  } = {},
) {
  window.history.replaceState(null, "", `/runs/${SEEDED_RUN_ID}/tests${options.search ?? ""}`);

  return render(
    <TestsScreen
      farmPoll={options.farmPoll ?? quiet()}
      failurePoll={quiet()}
      gatePoll={quiet()}
      hintsPoll={quiet()}
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

/** The physical-tests card. */
function card() {
  return within(screen.getByRole("region", { name: PHYSICAL_TITLE }));
}

/** The suites card. */
function suites() {
  return within(screen.getByRole("region", { name: SUITES_TITLE }));
}

/** The case that is selected, by name, or `null`. */
function selected(): string | null {
  return card().queryByRole("button", { pressed: true })?.textContent ?? null;
}

/** Let the polls' answers land. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("withCase", () => {
  it("sets the case and keeps everything else", () => {
    expect(withCase("?attempt=3&suite=HIL", "estop release")).toBe("?attempt=3&suite=HIL&case=estop+release");
    expect(withCase("?case=old&attempt=2", "new")).toBe("?case=new&attempt=2");
  });

  it("removes it when nothing is selected, down to an empty query", () => {
    expect(withCase("?attempt=3&case=x", null)).toBe("?attempt=3");
    expect(withCase("?case=x", null)).toBe("");
  });

  it("encodes a name that would otherwise be read as more of the query", () => {
    const search = withCase("", "a&suite=9#x");

    expect(new URLSearchParams(search).get("case")).toBe("a&suite=9#x");
    expect(new URLSearchParams(search).get("suite")).toBeNull();
  });
});

describe("the physical-tests card on the screen", () => {
  it("sits beneath the suites card, with nothing selected and the address untouched", () => {
    draw({ search: "?from=build-farm" });

    const above = screen.getByRole("region", { name: SUITES_TITLE });
    const physical = screen.getByRole("region", { name: PHYSICAL_TITLE });

    expect(above.compareDocumentPosition(physical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(selected()).toBeNull();
    expect(window.location.search).toBe("?from=build-farm");
  });

  it("puts the selected case in the address, beside the suite", () => {
    draw({ search: "?attempt=3" });

    fireEvent.click(suites().getByRole("button", { name: RIG_SUITE }));
    fireEvent.click(card().getByRole("button", { name: OVERSHOOT }));

    expect(selected()).toBe(OVERSHOOT);
    expect(new URLSearchParams(window.location.search).get("case")).toBe(OVERSHOOT);
    expect(new URLSearchParams(window.location.search).get("suite")).toBe(RIG_SUITE);
    expect(new URLSearchParams(window.location.search).get("attempt")).toBe("3");
  });

  it("replaces the address rather than pushing, so Back leaves the page", () => {
    draw();
    const before = window.history.length;

    fireEvent.click(card().getByRole("button", { name: OVERSHOOT }));
    fireEvent.click(card().getByRole("button", { name: "Power-loss mid-flash recovery" }));

    expect(window.history.length).toBe(before);
    expect(new URLSearchParams(window.location.search).get("case")).toBe("Power-loss mid-flash recovery");
  });

  it("restores the selection the address names, as a reload does", () => {
    draw({ search: `${withCase("", OVERSHOOT)}`, initialCase: OVERSHOOT });

    expect(selected()).toBe(OVERSHOOT);
    expect(new URLSearchParams(window.location.search).get("case")).toBe(OVERSHOOT);
  });

  it("takes the selection out of the address when the selected row is pressed again", () => {
    draw({ search: `${withCase("?attempt=3", OVERSHOOT)}`, initialCase: OVERSHOOT });

    fireEvent.click(card().getByRole("button", { name: OVERSHOOT }));

    expect(selected()).toBeNull();
    expect(window.location.search).toBe("?attempt=3");
  });

  it("clears a case the address names that no rig ran, and says so", () => {
    draw({ search: "?case=can_frame_roundtrip", initialCase: "can_frame_roundtrip" });

    expect(selected()).toBeNull();
    expect(card().getByRole("status")).toHaveTextContent(caseCleared("can_frame_roundtrip", 3));
    expect(window.location.search).toBe("");
  });
});

describe("in step with the suites card", () => {
  it("keeps the rig's rows, and the selected case, when the rig's suite is selected", () => {
    draw({ initialCase: OVERSHOOT });

    fireEvent.click(suites().getByRole("button", { name: RIG_SUITE }));

    expect(card().getAllByRole("listitem")).toHaveLength(4);
    expect(selected()).toBe(OVERSHOOT);
    expect(card().queryByRole("status")).toBeNull();
  });

  it("empties the card for a simulated suite, and says why", () => {
    draw();

    fireEvent.click(suites().getByRole("button", { name: "telemetry integration" }));

    expect(card().queryByRole("list")).toBeNull();
    expect(card().getByText(simulatedScope("telemetry integration"))).toBeInTheDocument();
  });

  it("clears a selected case that the suite now selected does not hold, and says so", () => {
    draw({ search: withCase("", OVERSHOOT), initialCase: OVERSHOOT });

    fireEvent.click(suites().getByRole("button", { name: "telemetry integration" }));

    expect(card().getByRole("status")).toHaveTextContent(caseOutOfScope(OVERSHOOT, "telemetry integration"));
    expect(new URLSearchParams(window.location.search).get("case")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("suite")).toBe("telemetry integration");
  });

  it("draws every rig again, with nothing selected, when the suite is cleared", () => {
    draw({ initialSuite: "telemetry integration", search: "?suite=telemetry+integration" });

    fireEvent.click(suites().getByRole("button", { name: "telemetry integration" }));

    expect(card().getAllByRole("listitem")).toHaveLength(4);
    expect(selected()).toBeNull();
  });

  it("restores a suite and a case the address names together", () => {
    draw({ initialSuite: RIG_SUITE, initialCase: OVERSHOOT });

    expect(suites().getByRole("button", { pressed: true })).toHaveTextContent(RIG_SUITE);
    expect(selected()).toBe(OVERSHOOT);
  });
});

describe("an attempt switch", () => {
  /** Switch to a build through the timeline. */
  function switchTo(attemptSeq: number): void {
    fireEvent.click(
      within(screen.getByRole("region", { name: TIMELINE_TITLE })).getByRole("button", {
        name: new RegExp(`^Build ${attemptSeq}\\b`),
      }),
    );
  }

  it("finds the selected case again by name, under the other build's ids", async () => {
    const rig = mockupRigSuite({ id: "5eed0032-0000-4000-8000-000000048105" });
    const buildOne = page({
      testRun: attempt(1),
      suites: [{ ...rig, cases: rig.cases.map((each, index) => ({ ...each, id: `5eed0035-0000-4000-8000-00000000010${index}` })) }],
    });
    let current = "";

    draw({ initialCase: OVERSHOOT, pagePoll: pagingBuildOne(buildOne, () => current) });
    current = BUILD_1_ID;
    switchTo(1);
    await settle();

    expect(selected()).toBe(OVERSHOOT);
    expect(card().queryByRole("status")).toBeNull();
  });

  it("clears a case the build did not run on a rig, and says which build", async () => {
    const buildOne = page({ testRun: attempt(1), suites: seededSuites().filter((each) => each.kind === "sim") });
    let current = "";

    draw({ search: withCase("", OVERSHOOT), initialCase: OVERSHOOT, pagePoll: pagingBuildOne(buildOne, () => current) });
    current = BUILD_1_ID;
    switchTo(1);
    await settle();

    expect(card().getByRole("status")).toHaveTextContent(caseCleared(OVERSHOOT, 1));
    expect(new URLSearchParams(window.location.search).get("case")).toBeNull();
  });

  it("draws no other build's rows while the new build's page is unread", () => {
    draw();

    switchTo(1);

    expect(card().queryByRole("list")).toBeNull();
  });
});

describe("the rig online pill", () => {
  it("is drawn once the farm names a connected runner of the rig's name", async () => {
    const fleet = seededFarm({ runners: [farmRunner({ name: "helios-rig-02", status: "online" })] });

    draw({ farmPoll: farmOf(fleet) });
    expect(card().queryByText(RIG_ONLINE)).toBeNull();

    await settle();
    expect(card().getByText(RIG_ONLINE)).toBeInTheDocument();
  });

  it("is omitted when the seeded fleet holds no runner of that name", async () => {
    draw({ farmPoll: farmOf(seededFarm()) });
    await settle();

    expect(card().queryByText(RIG_ONLINE)).toBeNull();
  });

  it("is omitted when the farm cannot be read", async () => {
    const failed: PollAnswer<FarmPage> = { state: "failed", reason: "The farm is unavailable.", pollAfterSeconds: null };

    draw({ farmPoll: { visible: () => true, read: () => Promise.resolve(failed) } });
    await settle();

    expect(card().queryByText(RIG_ONLINE)).toBeNull();
    expect(screen.queryByText("The farm is unavailable.")).toBeNull();
  });

  it("does not ask the farm at all for a build that ran nothing on a rig", async () => {
    const farm = farmOf(seededFarm());

    draw({ farmPoll: farm, initialPage: page({ suites: seededSuites().filter((each) => each.kind === "sim") }) });
    await settle();

    expect(farm.asked()).toBe(0);
  });
});
