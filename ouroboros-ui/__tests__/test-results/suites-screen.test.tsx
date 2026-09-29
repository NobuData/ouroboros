import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TestRunPage } from "@/app/api/test-results";
import type { PollAnswer } from "@/app/poll";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";
import type { TestsPollOptions } from "@/app/test-results/poll";
import { READING_SUITES, SUITES_STALE_HEADLINE, SUITES_TITLE } from "@/app/test-results/suites";
import { TestsScreen, withSuite } from "@/app/test-results/tests-screen";
import { TIMELINE_TITLE } from "@/app/test-results/timeline";

import { SEEDED_RUN_ID } from "../helpers/runs";
import { BUILD_1_ID, BUILD_2_ID, attempt, gate, page, seededSuites, timeline } from "../helpers/test-results";

/**
 * The suites card on the test-results screen (#337): the selection is in the address and restores
 * from it, an attempt switch finds the suite again by name or clears it and says so, and the
 * attempt's page is polled per attempt.
 */

vi.mock("@/app/test-results/rerun-actions", () => ({ requestRerun: vi.fn() }));
vi.mock("@/app/test-results/mark-route-actions", () => ({
  classifyFailure: vi.fn(),
  waiveFailure: vi.fn(),
  setRunIntent: vi.fn(),
}));

/** A poll that never answers — the page shows the server's first read. */
function quiet<T>(): TestsPollOptions<T> {
  return { read: () => new Promise(() => {}), visible: () => true };
}

/** Build 1's suites: the same names under Build 1's ids, and no `OTA update`. */
function buildOneSuites() {
  return seededSuites()
    .filter((each) => each.name !== "OTA update")
    .map((each, index) => ({ ...each, id: `5eed0032-0000-4000-8000-00000004810${index + 1}` }));
}

/** Every attempt's page, by the attempt's id. */
const PAGES: Readonly<Record<string, TestRunPage>> = {
  [BUILD_1_ID]: page({ testRun: attempt(1), suites: buildOneSuites() }),
  [BUILD_2_ID]: page({ testRun: attempt(2) }),
};

/**
 * A page poll that answers for whichever attempt it is built for.
 *
 * @returns The seam, and the ids it was asked for.
 */
function paging(): TestsPollOptions<TestRunPage> & { asked: string[] } {
  const asked: string[] = [];

  return { asked, visible: () => true, read: () => new Promise(() => {}) };
}

/**
 * Draw the screen at an address.
 *
 * @param options The address's query, the first read's page, and the page poll.
 * @returns The Testing Library render result.
 */
function draw(
  options: {
    search?: string;
    initialSuite?: string | null;
    initialAttempt?: number | null;
    initialPage?: TestRunPage | null;
    pagePoll?: TestsPollOptions<TestRunPage>;
  } = {},
) {
  window.history.replaceState(null, "", `/runs/${SEEDED_RUN_ID}/tests${options.search ?? ""}`);

  return render(
    <TestsScreen
      farmPoll={quiet()}
      failurePoll={quiet()}
      gatePoll={quiet()}
      hintsPoll={quiet()}
      initial={timeline()}
      initialAttempt={options.initialAttempt ?? null}
      initialError={null}
      initialGate={gate()}
      initialPage={options.initialPage === undefined ? page() : options.initialPage}
      initialSuite={options.initialSuite ?? null}
      origin={DASHBOARD_ORIGIN}
      pagePoll={options.pagePoll ?? quiet()}
      runId={SEEDED_RUN_ID}
      timelinePoll={quiet()}
      trackerUrl={null}
    />,
  );
}

/**
 * A page poll answering each attempt's own page.
 *
 * `useKeyedPoll` builds one poll per attempt id, and the seam is the same object for all of them,
 * so the answer is chosen by the attempt on screen when the read is made.
 *
 * @param current What names the attempt on screen.
 * @returns The seam.
 */
function answeringFor(current: () => string): TestsPollOptions<TestRunPage> {
  return {
    visible: () => true,
    read: () => {
      const payload = PAGES[current()];
      if (payload === undefined) return new Promise(() => {});

      const answer: PollAnswer<TestRunPage> = { state: "fresh", payload, etag: null, pollAfterSeconds: null };

      return Promise.resolve(answer);
    },
  };
}

/** The suites card. */
function card() {
  return within(screen.getByRole("region", { name: SUITES_TITLE }));
}

/** The suite that is selected, by label, or `null`. */
function selected(): string | null {
  return card().queryByRole("button", { pressed: true })?.textContent ?? null;
}

/** Switch to a build through the timeline. */
function switchTo(attemptSeq: number): void {
  fireEvent.click(
    within(screen.getByRole("region", { name: TIMELINE_TITLE })).getByRole("button", {
      name: new RegExp(`^Build ${attemptSeq}\\b`),
    }),
  );
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("withSuite", () => {
  it("sets the suite and keeps everything else", () => {
    expect(withSuite("?from=build-farm&attempt=3", "telemetry integration")).toBe(
      "?from=build-farm&attempt=3&suite=telemetry+integration",
    );
    expect(withSuite("?suite=old&attempt=2", "OTA update")).toBe("?suite=OTA+update&attempt=2");
  });

  it("removes it when nothing is selected, down to an empty query", () => {
    expect(withSuite("?attempt=3&suite=x", null)).toBe("?attempt=3");
    expect(withSuite("?suite=x", null)).toBe("");
    expect(withSuite("", null)).toBe("");
  });

  it("encodes a name that would otherwise be read as more of the query", () => {
    const search = withSuite("", "a&attempt=9#x");

    expect(new URLSearchParams(search).get("suite")).toBe("a&attempt=9#x");
    expect(new URLSearchParams(search).get("attempt")).toBeNull();
  });
});

describe("the suites card on the screen", () => {
  it("sits beneath the summary strip, with nothing selected and the address untouched", () => {
    draw({ search: "?from=build-farm" });

    const strip = document.querySelector(".tests-strip")!;
    const suites = screen.getByRole("region", { name: SUITES_TITLE });

    expect(strip.compareDocumentPosition(suites) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(selected()).toBeNull();
    expect(window.location.search).toBe("?from=build-farm");
  });

  it("puts the selection in the address, beside the attempt and the origin", () => {
    draw({ search: "?from=build-farm&attempt=3", initialAttempt: 3 });

    fireEvent.click(card().getByRole("button", { name: "telemetry integration" }));

    expect(selected()).toBe("telemetry integration");
    expect(window.location.search).toBe("?from=build-farm&attempt=3&suite=telemetry+integration");
  });

  it("replaces the address rather than pushing, so Back leaves the page", () => {
    draw();
    const before = window.history.length;

    fireEvent.click(card().getByRole("button", { name: "OTA update" }));
    fireEvent.click(card().getByRole("button", { name: "motor control" }));

    expect(window.history.length).toBe(before);
    expect(window.location.search).toBe("?suite=motor+control");
  });

  it("restores the selection the address names, as a reload does", () => {
    draw({ search: "?suite=PHYSICAL+%C2%B7+HIL+rig", initialSuite: "PHYSICAL · HIL rig" });

    expect(selected()).toBe("PHYSICAL · HIL rig");
    expect(window.location.search).toBe("?suite=PHYSICAL+%C2%B7+HIL+rig");
  });

  it("takes the selection out of the address when the selected row is pressed again", () => {
    draw({ search: "?attempt=3&suite=OTA+update", initialSuite: "OTA update", initialAttempt: 3 });

    fireEvent.click(card().getByRole("button", { name: "OTA update" }));

    expect(selected()).toBeNull();
    expect(window.location.search).toBe("?attempt=3");
  });

  it("clears, visibly, a suite the address names and the attempt does not have", () => {
    draw({ search: "?suite=bootloader", initialSuite: "bootloader" });

    expect(selected()).toBeNull();
    expect(card().getByRole("status")).toHaveTextContent("bootloader did not run in Build 3 — selection cleared.");
    expect(window.location.search).toBe("");
  });

  it("says it is reading when the first read brought no page", () => {
    draw({ initialPage: null });

    expect(card().getByText(READING_SUITES)).toBeInTheDocument();
  });

  it("never draws one attempt's first-read page under another attempt", () => {
    draw({ initialAttempt: 2, initialPage: page() });

    expect(card().getByText(READING_SUITES)).toBeInTheDocument();
    expect(card().queryByRole("list")).toBeNull();
  });
});

describe("switching attempts", () => {
  it("finds the selected suite again by name, under the other build's id", async () => {
    let onScreen = "";
    draw({ pagePoll: answeringFor(() => onScreen) });
    fireEvent.click(card().getByRole("button", { name: "telemetry integration" }));

    onScreen = BUILD_1_ID;
    switchTo(1);

    await vi.waitFor(() => expect(selected()).toBe("telemetry integration"));
    expect(document.querySelectorAll(".tests-suites__row")).toHaveLength(4);
    expect(card().queryByRole("status")).toBeNull();
    expect(window.location.search).toBe("?suite=telemetry+integration&attempt=1");
  });

  it("clears the selection and says so when the build has no such suite — never another's data", async () => {
    let onScreen = "";
    draw({ pagePoll: answeringFor(() => onScreen) });
    fireEvent.click(card().getByRole("button", { name: "OTA update" }));
    expect(window.location.search).toBe("?suite=OTA+update");

    onScreen = BUILD_1_ID;
    switchTo(1);

    await vi.waitFor(() =>
      expect(card().getByRole("status")).toHaveTextContent("OTA update did not run in Build 1 — selection cleared."),
    );
    expect(selected()).toBeNull();
    expect(window.location.search).toBe("?attempt=1");
  });

  it("does not bring a cleared selection back, and drops the notice, on the next build", async () => {
    let onScreen = "";
    draw({ pagePoll: answeringFor(() => onScreen) });
    fireEvent.click(card().getByRole("button", { name: "OTA update" }));

    onScreen = BUILD_1_ID;
    switchTo(1);
    await vi.waitFor(() => expect(card().getByRole("status")).toBeInTheDocument());

    onScreen = BUILD_2_ID;
    switchTo(2);

    await vi.waitFor(() => expect(document.querySelectorAll(".tests-suites__row")).toHaveLength(5));
    expect(selected()).toBeNull();
    expect(card().queryByRole("status")).toBeNull();
    expect(window.location.search).toBe("?attempt=2");
  });

  it("drops the notice once another suite is selected", async () => {
    let onScreen = "";
    draw({ pagePoll: answeringFor(() => onScreen) });
    fireEvent.click(card().getByRole("button", { name: "OTA update" }));

    onScreen = BUILD_1_ID;
    switchTo(1);
    await vi.waitFor(() => expect(card().getByRole("status")).toBeInTheDocument());

    fireEvent.click(card().getByRole("button", { name: "motor control" }));

    expect(card().queryByRole("status")).toBeNull();
    expect(selected()).toBe("motor control");
  });

  it("holds the selection while the other build's suites are still being read", () => {
    draw({ pagePoll: paging() });
    fireEvent.click(card().getByRole("button", { name: "telemetry integration" }));

    switchTo(2);

    expect(card().getByText(READING_SUITES)).toBeInTheDocument();
    expect(window.location.search).toBe("?suite=telemetry+integration&attempt=2");
  });
});

describe("the attempt page's poll", () => {
  it("redraws the rows from the poll's answer", async () => {
    const moved = page({
      suites: seededSuites().map((each) =>
        each.name === "telemetry integration"
          ? { ...each, counts: { total: 19, passed: 19, failed: 0, flaky: 0, skipped: 0 } }
          : each,
      ),
    });
    const answer: PollAnswer<TestRunPage> = { state: "fresh", payload: moved, etag: null, pollAfterSeconds: null };

    draw({ pagePoll: { read: () => Promise.resolve(answer), visible: () => true } });

    await vi.waitFor(() => expect(card().getByRole("img", { name: "19 of 19 passed" })).toBeInTheDocument());
  });

  it("keeps the first read's rows under a banner when a refresh fails", async () => {
    const answer: PollAnswer<TestRunPage> = { state: "failed", reason: "The suites could not be reached.", pollAfterSeconds: null };

    draw({ pagePoll: { read: () => Promise.resolve(answer), visible: () => true } });

    await vi.waitFor(() => expect(card().getByText(SUITES_STALE_HEADLINE)).toBeInTheDocument());
    expect(document.querySelectorAll(".tests-suites__row")).toHaveLength(5);
  });
});
