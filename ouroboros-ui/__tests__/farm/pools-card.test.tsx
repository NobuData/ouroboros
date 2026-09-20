import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FarmPage, RunnerPool, RunnerPoolChange } from "@/app/api/farm";
import { ENROLL_TITLE } from "@/app/farm/enroll";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmScreen } from "@/app/farm/farm-screen";
import {
  AUTOSCALE_AFFIX,
  AUTOSCALE_KEEP,
  CONFIGURE,
  NO_POOLS_MEMBER_NOTE,
  NO_POOLS_NOTE,
  NO_POOLS_TITLE,
  POOLS_TITLE,
  POOLS_UNREAD,
  POOL_MEMBER_REASON,
  type PoolWriteOutcome,
  SHEET_TITLE,
  WRITE_FAILED,
} from "@/app/farm/pools";
import type { PollAnswer } from "@/app/poll";

import {
  ADMIN_READER,
  FARM_READ_AT,
  MEMBER_READER,
  emptyFarm,
  failedFarmReadings,
  farmReadings,
  seededFarm,
} from "../helpers/farm";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";

const actions = vi.hoisted(() => ({
  updatePool: vi.fn<(id: string, change: RunnerPoolChange) => Promise<PoolWriteOutcome>>(),
}));

vi.mock("@/app/farm/pool-actions", () => ({
  createPool: vi.fn(),
  deletePool: vi.fn(),
  updatePool: (id: string, change: RunnerPoolChange) => actions.updatePool(id, change),
}));

// The enroll card (#258) shares the column; this suite presses none of its actions.
vi.mock("@/app/farm/enroll-actions", () => ({
  mintEnrollCommand: vi.fn(),
  readEnrollmentTokens: vi.fn(),
  revokeEnrollmentToken: vi.fn(),
}));

/**
 * The pools card on the farm screen (#259): the seeded rows reading exactly as mockup 08 draws
 * them, composed from the live page; the enable switch and the auto-scale sub-toggle persisting
 * through the one write each makes; the affix as text on the card rather than a tooltip; a write
 * standing in for the page until a read made after it lands; and the read-only card a member is
 * given.
 */

/** A poll that never answers, so a case draws exactly what the server read. */
const QUIET: FarmPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** The seeded pools. */
const [POOL_A, POOL_B] = seededFarm().pools as [RunnerPool, RunnerPool];

/**
 * The card.
 *
 * @returns The pools card's section.
 */
function card(): HTMLElement {
  return screen.getByRole("region", { name: POOLS_TITLE });
}

/**
 * One pool's row.
 *
 * @param name The pool.
 * @returns Its list item.
 */
function row(name: string): HTMLElement {
  const found = within(card())
    .getAllByRole("listitem")
    .find((item) => item.querySelector(".farm-pool__name")?.textContent === name);

  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

/**
 * Press a switch and let the write settle.
 *
 * The write's output and the end of its transition are two moments (`../helpers/settle.ts`): the
 * optimistic position is given back when the *transition* ends, a turn after the action's
 * promise does — so this drains React once more after the press.
 *
 * @param control The switch.
 */
async function press(control: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(control);
    await Promise.resolve();
  });
  await settle();
}

/**
 * What the service answers a change with: the pool, changed.
 *
 * @param id The pool.
 * @param change The change.
 * @returns The outcome.
 */
function written(id: string, change: RunnerPoolChange): PoolWriteOutcome {
  const pool = seededFarm().pools.find((held) => held.id === id) as RunnerPool;

  return { ok: true, pool: { ...pool, ...change, defaultCommand: pool.defaultCommand } as RunnerPool };
}

beforeEach(() => {
  actions.updatePool.mockReset();
  actions.updatePool.mockImplementation((id, change) => Promise.resolve(written(id, change)));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the seeded card", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);
  });

  it("draws the mockup's rows: a mono name over a line composed from executor, image and live count", () => {
    expect(within(card()).getByRole("heading", { name: POOLS_TITLE })).toBeInTheDocument();
    expect(within(card()).getAllByRole("listitem")).toHaveLength(2);
    expect(row("pool-a").querySelector(".farm-pool__meta")).toHaveTextContent(
      "firmware builds · zephyr-sdk 0.17 image · 3 runners",
    );
    expect(row("pool-b").querySelector(".farm-pool__meta")).toHaveTextContent("HIL & macOS jobs · 2 runners");
  });

  it("sits under the enroll card, in the mockup's right-hand column", () => {
    const column = card().parentElement;

    expect(column).toHaveClass("farm-col--4", "farm__side");
    expect(Array.from(column?.children ?? [])).toEqual([screen.getByRole("region", { name: ENROLL_TITLE }), card()]);
  });

  it("draws each pool's switch in its stored position, named for what a press would do", () => {
    for (const name of ["pool-a", "pool-b"]) {
      const control = within(row(name)).getByRole("switch", { name: `Disable ${name}` });

      expect(control).toHaveAttribute("aria-checked", "true");
      expect(control).not.toHaveAttribute("aria-disabled");
    }
  });

  it("writes nothing to draw the card", () => {
    expect(actions.updatePool).not.toHaveBeenCalled();
  });
});

describe("the auto-scale sub-toggle", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);
  });

  it("is drawn under the pool that stores a threshold, off, with the mockup's two lines", () => {
    const control = within(row("pool-a")).getByRole("switch", { name: "Turn on auto-scale to cloud for pool-a" });

    expect(control).toHaveAttribute("aria-checked", "false");
    expect(row("pool-a")).toHaveTextContent("Auto-scale to cloud when queue > 5");
    expect(row("pool-a")).toHaveTextContent(AUTOSCALE_KEEP);
  });

  it("is not drawn under the pool that stores none", () => {
    expect(within(row("pool-b")).getAllByRole("switch")).toHaveLength(1);
    expect(row("pool-b")).not.toHaveTextContent(/auto-scale/i);
  });

  it("carries the v2 affix as text on the card — not a tooltip that has to be hovered to find", () => {
    const affix = within(row("pool-a")).getByText(new RegExp(AUTOSCALE_AFFIX.replace(/[()]/g, "\\$&")));

    expect(affix).toBeVisible();
    // Nowhere in the card is the affix an attribute: it is only ever text.
    expect(card().querySelectorAll(`[title*="${AUTOSCALE_AFFIX}"]`)).toHaveLength(0);
    // And a screen reader hears it with the switch it qualifies.
    expect(within(row("pool-a")).getByRole("switch", { name: /auto-scale/ })).toHaveAttribute(
      "aria-describedby",
      affix.id,
    );
  });

  it("persists a press — the whole stored preference with the switch flipped, and nothing else", async () => {
    await press(within(row("pool-a")).getByRole("switch", { name: /Turn on auto-scale/ }));

    expect(actions.updatePool).toHaveBeenCalledExactlyOnceWith(POOL_A.id, {
      autoscalePref: { enabled: true, queue_threshold: 5 },
    });

    const control = within(row("pool-a")).getByRole("switch", { name: "Turn off auto-scale to cloud for pool-a" });

    expect(control).toHaveAttribute("aria-checked", "true");
    // Stored is still not active: the affix stays whichever way the switch stands.
    expect(row("pool-a")).toHaveTextContent(AUTOSCALE_AFFIX);
  });

  it("acts on nothing: the pool's own switch, its line and the rest of the page are as they were", async () => {
    const before = screen.getByRole("main").cloneNode(true) as HTMLElement;

    await press(within(row("pool-a")).getByRole("switch", { name: /Turn on auto-scale/ }));

    const after = screen.getByRole("main").cloneNode(true) as HTMLElement;
    for (const tree of [before, after]) tree.querySelector(".farm-pool__subtoggle")?.remove();

    expect(after.innerHTML).toBe(before.innerHTML);
  });
});

describe("the enable switch", () => {
  it("persists a press through the one field it is about, and moves at once", async () => {
    let answerWrite: (outcome: PoolWriteOutcome) => void = () => {};
    actions.updatePool.mockReturnValue(new Promise((resolve) => (answerWrite = resolve)));
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);

    await press(within(row("pool-b")).getByRole("switch", { name: "Disable pool-b" }));

    expect(actions.updatePool).toHaveBeenCalledExactlyOnceWith(POOL_B.id, { enabled: false });
    // Before the service has answered.
    expect(within(row("pool-b")).getByRole("switch", { name: "Enable pool-b" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await act(async () => {
      answerWrite(written(POOL_B.id, { enabled: false }));
      await Promise.resolve();
    });
    await settle();

    expect(within(row("pool-b")).getByRole("switch", { name: "Enable pool-b" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(within(row("pool-a")).getByRole("switch", { name: "Disable pool-a" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("ignores a second press while the first is in flight", async () => {
    let answerWrite: (outcome: PoolWriteOutcome) => void = () => {};
    actions.updatePool.mockReturnValue(new Promise((resolve) => (answerWrite = resolve)));
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);

    await press(within(row("pool-a")).getByRole("switch", { name: "Disable pool-a" }));
    await press(within(row("pool-a")).getByRole("switch", { name: "Enable pool-a" }));
    await press(within(row("pool-a")).getByRole("switch", { name: /auto-scale/ }));

    expect(actions.updatePool).toHaveBeenCalledTimes(1);

    // Answered before the case ends: React entangles every async action in the module, so one
    // left hanging would hold the next case's optimistic switch in place for ever.
    await act(async () => {
      answerWrite(written(POOL_A.id, { enabled: false }));
      await Promise.resolve();
    });
  });

  it("goes back on its own when the service refuses, and says why under the row", async () => {
    actions.updatePool.mockResolvedValue({ ok: false, reason: WRITE_FAILED, fields: {} });
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);

    await press(within(row("pool-a")).getByRole("switch", { name: "Disable pool-a" }));

    expect(within(row("pool-a")).getByRole("switch", { name: "Disable pool-a" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(row("pool-a")).getByRole("alert")).toHaveTextContent(WRITE_FAILED);
    expect(within(row("pool-b")).queryByRole("alert")).toBeNull();
  });

  it("clears the last refusal on the next press", async () => {
    actions.updatePool.mockResolvedValueOnce({ ok: false, reason: WRITE_FAILED, fields: {} });
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);

    await press(within(row("pool-a")).getByRole("switch", { name: "Disable pool-a" }));
    await press(within(row("pool-a")).getByRole("switch", { name: "Disable pool-a" }));

    expect(within(row("pool-a")).queryByRole("alert")).toBeNull();
    expect(within(row("pool-a")).getByRole("switch", { name: "Enable pool-a" })).toBeInTheDocument();
  });
});

describe("the page beneath a write", () => {
  /** What the poll answers. */
  let answer: PollAnswer<FarmPage>;
  /** How many reads the poll has made. */
  let reads: number;
  /** The poll's clock. */
  let pollNow: number;

  /** A poll that answers {@link answer} on the poll's own clock. */
  const LIVE: FarmPollOptions = {
    read: () => {
      reads += 1;
      return Promise.resolve(answer);
    },
    visible: () => true,
    now: () => pollNow,
  };

  beforeEach(() => {
    reads = 0;
    pollNow = FARM_READ_AT + 1_000;
    answer = { state: "fresh", payload: seededFarm(), etag: null, pollAfterSeconds: 10 };
  });

  it("moves the meta line with the live count, like the table beside it", async () => {
    const [first, second] = seededFarm().pools as [RunnerPool, RunnerPool];
    answer = {
      state: "fresh",
      payload: seededFarm({ pools: [{ ...first, runners: 4 }, second] }),
      etag: null,
      pollAfterSeconds: 10,
    };

    render(<FarmScreen poll={LIVE} reader={ADMIN_READER} readings={farmReadings()} />);
    await act(async () => {});

    expect(row("pool-a")).toHaveTextContent("firmware builds · zephyr-sdk 0.17 image · 4 runners");
  });

  it("asks for a fresh page as soon as a write is answered", async () => {
    render(<FarmScreen poll={LIVE} reader={ADMIN_READER} readings={farmReadings()} />);
    await act(async () => {});
    const before = reads;

    await press(within(row("pool-a")).getByRole("switch", { name: "Disable pool-a" }));

    expect(reads).toBe(before + 1);
  });

  it("holds the write's answer over a page read before it, and yields to one read after", async () => {
    // The page the poll keeps answering still says *enabled*: it is the old truth.
    render(<FarmScreen poll={LIVE} reader={ADMIN_READER} readings={farmReadings()} />);
    await act(async () => {});

    // The write is answered *after* every page this poll will confirm…
    vi.spyOn(Date, "now").mockReturnValue(pollNow + 5_000);
    await press(within(row("pool-a")).getByRole("switch", { name: "Disable pool-a" }));

    expect(within(row("pool-a")).getByRole("switch", { name: "Enable pool-a" })).toBeInTheDocument();

    // …until one is confirmed later than the write: that page was read after it, and wins.
    pollNow += 10_000;
    const [first, second] = seededFarm().pools as [RunnerPool, RunnerPool];
    answer = {
      state: "fresh",
      payload: seededFarm({ pools: [{ ...first, enabled: false, runners: 7 }, second] }),
      etag: null,
      pollAfterSeconds: 10,
    };
    await press(within(row("pool-b")).getByRole("switch", { name: "Disable pool-b" }));

    expect(row("pool-a")).toHaveTextContent("7 runners");
  });
});

describe("a reader who may not write", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);
  });

  it("sees every switch in its real position, inert, with the reason", async () => {
    const switches = within(card()).getAllByRole("switch");

    expect(switches).toHaveLength(3);
    for (const control of switches) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("title", POOL_MEMBER_REASON);
      await press(control);
    }

    expect(actions.updatePool).not.toHaveBeenCalled();
    expect(within(row("pool-a")).getByRole("switch", { name: "Disable pool-a" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("still reads the affix, and may still open the sheet to read a pool's configuration", () => {
    expect(row("pool-a")).toHaveTextContent(AUTOSCALE_AFFIX);

    fireEvent.click(within(card()).getByRole("button", { name: CONFIGURE }));

    expect(screen.getByRole("dialog", { name: SHEET_TITLE })).toBeInTheDocument();
  });
});

describe("a workspace with no pools, and a page that could not be read", () => {
  it("says so, and tells an administrator where the first one comes from", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings(emptyFarm())} />);

    expect(card()).toHaveTextContent(NO_POOLS_TITLE);
    expect(card()).toHaveTextContent(NO_POOLS_NOTE);
    expect(within(card()).queryByRole("list")).toBeNull();
  });

  it("tells a member who creates one", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings(emptyFarm())} />);

    expect(card()).toHaveTextContent(NO_POOLS_MEMBER_NOTE);
  });

  it("claims no pools over a page that could not be read, and opens nothing", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={failedFarmReadings()} />);

    expect(card()).toHaveTextContent(POOLS_UNREAD);
    expect(card()).not.toHaveTextContent(NO_POOLS_TITLE);

    const configure = within(card()).getByRole("button", { name: CONFIGURE });

    expect(configure).toHaveAttribute("aria-disabled", "true");
    expect(configure).toHaveAttribute("title", POOLS_UNREAD);
    fireEvent.click(configure);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("both palettes", () => {
  it("draws one markup under both, for an administrator and for a member", () => {
    for (const reader of [ADMIN_READER, MEMBER_READER]) {
      const [light, dark] = renderInBothPalettes(
        <FarmScreen poll={QUIET} reader={reader} readings={farmReadings()} />,
      );

      expect(maskIds(light ?? "")).toBe(maskIds(dark ?? ""));
    }
  });
});
