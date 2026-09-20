import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FarmPage, RunnerPool } from "@/app/api/farm";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmProvider } from "@/app/farm/farm-store";
import { PoolProvider, usePools } from "@/app/farm/pool-store";
import type { PollAnswer } from "@/app/poll";

import { FARM_READ_AT, failedFarmReadings, farmReadings, runnerPool, seededFarm } from "../helpers/farm";

/**
 * Where the pools card, its sheet and the head meet (#259): one *open*, the page's pools with the
 * reader's own outstanding writes over them, and a fresh page asked for the moment a write is
 * recorded.
 */

/** The seeded pools. */
const [POOL_A, POOL_B] = seededFarm().pools as [RunnerPool, RunnerPool];

/** A pool a case creates. */
const CREATED = runnerPool({ id: "created", name: "pool-0", runners: 0 });

/** How many reads the poll has made. */
let reads = 0;

/** The poll's clock. */
let pollNow = FARM_READ_AT;

/** What the poll answers. */
let answer: PollAnswer<FarmPage> = { state: "fresh", payload: seededFarm(), etag: null, pollAfterSeconds: 10 };

/** A poll that answers {@link answer} on its own clock, and counts. */
const LIVE: FarmPollOptions = {
  read: () => {
    reads += 1;
    return Promise.resolve(answer);
  },
  visible: () => true,
  now: () => pollNow,
};

/** One region, drawing whatever the store holds and pressing each of its seams. */
function Region() {
  const { pools, sheetOpen, openSheet, closeSheet, recordWrite, recordRemoval } = usePools();

  return (
    <div>
      <p data-testid="pools">
        {pools === null ? "unread" : pools.map((pool) => `${pool.name}${pool.enabled ? "" : " (off)"}`).join(", ")}
      </p>
      <p data-testid="sheet">{sheetOpen ? "open" : "closed"}</p>
      <button onClick={openSheet} type="button">
        open
      </button>
      <button onClick={closeSheet} type="button">
        close
      </button>
      <button onClick={() => recordWrite({ ...POOL_A, enabled: false })} type="button">
        disable pool-a
      </button>
      <button onClick={() => recordWrite(CREATED)} type="button">
        create
      </button>
      <button onClick={() => recordRemoval(POOL_B.id)} type="button">
        remove pool-b
      </button>
    </div>
  );
}

/**
 * Render the region under both providers and let the first poll land.
 *
 * @param readings What the route read.
 */
async function mount(readings = farmReadings()): Promise<void> {
  reads = 0;
  pollNow = FARM_READ_AT;
  answer = { state: "fresh", payload: seededFarm(), etag: null, pollAfterSeconds: 10 };

  render(
    <FarmProvider initial={readings.page} poll={LIVE} readAt={readings.readAt}>
      <PoolProvider>
        <Region />
      </PoolProvider>
    </FarmProvider>,
  );
  await act(async () => {});
}

/**
 * Press one of the region's buttons and let the read it starts land.
 *
 * @param name The button.
 */
async function press(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pool store", () => {
  it("answers the page's pools, by name", async () => {
    await mount();

    expect(screen.getByTestId("pools")).toHaveTextContent("pool-a, pool-b");
  });

  it("holds one open for the sheet's two doors", async () => {
    await mount();

    await press("open");
    expect(screen.getByTestId("sheet")).toHaveTextContent("open");

    await press("close");
    expect(screen.getByTestId("sheet")).toHaveTextContent("closed");
  });

  it("asks for a fresh page the moment a write or a removal is recorded", async () => {
    await mount();
    const before = reads;

    await press("disable pool-a");
    expect(reads).toBe(before + 1);

    await press("remove pool-b");
    expect(reads).toBe(before + 2);
  });

  it("draws a write over a page read before it — changed, created and removed alike", async () => {
    await mount();
    // Every write is answered after any page this poll confirms.
    vi.spyOn(Date, "now").mockReturnValue(FARM_READ_AT + 60_000);

    await press("disable pool-a");
    await press("create");
    await press("remove pool-b");

    expect(screen.getByTestId("pools")).toHaveTextContent("pool-0, pool-a (off)");
  });

  it("yields to the first page confirmed after the write", async () => {
    await mount();
    vi.spyOn(Date, "now").mockReturnValue(FARM_READ_AT + 60_000);
    await press("disable pool-a");

    expect(screen.getByTestId("pools")).toHaveTextContent("pool-a (off), pool-b");

    // The next read is confirmed later than both writes, and the service says otherwise: the
    // page wins, over the write that asked for it as much as over the one before.
    pollNow = FARM_READ_AT + 120_000;
    await press("create");

    expect(screen.getByTestId("pools")).toHaveTextContent(/^pool-a, pool-b$/);
  });

  it("claims no pools over a page that could not be read", async () => {
    answer = { state: "failed", reason: "The build farm could not be reached.", pollAfterSeconds: null };
    reads = 0;
    render(
      <FarmProvider initial={failedFarmReadings().page} poll={{ ...LIVE, read: () => Promise.resolve(answer) }} readAt={FARM_READ_AT}>
        <PoolProvider>
          <Region />
        </PoolProvider>
      </FarmProvider>,
    );
    await act(async () => {});

    expect(screen.getByTestId("pools")).toHaveTextContent("unread");
  });

  it("reads nothing, harmlessly, outside a provider", () => {
    render(<Region />);

    expect(screen.getByTestId("pools")).toHaveTextContent("unread");
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "disable pool-a" }));
    fireEvent.click(screen.getByRole("button", { name: "remove pool-b" }));

    expect(screen.getByTestId("sheet")).toHaveTextContent("closed");
  });
});
