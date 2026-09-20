import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FarmPage } from "@/app/api/farm";
import type { Reading } from "@/app/api/reading";
import { requestSummaryRefresh } from "@/app/dashboard/summary-refresh";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmProvider, farmReading, useFarm } from "@/app/farm/farm-store";
import { EMPTY_POLL_SNAPSHOT, type PollAnswer, SESSION_ENDED } from "@/app/poll";

import { FARM_READ_AT, emptyFarm, farmStats, seededFarm } from "../helpers/farm";

/**
 * The farm's store, where the loop meets React (#256): one poll per screen however many regions
 * read it, the server's page until the poll has one, and a failure that keeps the page.
 */

/** The fleet's cadence, in milliseconds — what the stubbed answers ask for. */
const INTERVAL = 10_000;

/** How many times the reader was asked, this test. */
let asks = 0;

/** What it answers. Reassigned by the cases that care. */
let answer: PollAnswer<FarmPage>;

/** An answer held back until a case releases it, or `null` to answer at once. */
let held: Promise<PollAnswer<FarmPage>> | null = null;

/** A reader that never answers, for the cases about what stands before the first answer. */
const PENDING: FarmPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** The provider's test seam — one stable object, so a re-render builds no second poll. */
const OPTIONS: FarmPollOptions = {
  read: () => {
    asks += 1;
    return held ?? Promise.resolve(answer);
  },
  visible: () => true,
};

/** A fresh answer carrying one page. */
function fresh(page: FarmPage): PollAnswer<FarmPage> {
  return { state: "fresh", payload: page, etag: null, pollAfterSeconds: INTERVAL / 1000 };
}

/** One region, drawing whatever the store holds. */
function Region({ label }: Readonly<{ label: string }>) {
  const { page, failure, dataAt, retry, retrying, refresh } = useFarm();

  return (
    <p data-testid={label}>
      {page === null ? "nothing" : `total ${page.stats.runnersOnline.total}`}
      {failure === null ? "" : ` · ${failure}`}
      {dataAt === null ? "" : ` · at ${dataAt}`}
      {retrying ? " · retrying" : ""}
      <button onClick={retry} type="button">
        retry {label}
      </button>
      <button onClick={refresh} type="button">
        refresh {label}
      </button>
    </p>
  );
}

/**
 * Render regions under the provider and let the first poll land.
 *
 * @param initial What the server read.
 * @param children The regions.
 * @param poll The test seam.
 * @returns The way to take the screen away.
 */
async function mount(
  initial: Reading<FarmPage>,
  children: React.ReactNode = <Region label="row" />,
  poll: FarmPollOptions = OPTIONS,
): Promise<() => void> {
  const { unmount } = render(
    <FarmProvider initial={initial} poll={poll} readAt={FARM_READ_AT}>
      {children}
    </FarmProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

  return unmount;
}

beforeEach(() => {
  asks = 0;
  held = null;
  answer = fresh(seededFarm());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("farmReading", () => {
  const initial: Reading<FarmPage> = { ok: true, value: seededFarm() };
  const refused: Reading<FarmPage> = { ok: false, reason: "Choose a workspace." };

  it("is the server's page until the poll has one", () => {
    expect(farmReading(initial, FARM_READ_AT, EMPTY_POLL_SNAPSHOT)).toEqual({
      page: seededFarm(),
      failure: null,
      dataAt: FARM_READ_AT,
    });
  });

  it("is the poll's page once it has one, with the poll's own clock", () => {
    const snapshot = { data: emptyFarm(), updatedAt: 99, error: null };

    expect(farmReading(initial, FARM_READ_AT, snapshot)).toEqual({ page: emptyFarm(), failure: null, dataAt: 99 });
  });

  it("keeps the page under a failure — stale, not blank", () => {
    const snapshot = { data: seededFarm(), updatedAt: 99, error: "The build farm could not be reached." };

    expect(farmReading(initial, FARM_READ_AT, snapshot)).toEqual({
      page: seededFarm(),
      failure: "The build farm could not be reached.",
      dataAt: 99,
    });
  });

  it("keeps the server's page when the poll has only ever failed", () => {
    const snapshot = { data: null, updatedAt: null, error: "The build farm could not be reached." };

    expect(farmReading(initial, FARM_READ_AT, snapshot)).toEqual({
      page: seededFarm(),
      failure: "The build farm could not be reached.",
      dataAt: FARM_READ_AT,
    });
  });

  it("carries the server's reason for a first paint that failed, until the poll says something newer", () => {
    expect(farmReading(refused, FARM_READ_AT, EMPTY_POLL_SNAPSHOT)).toEqual({
      page: null,
      failure: "Choose a workspace.",
      dataAt: null,
    });
    expect(
      farmReading(refused, FARM_READ_AT, { data: null, updatedAt: null, error: SESSION_ENDED }).failure,
    ).toBe(SESSION_ENDED);
  });

  it("forgets the server's failure the moment the poll reads the page", () => {
    const snapshot = { data: seededFarm(), updatedAt: 99, error: null };

    expect(farmReading(refused, FARM_READ_AT, snapshot)).toEqual({ page: seededFarm(), failure: null, dataAt: 99 });
  });
});

describe("the farm store", () => {
  it("makes one request per interval however many regions read it", async () => {
    await mount(
      { ok: true, value: seededFarm() },
      <>
        <Region label="head" />
        <Region label="row" />
        <Region label="table" />
      </>,
    );

    expect(asks).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });

    // Three regions, two intervals, two requests — and at the fleet's cadence, not the default.
    expect(asks).toBe(2);
  });

  it("draws the server's page before the poll's first answer", async () => {
    await mount({ ok: true, value: seededFarm() }, undefined, PENDING);

    expect(screen.getByTestId("row")).toHaveTextContent(`total 5 · at ${FARM_READ_AT}`);
  });

  it("moves every region to the poll's page when it lands", async () => {
    answer = fresh(emptyFarm());

    await mount(
      { ok: true, value: seededFarm() },
      <>
        <Region label="head" />
        <Region label="row" />
      </>,
    );

    expect(screen.getByTestId("head")).toHaveTextContent("total 0");
    expect(screen.getByTestId("row")).toHaveTextContent("total 0");
  });

  it("keeps the page on screen when a later poll fails, and clears the failure when one works", async () => {
    await mount({ ok: true, value: seededFarm() });

    answer = { state: "failed", reason: "The build farm could not be reached.", pollAfterSeconds: null };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });

    expect(screen.getByTestId("row")).toHaveTextContent("total 5 · The build farm could not be reached.");

    answer = fresh(seededFarm());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });

    expect(screen.getByTestId("row")).not.toHaveTextContent("could not be reached");
  });

  it("mends a first paint that failed without anybody pressing anything", async () => {
    await mount({ ok: false, reason: "Choose a workspace." });

    expect(screen.getByTestId("row")).toHaveTextContent("total 5");
    expect(screen.getByTestId("row")).not.toHaveTextContent("Choose a workspace.");
  });

  it("asks at once on retry, reports it in flight, and ignores a second press meanwhile", async () => {
    await mount({ ok: true, value: seededFarm() });
    expect(asks).toBe(1);

    /** Releases the ask the retry starts. */
    let land: (value: PollAnswer<FarmPage>) => void = () => {};
    held = new Promise((resolve) => (land = resolve));

    fireEvent.click(screen.getByRole("button", { name: "retry row" }));
    fireEvent.click(screen.getByRole("button", { name: "retry row" }));

    // One press, one ask — the second press found the first still in the air.
    expect(asks).toBe(2);
    expect(screen.getByTestId("row")).toHaveTextContent("retrying");

    await act(async () => {
      land(fresh(seededFarm()));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Nothing had to be told that the ask came back: the snapshot moved.
    expect(screen.getByTestId("row")).not.toHaveTextContent("retrying");
  });

  it("stops reporting a retry in flight when it comes back failed, too", async () => {
    await mount({ ok: true, value: seededFarm() });

    answer = { state: "failed", reason: "The build farm could not be reached.", pollAfterSeconds: null };
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "retry row" }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId("row")).toHaveTextContent("could not be reached");
    expect(screen.getByTestId("row")).not.toHaveTextContent("retrying");
  });

  it("asks at once on refresh — what a write calls — without reporting a retry in flight (#259)", async () => {
    await mount({ ok: true, value: seededFarm() });
    expect(asks).toBe(1);

    held = new Promise(() => {});
    fireEvent.click(screen.getByRole("button", { name: "refresh row" }));

    expect(asks).toBe(2);
    // Not a control's press: there is no *retrying* for the banner to draw.
    expect(screen.getByTestId("row")).not.toHaveTextContent("retrying");
  });

  it("supersedes an ask already in the air on refresh, so the page that lands was read after the write", async () => {
    await mount({ ok: true, value: seededFarm() });

    /** Releases the ask that was in the air when the write was answered. */
    let landStale: (value: PollAnswer<FarmPage>) => void = () => {};
    held = new Promise((resolve) => (landStale = resolve));
    fireEvent.click(screen.getByRole("button", { name: "retry row" }));

    // The write is answered; the store is asked for a read made after it.
    held = null;
    answer = fresh(seededFarm({ stats: farmStats({ runnersOnline: { online: 6, total: 7, note: null, offline: null } }) }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "refresh row" }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId("row")).toHaveTextContent("total 7");

    // The overtaken ask lands last, and is dropped: an old page never replaces a newer one.
    await act(async () => {
      landStale(fresh(seededFarm()));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId("row")).toHaveTextContent("total 7");
  });

  it("asks again the moment the workspace changes", async () => {
    await mount({ ok: true, value: seededFarm() });
    expect(asks).toBe(1);

    answer = fresh(emptyFarm());
    await act(async () => {
      requestSummaryRefresh();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(asks).toBe(2);
    expect(screen.getByTestId("row")).toHaveTextContent("total 0");
  });

  it("stops polling when the screen goes away", async () => {
    const unmount = await mount({ ok: true, value: seededFarm() });
    expect(asks).toBe(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });

    expect(asks).toBe(1);
  });

  it("reads nothing, harmlessly, outside a provider", () => {
    render(<Region label="orphan" />);

    expect(screen.getByTestId("orphan")).toHaveTextContent("nothing");
    fireEvent.click(screen.getByRole("button", { name: "retry orphan" }));
    fireEvent.click(screen.getByRole("button", { name: "refresh orphan" }));
    expect(asks).toBe(0);
  });
});
