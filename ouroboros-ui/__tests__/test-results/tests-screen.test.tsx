import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RerunAvailability, TestRunTimeline } from "@/app/api/test-results";
import type { CommitSource } from "@/app/runs/cards";
import { BUILD_FARM_PATH, runPath } from "@/app/paths";
import type { PollAnswer } from "@/app/poll";
import { BUILD_FARM_ORIGIN, DASHBOARD_ORIGIN, type RunOrigin } from "@/app/runs/origin";
import { navRegistry } from "@/app/shell/nav-registry";
import type { NavEntry } from "@/app/shell/nav";
import { MARK_ROUTE_TITLE, NOTHING_STAGED, STAGED_LABEL } from "@/app/test-results/mark-route-slot";
import type { TestsPollOptions } from "@/app/test-results/poll";
import type { RerunOutcome } from "@/app/test-results/rerun";
import { InsightsLink, SummaryStrip } from "@/app/test-results/summary-strip";
import { type RerunSender, TestsScreen } from "@/app/test-results/tests-screen";
import { PR_PLANE_NOTE, TIMELINE_LIST_LABEL, TIMELINE_TITLE } from "@/app/test-results/timeline";
import {
  ACTIONS_LABEL,
  GATE_CHECKING,
  NO_ATTEMPTS,
  STALE_HEADLINE,
  STRIP_LABEL,
  UNREAD_HEADLINE,
  VIEWER_REASON,
  stripView,
} from "@/app/test-results/view";

import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  BUILD_1_ID,
  BUILD_3_ID,
  OVERSHOOT_CASE,
  gate,
  mockupAttempts,
  strip,
  timeline,
} from "../helpers/test-results";

/**
 * The test-results frame (#335), rendered: the seeded head and strip against mockup 11, the build
 * attempts timeline (#336) whose cards switch the attempt and redraw every region and the address, the re-runs gated with a visible reason, *Send
 * failures back to loop* focusing Mark & Route with the failed set staged, the flaky card's honest
 * link to insights, and the shell's contextual-surface contract.
 */

// The Server Action is never reached here: the cases that press a re-run pass their own sender.
vi.mock("@/app/test-results/rerun-actions", () => ({ requestRerun: vi.fn() }));

/** A poll that never answers — the page shows the server's first read. */
function quiet<T>(): TestsPollOptions<T> {
  return { read: () => new Promise(() => {}), visible: () => true };
}

/** A poll that answers one value, fresh. */
function answering<T>(payload: T): TestsPollOptions<T> {
  const answer: PollAnswer<T> = { state: "fresh", payload, etag: null, pollAfterSeconds: null };

  return { read: () => Promise.resolve(answer), visible: () => true };
}

/** A poll that fails. */
function failing<T>(reason: string): TestsPollOptions<T> {
  const answer: PollAnswer<T> = { state: "failed", reason, pollAfterSeconds: null };

  return { read: () => Promise.resolve(answer), visible: () => true };
}

/** The seeded tracker link. */
const TRACKER = "https://github.com/acme-robotics/helios-firmware/issues/482";

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
    initialGate?: RerunAvailability | null;
    commitSource?: CommitSource | null;
    origin?: RunOrigin;
    mayContribute?: boolean;
    timelinePoll?: TestsPollOptions<TestRunTimeline>;
    gatePoll?: TestsPollOptions<RerunAvailability>;
    send?: RerunSender;
  } = {},
) {
  return render(
    <TestsScreen
      commitSource={options.commitSource ?? null}
      gatePoll={options.gatePoll ?? quiet()}
      initial={options.initial === undefined ? timeline() : options.initial}
      initialAttempt={options.initialAttempt ?? null}
      initialError={options.initialError ?? null}
      initialGate={options.initialGate === undefined ? gate() : options.initialGate}
      mayContribute={options.mayContribute ?? true}
      origin={options.origin ?? DASHBOARD_ORIGIN}
      runId={SEEDED_RUN_ID}
      send={options.send}
      timelinePoll={options.timelinePoll ?? quiet()}
      trackerUrl={TRACKER}
    />,
  );
}

/** The head's meta row, element by element. */
function meta(): string[] {
  return [...(document.querySelector(".tests-head__meta")?.children ?? [])].map(
    (child) => child.textContent?.trim() ?? "",
  );
}

/** One stat card, by its caption. */
function stat(label: string): HTMLElement {
  return within(screen.getByRole("region", { name: STRIP_LABEL })).getByRole("region", { name: label });
}

/** A timeline card's button, by its build. */
function build(attemptSeq: number): HTMLElement {
  return within(screen.getByRole("region", { name: TIMELINE_TITLE })).getByRole("button", {
    name: new RegExp(`^Build ${attemptSeq}\\b`),
  });
}

/** The timeline's cards, as text. */
function timelineCards(): string[] {
  return within(screen.getByRole("list", { name: TIMELINE_LIST_LABEL }))
    .getAllByRole("listitem")
    .map((card) => card.textContent ?? "");
}

/** A head action, by its label. */
function action(name: RegExp | string): HTMLElement {
  return within(screen.getByRole("group", { name: ACTIONS_LABEL })).getByRole("button", { name });
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the seeded head and strip (mockup 11)", () => {
  it("draws the eyebrow, the linked headline and the meta row in the mockup's order", () => {
    draw();

    expect(screen.getByText("Test Results · Run #1847 · Build 3")).toBeInTheDocument();

    const headline = screen.getByRole("heading", { level: 1 });
    expect(headline).toHaveTextContent("#482 — Fix flaky CAN-bus telemetry test");
    expect(within(headline).getByRole("link")).toHaveAttribute("href", TRACKER);

    expect(meta()).toEqual([
      "standard-fix v14",
      "61/63 passed",
      "build 3 of loop #1847",
      "forge-01 + rig helios-rig-02 · 6m 12s",
    ]);
    expect(document.querySelector(".tests-head__meta .ou-chip")).toHaveClass("ou-chip--warn");
  });

  it("draws the three actions, the primary one last", () => {
    draw();

    const buttons = within(screen.getByRole("group", { name: ACTIONS_LABEL })).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Re-run failed (1)",
      "Re-run full suite",
      "Send failures back to loop ⟳",
    ]);
    expect(buttons[2]).toHaveClass("ou-btn--primary");
  });

  it("draws the five stat cards, the delta and the wall-time split", () => {
    draw();

    expect(stat("Total tests")).toHaveTextContent("63across 5 suites");
    expect(stat("Passed")).toHaveTextContent("61▲ 12 vs build 1");
    expect(stat("Failed")).toHaveTextContent("1pid_overshoot_under_load · HIL");
    expect(stat("Flaky")).toHaveTextContent("1passed on retry 2/3 · quarantine watching (1)");
    expect(stat("Wall time")).toHaveTextContent("6m 12s4m sim · 2m 12s physical");

    expect(stat("Passed").querySelector(".ou-stat__value")).toHaveClass("ou-stat__value--ok");
    expect(stat("Failed").querySelector(".ou-stat__value")).toHaveClass("ou-stat__value--err");
    expect(stat("Flaky").querySelector(".ou-stat__value")).toHaveClass("ou-stat__value--warn");
    expect(stat("Wall time")).toHaveClass("tests-strip__stat--wide");
  });

  it("computes no delta or split in the browser — the lines follow the payload, not the counts", () => {
    const odd = timeline();
    odd.attempts[2] = {
      ...odd.attempts[2]!,
      strip: strip({
        passed: 2,
        passedDelta: { value: 30, versusAttemptSeq: 9, versusTestRunId: BUILD_1_ID },
        wallTime: { wallMs: 5_000, simMs: 3_600_000, physicalMs: 0 },
      }),
    };
    draw({ initial: odd });

    expect(stat("Passed")).toHaveTextContent("2▲ 30 vs build 9");
    expect(stat("Wall time")).toHaveTextContent("5s1h sim · 0s physical");
  });
});

describe("the flaky card's link to insights", () => {
  it("names the real watching count and, while insights is soon, says so rather than linking", () => {
    draw();

    const words = within(stat("Flaky")).getByText("quarantine watching (1)");
    expect(words.tagName).toBe("SPAN");
    expect(words).toHaveClass("tests-strip__soon");
    expect(words).toHaveAttribute("title", expect.stringMatching(/mockup 15/));
    expect(within(stat("Flaky")).queryByRole("link")).toBeNull();
  });

  it("links to the insights entry the day it is live, with no edit to the card", () => {
    const live: NavEntry = { id: "insights", label: "Insights", route: "/insights", group: "primary", sort: 90 } as NavEntry;
    render(<InsightsLink entry={live} watching={2} />);

    expect(screen.getByRole("link", { name: "quarantine watching (2) ↗" })).toHaveAttribute("href", "/insights");
  });

  it("shows a zero watching count when the attempt has flaky cases none of which is watched", () => {
    render(
      <SummaryStrip view={stripView(strip({ flakyCases: [{ ...strip().flakyCases[0]!, flakeState: "quarantined" }] }))} />,
    );

    expect(screen.getByText("quarantine watching (0)")).toBeInTheDocument();
  });

  it("draws no link for an attempt with no flaky case", () => {
    render(<SummaryStrip view={stripView(strip({ flaky: 0, flakyCases: [] }))} />);

    expect(screen.queryByText(/quarantine watching/)).toBeNull();
  });
});

describe("switching attempts", () => {
  it("redraws every region for the chosen build and says so in the address", () => {
    window.history.replaceState(null, "", `/runs/${SEEDED_RUN_ID}/tests?from=build-farm`);
    draw({ origin: BUILD_FARM_ORIGIN });

    fireEvent.click(build(1));

    expect(window.location.search).toBe("?from=build-farm&attempt=1");
    expect(build(1)).toHaveAttribute("aria-pressed", "true");
    expect(build(3)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Test Results · Run #1847 · Build 1")).toBeInTheDocument();
    expect(meta()).toEqual([
      "standard-fix v14",
      "49/63 passed",
      "build 1 of loop #1847",
      "forge-01 + rig helios-rig-02 · 6m 41s",
    ]);
    expect(document.querySelector(".tests-head__meta .ou-chip")).toHaveClass("ou-chip--err");
    expect(stat("Passed")).toHaveTextContent(/^Passed49$/);
    expect(stat("Failed")).toHaveTextContent("14");
    expect(stat("Wall time")).toHaveTextContent("6m 41s4m 23s sim · 2m 18s physical");

    // Build 3's gate is not Build 1's: the re-runs wait for Build 1's own answer.
    expect(action(/^Re-run full suite/)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(GATE_CHECKING)).toBeInTheDocument();
  });

  it("opens on the build the address names, and on the latest otherwise", () => {
    draw({ initialAttempt: 2 });
    expect(screen.getByText("Test Results · Run #1847 · Build 2")).toBeInTheDocument();
  });

  it("draws the gate that answers for the attempt on screen", async () => {
    draw({ gatePoll: answering(gate({ readiness: "no_eligible_runner" })), initialGate: null });

    expect(await screen.findByText(/No runner in pool hil can take a build right now/)).toBeInTheDocument();
  });
});

describe("the build attempts timeline (#336)", () => {
  it("sits between the head and the strip, with the seeded cards and the latest attempt pressed", () => {
    draw({
      commitSource: { kind: "github", owner: "acme-robotics", name: "helios-firmware" },
      initial: timeline({ attempts: mockupAttempts() }),
    });

    expect(timelineCards()).toEqual([
      "Build 1 49/63 · 14 failed ✗13:52:41 · a3f19c2",
      "Build 2 61/63 · 2 failed14:21:07 · c81d4e7",
      "Build 3 running re-run of failed set14:38:19 · f42b9a0",
      "NextPublish to PR #514 when greenauto · gated on 63/63",
    ]);
    expect(build(3)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "f42b9a0" })).toHaveAttribute(
      "href",
      "https://github.com/acme-robotics/helios-firmware/commit/f42b9a0",
    );

    const regions = [...document.querySelectorAll(".tests-head, .tests-timeline, .tests-strip")];
    expect(regions.map((region) => region.className.split(" ").find((name) => name.startsWith("tests-")))).toEqual([
      "tests-head",
      "tests-timeline",
      "tests-strip",
    ]);
  });

  it("leaves the shas plain when the page was handed no commit source", () => {
    draw();

    expect(within(screen.getByRole("region", { name: TIMELINE_TITLE })).queryByRole("link")).toBeNull();
  });

  it("is drawn for a run with one attempt — the story has a first card", () => {
    draw({ initial: timeline({ attempts: [mockupAttempts()[0]!] }) });

    expect(timelineCards()).toHaveLength(2);
    expect(build(1)).toHaveAttribute("aria-pressed", "true");
  });

  it("draws the future card's honest variant from the projection, note included", () => {
    draw({
      initial: timeline({ next: { ...timeline().next, pullRequest: null, activation: "none", gate: null } }),
    });

    expect(timelineCards().at(-1)).toBe(`Nextauto · gated on 63/63${PR_PLANE_NOTE}`);
  });

  it("re-scopes every region to one attempt — never a mix of two", () => {
    draw({ initial: timeline({ attempts: mockupAttempts() }), initialGate: null });

    for (const [attemptSeq, passed] of [
      [1, "49"],
      [2, "61"],
      [3, "61"],
      [1, "49"],
    ] as const) {
      fireEvent.click(build(attemptSeq));

      expect(screen.getByText(`Test Results · Run #1847 · Build ${attemptSeq}`)).toBeInTheDocument();
      expect(meta()[2]).toBe(`build ${attemptSeq} of loop #1847`);
      expect(stat("Passed")).toHaveTextContent(new RegExp(`^Passed${passed}`));
      expect(window.location.search).toBe(`?attempt=${attemptSeq}`);
      expect(
        screen.getAllByRole("button", { pressed: true }).map((button) => button.textContent),
      ).toEqual([expect.stringMatching(new RegExp(`^Build ${attemptSeq}`))]);
    }
  });

  it("updates the live card on poll as the running build progresses and finishes", async () => {
    const finished = timeline({ attempts: mockupAttempts() });
    finished.attempts[2] = {
      ...finished.attempts[2]!,
      status: "complete",
      strip: strip({ passed: 63, failed: 0, failedCases: [], flaky: 0, flakyCases: [] }),
    };
    draw({ initial: timeline({ attempts: mockupAttempts() }), timelinePoll: answering(finished) });

    expect(await screen.findByRole("button", { name: "Build 3 63/63 · all passed ✓" })).toBeInTheDocument();
    expect(build(3).closest("li")).toHaveClass("tests-timeline__card--ok");
    expect(document.querySelector(".tests-timeline__pulse")).toBeNull();
  });

  it("draws a build the poll newly reports, and follows it as the latest", async () => {
    const grown = timeline({
      attempts: [...mockupAttempts().slice(0, 2), { ...mockupAttempts()[2]!, status: "complete" }],
    });
    grown.attempts.push({
      ...mockupAttempts()[2]!,
      id: "5eed0033-0000-4000-8000-000000000004",
      attemptSeq: 4,
    });
    draw({ initial: timeline({ attempts: mockupAttempts() }), timelinePoll: answering(grown) });

    expect(await screen.findByRole("button", { name: /^Build 4/ })).toHaveAttribute("aria-pressed", "true");
    expect(build(4).closest("li")).toHaveClass("tests-timeline__card--live");
  });

  it("is not drawn before any attempt has reported", () => {
    draw({ initial: timeline({ attempts: [] }), initialGate: null });

    expect(screen.queryByRole("region", { name: TIMELINE_TITLE })).toBeNull();
  });
});

describe("the re-runs, honestly gated", () => {
  it("are disabled with a visible reason when no runner is eligible, and send nothing", () => {
    const send = vi.fn<RerunSender>();
    draw({ initialGate: gate({ readiness: "no_eligible_runner" }), send });

    const reason = screen.getByText(/No runner in pool hil can take a build right now/);
    expect(reason).toBeVisible();

    for (const name of [/^Re-run failed/, /^Re-run full suite/]) {
      const button = action(name);
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("aria-describedby", reason.id);
      fireEvent.click(button);
    }
    expect(send).not.toHaveBeenCalled();
    expect(action(/^Send failures back/)).not.toHaveAttribute("aria-disabled");
  });

  it("are disabled for a viewer, with the reason", () => {
    draw({ mayContribute: false });

    expect(screen.getByText(VIEWER_REASON)).toBeInTheDocument();
    expect(action(/^Re-run failed/)).toHaveAttribute("aria-disabled", "true");
  });

  it("queue a re-run of the attempt on screen and say its honest queue state", async () => {
    const send = vi.fn<RerunSender>().mockResolvedValue({
      ok: true,
      rerun: {
        testRunId: BUILD_3_ID,
        scope: "failed",
        caseKeys: ["c".repeat(64)],
        job: { number: 483, pool: "hil" },
        queueState: "queued_no_eligible_runner",
      },
    } as RerunOutcome);
    draw({ send });

    fireEvent.click(action("Re-run failed (1)"));

    expect(send).toHaveBeenCalledExactlyOnceWith(BUILD_3_ID, "failed");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Build job #483 queued with 1 case — no runner is eligible yet, so it waits in pool hil.",
    );
  });

  it("say a refusal in the service's words", async () => {
    const send = vi.fn<RerunSender>().mockResolvedValue({
      ok: false,
      status: 409,
      code: "rerun_source_missing",
      reason: "No farm build produced this test run.",
    });
    draw({ send });

    fireEvent.click(action(/^Re-run full suite/));

    expect(send).toHaveBeenCalledWith(BUILD_3_ID, "full");
    const said = await screen.findByRole("status");
    expect(said).toHaveTextContent("No farm build produced this test run.");
    expect(said).toHaveClass("tests-actions__outcome--failed");
  });
});

describe("Send failures back to loop", () => {
  it("focuses the Mark & Route card with the attempt's failed set staged", () => {
    const send = vi.fn<RerunSender>();
    draw({ send });

    const card = screen.getByRole("region", { name: MARK_ROUTE_TITLE });
    expect(card).toHaveTextContent(NOTHING_STAGED);

    fireEvent.click(action(/^Send failures back/));

    expect(card).toHaveFocus();
    const staged = within(card).getByRole("list", { name: STAGED_LABEL });
    expect(within(staged).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      `${OVERSHOOT_CASE.suite} › ${OVERSHOOT_CASE.name}`,
    ]);
    // A navigation, not a dispatch.
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps a staged set to its own attempt", () => {
    draw();

    fireEvent.click(action(/^Send failures back/));
    fireEvent.click(build(2));

    expect(screen.queryByRole("list", { name: STAGED_LABEL })).toBeNull();
  });

  it("is off, with the reason, for an attempt where nothing failed", () => {
    const green = timeline();
    green.attempts[2] = { ...green.attempts[2]!, strip: strip({ passed: 63, failed: 0, failedCases: [], flaky: 0, flakyCases: [] }) };
    draw({ initial: green, initialGate: gate({ failedCases: 0 }) });

    expect(action(/^Send failures back/)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Nothing failed in Build 3.")).toBeInTheDocument();
  });
});

describe("the shell and the frame", () => {
  it("keeps the originating module lit while mounted and leads back through the console", () => {
    const { unmount } = draw({ origin: BUILD_FARM_ORIGIN });

    expect(navRegistry().origin).toBe("build-farm");

    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByRole("link");
    expect(crumbs.map((link) => link.getAttribute("href"))).toEqual([
      BUILD_FARM_PATH,
      runPath(SEEDED_RUN_ID, "build-farm"),
    ]);
    expect(crumbs[1]).toHaveTextContent("Loop #1847");

    unmount();
    expect(navRegistry().origin).toBeNull();
  });

  it("mounts in the content pane as one main landmark with no chrome of its own", () => {
    const { container } = draw();

    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("header.shell-header, nav.shell-nav")).toBeNull();
  });

  it("draws a failed first read as a banner, and a failed refresh over the last answer", async () => {
    draw({ initial: null, initialError: "The service is down." });
    expect(screen.getByText(UNREAD_HEADLINE)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("keeps the last answer on screen under a banner when a refresh fails", async () => {
    draw({ timelinePoll: failing("The service is down.") });

    expect(await screen.findByText(STALE_HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("redraws the strip from the poll's answer", async () => {
    const moved = timeline();
    moved.attempts[2] = { ...moved.attempts[2]!, strip: strip({ passed: 62, failed: 0, failedCases: [] }) };
    draw({ timelinePoll: answering(moved) });

    expect(await screen.findByText("62/63 passed")).toBeInTheDocument();
  });

  it("says a run with no reported attempt has none, with no actions", () => {
    draw({ initial: timeline({ attempts: [] }), initialGate: null });

    expect(screen.getByText(NO_ATTEMPTS)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: ACTIONS_LABEL })).toBeNull();
    expect(screen.getByText("Test Results · Run #1847")).toBeInTheDocument();
  });
});
