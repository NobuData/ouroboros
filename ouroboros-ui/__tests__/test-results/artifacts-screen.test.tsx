import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TestRunPage } from "@/app/api/test-results";
import type { PollAnswer } from "@/app/poll";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";
import type { ArtifactReader } from "@/app/test-results/artifact-viewer";
import { ARTIFACTS_LIST_LABEL, ARTIFACTS_TITLE, EXPIRED, READING_ARTIFACTS } from "@/app/test-results/artifacts";
import { PHYSICAL_TITLE } from "@/app/test-results/physical";
import type { TestsPollOptions } from "@/app/test-results/poll";
import { TestsScreen } from "@/app/test-results/tests-screen";
import { TIMELINE_TITLE } from "@/app/test-results/timeline";

import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  BUILD_1_ID,
  COVERAGE_ARTIFACT_ID,
  LOG_ARTIFACT_ID,
  artifact,
  attempt,
  coverage,
  firstCoverage,
  gate,
  mockupArtifacts,
  mockupPage,
  page,
  timeline,
} from "../helpers/test-results";

/**
 * The artifacts card on the test-results screen (#341): it is drawn from the attempt's page, it
 * follows the attempt on screen and the page's poll, and a text artifact opens in place.
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

/**
 * A page poll answering one page, whichever attempt asks.
 *
 * @param answered The page.
 * @returns The seam.
 */
function paging(answered: TestRunPage): TestsPollOptions<TestRunPage> {
  const answer: PollAnswer<TestRunPage> = { state: "fresh", payload: answered, etag: null, pollAfterSeconds: null };

  return { visible: () => true, read: () => Promise.resolve(answer) };
}

/** Build 3's page as the mockup draws its artifacts. */
function buildThree(): TestRunPage {
  return mockupPage({ artifacts: mockupArtifacts(), coverage: coverage() });
}

/**
 * Draw the screen.
 *
 * @param options The first read's page, the page's poll and the viewer's reader.
 * @returns The Testing Library render result.
 */
function draw(
  options: {
    initialPage?: TestRunPage | null;
    pagePoll?: TestsPollOptions<TestRunPage>;
    read?: ArtifactReader;
  } = {},
) {
  window.history.replaceState(null, "", `/runs/${SEEDED_RUN_ID}/tests`);

  return render(
    <TestsScreen
      artifactRead={options.read ?? (() => Promise.resolve({ state: "read", text: "boot ok\n", clipped: false }))}
      farmPoll={quiet()}
      failurePoll={quiet()}
      gatePoll={quiet()}
      hintsPoll={quiet()}
      initial={timeline()}
      initialAttempt={null}
      initialError={null}
      initialGate={gate()}
      initialPage={options.initialPage === undefined ? buildThree() : options.initialPage}
      origin={DASHBOARD_ORIGIN}
      pagePoll={options.pagePoll ?? quiet()}
      runId={SEEDED_RUN_ID}
      timelinePoll={quiet()}
      trackerUrl={null}
    />,
  );
}

/** The artifacts card. */
function card() {
  return within(screen.getByRole("region", { name: ARTIFACTS_TITLE }));
}

/** The rows' names, as drawn. */
function names(): string[] {
  return within(card().getByRole("list", { name: ARTIFACTS_LIST_LABEL }))
    .getAllByRole("listitem")
    .map((row) => row.querySelector(".tests-artifacts__name")?.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

/** Let the polls' answers land. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Switch to another attempt from the timeline.
 *
 * @param attemptSeq The attempt's ordinal.
 */
function switchTo(attemptSeq: number): void {
  const cards = within(screen.getByRole("region", { name: TIMELINE_TITLE }));

  fireEvent.click(cards.getByRole("button", { name: new RegExp(`Build ${attemptSeq}\\b`) }));
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the artifacts card on the screen", () => {
  it("sits beneath the physical-tests card, drawn from the first read", () => {
    draw();

    const above = screen.getByRole("region", { name: PHYSICAL_TITLE });
    const artifacts = screen.getByRole("region", { name: ARTIFACTS_TITLE });

    expect(above.compareDocumentPosition(artifacts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(names()).toEqual([
      "junit-build3.xml",
      "rig-capture-estop.csv 2.1 MB",
      "serial-console.log",
      "coverage 87.4% (+0.6%)",
    ]);
    expect(card().getByText("retained 30d")).toBeInTheDocument();
  });

  it("says it is reading until the attempt's page has been read", () => {
    draw({ initialPage: null });

    expect(card().getByText(READING_ARTIFACTS)).toBeInTheDocument();
  });

  it("opens a text artifact in place, through this origin", async () => {
    const read = vi.fn<ArtifactReader>(() => Promise.resolve({ state: "read", text: "boot ok\n", clipped: false }));
    draw({ read });

    fireEvent.click(card().getByRole("button", { name: "Open serial-console.log" }));

    expect((await card().findByRole("group", { name: "serial-console.log" })).textContent).toBe("boot ok\n");
    expect(read).toHaveBeenCalledWith(`/api/artifacts/${LOG_ARTIFACT_ID}`, expect.any(AbortSignal));
  });

  it("follows the page's poll: a file the sweep took becomes a tombstone, and is not dropped", async () => {
    draw({
      pagePoll: paging(
        mockupPage({
          artifacts: mockupArtifacts().map((each) =>
            each.id === LOG_ARTIFACT_ID ? artifact({ ...each, state: "expired", href: null }) : each,
          ),
          coverage: coverage(),
        }),
      ),
    });
    await settle();

    expect(names()).toHaveLength(4);
    expect(names()).toContain("serial-console.log");
    expect(card().getByText(EXPIRED)).toBeInTheDocument();
    expect(card().queryByRole("button", { name: "Open serial-console.log" })).toBeNull();
  });

  it("follows a non-default retention policy", async () => {
    draw({
      pagePoll: paging(
        mockupPage({ artifacts: mockupArtifacts().map((each) => ({ ...each, retentionDays: 7 })), coverage: coverage() }),
      ),
    });
    await settle();

    expect(card().getByText("retained 7d")).toBeInTheDocument();
    expect(card().queryByText("retained 30d")).toBeNull();
  });

  it("redraws for the attempt on screen, closing an open viewer, and prints no delta for a first attempt", async () => {
    let onScreen = "";
    const buildOne = page({
      testRun: attempt(1),
      artifacts: [
        artifact({
          id: COVERAGE_ARTIFACT_ID.replace(/4$/, "1"),
          name: "coverage.info",
          kind: "coverage",
          coverage: firstCoverage(),
        }),
      ],
      coverage: firstCoverage(),
    });
    draw({
      pagePoll: {
        visible: () => true,
        read: () =>
          onScreen === BUILD_1_ID
            ? Promise.resolve({ state: "fresh", payload: buildOne, etag: null, pollAfterSeconds: null })
            : new Promise(() => {}),
      },
    });

    fireEvent.click(card().getByRole("button", { name: "Open junit-build3.xml" }));
    expect(await card().findByRole("region", { name: "Contents of junit-build3.xml" })).toBeInTheDocument();

    onScreen = BUILD_1_ID;
    switchTo(1);
    await settle();

    expect(names()).toEqual(["coverage 86.8%"]);
    expect(card().queryByText(/0\.0%/)).toBeNull();
    expect(card().queryByRole("region", { name: /^Contents of/ })).toBeNull();
  });

  it("never draws another attempt's artifacts while the attempt on screen is being read", () => {
    draw();

    switchTo(1);

    expect(card().getByText(READING_ARTIFACTS)).toBeInTheDocument();
    expect(card().queryByText("junit-build3.xml")).toBeNull();
  });
});
