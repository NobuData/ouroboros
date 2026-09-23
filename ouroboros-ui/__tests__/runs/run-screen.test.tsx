import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunConsole } from "@/app/api/runs";
import { BUILD_FARM_PATH, DASHBOARD_PATH } from "@/app/paths";
import type { RunPollOptions } from "@/app/runs/console-poll";
import { CONTROLS_LABEL } from "@/app/runs/controls";
import type { ControlsPollOptions } from "@/app/runs/controls-poll";
import { BUILD_FARM_ORIGIN, DASHBOARD_ORIGIN, type RunOrigin } from "@/app/runs/origin";
import { RunScreen } from "@/app/runs/run-screen";
import {
  BREADCRUMB_LABEL,
  NO_BRANCH,
  SIMULATED_HEADLINE,
  STALE_HEADLINE,
  UNREAD_HEADLINE,
} from "@/app/runs/view";
import { navRegistry } from "@/app/shell/nav-registry";
import type { PollAnswer } from "@/app/poll";

import {
  SEEDED_AS_OF,
  SEEDED_ELAPSED_SECONDS,
  SEEDED_RUN_ID,
  SEEDED_STARTED_AT,
  runConsole,
} from "../helpers/runs";

/**
 * The run console's frame (#309), rendered: the seeded head against the mockup, the anchored
 * elapsed across ticks and polls, the status pill, the watermark, the breadcrumb and the
 * sidebar origin — and a refresh that failed.
 */

// The Server Action is never reached here: the controls' cases pass their own sender.
vi.mock("@/app/runs/control-actions", () => ({ submitRunControl: vi.fn() }));

/** A poll that never answers — the page shows the server's first read. */
const QUIET: RunPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** A controls poll that never answers. */
const QUIET_CONTROLS: ControlsPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** What the live poll answers. Reassigned by the cases that care. */
let answer: PollAnswer<RunConsole>;

/** A poll that answers {@link answer}. */
const LIVE: RunPollOptions = { read: () => Promise.resolve(answer), visible: () => true };

/**
 * Draw the screen.
 *
 * @param initial The server's first read.
 * @param options What else to pass — the poll, the origin, the first read's failure.
 * @returns The Testing Library render result.
 */
function draw(
  initial: RunConsole | null = runConsole(),
  options: {
    poll?: RunPollOptions;
    origin?: RunOrigin;
    initialError?: string | null;
    mayControl?: boolean;
  } = {},
) {
  return render(
    <RunScreen
      controlsPoll={QUIET_CONTROLS}
      id={SEEDED_RUN_ID}
      initial={initial}
      initialError={options.initialError ?? null}
      mayControl={options.mayControl}
      origin={options.origin ?? DASHBOARD_ORIGIN}
      poll={options.poll ?? QUIET}
    />,
  );
}

/** The head's meta row. */
function meta(): HTMLElement {
  return document.querySelector(".run-head__meta") as HTMLElement;
}

/** What the elapsed figure reads. */
function elapsed(): string {
  return document.querySelector(".run-head__elapsed")?.textContent ?? "";
}

/**
 * Let the clock run.
 *
 * @param seconds How far.
 */
function advance(seconds: number): void {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

beforeEach(() => {
  answer = { state: "fresh", payload: runConsole(), etag: null, pollAfterSeconds: null };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the seeded head", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse(SEEDED_AS_OF) });
  });

  it("matches the mockup: eyebrow, headline, and all five meta elements in order", () => {
    draw();

    expect(screen.getByText("Run Console · Loop #1847")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#482 — Fix flaky CAN-bus telemetry test");

    const row = meta();
    const parts = [...row.children].map((child) => child.textContent?.trim());
    expect(parts[0]).toBe("coding");
    expect(parts[1]).toBe("standard-fix v14");
    expect(parts[2]).toBe("claude-fable-5");
    expect(parts[3]).toBe("elapsed 12m 40s");
    expect(parts[4]).toContain("branch loop/482-canbus-flake");
  });

  it("links the headline to the issue on its tracker, in a new tab", () => {
    draw();

    const link = within(screen.getByRole("heading", { level: 1 })).getByRole("link");
    expect(link).toHaveAttribute("href", "https://github.com/acme/helios-firmware/issues/482");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("draws the headline as text when there is no repository to link it to", () => {
    draw(runConsole({ head: { repository: undefined } }));

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("#482 — Fix flaky CAN-bus telemetry test");
    expect(within(heading).queryByRole("link")).toBeNull();
  });

  it("says there is no branch yet rather than drawing a copy control for nothing", () => {
    draw(runConsole({ head: { branchName: null } }));

    expect(meta()).toHaveTextContent(NO_BRANCH);
    expect(screen.queryByRole("button", { name: /Copy branch/ })).toBeNull();
  });
});

describe("the status pill", () => {
  it("pulses while the run is live, and reads the run's own status", () => {
    draw(runConsole({ run: { status: "building" } }));

    const pill = meta().firstElementChild as HTMLElement;
    expect(pill).toHaveTextContent("building");
    expect(pill.querySelector(".ou-chip__dot--pulse")).not.toBeNull();
  });

  it("stops pulsing once the run has stopped", () => {
    draw(
      runConsole({
        run: { status: "merged", finishedAt: "2026-09-19T12:30:00.000Z" },
        head: { live: false },
        wallClock: { finishedAt: "2026-09-19T12:30:00.000Z", elapsedSeconds: 1800 },
      }),
    );

    const pill = meta().firstElementChild as HTMLElement;
    expect(pill).toHaveTextContent("merged");
    expect(pill.querySelector(".ou-chip__dot")).not.toBeNull();
    expect(pill.querySelector(".ou-chip__dot--pulse")).toBeNull();
    expect(elapsed()).toBe("30m 00s");
  });
});

describe("elapsed", () => {
  it("ticks from the anchor, second by second", () => {
    vi.useFakeTimers({ now: Date.parse(SEEDED_AS_OF) });
    draw();

    expect(elapsed()).toBe("12m 40s");
    advance(1);
    expect(elapsed()).toBe("12m 41s");
    advance(79);
    expect(elapsed()).toBe("14m 00s");
  });

  it("does not jump after a slow poll — the answer moves no anchor", async () => {
    vi.useFakeTimers({ now: Date.parse(SEEDED_AS_OF) });
    // The poll answers a snapshot taken ten seconds ago: a server figure behind the clock.
    answer = {
      state: "fresh",
      payload: runConsole({ wallClock: { elapsedSeconds: SEEDED_ELAPSED_SECONDS + 20 } }),
      etag: null,
      pollAfterSeconds: null,
    };
    draw(runConsole(), { poll: LIVE });
    advance(30);
    await act(async () => {});

    expect(elapsed()).toBe("13m 10s");
    advance(1);
    expect(elapsed()).toBe("13m 11s");
  });

  it("reads the same after a refresh as before it — both count from the start", () => {
    vi.useFakeTimers({ now: Date.parse(SEEDED_STARTED_AT) + 900_000 });

    const before = draw();
    const first = elapsed();
    before.unmount();

    // A reload serves a snapshot whose own figure is older; the page still reads the clock.
    draw(runConsole({ wallClock: { elapsedSeconds: 800 } }));
    expect(elapsed()).toBe(first);
    expect(first).toBe("15m 00s");
  });
});

describe("the simulated watermark", () => {
  it("renders above the head for a simulated run", () => {
    draw(runConsole({ head: { simulated: true } }));

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(SIMULATED_HEADLINE);
    expect(note.compareDocumentPosition(screen.getByRole("heading", { level: 1 }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("is absent otherwise", () => {
    draw();

    expect(screen.queryByRole("note")).toBeNull();
  });

  it("appears when a poll reports the run as simulated", async () => {
    answer = { state: "fresh", payload: runConsole({ head: { simulated: true } }), etag: null, pollAfterSeconds: null };
    draw(runConsole(), { poll: LIVE });

    expect(await screen.findByRole("note")).toHaveTextContent(SIMULATED_HEADLINE);
  });
});

describe("the poll", () => {
  it("replaces the head with each answer — the status pill follows the run", async () => {
    answer = { state: "fresh", payload: runConsole({ run: { status: "review" } }), etag: null, pollAfterSeconds: null };
    draw(runConsole(), { poll: LIVE });

    await vi.waitFor(() => expect(meta().firstElementChild).toHaveTextContent("review"));
  });

  it("keeps the last answer under a banner when a refresh fails, and retries on request", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ state: "failed", reason: "The run could not be reached.", pollAfterSeconds: null })
      .mockResolvedValue({ state: "fresh", payload: runConsole(), etag: null, pollAfterSeconds: null });
    draw(runConsole(), { poll: { read, visible: () => true } });

    const banner = (await screen.findByText(STALE_HEADLINE)).closest(".ou-retry") as HTMLElement;
    expect(banner).toHaveTextContent("The run could not be reached.");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();

    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    await vi.waitFor(() => expect(screen.queryByText(STALE_HEADLINE)).toBeNull());
  });

  it("says the run could not be read when the first read failed and nothing has answered", () => {
    draw(null, { initialError: "The service is down." });

    expect(screen.getByText(UNREAD_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText("The service is down.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

describe("the contextual frame", () => {
  it("leads back to the dashboard through a breadcrumb naming the loop", () => {
    draw();

    const crumbs = screen.getByRole("navigation", { name: BREADCRUMB_LABEL });
    expect(within(crumbs).getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", DASHBOARD_PATH);
    expect(within(crumbs).getByText("Loop #1847")).toHaveAttribute("aria-current", "page");
  });

  it("leads back to the build farm when opened from there", () => {
    draw(runConsole(), { origin: BUILD_FARM_ORIGIN });

    const crumbs = screen.getByRole("navigation", { name: BREADCRUMB_LABEL });
    expect(within(crumbs).getByRole("link", { name: "Build Farm" })).toHaveAttribute("href", BUILD_FARM_PATH);
  });

  it("keeps the originating module lit in the sidebar while mounted, and lets go after", () => {
    const view = draw(runConsole(), { origin: BUILD_FARM_ORIGIN });
    expect(navRegistry().origin).toBe("build-farm");

    view.unmount();
    expect(navRegistry().origin).toBeNull();
  });

  it("adds no chrome of its own — the frame is a <main> in the pane", () => {
    const { container } = draw();

    expect(container.firstElementChild?.tagName).toBe("MAIN");
    expect(container.querySelector("header, aside")).toBeNull();
  });
});

describe("the run controls (#310)", () => {
  it("are drawn beside the head for a reader who may control the run", () => {
    draw(runConsole(), { mayControl: true });

    const head = document.querySelector(".run-head") as HTMLElement;
    expect(within(head).getByRole("group", { name: CONTROLS_LABEL })).toBeInTheDocument();
  });

  it("are not drawn for a reader who may not — the default", () => {
    draw(runConsole());

    expect(screen.queryByRole("group", { name: CONTROLS_LABEL })).toBeNull();
  });

  it("go once the run has ended — there is nothing left to control", () => {
    draw(
      runConsole({
        run: { status: "canceled", finishedAt: "2026-09-19T12:30:00.000Z" },
        head: { live: false },
        wallClock: { finishedAt: "2026-09-19T12:30:00.000Z", elapsedSeconds: 1800 },
      }),
      { mayControl: true },
    );

    expect(screen.queryByRole("group", { name: CONTROLS_LABEL })).toBeNull();
    expect(meta().firstElementChild).toHaveTextContent("canceled");
  });

  it("leave the page on the poll's answer once an abort has ended the run", async () => {
    answer = {
      state: "fresh",
      payload: runConsole({
        run: { status: "canceled", finishedAt: "2026-09-19T12:30:00.000Z" },
        head: { live: false },
      }),
      etag: null,
      pollAfterSeconds: null,
    };
    draw(runConsole(), { mayControl: true, poll: LIVE });
    expect(screen.getByRole("group", { name: CONTROLS_LABEL })).toBeInTheDocument();

    await vi.waitFor(() => expect(screen.queryByRole("group", { name: CONTROLS_LABEL })).toBeNull());
    expect(meta().firstElementChild).toHaveTextContent("canceled");
  });
});
