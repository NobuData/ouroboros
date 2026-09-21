import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FarmPage } from "@/app/api/farm";
import { COPY_COMMAND, ENROLL_TITLE, NO_POOLS_REASON, POOL_LABEL } from "@/app/farm/enroll";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmScreen } from "@/app/farm/farm-screen";
import { CONFIGURE, POOLS_TITLE, SHEET_CLOSE, SHEET_TITLE } from "@/app/farm/pools";
import { NO_RUNNERS_TITLE, RUNNERS_TITLE, RUNNERS_UNREAD_TITLE } from "@/app/farm/runners";
import {
  CREATE_POOL,
  FARM_READ_ONLY_BODY,
  FIRST_RUN_MEMBER_NOTE,
  FIRST_RUN_NOTE,
  FIRST_RUN_STEPS_LABEL,
  FLEET_DOWN_BODY,
  FLEET_THIN_BODY,
  GO_TO_ENROLL,
  STEP_COPY_COMMAND,
  STEP_CREATE_POOL,
  STEP_ONE,
  STEP_RUN_COMMAND,
  STEP_TWO,
  farmReadOnlyNote,
} from "@/app/farm/states";
import type { PollAnswer } from "@/app/poll";

import {
  ADMIN_READER,
  FARM_READ_AT,
  MEMBER_READER,
  emptyFarm,
  failedFarmReadings,
  farmReadings,
  farmRunner,
  farmStats,
  runnerPool,
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

// The pools card (#259) writes through Server Actions too; this suite opens its sheet and
// writes nothing through it.
vi.mock("@/app/farm/pool-actions", () => ({
  createPool: vi.fn(),
  deletePool: vi.fn(),
  updatePool: vi.fn(),
}));

// The runner menu and the submit dialog (#260) share the screen; this suite presses neither.
vi.mock("@/app/farm/lifecycle-actions", () => ({
  drainRunner: vi.fn(),
  undrainRunner: vi.fn(),
  removeRunner: vi.fn(),
}));

vi.mock("@/app/farm/submit-actions", () => ({ submitBuild: vi.fn() }));

/**
 * The build farm's states as they are drawn (#262): a first run that starts somebody enrolling
 * rather than showing an empty table — the grid reordered, step one's card promoted, the seat
 * saying what to do; the same page for a reader who may not act; the role explained under the
 * head; and the strip that says most of the fleet is away. Every one in both palettes.
 */

/** A poll that never answers, so a case draws exactly what the server read. */
const QUIET: FarmPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** What the live poll answers. Reassigned by the cases that care. */
let answer: PollAnswer<FarmPage>;

/** A poll that answers {@link answer}, at the fleet's cadence. */
const LIVE: FarmPollOptions = { read: () => Promise.resolve(answer), visible: () => true };

/** A workspace with one pool and nothing enrolled — the first run's second state. */
function pooledFarm(): FarmPage {
  return { ...emptyFarm(), pools: [runnerPool({ runners: 0 })] };
}

/**
 * A fresh poll answer.
 *
 * @param payload The page it carries.
 * @returns The answer — a new object each time, so the page's identity moves with it.
 */
function fresh(payload: FarmPage): PollAnswer<FarmPage> {
  return { state: "fresh", payload, etag: null, pollAfterSeconds: 10 };
}

/** Let the poll that is due land. */
async function nextPoll(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The grid. */
function grid(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".farm__grid");

  if (!found) throw new Error("no grid");
  return found;
}

/** The right-hand column. */
function side(): HTMLElement {
  const found = grid().querySelector<HTMLElement>(":scope > .farm__side");

  if (!found) throw new Error("no side column");
  return found;
}

/** The runners card. */
function runnersCard(): HTMLElement {
  return screen.getByRole("region", { name: RUNNERS_TITLE });
}

/** The enroll card. */
function enrollCard(): HTMLElement {
  return screen.getByRole("region", { name: ENROLL_TITLE });
}

/** The pools card. */
function poolsCard(): HTMLElement {
  return screen.getByRole("region", { name: POOLS_TITLE });
}

/**
 * Whether one element comes before another in the document — the order a keyboard and a screen
 * reader take, which is the one the first run promises.
 *
 * @param first The element expected first.
 * @param second The element expected after it.
 * @returns Whether it does.
 */
function precedes(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** The read-only note, by its class: the enroll card keeps a `note` of its own for a member. */
function readOnlyNote(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".farm-readonly[role='note']");
}

/** The offline-heavy strip's seat — by its class, as the page has several polite regions. */
function fleetSeat(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".farm-fleet-seat[role='status']");

  if (!found) throw new Error("no fleet seat");
  return found;
}

beforeEach(() => {
  answer = fresh(seededFarm());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a first run with no pool — the new tenant's landing", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings(emptyFarm())} />);
  });

  it("marks the grid, and puts the right-hand column ahead of the runners card in the document", () => {
    expect(grid()).toHaveClass("farm__grid--first-run");
    expect(precedes(side(), runnersCard())).toBe(true);
  });

  it("keeps the stat row first and the live card last", () => {
    const children = [...grid().children];

    expect(children.slice(0, 4).every((child) => child.classList.contains("farm-col--3"))).toBe(true);
    expect(children.at(-1)).toHaveClass("farm-col--12");
  });

  it("puts the pools card first in its column, as step one, with the promoted border", () => {
    expect(precedes(poolsCard(), enrollCard())).toBe(true);
    expect(within(poolsCard()).getByText(STEP_ONE)).toHaveClass("ou-eyebrow");
    expect(poolsCard()).toHaveClass("farm-promoted");
  });

  it("marks the enroll card a quiet step two, unpromoted — its command cannot be minted yet", () => {
    const eyebrow = within(enrollCard()).getByText(STEP_TWO);

    expect(eyebrow).toHaveClass("ou-eyebrow--quiet");
    expect(enrollCard()).not.toHaveClass("farm-promoted");
    expect(within(enrollCard()).getByRole("button", { name: COPY_COMMAND })).toHaveAttribute(
      "title",
      NO_POOLS_REASON,
    );
  });

  it("promotes exactly one card", () => {
    expect(document.querySelectorAll(".farm-promoted")).toHaveLength(1);
  });

  it("seats guidance where the table would be — three steps, the pool first — and no table", () => {
    const seat = within(runnersCard());
    const steps = within(seat.getByRole("list", { name: FIRST_RUN_STEPS_LABEL })).getAllByRole("listitem");

    expect(seat.getByText(NO_RUNNERS_TITLE)).toBeInTheDocument();
    expect(seat.getByText(FIRST_RUN_NOTE)).toBeInTheDocument();
    expect(steps.map((step) => step.querySelector(".farm-first-run__title")?.textContent)).toEqual([
      STEP_CREATE_POOL.title,
      STEP_COPY_COMMAND.title,
      STEP_RUN_COMMAND.title,
    ]);
    expect(steps[0]).toHaveTextContent(STEP_CREATE_POOL.body);
    expect(seat.queryByRole("grid")).toBeNull();
    expect(seat.queryByRole("table")).toBeNull();
  });

  it("opens the pool sheet on its blank form from the seat's Create a pool", () => {
    fireEvent.click(within(runnersCard()).getByRole("button", { name: CREATE_POOL }));

    const sheet = screen.getByRole("dialog", { name: SHEET_TITLE });

    // No picker: with no pool to configure, the sheet is the create form.
    expect(within(sheet).queryByRole("combobox", { name: /pool/i })).toBeNull();
    expect(within(sheet).getAllByRole("textbox").length).toBeGreaterThan(0);
  });

  it("opens the same sheet from the pools card's own Create a pool", () => {
    fireEvent.click(within(poolsCard()).getByRole("button", { name: CREATE_POOL }));

    expect(screen.getByRole("dialog", { name: SHEET_TITLE })).toBeInTheDocument();
  });

  it("draws no warning strip over an empty fleet, and no read-only note for an administrator", () => {
    expect(fleetSeat()).toBeEmptyDOMElement();
    expect(readOnlyNote()).toBeNull();
  });
});

describe("a first run with a pool and no machine", () => {
  beforeEach(() => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings(pooledFarm())} />);
  });

  it("keeps the column ahead of the table, with the enroll card first in it as step one", () => {
    expect(grid()).toHaveClass("farm__grid--first-run");
    expect(precedes(side(), runnersCard())).toBe(true);
    expect(precedes(enrollCard(), poolsCard())).toBe(true);
    expect(within(enrollCard()).getByText(STEP_ONE)).not.toHaveClass("ou-eyebrow--quiet");
    expect(enrollCard()).toHaveClass("farm-promoted");
  });

  it("leaves the pools card unmarked — its step is done", () => {
    expect(poolsCard()).not.toHaveClass("farm-promoted");
    expect(within(poolsCard()).queryByText(STEP_ONE)).toBeNull();
    expect(within(poolsCard()).queryByText(STEP_TWO)).toBeNull();
    expect(within(poolsCard()).queryByRole("button", { name: CREATE_POOL })).toBeNull();
  });

  it("starts the steps at the command", () => {
    const steps = within(
      within(runnersCard()).getByRole("list", { name: FIRST_RUN_STEPS_LABEL }),
    ).getAllByRole("listitem");

    expect(steps.map((step) => step.querySelector(".farm-first-run__title")?.textContent)).toEqual([
      STEP_COPY_COMMAND.title,
      STEP_RUN_COMMAND.title,
    ]);
  });

  it("moves the reader from the seat to the enroll card's pool selector", () => {
    fireEvent.click(within(runnersCard()).getByRole("button", { name: GO_TO_ENROLL }));

    expect(screen.getByRole("combobox", { name: POOL_LABEL })).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("a first run, for a reader who may not act", () => {
  it("says who can, in a sentence — the steps stay, and there is no control in the seat", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings(emptyFarm())} />);

    const seat = within(runnersCard());

    expect(seat.getByText(FIRST_RUN_MEMBER_NOTE)).toBeInTheDocument();
    expect(seat.queryByText(FIRST_RUN_NOTE)).toBeNull();
    expect(seat.getByRole("list", { name: FIRST_RUN_STEPS_LABEL })).toBeInTheDocument();
    expect(seat.queryByRole("button", { name: CREATE_POOL })).toBeNull();
    expect(seat.queryByRole("button", { name: GO_TO_ENROLL })).toBeNull();
  });

  it("marks no card as a step they cannot take, and offers no Create a pool", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings(emptyFarm())} />);

    expect(screen.queryByText(STEP_ONE)).toBeNull();
    expect(screen.queryByText(STEP_TWO)).toBeNull();
    expect(document.querySelectorAll(".farm-promoted")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: CREATE_POOL })).toBeNull();
  });

  it("still puts the column first — the layout is the page's state, not the reader's role", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings(pooledFarm())} />);

    expect(grid()).toHaveClass("farm__grid--first-run");
    expect(precedes(side(), runnersCard())).toBe(true);
  });
});

describe("outside a first run", () => {
  it("is mockup 08's order: the table, then the column, the enroll card over the pools", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);

    expect(grid()).not.toHaveClass("farm__grid--first-run");
    expect(precedes(runnersCard(), side())).toBe(true);
    expect(precedes(enrollCard(), poolsCard())).toBe(true);
    expect(document.querySelectorAll(".farm-promoted")).toHaveLength(0);
    expect(screen.queryByText(STEP_ONE)).toBeNull();
    expect(screen.queryByRole("list", { name: FIRST_RUN_STEPS_LABEL })).toBeNull();
  });

  it("treats a page that could not be read as unread, not as empty — no guidance over a fleet nobody counted", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={failedFarmReadings()} />);

    expect(grid()).not.toHaveClass("farm__grid--first-run");
    expect(within(runnersCard()).getByText(RUNNERS_UNREAD_TITLE)).toBeInTheDocument();
    expect(within(runnersCard()).queryByText(NO_RUNNERS_TITLE)).toBeNull();
    expect(screen.queryByRole("list", { name: FIRST_RUN_STEPS_LABEL })).toBeNull();
    expect(screen.queryByRole("button", { name: CREATE_POOL })).toBeNull();
    expect(fleetSeat()).toBeEmptyDOMElement();
  });

  it("does not call a fleet of offline machines a first run", () => {
    const quiet = {
      ...pooledFarm(),
      stats: farmStats({ runnersOnline: { online: 0, total: 1, note: null, offline: null } }),
      runners: [farmRunner({ status: "offline" })],
    };

    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings(quiet)} />);

    expect(grid()).not.toHaveClass("farm__grid--first-run");
    expect(screen.queryByRole("list", { name: FIRST_RUN_STEPS_LABEL })).toBeNull();
  });
});

describe("a first run, moving", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FARM_READ_AT);
  });

  it("moves from the pool to the command when a pool lands — and moves the cards rather than remounting them", async () => {
    answer = fresh(emptyFarm());
    render(<FarmScreen poll={LIVE} reader={ADMIN_READER} readings={farmReadings(emptyFarm())} />);
    await nextPoll();

    const pools = poolsCard();
    const enroll = enrollCard();
    const column = side();

    expect(precedes(pools, enroll)).toBe(true);

    answer = fresh(pooledFarm());
    await nextPoll(10_000);

    expect(precedes(enrollCard(), poolsCard())).toBe(true);
    expect(within(enrollCard()).getByText(STEP_ONE)).toBeInTheDocument();
    expect(enrollCard()).toHaveClass("farm-promoted");
    expect(poolsCard()).not.toHaveClass("farm-promoted");
    // The same elements, in a new order: whatever a card was holding, it still holds.
    expect(poolsCard()).toBe(pools);
    expect(enrollCard()).toBe(enroll);
    expect(side()).toBe(column);
  });

  it("draws a new steps list when a step leaves it — a browser does not renumber the old one", async () => {
    answer = fresh(emptyFarm());
    render(<FarmScreen poll={LIVE} reader={ADMIN_READER} readings={farmReadings(emptyFarm())} />);
    await nextPoll();

    const before = screen.getByRole("list", { name: FIRST_RUN_STEPS_LABEL });

    expect(within(before).getAllByRole("listitem")).toHaveLength(3);

    answer = fresh(pooledFarm());
    await nextPoll(10_000);

    const after = screen.getByRole("list", { name: FIRST_RUN_STEPS_LABEL });

    expect(within(after).getAllByRole("listitem")).toHaveLength(2);
    // Chromium kept `2.` and `3.` on the two items that stayed when the first was removed from
    // this flex `<ol>` (#262's e2e screenshot). jsdom draws no markers, so what can be held here
    // is the cause of the fix: the list is replaced, and a new list counts from one.
    expect(after).not.toBe(before);
    expect(before.isConnected).toBe(false);
  });

  it("ends when the first runner's row arrives: the table, mockup 08's order, no eyebrows", async () => {
    answer = fresh(pooledFarm());
    render(<FarmScreen poll={LIVE} reader={ADMIN_READER} readings={farmReadings(pooledFarm())} />);
    await nextPoll();

    const column = side();
    const runners = runnersCard();

    expect(precedes(column, runners)).toBe(true);

    answer = fresh({
      ...pooledFarm(),
      stats: farmStats({ runnersOnline: { online: 1, total: 1, note: null, offline: null } }),
      runners: [farmRunner()],
    });
    await nextPoll(10_000);

    expect(grid()).not.toHaveClass("farm__grid--first-run");
    expect(precedes(runnersCard(), side())).toBe(true);
    expect(within(runnersCard()).getByRole("grid")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: FIRST_RUN_STEPS_LABEL })).toBeNull();
    expect(screen.queryByText(STEP_ONE)).toBeNull();
    expect(document.querySelectorAll(".farm-promoted")).toHaveLength(0);
    expect(side()).toBe(column);
    expect(runnersCard()).toBe(runners);
  });

  it("keeps the sheet open across the move, and hands its closing focus to the seat's control", async () => {
    answer = fresh(emptyFarm());
    render(<FarmScreen poll={LIVE} reader={ADMIN_READER} readings={farmReadings(emptyFarm())} />);
    await nextPoll();

    const opener = within(runnersCard()).getByRole("button", { name: CREATE_POOL });

    // `fireEvent.click` moves no focus; the overlay returns it to whatever held it.
    opener.focus();
    fireEvent.click(opener);

    answer = fresh(pooledFarm());
    await nextPoll(10_000);

    const sheet = screen.getByRole("dialog", { name: SHEET_TITLE });

    fireEvent.click(within(sheet).getByRole("button", { name: SHEET_CLOSE }));

    // The same control, saying the next step: it never left the document.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(runnersCard()).getByRole("button", { name: GO_TO_ENROLL })).toHaveFocus();
  });

  it("rescues the focus to Configure when the pools card's Create a pool is gone by the time the sheet closes", async () => {
    answer = fresh(emptyFarm());
    render(<FarmScreen poll={LIVE} reader={ADMIN_READER} readings={farmReadings(emptyFarm())} />);
    await nextPoll();

    const opener = within(poolsCard()).getByRole("button", { name: CREATE_POOL });

    opener.focus();
    fireEvent.click(opener);

    answer = fresh(pooledFarm());
    await nextPoll(10_000);

    expect(within(poolsCard()).queryByRole("button", { name: CREATE_POOL })).toBeNull();

    fireEvent.click(
      within(screen.getByRole("dialog", { name: SHEET_TITLE })).getByRole("button", { name: SHEET_CLOSE }),
    );

    expect(within(poolsCard()).getByRole("button", { name: CONFIGURE })).toHaveFocus();
  });

  it("leaves the focus alone when the sheet closes with its opener still there", async () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);

    const opener = screen.getByRole("button", { name: "Pool settings" });

    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: SHEET_TITLE })).getByRole("button", { name: SHEET_CLOSE }),
    );

    expect(opener).toHaveFocus();
  });
});

describe("the read-only note", () => {
  it("names a member's role under the head, and says what each region does about it", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);

    const note = readOnlyNote()!;

    expect(note).toHaveTextContent(farmReadOnlyNote("member").head);
    expect(note).toHaveTextContent(FARM_READ_ONLY_BODY);
    expect(note.querySelector(".farm-readonly__head")).toHaveTextContent("Viewing the build farm as a member.");
    // Under the head, above the grid.
    expect(precedes(screen.getByRole("heading", { level: 1 }), note)).toBe(true);
    expect(precedes(note, grid())).toBe(true);
  });

  it("names a viewer as a viewer", () => {
    render(
      <FarmScreen
        poll={QUIET}
        reader={{ ...MEMBER_READER, role: "viewer" }}
        readings={farmReadings()}
      />,
    );

    expect(readOnlyNote()).toHaveTextContent("Viewing the build farm as a viewer.");
  });

  it("is a note, not a live region — a fact about the reader is not re-announced on a poll", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);

    expect(readOnlyNote()).not.toHaveAttribute("aria-live");
    expect(readOnlyNote()).toHaveAttribute("role", "note");
  });

  it("is not drawn for a reader who may administer", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings()} />);

    expect(readOnlyNote()).toBeNull();
  });

  it("stays over a page that could not be read — the role is known without it", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={failedFarmReadings()} />);

    expect(readOnlyNote()).toHaveTextContent(farmReadOnlyNote("member").head);
  });
});

describe("the offline-heavy strip", () => {
  /**
   * The seeded farm with most of it away.
   *
   * @param online How many are still connected, of the five.
   * @returns The page.
   */
  function thinFarm(online: number): FarmPage {
    return seededFarm({
      stats: farmStats({
        runnersOnline: { online, total: 5, note: "forge-03 offline · 2h", offline: null },
      }),
    });
  }

  it("keeps its seat mounted and empty over mockup 08's 4/5", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);

    expect(fleetSeat()).toBeEmptyDOMElement();
  });

  it("says how much of the fleet is away, above the grid", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings(thinFarm(2))} />);

    const strip = fleetSeat();

    expect(strip.querySelector(".farm-fleet__headline")).toHaveTextContent("3 of 5 runners are offline.");
    expect(strip).toHaveTextContent(FLEET_THIN_BODY);
    expect(precedes(strip, grid())).toBe(true);
    expect(precedes(screen.getByRole("heading", { level: 1 }), strip)).toBe(true);
  });

  it("says a fleet with nothing connected cannot build", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings(thinFarm(0))} />);

    expect(fleetSeat()).toHaveTextContent("All 5 runners are offline.");
    expect(fleetSeat()).toHaveTextContent(FLEET_DOWN_BODY);
  });

  it("arrives and leaves on a poll, in the region that was already there", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FARM_READ_AT);
    answer = fresh(thinFarm(1));
    render(<FarmScreen poll={LIVE} reader={MEMBER_READER} readings={farmReadings()} />);

    const seat = fleetSeat();

    expect(seat).toBeEmptyDOMElement();

    await nextPoll();

    expect(fleetSeat()).toBe(seat);
    expect(seat).toHaveTextContent("4 of 5 runners are offline.");

    answer = fresh(seededFarm());
    await nextPoll(10_000);

    expect(seat).toBeEmptyDOMElement();
  });

  it("is the same sentence for an administrator — the fleet's state is nobody's role", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings(thinFarm(2))} />);

    expect(fleetSeat()).toHaveTextContent("3 of 5 runners are offline.");
  });
});

describe("both themes", () => {
  it("renders every state the same under either palette, so the theme is the sheet's alone", () => {
    const thin = seededFarm({
      stats: farmStats({ runnersOnline: { online: 1, total: 5, note: null, offline: null } }),
    });
    const cases = [
      { reader: ADMIN_READER, readings: farmReadings(emptyFarm()) },
      { reader: ADMIN_READER, readings: farmReadings(pooledFarm()) },
      { reader: MEMBER_READER, readings: farmReadings(emptyFarm()) },
      { reader: MEMBER_READER, readings: farmReadings(pooledFarm()) },
      { reader: MEMBER_READER, readings: farmReadings(thin) },
      { reader: ADMIN_READER, readings: farmReadings(thin) },
      { reader: MEMBER_READER, readings: failedFarmReadings() },
    ];

    for (const { reader, readings } of cases) {
      const [light, dark] = renderInBothPalettes(<FarmScreen poll={QUIET} reader={reader} readings={readings} />);

      expect(maskIds(light!)).toBe(maskIds(dark!));
    }
  });

  it("writes no inline style in any first-run state, so every size is the sheet's rem", () => {
    for (const page of [emptyFarm(), pooledFarm()]) {
      const { container, unmount } = render(
        <FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings(page)} />,
      );

      expect(container.querySelectorAll("[style]")).toHaveLength(0);
      unmount();
    }
  });
});
