import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FarmPage } from "@/app/api/farm";
import { COPY_COMMAND, ENROLL_MEMBER_REASON, POOL_LABEL } from "@/app/farm/enroll";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmScreen } from "@/app/farm/farm-screen";
import {
  FARM_ACTIONS,
  FARM_EYEBROW,
  FARM_HEADLINE_UNREAD,
  FARM_SUBLINE,
  FARM_UNREAD_HEADLINE,
  NOT_READ,
  NO_BUILDS_TODAY,
  NO_RUNNERS_ENROLLED,
  SOON_MARK,
} from "@/app/farm/view";
import type { PollAnswer } from "@/app/poll";
import { RETRYING_LABEL, RETRY_LABEL } from "@/app/ui";

import {
  ADMIN_READER,
  MEMBER_READER,
  emptyFarm,
  failedFarmReadings,
  farmReadings,
  farmStats,
  seededFarm,
} from "../helpers/farm";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

// The enroll card (#258) reaches the service through Server Actions, which import the
// server-only client; this suite presses none of them.
vi.mock("@/app/farm/enroll-actions", () => ({
  mintEnrollCommand: vi.fn(),
  readEnrollmentTokens: vi.fn(),
  revokeEnrollmentToken: vi.fn(),
}));

/**
 * The build farm as it is drawn (#256): mockup 08's head and stat row from the seeded farm, the
 * same page for an empty organization, the three head actions as honest *soon* controls, and the
 * page staying on screen — under one banner — when a refresh fails.
 */

/** A poll that never answers, so a case draws exactly what the server read. */
const QUIET: FarmPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** What the live poll answers. Reassigned by the cases that care. */
let answer: PollAnswer<FarmPage>;

/** A poll that answers {@link answer}, at the fleet's cadence. */
const LIVE: FarmPollOptions = { read: () => Promise.resolve(answer), visible: () => true };

/**
 * One stat tile, by its caption.
 *
 * @param label The caption — the tile's accessible name.
 * @returns The tile's region.
 */
function tile(label: string): HTMLElement {
  return screen.getByRole("region", { name: label });
}

/**
 * The stale-data banner.
 *
 * By its class rather than by `role="status"`: the runners card (#257) keeps a polite region of
 * its own for announcing the current row, so the role alone no longer names one element.
 *
 * @returns The banner, or `null` while the latest read is good.
 */
function banner(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ou-retry[role='status']");
}

/** The stat row's four captions, in the mockup's order. */
const TILES = ["Runners online", "Builds today", "Avg build time", "Cache hit rate"];

beforeEach(() => {
  answer = { state: "fresh", payload: seededFarm(), etag: null, pollAfterSeconds: 10 };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the head", () => {
  it("draws the mockup's eyebrow, computed headline and subline", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);

    expect(screen.getByText(FARM_EYEBROW)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("5 runners. 2 pools. 78% cache hits.");
    expect(screen.getByText(FARM_SUBLINE)).toBeInTheDocument();
  });

  it("reads naturally at zero runners, zero pools and no cache data", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings(emptyFarm())} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "No runners yet. No pools yet. No cache data today.",
    );
  });

  it("draws the two unbuilt actions as soon — labelled, inert, and saying what each waits for", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);

    const soon = FARM_ACTIONS.filter((action) => action.soonNote !== null);

    expect(soon.map(({ id }) => id)).toEqual(["analyzer", "pools"]);
    for (const action of soon) {
      const control = screen.getByRole("button", { name: `${action.label} ${SOON_MARK}` });

      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("title", action.soonNote);
    }
  });

  it("moves an administrator from + Enroll runner to the enroll card's pool selector (#258)", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);

    const control = screen.getByRole("button", { name: "+ Enroll runner" });

    expect(control).not.toHaveAttribute("aria-disabled");
    fireEvent.click(control);

    expect(screen.getByRole("combobox", { name: POOL_LABEL })).toHaveFocus();
  });

  it("moves them to the copy control instead when there is no pool to select", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings(emptyFarm())} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Enroll runner" }));

    expect(screen.getByRole("button", { name: COPY_COMMAND })).toHaveFocus();
  });

  it("draws + Enroll runner inert for a reader who may not mint, with the reason", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);

    const control = screen.getByRole("button", { name: "+ Enroll runner" });

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("title", ENROLL_MEMBER_REASON);
  });

  it("navigates nowhere from Build Analyzer — there is no link on the page, to a dead route or any other", () => {
    const { container } = render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);

    fireEvent.click(screen.getByRole("button", { name: /Build Analyzer/ }));

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("href");
    expect(container.innerHTML).not.toContain("analyzer.html");
  });
});

describe("the stat row, from the seeded farm", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);
  });

  it("is four tiles, each a region named by its caption", () => {
    // The fifth region on the page is the runners card (#257), named by its heading instead.
    const labelled = screen.getAllByRole("region").filter((region) => region.hasAttribute("aria-label"));

    expect(labelled.map((region) => region.getAttribute("aria-label"))).toEqual(TILES);
  });

  it("draws 4/5 — the 4 accented, the /5 quieter — over the offline note", () => {
    const runners = tile("Runners online");
    const figure = runners.querySelector(".ou-stat__value");

    expect(figure).toHaveTextContent("4/5");
    expect(figure).toHaveClass("ou-stat__value--accent");
    expect(figure?.querySelector(".ou-stat__suffix")).toHaveTextContent("/5");
    expect(within(runners).getByText("forge-03 offline · 2h")).toBeInTheDocument();
  });

  it("draws 23 over the split line", () => {
    const builds = tile("Builds today");

    expect(builds.querySelector(".ou-stat__value")).toHaveTextContent("23");
    expect(within(builds).getByText("19 clean · 3 retried · 1 failed")).toBeInTheDocument();
  });

  it("draws 4m 12s over a down arrow in the good-news tone", () => {
    const time = tile("Avg build time");
    const delta = within(time).getByText("▼ 38s vs last week");

    expect(time.querySelector(".ou-stat__value")).toHaveTextContent("4m 12s");
    expect(delta).toHaveClass("ou-stat__delta--up");
    expect(delta).not.toHaveClass("ou-stat__delta--down");
  });

  it("draws 78% with an inline meter filled to it, under the B5 label", () => {
    const cache = tile("Cache hit rate");
    const meter = cache.querySelector(".ou-meter");

    expect(cache.querySelector(".ou-stat__value")).toHaveTextContent("78%");
    expect(meter?.querySelector(".ou-meter__fill")?.getAttribute("style")).toContain("--ou-meter-fill: 78%");
    // A picture of the figure above it, so it is not announced a second time.
    expect(meter).toHaveAttribute("aria-hidden", "true");
    expect(within(cache).getByText("ccache · per-runner")).toBeInTheDocument();
    expect(cache).not.toHaveTextContent("shared per pool");
  });

  it("accents exactly one figure and draws exactly one meter", () => {
    expect(document.querySelectorAll(".ou-stat__value--accent")).toHaveLength(1);
    // Among the tiles: the runners table under them draws a CPU meter per connected machine.
    expect(document.querySelectorAll(".ou-stat .ou-meter")).toHaveLength(1);
  });
});

describe("the stat row, for an empty organization", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings(emptyFarm())} />);
  });

  it("shows genuine zeros for the counts", () => {
    expect(tile("Runners online").querySelector(".ou-stat__value")).toHaveTextContent("0/0");
    expect(within(tile("Runners online")).getByText(NO_RUNNERS_ENROLLED)).toBeInTheDocument();
    expect(tile("Builds today").querySelector(".ou-stat__value")).toHaveTextContent(/^0$/);
    expect(within(tile("Builds today")).getByText(NO_BUILDS_TODAY)).toBeInTheDocument();
  });

  it("shows em-dashes where there is nothing to average — never 0m 00s, 0% or ▼ 0s", () => {
    expect(tile("Avg build time").querySelector(".ou-stat__value")).toHaveTextContent(/^—$/);
    expect(tile("Cache hit rate").querySelector(".ou-stat__value")).toHaveTextContent(/^—$/);

    const page = document.body.textContent ?? "";
    expect(page).not.toContain("0m 00s");
    expect(page).not.toContain("0%");
    expect(page).not.toMatch(/[▼▲]/);
  });

  it("draws no delta line under the average and no meter under the cache rate", () => {
    expect(tile("Avg build time").querySelector(".ou-stat__delta")).toBeNull();
    expect(document.querySelectorAll(".ou-meter")).toHaveLength(0);
  });
});

describe("the delta", () => {
  it("colours a slower week as bad news", () => {
    const slower = seededFarm({
      stats: farmStats({
        avgBuildTime: { seconds: 328, builds: 20, priorSeconds: 290, priorBuilds: 140, deltaVsLastWeek: 38 },
      }),
    });

    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings(slower)} />);

    expect(screen.getByText("▲ 38s vs last week")).toHaveClass("ou-stat__delta--down");
  });
});

describe("both themes", () => {
  it("renders the same markup under either palette, so the theme is the sheet's alone", () => {
    const [light, dark] = renderInBothPalettes(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });

  it("does the same for the empty organization and for the page that could not be read", () => {
    for (const readings of [farmReadings(emptyFarm()), failedFarmReadings()]) {
      const [light, dark] = renderInBothPalettes(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={readings} />);

      expect(maskIds(light!)).toBe(maskIds(dark!));
    }
  });

  it("writes no inline style but a meter's fill, so every size is the sheet's rem", () => {
    const { container } = render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);
    const styled = [...container.querySelectorAll("[style]")];

    // The cache tile's meter, and one CPU meter for each of the four connected runners.
    expect(styled).toHaveLength(5);
    for (const element of styled) expect(element).toHaveClass("ou-meter__fill");
  });
});

describe("the shell", () => {
  it("draws one main landmark and no chrome of its own", () => {
    const { container } = render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(container.querySelector("nav, aside")).toBeNull();
    // The only `<header>` is a card's own head, inside its section — not a page banner.
    for (const header of container.querySelectorAll("header")) {
      expect(header).toHaveClass("ou-card__head");
      expect(header.closest("section")).not.toBeNull();
    }
  });
});

describe("staying live", () => {
  it("moves the headline and the tiles together when the poll brings a new page", async () => {
    vi.useFakeTimers();
    render(<FarmScreen poll={LIVE} reader={MEMBER_READER} readings={farmReadings(emptyFarm())} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("5 runners. 2 pools. 78% cache hits.");
    expect(tile("Runners online").querySelector(".ou-stat__value")).toHaveTextContent("4/5");
  });

  it("keeps the page under one banner when a refresh fails, with the way to ask again", async () => {
    vi.useFakeTimers();
    answer = { state: "failed", reason: "The build farm could not be reached.", pollAfterSeconds: null };
    render(<FarmScreen poll={LIVE} reader={MEMBER_READER} readings={farmReadings()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const stale = banner()!;
    expect(stale).toHaveTextContent(/Showing data from .+ — the latest refresh failed\./);
    expect(stale).toHaveTextContent("The build farm could not be reached.");
    // The page underneath is the last good one, untouched.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("5 runners. 2 pools. 78% cache hits.");
    expect(tile("Builds today").querySelector(".ou-stat__value")).toHaveTextContent("23");

    answer = { state: "fresh", payload: seededFarm(), etag: null, pollAfterSeconds: 10 };
    await act(async () => {
      fireEvent.click(within(stale).getByRole("button", { name: RETRY_LABEL }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(banner()).toBeNull();
  });

  it("says Retrying… while the ask it started is in the air", async () => {
    vi.useFakeTimers();
    answer = { state: "failed", reason: "The build farm could not be reached.", pollAfterSeconds: null };
    /** How many reads have been made; the second one — the retry's — never lands. */
    let reads = 0;
    const poll: FarmPollOptions = {
      read: () => ((reads += 1) === 1 ? Promise.resolve(answer) : new Promise(() => {})),
      visible: () => true,
    };
    render(<FarmScreen poll={poll} reader={MEMBER_READER} readings={farmReadings()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.click(screen.getByRole("button", { name: RETRY_LABEL }));

    expect(screen.getByRole("button", { name: RETRYING_LABEL })).toBeInTheDocument();
  });
});

describe("a page that could not be read", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={failedFarmReadings("Choose a workspace.")} />);
  });

  it("says why once, in the banner", () => {
    const unread = banner()!;

    expect(unread).toHaveTextContent(FARM_UNREAD_HEADLINE);
    expect(unread).toHaveTextContent("Choose a workspace.");
    expect(screen.getAllByText(/Choose a workspace\./)).toHaveLength(1);
  });

  it("draws the banner inside the page's frame, above the head, so it shares the head's gutters", () => {
    const frame = screen.getByRole("main");
    const unread = banner();

    expect(frame).toContainElement(unread);
    expect(frame.firstElementChild).toBe(unread);
  });

  it("keeps the head, the actions and four named tiles holding em-dashes", () => {
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(FARM_HEADLINE_UNREAD);
    // The head's two unbuilt actions, and the runners card's *Health history* (#257).
    expect(screen.getAllByRole("button", { name: new RegExp(SOON_MARK) })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "+ Enroll runner" })).toBeInTheDocument();
    expect(screen.getAllByRole("region").filter((region) => region.hasAttribute("aria-label"))).toHaveLength(4);
    expect(screen.getAllByText(NOT_READ)).toHaveLength(4);
    expect(document.querySelectorAll(".ou-stat__delta--failed")).toHaveLength(4);
    // The accent is for a figure that is reporting something.
    expect(document.querySelectorAll(".ou-stat__value--accent")).toHaveLength(0);
  });
});
