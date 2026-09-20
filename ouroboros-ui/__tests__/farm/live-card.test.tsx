import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuildLog, FarmPage } from "@/app/api/farm";
import { requestSummaryRefresh } from "@/app/dashboard/summary-refresh";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmScreen } from "@/app/farm/farm-screen";
import {
  FULL_LOG,
  LIVE_TITLE,
  LIVE_UNREAD,
  LOG_EMPTY,
  LOG_LABEL,
  LOG_SHEET_NOTE,
  LOG_SWEPT,
  NO_BUILDS_RUNNING,
} from "@/app/farm/live";
import type { LogReader } from "@/app/farm/log-poll";
import { EARLIER_OUTPUT, type LogStreamOptions } from "@/app/farm/log-stream";
import { JOB_SHEET_CLOSE } from "@/app/farm/runners";
import { NOT_MEASURED } from "@/app/farm/view";
import type { PollAnswer } from "@/app/poll";

import {
  FARM_READ_AT,
  LIVE_JOB_ID,
  MEMBER_READER,
  buildLog,
  failedFarmReadings,
  farmReadings,
  liveBuild,
  logAnswer,
  seededFarm,
} from "../helpers/farm";
import { layOutLogPanes, scrollPane } from "../helpers/log-pane";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

// The enroll card (#258) and the pools card (#259) reach the service through Server Actions,
// which import the server-only client; this suite presses none of them.
vi.mock("@/app/farm/enroll-actions", () => ({
  mintEnrollCommand: vi.fn(),
  readEnrollmentTokens: vi.fn(),
  revokeEnrollmentToken: vi.fn(),
}));
vi.mock("@/app/farm/pool-actions", () => ({
  createPool: vi.fn(),
  deletePool: vi.fn(),
  updatePool: vi.fn(),
}));

/**
 * The live log card on the farm screen (#261), through the whole stack — the farm's store for
 * *which* build, a log stream for *what it printed*, the pane for how it is drawn — against a
 * fake of AH.5's log resource that serves whatever a build has printed so far from any offset.
 *
 * What the pieces do on their own is `live.test.ts`, `log-stream.test.ts`, `log-buffer.test.ts`
 * and `log-pane.test.tsx`; what is here is the issue's acceptance criteria, as a reader meets
 * them.
 */

const ESC = String.fromCharCode(0x1b);

/** The two cadences, in milliseconds. */
const LOG_MS = 2000;
const FARM_MS = 10_000;

/**
 * The most one page carries. AH.5's is 256 KiB; the fake's is scaled down with everything else
 * here, so that *a log of several pages* is four thousand lines rather than forty thousand and
 * this suite stays quick on a loaded machine. The forty-thousand-line bounds are
 * `log-buffer.test.ts`'s and `log-pane.test.tsx`'s.
 */
const PAGE_BYTES = 16 * 1024;

/** How much of a long log the card joins at, in the cases that are about that. */
const TAIL = 8 * 1024;

/** A four-thousand-line build: 58,890 bytes, four pages. */
const LONG_LINES = 4000;
const LONG_LOG = Array.from({ length: LONG_LINES }, (_, index) => `[${String(index)}/4000] cc\n`).join("");

/** Where each page of {@link LONG_LOG} starts, read whole. */
const LONG_LOG_PAGES = Array.from({ length: Math.ceil(LONG_LOG.length / PAGE_BYTES) }, (_, page) => page * PAGE_BYTES);

/** A log's stored bytes, encoded once per text — a build's log is read many times a case. */
const encoded = new Map<string, Uint8Array>();

/**
 * A text's UTF-8 bytes.
 *
 * @param text The log, as the fake service holds it.
 * @returns Its bytes.
 */
function bytesOf(text: string): Uint8Array {
  const held = encoded.get(text) ?? new TextEncoder().encode(text);
  encoded.set(text, held);

  return held;
}

/** A build's log as the service holds it. Cases append to `text` to make the build print. */
interface FakeLog {
  text: string;
  live: boolean;
  retained?: boolean;
  elisions?: BuildLog["elisions"];
  tail?: BuildLog["tail"];
}

/** Every build's log, by job id. */
let logs: Map<string, FakeLog>;

/** Every log read made, in order. */
let asked: { jobId: string; after: number }[];

/** What a log read answers instead of a page, when set — a service that has stopped answering. */
let logFailure: string | null;

/** What the farm's poll answers. */
let farmAnswer: PollAnswer<FarmPage>;

/** AH.5's log resource, faked: the bytes after an offset, and the job's own `live`. */
const readLog: LogReader = (jobId, after) => {
  asked.push({ jobId, after });

  const log = logs.get(jobId);
  if (logFailure !== null || log === undefined) {
    return Promise.resolve({
      state: "failed",
      reason: logFailure ?? "This workspace has no such build job.",
      pollAfterSeconds: null,
    });
  }

  const stored = bytesOf(log.retained === false ? "" : log.text);
  // A page has a most it carries, as AH.5's has. The fixtures that reach it are ASCII, so a page
  // never ends inside a character.
  const nextOffset = Math.max(after, Math.min(stored.length, after + PAGE_BYTES));

  return Promise.resolve(
    logAnswer(
      buildLog(new TextDecoder().decode(stored.slice(after, nextOffset)), {
        jobId,
        offset: after,
        nextOffset,
        end: Math.max(after, stored.length),
        live: log.live,
        retained: log.retained ?? true,
        elisions: (log.elisions ?? []).filter((mark) => mark.offset >= after && mark.offset < nextOffset),
        tail: log.tail ?? null,
        pollAfter: log.live ? 2 : 15,
      }),
    ),
  );
};

const LOG: LogStreamOptions = { read: readLog, visible: () => true };

/** A farm poll that answers {@link farmAnswer}. */
const FARM: FarmPollOptions = { read: () => Promise.resolve(farmAnswer), visible: () => true };

/** A second build, started after the seeded one. */
const NEWER_JOB_ID = "5eed0400-0000-4000-8000-000000000500";
const NEWER = liveBuild({
  id: NEWER_JOB_ID,
  number: 480,
  title: "Bump the Zephyr SDK",
  runner: "forge-02",
  startedAt: "2026-09-19T14:01:30.000Z",
});

/**
 * A fresh answer from the farm's poll.
 *
 * @param page The page.
 * @returns The answer, at the fleet's cadence.
 */
function farmPage(page: FarmPage): PollAnswer<FarmPage> {
  return { state: "fresh", payload: page, etag: null, pollAfterSeconds: 10 };
}

/**
 * Let time pass, and everything that was waiting on it land.
 *
 * @param ms How long.
 * @returns When React has drawn the result.
 */
async function pass(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Draw the screen over a page with the seeded build live, and let the first log page land.
 *
 * @param page The page the first paint read.
 * @param log The log streams' options.
 * @returns The render result.
 */
async function draw(page: FarmPage = seededFarm({ live: liveBuild() }), log: LogStreamOptions = LOG) {
  farmAnswer = farmPage(page);
  const result = render(
    <FarmScreen log={log} poll={FARM} reader={MEMBER_READER} readings={farmReadings(page)} />,
  );
  await pass();

  return result;
}

/** @returns The live card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${LIVE_TITLE}`) });
}

/** @returns The text of every row the card's pane has drawn. */
function drawn(within_: HTMLElement = card()): string[] {
  return [...within_.querySelectorAll(".log-pane__window .log-pane__line")].map((row) => row.textContent ?? "");
}

/** @returns The card's cursor. */
function cursor(): Element {
  return card().querySelector(".log-pane__cursor")!;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FARM_READ_AT);
  asked = [];
  logFailure = null;
  encoded.clear();
  logs = new Map([[LIVE_JOB_ID, { text: "$ west build -b helios_mainboard app\n[6/7] Linking zephyr.elf …", live: true }]]);
  // jsdom lays nothing out; the cases that scroll a pane need it to have a height.
  layOutLogPanes();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the header", () => {
  it("is the mockup's: runner and job, the building pill, the elapsed time and Full log", async () => {
    await draw();

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent(
      "LIVE — forge-01 · #479 Add OTA rollback on failed checksum",
    );
    expect(within(card()).getByText("building")).toBeInTheDocument();
    expect(card().querySelector(".farm-live__elapsed")).toHaveTextContent("3m 41s");
    expect(within(card()).getByRole("button", { name: FULL_LOG })).toBeEnabled();
  });

  it("ticks the elapsed time once a second while the build runs", async () => {
    await draw();

    await pass(1000);
    expect(card().querySelector(".farm-live__elapsed")).toHaveTextContent("3m 42s");

    await pass(19_000);
    expect(card().querySelector(".farm-live__elapsed")).toHaveTextContent("4m 01s");
  });

  it("takes the mockup's full measure in the grid", async () => {
    await draw();

    expect(card()).toHaveClass("farm-col--12");
  });
});

describe("streaming", () => {
  it("draws what the build has printed, the last line in the accent", async () => {
    await draw();

    expect(drawn()).toEqual(["$ west build -b helios_mainboard app", "[6/7] Linking zephyr.elf …"]);
    expect(card().querySelector(".log-pane__line--last")).toHaveTextContent("[6/7] Linking zephyr.elf …");
  });

  it("appends what arrives by offset: no page is asked for twice and no row is drawn twice", async () => {
    await draw();
    const log = logs.get(LIVE_JOB_ID)!;
    const first = card().querySelectorAll(".log-pane__window .log-pane__line")[0]!;

    log.text += " done\nMemory region  Used Size\n";
    await pass(LOG_MS);
    log.text += "   FLASH:  412 KB\n";
    await pass(LOG_MS);

    expect(drawn()).toEqual([
      "$ west build -b helios_mainboard app",
      "[6/7] Linking zephyr.elf … done",
      "Memory region  Used Size",
      "   FLASH:  412 KB",
    ]);
    // Offsets resume exactly: each ask starts where the last page ended.
    expect(asked.map((ask) => ask.after)).toEqual([0, 65, 96]);
    // And the first row is the node it always was — appended to, never re-painted.
    expect(card().querySelectorAll(".log-pane__window .log-pane__line")[0]).toBe(first);
  });

  it("sanitizes escapes and control characters, and draws markup as the text it is", async () => {
    logs.set(LIVE_JOB_ID, {
      text: `${ESC}[1;31merror:${ESC}[0m bad${String.fromCharCode(0)} thing\n<img src=x onerror=alert(1)>\n`,
      live: true,
    });
    await draw();

    expect(drawn()).toEqual(["error: bad thing", "<img src=x onerror=alert(1)>"]);
    expect(card().querySelector("img")).toBeNull();
    expect(card().textContent).not.toContain(ESC);
  });

  it("draws a hole in the log as a hole, distinct from the output either side", async () => {
    logs.set(LIVE_JOB_ID, {
      text: "[4/7] Building\n[6/7] Linking\n",
      live: true,
      elisions: [{ offset: 15, bytes: 2_481_392, missingChunks: 0 }],
    });
    await draw();

    expect(drawn()).toEqual(["[4/7] Building", "[… 2,481,392 bytes elided]", "[6/7] Linking"]);
    expect(card().querySelectorAll(".log-pane__line--gap")).toHaveLength(1);
    expect(card().querySelector(".log-pane__line--gap")).toHaveTextContent("[… 2,481,392 bytes elided]");
  });

  it("draws what was elided after the stored log's end once, under the text", async () => {
    logs.set(LIVE_JOB_ID, { text: "head\n", live: true, tail: { bytes: 900, missingChunks: 0, capped: true } });
    await draw();
    await pass(LOG_MS);

    expect(drawn()).toEqual(["head", "[… 900 bytes elided — log cap reached]"]);
  });

  it("keeps the DOM bounded across a build of several pages", async () => {
    logs.set(LIVE_JOB_ID, { text: LONG_LOG, live: true });
    await draw(undefined, { ...LOG, tailBytes: TAIL });

    expect(drawn().length).toBeLessThan(150);
    expect(drawn().at(-1)).toBe("[3999/4000] cc");
    // A log that long is joined at its tail rather than paged through: two asks, not four.
    expect(asked.map((ask) => ask.after)).toEqual([0, LONG_LOG.length - TAIL]);
  });

  it("says that earlier output exists above a log it joined at the tail", async () => {
    logs.set(LIVE_JOB_ID, { text: LONG_LOG, live: true });
    await draw(undefined, { ...LOG, tailBytes: TAIL });

    // The note is the first row; the reader scrolls up to it.
    scrollPane(within(card()).getByRole("region", { name: LOG_LABEL }), 0);

    expect(drawn()[0]).toBe(EARLIER_OUTPUT.tail);
    // The line the jump landed in is left out: the first line drawn is a whole one.
    expect(drawn()[1]).toMatch(/^\[\d+\/4000\] cc$/);
  });

  it("says why under the log when a read fails, keeps what it has, and mends", async () => {
    await draw();

    logFailure = "The build log could not be reached.";
    await pass(LOG_MS);
    expect(within(card()).getByText("The build log could not be reached.")).toBeInTheDocument();
    expect(drawn()).toHaveLength(2);

    logFailure = null;
    await pass(LOG_MS);
    expect(within(card()).queryByText("The build log could not be reached.")).toBeNull();
  });
});

describe("the cursor and the terminal state", () => {
  it("does not blink before the log has said the build is live", async () => {
    const page = seededFarm({ live: liveBuild() });
    farmAnswer = farmPage(page);
    // A log read that never answers.
    render(
      <FarmScreen
        log={{ read: () => new Promise(() => {}), visible: () => true }}
        poll={FARM}
        reader={MEMBER_READER}
        readings={farmReadings(page)}
      />,
    );
    await pass();

    expect(cursor()).not.toHaveClass("log-pane__cursor--live");
  });

  it("blinks while live is true — through a minute in which the build prints nothing", async () => {
    await draw();
    expect(cursor()).toHaveClass("log-pane__cursor--live");

    await pass(60_000);

    expect(cursor()).toHaveClass("log-pane__cursor--live");
    expect(within(card()).getByText("building")).toBeInTheDocument();
  });

  it("freezes the cursor, swaps the pill and stops the clock when the build ends", async () => {
    await draw();

    logs.get(LIVE_JOB_ID)!.live = false;
    await pass(LOG_MS);

    expect(cursor()).toBeInTheDocument();
    expect(cursor()).not.toHaveClass("log-pane__cursor--live");
    expect(within(card()).getByText("finished")).toBeInTheDocument();
    expect(within(card()).queryByText("building")).toBeNull();
    // Witnessed two seconds after 3m 41s — and it does not tick again.
    expect(card().querySelector(".farm-live__elapsed")).toHaveTextContent("3m 43s");
    await pass(60_000);
    expect(card().querySelector(".farm-live__elapsed")).toHaveTextContent("3m 43s");
  });

  it("is frozen for a job that was already finished, and claims no elapsed time for it", async () => {
    // The page still names the build — it is up to ten seconds old — but the log knows better.
    logs.get(LIVE_JOB_ID)!.live = false;
    await draw();

    expect(cursor()).not.toHaveClass("log-pane__cursor--live");
    expect(within(card()).getByText("finished")).toBeInTheDocument();
    expect(card().querySelector(".farm-live__elapsed")).toHaveTextContent(NOT_MEASURED);
  });

  it("stops asking once a finished log has been read to its end", async () => {
    logs.get(LIVE_JOB_ID)!.live = false;
    await draw();
    const reads = asked.length;

    await pass(3_600_000);

    expect(asked).toHaveLength(reads);
  });

  it("says so when a build ended having printed nothing, or its log has been swept", async () => {
    logs.set(LIVE_JOB_ID, { text: "", live: false });
    const { unmount } = await draw();
    expect(drawn()).toEqual([LOG_EMPTY]);
    unmount();

    logs.set(LIVE_JOB_ID, { text: "gone", live: false, retained: false });
    await draw();
    expect(drawn()).toEqual([LOG_SWEPT]);
  });
});

describe("which build", () => {
  it("says so when nothing is running", async () => {
    await draw(seededFarm());

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent(LIVE_TITLE);
    expect(within(card()).getByText(NO_BUILDS_RUNNING)).toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: FULL_LOG })).toBeNull();
    expect(asked).toEqual([]);
  });

  it("says the page could not be read rather than that nothing is running", () => {
    render(
      <FarmScreen
        log={LOG}
        poll={{ read: () => new Promise(() => {}), visible: () => true }}
        reader={MEMBER_READER}
        readings={failedFarmReadings()}
      />,
    );

    expect(within(card()).getByText(LIVE_UNREAD)).toBeInTheDocument();
    expect(within(card()).queryByText(NO_BUILDS_RUNNING)).toBeNull();
  });

  it("keeps a build that ended on the card, finished, after the page stops naming it", async () => {
    await draw();

    logs.get(LIVE_JOB_ID)!.live = false;
    farmAnswer = farmPage(seededFarm({ live: null }));
    await pass(FARM_MS);

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent("#479");
    expect(within(card()).getByText("finished")).toBeInTheDocument();
    expect(within(card()).queryByText(NO_BUILDS_RUNNING)).toBeNull();
    expect(drawn()).toHaveLength(2);
  });

  it("moves to a newer build when one starts", async () => {
    await draw();
    logs.set(NEWER_JOB_ID, { text: "$ west update\n", live: true });

    farmAnswer = farmPage(seededFarm({ live: NEWER }));
    await pass(FARM_MS);

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent(
      "LIVE — forge-02 · #480 Bump the Zephyr SDK",
    );
    expect(drawn()).toEqual(["$ west update"]);
    // A new build is read from its own start, not from the last build's offset.
    expect(asked.filter((ask) => ask.jobId === NEWER_JOB_ID)[0]).toEqual({ jobId: NEWER_JOB_ID, after: 0 });
  });

  it("follows the runner selected in the table", async () => {
    const draining = "5eed0400-0000-4000-8000-0000000004f0";
    const page = seededFarm({ live: liveBuild() });
    const bigiron = page.runners.find((runner) => runner.name === "bigiron")!;
    logs.set(bigiron.currentJob!.id, { text: "HIL sweep 14/40\n", live: true });
    await draw(page);

    fireEvent.click(screen.getByRole("row", { name: /bigiron/ }));
    await pass();

    expect(bigiron.currentJob!.id).not.toBe(draining);
    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent(
      `LIVE — bigiron · #${String(bigiron.currentJob!.number)} ${bigiron.currentJob!.title}`,
    );
    expect(drawn()).toEqual(["HIL sweep 14/40"]);
  });

  it("stays where it was when the selected runner is building nothing", async () => {
    await draw();

    fireEvent.click(screen.getByRole("row", { name: /forge-02/ }));
    await pass();

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent("forge-01 · #479");
  });

  it("lets go of what it held when the workspace changes", async () => {
    await draw();
    logs.get(LIVE_JOB_ID)!.live = false;
    await pass(LOG_MS);
    expect(within(card()).getByText("finished")).toBeInTheDocument();

    // The switch is published; the next page is another workspace's, with nothing running.
    farmAnswer = farmPage(seededFarm({ live: null }));
    act(() => requestSummaryRefresh());
    await pass();

    expect(within(card()).getByText(NO_BUILDS_RUNNING)).toBeInTheDocument();
    expect(within(card()).queryByText("finished")).toBeNull();
  });
});

describe("Full log", () => {
  /** Open the sheet from the card's header. */
  async function open(): Promise<HTMLElement> {
    const button = within(card()).getByRole("button", { name: FULL_LOG });
    button.focus();
    fireEvent.click(button);
    await pass();

    return screen.getByRole("dialog", { name: "Build job #479 — full log" });
  }

  it("opens a working sheet: the build, its facts, and its whole log from the first byte", async () => {
    await draw();
    asked = [];

    const sheet = await open();

    expect(within(sheet).getByRole("heading", { level: 2 })).toHaveTextContent("Add OTA rollback on failed checksum");
    expect(within(sheet).getByText("forge-01")).toBeInTheDocument();
    expect(within(sheet).getByText("building")).toBeInTheDocument();
    expect(within(sheet).getByText(LOG_SHEET_NOTE)).toBeInTheDocument();
    expect(drawn(sheet)).toEqual(["$ west build -b helios_mainboard app", "[6/7] Linking zephyr.elf …"]);
    expect(asked[0]).toEqual({ jobId: LIVE_JOB_ID, after: 0 });
    expect(within(sheet).getByRole("region", { name: LOG_LABEL })).toBeInTheDocument();
  });

  it("reads a long log whole, where the card joins it at the tail", async () => {
    logs.set(LIVE_JOB_ID, { text: LONG_LOG, live: false });
    await draw(undefined, { ...LOG, tailBytes: TAIL });
    asked = [];

    const sheet = await open();

    // Every page from the first byte, each starting where the last ended — and at once, not one
    // per interval.
    expect(LONG_LOG_PAGES).toHaveLength(4);
    expect(asked.map((ask) => ask.after)).toEqual(LONG_LOG_PAGES);
    expect(drawn(sheet).at(-1)).toBe("[3999/4000] cc");

    scrollPane(within(sheet).getByRole("region", { name: LOG_LABEL }), 0);
    expect(drawn(sheet)[0]).toBe("[0/4000] cc");
    // Bounded all the same.
    expect(drawn(sheet).length).toBeLessThan(150);
  });

  it("keeps streaming while the build runs, and freezes with it", async () => {
    await draw();
    const sheet = await open();

    logs.get(LIVE_JOB_ID)!.text += " done\n";
    await pass(LOG_MS);
    expect(drawn(sheet).at(-1)).toBe("[6/7] Linking zephyr.elf … done");

    logs.get(LIVE_JOB_ID)!.live = false;
    await pass(LOG_MS);
    expect(within(sheet).getByText("finished")).toBeInTheDocument();
    expect(sheet.querySelector(".log-pane__cursor")).not.toHaveClass("log-pane__cursor--live");
  });

  it("does not dead-end: Close and Escape both leave, and focus goes back to the control", async () => {
    await draw();

    let sheet = await open();
    fireEvent.click(within(sheet).getByRole("button", { name: JOB_SHEET_CLOSE }));
    await pass();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(card()).getByRole("button", { name: FULL_LOG })).toHaveFocus();

    sheet = await open();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await pass();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(card()).getByRole("button", { name: FULL_LOG })).toHaveFocus();
  });

  it("stays on the build it was opened for when the card moves on to a newer one", async () => {
    await draw();
    const sheet = await open();
    logs.set(NEWER_JOB_ID, { text: "$ west update\n", live: true });

    farmAnswer = farmPage(seededFarm({ live: NEWER }));
    await pass(FARM_MS);

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent("#480");
    expect(within(sheet).getByRole("heading", { level: 2 })).toHaveTextContent("Add OTA rollback on failed checksum");
    expect(drawn(sheet)[0]).toBe("$ west build -b helios_mainboard app");
  });

  it("stops reading when it is closed", async () => {
    await draw();
    const sheet = await open();
    fireEvent.click(within(sheet).getByRole("button", { name: JOB_SHEET_CLOSE }));
    await pass();
    asked = [];

    await pass(LOG_MS);

    // The card's stream asks; the sheet's is gone.
    expect(asked).toHaveLength(1);
  });
});

describe("both themes", () => {
  it("renders the same markup under either palette", async () => {
    const page = seededFarm({ live: liveBuild() });
    farmAnswer = farmPage(page);

    const [light, dark] = renderInBothPalettes(
      <FarmScreen log={LOG} poll={FARM} reader={MEMBER_READER} readings={farmReadings(page)} />,
    );
    await pass();

    expect(light).toContain("log-pane__scroller");
    expect(maskIds(light!)).toBe(maskIds(dark!));
  });

  it("writes no inline length: the pane's geometry is three unitless numbers", async () => {
    await draw();

    for (const styled of card().querySelectorAll("[style]")) {
      expect(styled).toHaveClass("log-pane__scroller");
      expect(styled.getAttribute("style")).not.toMatch(/\d(px|rem|em|%)/);
    }
  });
});
