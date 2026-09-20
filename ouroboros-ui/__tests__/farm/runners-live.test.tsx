import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FarmPage, FarmRunner } from "@/app/api/farm";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmScreen } from "@/app/farm/farm-screen";
import { RUNNERS_TITLE } from "@/app/farm/runners";
import { NOT_MEASURED } from "@/app/farm/view";
import type { PollAnswer } from "@/app/poll";
import { Meter } from "@/app/ui/meter";

import { FARM_READ_AT, farmReadings, runnerTelemetry, seededFarm } from "../helpers/farm";

/**
 * The runners table while the poll moves under it (#257) — the two acceptance criteria no other
 * table in the product has:
 *
 * - **Live updates produce no flicker and no full-row re-render.** Held at both levels. The DOM:
 *   a `MutationObserver` over the table body records everything a poll causes, and what it may
 *   record is a changed text node and a changed attribute *inside the cell that moved* — never a
 *   row or a cell added, removed or replaced. React: the meter is spied, and a poll that moved one
 *   machine's CPU renders one meter, not four.
 * - **Killing a runner flips its row** — dimmed, em dashes — on the poll that reports it, with no
 *   reload, and the row that flips is the same element it was.
 */

// The real meter, counted: which CPU cells React rendered is how the memo is observed.
vi.mock("@/app/ui/meter", async (original) => {
  const actual = await original<typeof import("@/app/ui/meter")>();

  return { ...actual, Meter: vi.fn(actual.Meter) };
});

/** What the live poll answers. Reassigned by each case. */
let answer: PollAnswer<FarmPage>;

/** A poll that answers {@link answer}, at the fleet's cadence. */
const LIVE: FarmPollOptions = { read: () => Promise.resolve(answer), visible: () => true };

/** The fleet's heartbeat, in milliseconds. */
const HEARTBEAT_MS = 10_000;

/**
 * The seeded farm with some runners changed.
 *
 * @param change What to replace on a runner, by its name.
 * @returns A fresh answer carrying the changed page.
 */
function fresh(change: Readonly<Record<string, Partial<FarmRunner>>> = {}): PollAnswer<FarmPage> {
  const page = seededFarm();

  return {
    state: "fresh",
    payload: {
      ...page,
      runners: page.runners.map((runner) => ({ ...runner, ...change[runner.name] })),
    },
    etag: null,
    pollAfterSeconds: 10,
  };
}

/** The table's body. */
function body(): HTMLElement {
  const table = within(screen.getByRole("region", { name: RUNNERS_TITLE })).getByRole("grid");

  return table.querySelector("tbody")!;
}

/**
 * One row, by its runner's name.
 *
 * @param name The runner's name.
 * @returns The row.
 */
function rowFor(name: string): HTMLElement {
  const row = [...body().querySelectorAll("tr")].find((candidate) => candidate.textContent?.includes(name));
  if (row === undefined) throw new Error(`no row for ${name}`);

  return row;
}

/**
 * Let the next poll land, and record everything it did to the table body.
 *
 * @returns The mutation records the poll caused.
 */
async function nextPoll(): Promise<MutationRecord[]> {
  // Collected in the callback as well as at the end: records are delivered on a microtask, so
  // by the time `act` returns most of them have already left the observer's queue.
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((delivered) => void records.push(...delivered));
  observer.observe(body(), {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
  });

  records.push(...observer.takeRecords());
  observer.disconnect();

  return records;
}

/**
 * The elements a set of records added or removed.
 *
 * @param records The records.
 * @returns Every element node among their added and removed nodes.
 */
function elementsMoved(records: readonly MutationRecord[]): Element[] {
  return records
    .flatMap((record) => [...record.addedNodes, ...record.removedNodes])
    .filter((node): node is Element => node instanceof Element);
}

/**
 * How many times a CPU cell's meter has rendered since the count was last cleared.
 *
 * The table's own meters only: the stat row's cache tile draws one too, and whether *that*
 * re-renders on a poll is not this table's claim.
 */
function meterRenders(): number {
  return vi.mocked(Meter).mock.calls.filter(([props]) => props.className === "farm-runners__cpu-meter").length;
}

beforeEach(async () => {
  vi.useFakeTimers();
  // The fixtures' own instant, so an age measured from the poll's clock is a small, known one.
  vi.setSystemTime(FARM_READ_AT);
  answer = fresh();
  render(<FarmScreen poll={LIVE} readings={farmReadings()} />);

  // The poll's first answer — the same page the server read — so every case starts settled.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  vi.mocked(Meter).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a poll that changes nothing", () => {
  it("touches nothing in the table, and renders no cell", async () => {
    answer = fresh();

    const records = await nextPoll();

    expect(records).toEqual([]);
    expect(meterRenders()).toBe(0);
  });
});

describe("a poll that moves one machine's figures", () => {
  beforeEach(() => {
    answer = fresh({ "forge-01": { telemetry: runnerTelemetry(91, 15.7, 32, 2) } });
  });

  it("draws the new figures", async () => {
    await nextPoll();

    expect(rowFor("forge-01")).toHaveTextContent("91%");
    expect(rowFor("forge-01")).toHaveTextContent("15.7/32 GB");
  });

  it("keeps every row the element it was — nothing is remounted", async () => {
    const before = [...body().querySelectorAll("tr")];
    const cellsBefore = [...body().querySelectorAll("td")];

    await nextPoll();

    expect([...body().querySelectorAll("tr")]).toEqual(before);
    expect([...body().querySelectorAll("td")]).toEqual(cellsBefore);
    for (const [index, row] of [...body().querySelectorAll("tr")].entries()) expect(row).toBe(before[index]);
  });

  it("adds and removes no element, and mutates only inside the row that moved", async () => {
    const records = await nextPoll();

    expect(records.length).toBeGreaterThan(0);
    expect(elementsMoved(records)).toEqual([]);
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;

      expect(rowFor("forge-01")).toContainElement(target as HTMLElement);
    }
  });

  it("moves the meter by its custom property, which is what lets the fill ease to its new width", async () => {
    const fill = rowFor("forge-01").querySelector(".ou-meter__fill");

    const records = await nextPoll();

    expect(rowFor("forge-01").querySelector(".ou-meter__fill")).toBe(fill);
    expect(fill?.getAttribute("style")).toContain("--ou-meter-fill: 91%");
    expect(records.some((record) => record.type === "attributes" && record.target === fill)).toBe(true);
  });

  it("renders the one CPU cell that moved, not the row and not the table", async () => {
    await nextPoll();

    // Four connected machines carry a meter; one of them changed.
    expect(meterRenders()).toBe(1);
  });
});

describe("a poll that only ages the page", () => {
  it("re-ages the offline row's last-seen figure and leaves every other cell alone", async () => {
    // Three hours of heartbeats, with nothing about the fleet changing.
    for (let beat = 0; beat < 3; beat += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_600_000);
      });
    }
    vi.mocked(Meter).mockClear();

    const records = await nextPoll();

    expect(rowFor("forge-03")).toHaveTextContent(/last seen \d+h ago/);
    expect(elementsMoved(records)).toEqual([]);
    expect(meterRenders()).toBe(0);
  });
});

describe("killing a runner", () => {
  beforeEach(() => {
    // What the presence sweep leaves behind: offline, and the snapshot cleared (V040).
    answer = fresh({
      "forge-02": {
        status: "offline",
        telemetry: null,
        uptimeSeconds: null,
        lastSeenAt: "2026-09-19T14:01:53.000Z",
      },
    });
  });

  it("flips its row on the poll that reports it — dimmed, with em dashes — and no reload", async () => {
    const row = rowFor("forge-02");
    expect(row).not.toHaveClass("farm-runners__row--dim");
    expect(row).toHaveTextContent("3%");

    await nextPoll();

    expect(rowFor("forge-02")).toBe(row);
    expect(row).toHaveClass("farm-runners__row--dim");
    expect(within(row).getByText("offline")).toHaveClass("ou-chip--err");
    expect(row).toHaveTextContent(/last seen \d+s ago/);
    expect(row).not.toHaveTextContent("3%");
    expect(row).not.toHaveTextContent("2.1/32 GB");
    expect(row.querySelector(".ou-meter")).toBeNull();
    expect(within(row).getAllByText(NOT_MEASURED).length).toBeGreaterThanOrEqual(3);
  });

  it("leaves every other row untouched while it does", async () => {
    const records = await nextPoll();

    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;

      expect(rowFor("forge-02")).toContainElement(target as HTMLElement);
    }
  });

  it("keeps the row where it stood — the default order does not move on a status", async () => {
    const before = [...body().querySelectorAll("tr")];

    await nextPoll();

    expect([...body().querySelectorAll("tr")]).toEqual(before);
  });
});
