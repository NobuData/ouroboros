import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunControl, RunControlList, RunEventsPage } from "@/app/api/runs";
import type { HeadControl, SubmitOutcome } from "@/app/runs/control-actions";
import type { ControlsPollOptions } from "@/app/runs/controls-poll";
import {
  ENTRIES_LABEL,
  JUMP_TO_LATEST,
  NO_ENTRIES,
  RAW_JSONL,
  STEER_CAPTION,
  STEER_EMPTY,
  STEER_ENDED,
  STEER_LABEL,
  STEER_PLACEHOLDER,
  STEER_READ_ONLY,
  TRANSCRIPT_TITLE,
} from "@/app/runs/transcript";
import { TranscriptCard } from "@/app/runs/transcript-card";
import type { TranscriptStreamOptions } from "@/app/runs/transcript-stream";
import type { PollAnswer } from "@/app/poll";

import { SEEDED_RUN_ID, eventsPage, runControl, seededEntries } from "../helpers/runs";

/**
 * The agent transcript card (#312), rendered against a stubbed tail and queue: the seeded nine,
 * the streaming pill, append without re-render, the scroll lock and its way back, the bounded
 * DOM, a steer's round trip, the closed box's reasons, R9's caption, the elision marker and the
 * stage filter.
 */

// The Server Action is the production sender; every case here passes its own.
vi.mock("@/app/runs/control-actions", () => ({ submitRunControl: vi.fn() }));

/** The pages the tail answers, in order; the last one repeats. */
let pages: RunEventsPage[];

/** What the controls queue holds. */
let queue: RunControl[];

/** The steers the card sent. */
let sent: HeadControl[];

/** What a send answers. */
let reply: (control: HeadControl) => Promise<SubmitOutcome>;

/** The tail — each read takes the next page. */
const STREAM: TranscriptStreamOptions = {
  visible: () => true,
  read: () => {
    const page = pages.length > 1 ? pages.shift()! : pages[0]!;
    return Promise.resolve<PollAnswer<RunEventsPage>>({ state: "fresh", payload: page, etag: null, pollAfterSeconds: page.pollAfter });
  },
};

/** The queue. */
const CONTROLS: ControlsPollOptions = {
  visible: () => true,
  read: () =>
    Promise.resolve<PollAnswer<RunControlList>>({
      state: "fresh",
      payload: { controls: queue },
      etag: null,
      pollAfterSeconds: 2,
    }),
};

/**
 * Draw the card.
 *
 * @param over What to change.
 * @returns The render result, and the filter's clear spy.
 */
function draw(over: { runLive?: boolean; mayContribute?: boolean; stage?: string | null; maxEntries?: number } = {}) {
  const onClearStage = vi.fn();
  const result = render(
    <TranscriptCard
      controlsPoll={CONTROLS}
      mayContribute={over.mayContribute ?? true}
      onClearStage={onClearStage}
      runId={SEEDED_RUN_ID}
      runLive={over.runLive ?? true}
      send={(_id, control) => {
        sent.push(control);
        return reply(control);
      }}
      stage={over.stage ?? null}
      stageLabel={over.stage === "implement" ? "Implement" : null}
      stream={{ ...STREAM, maxEntries: over.maxEntries }}
    />,
  );
  return { ...result, onClearStage };
}

/** Let resolved reads land. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/**
 * Let the clock run.
 *
 * @param seconds How far.
 */
async function advance(seconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  });
}

/** The entries' list items. */
function items(): HTMLElement[] {
  return within(screen.getByRole("region", { name: ENTRIES_LABEL })).queryAllByRole("listitem");
}

/** The well. */
function well(): HTMLElement {
  return screen.getByRole("region", { name: ENTRIES_LABEL });
}

beforeEach(() => {
  vi.useFakeTimers();
  pages = [eventsPage()];
  queue = [];
  sent = [];
  reply = (control) => {
    const row = runControl({ kind: control.kind, state: "pending", hasPayload: true });
    queue = [row, ...queue];
    return Promise.resolve({ ok: true, control: row });
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the card", () => {
  it("is named Agent transcript, streams while live, and links the raw JSONL", async () => {
    draw();
    await settle();

    const card = screen.getByRole("region", { name: TRANSCRIPT_TITLE });
    expect(within(card).getByText("streaming")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: RAW_JSONL })).toHaveAttribute(
      "href",
      `/api/runs/${SEEDED_RUN_ID}/transcript.jsonl`,
    );
  });

  it("goes quiet on a terminal run", async () => {
    pages = [eventsPage({ live: false })];
    draw({ runLive: false });
    await settle();

    expect(screen.queryByText("streaming")).toBeNull();
    expect(document.querySelector(".run-entry__meter--live")).toBeNull();
    expect(document.querySelector(".run-entry__meter")).not.toBeNull();
  });

  it("says so while nothing has been written", async () => {
    pages = [eventsPage({ entries: [], nextAfter: 0 })];
    draw();
    await settle();

    expect(within(well()).getByText(NO_ENTRIES)).toBeInTheDocument();
  });
});

describe("the seeded nine", () => {
  it("are drawn in order, each an article named by its time and chip", async () => {
    draw();
    await settle();

    const chips = items().map((item) => item.querySelector(".run-entry__actor")?.textContent);
    expect(chips).toEqual(["PLAN", "TOOL", "CLAUDE-FABLE-5", "TOOL", "TOOL", "GATE", "CLAUDE-FABLE-5", "TOOL", "TOOL"]);
    expect(within(well()).getAllByRole("article")).toHaveLength(9);
    expect(within(well()).getAllByRole("article")[3]!.getAttribute("aria-label")).toMatch(/, TOOL edit_file$/);
  });

  it("draw the diff, the warn result, the gate and the live meter as the mockup does", async () => {
    draw();
    await settle();

    const [, , , edit, tests, gate, , , live] = items();
    expect(edit!.querySelector(".run-entry__note")).toHaveTextContent("drivers/can/telemetry_buf.c");
    expect([...edit!.querySelectorAll(".run-entry__line")].map((line) => [line.className, line.textContent])).toEqual([
      ["run-entry__line run-entry__line--ctx", "  /* telemetry frame path */"],
      ["run-entry__line run-entry__line--del", "− static struct k_fifo tel_fifo;"],
      ["run-entry__line run-entry__line--add", "+ K_MSGQ_DEFINE(tel_msgq, sizeof(struct tel_frame), CONFIG_TEL_QUEUE_DEPTH, 4);"],
    ]);
    expect(tests!.querySelector(".run-entry__result--warn")).toHaveTextContent("2 passed, 1 flaked → retrying under load profile");
    expect(gate!.querySelector(".run-entry__body--warn")).toHaveTextContent("test flake reproduced — returning to implement (attempt 2) ↺");
    expect(live).toHaveClass("run-entry--live");
    expect(live).toHaveTextContent("running… 47/63 cases");
    const meter = within(live!).getByRole("progressbar");
    expect(meter).toHaveAttribute("aria-valuenow", "74");
    expect(meter).toHaveClass("run-entry__meter--live");
  });
});

describe("streaming", () => {
  it("appends a new page without redrawing what is already there", async () => {
    pages = [eventsPage(), eventsPage({ after: 9, entries: [
      { seq: 10, ts: "2026-09-19T12:13:00.000Z", actor: "tool", toolTag: "run_tests", body: "twister", simulated: false,
        payload: { severity: "ok", result: "63 passed" } },
    ] })];
    draw();
    await settle();
    const first = items()[0];

    await advance(5);

    expect(items()).toHaveLength(10);
    expect(items()[0]).toBe(first);
    expect(items()[9]!.querySelector(".run-entry__result--ok")).toHaveTextContent("63 passed");
    // The newest entry is no longer running, so nothing is live.
    expect(document.querySelector(".run-entry--live")).toBeNull();
  });

  it("announces how many arrived, once per poll, never the entries themselves", async () => {
    pages = [eventsPage(), eventsPage({ after: 9, entries: [
      { seq: 10, ts: "2026-09-19T12:13:00.000Z", actor: "plan", body: "a very long plan that must not be read aloud", simulated: false },
      { seq: 11, ts: "2026-09-19T12:13:01.000Z", actor: "plan", body: "another", simulated: false },
    ] })];
    draw();
    await settle();
    await advance(5);

    const status = screen.getAllByRole("status").find((element) => element.classList.contains("sr-only"))!;
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/^2 new transcript entries$/);
  });

  it("keeps the DOM bounded under a long transcript, and says what left", async () => {
    draw({ maxEntries: 4 });
    await settle();

    expect(items()).toHaveLength(4);
    expect(within(well()).getByText("5 earlier entries are not shown here — Raw JSONL has all of them.")).toBeInTheDocument();
  });
});

describe("the scroll lock", () => {
  /**
   * Give the well a geometry.
   *
   * @param height The content's height.
   */
  function geometry(height: { value: number }): void {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => height.value);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  }

  it("follows the tail, stops when the reader scrolls up, and comes back on Jump to latest", async () => {
    const height = { value: 2000 };
    geometry(height);
    pages = [eventsPage(), eventsPage({ after: 9, entries: [
      { seq: 10, ts: "2026-09-19T12:13:00.000Z", actor: "plan", body: "more", simulated: false },
    ] })];
    draw();
    await settle();

    expect(well().scrollTop).toBe(2000);
    expect(screen.queryByRole("button", { name: JUMP_TO_LATEST })).toBeNull();

    // The reader scrolls up: following stops, and the way back appears.
    well().scrollTop = 600;
    fireEvent.scroll(well());
    const jump = screen.getByRole("button", { name: JUMP_TO_LATEST });

    // New entries land below without moving what is being read.
    height.value = 2400;
    await advance(5);
    expect(items()).toHaveLength(10);
    expect(well().scrollTop).toBe(600);

    fireEvent.click(jump);
    expect(well().scrollTop).toBe(2400);
    expect(screen.queryByRole("button", { name: JUMP_TO_LATEST })).toBeNull();
  });

  it("counts a scroll within a hair of the end as the end", async () => {
    geometry({ value: 2000 });
    draw();
    await settle();

    well().scrollTop = 1490;
    fireEvent.scroll(well());

    expect(screen.queryByRole("button", { name: JUMP_TO_LATEST })).toBeNull();
  });
});

describe("steering", () => {
  /** The steering input. */
  function input(): HTMLInputElement {
    return screen.getByRole("textbox", { name: STEER_LABEL }) as HTMLInputElement;
  }

  /** The Send button. */
  function sendButton(): HTMLElement {
    return screen.getByRole("button", { name: /^Send$|^Sending…$/ });
  }

  it("is labelled, keeps the mockup's placeholder, and captions without Slack", async () => {
    draw();
    await settle();

    expect(input()).toHaveAttribute("placeholder", STEER_PLACEHOLDER);
    expect(input()).toHaveAccessibleDescription(STEER_CAPTION);
    expect(screen.getByRole("region", { name: TRANSCRIPT_TITLE })).not.toHaveTextContent(/slack/i);
  });

  it("will not send nothing", async () => {
    draw();
    await settle();

    expect(sendButton()).toHaveAttribute("title", STEER_EMPTY);
    fireEvent.change(input(), { target: { value: "   " } });
    fireEvent.submit(input().form!);
    await settle();

    expect(sent).toEqual([]);
  });

  it("round-trips: optimistic USER entry → sent → the mirror arrives → acknowledged", async () => {
    let finish: () => void = () => {};
    const text = "prefer a fix inside the ISR; do not touch the test timeouts";
    const base = reply;
    reply = (control) => new Promise((resolve) => (finish = () => void base(control).then(resolve)));
    pages = [
      eventsPage(),
      eventsPage({ after: 9, entries: [
        { seq: 10, ts: "2026-09-19T12:13:00.000Z", actor: "user", stageKey: "implement", attempt: 2, body: text, simulated: false },
      ] }),
    ];
    draw();
    await settle();

    fireEvent.change(input(), { target: { value: `  ${text}  ` } });
    fireEvent.click(sendButton());

    // At once: the reader's own words, drawn as a USER entry with its chip.
    const optimistic = items().at(-1)!;
    expect(optimistic).toHaveClass("run-entry--optimistic");
    expect(optimistic).toHaveTextContent(text);
    expect(optimistic).toHaveTextContent("Steer · sending");
    expect(sendButton()).toHaveAttribute("aria-disabled", "true");

    // Queued: the box clears, and the transcript and the queue are asked at once.
    await act(async () => finish());
    await settle();
    expect(sent).toEqual([{ kind: "steer", payload: text, idempotencyKey: expect.any(String) }]);
    expect(input().value).toBe("");

    // The mirror has arrived: one USER entry, the real one, carrying the chip.
    const users = items().filter((item) => item.querySelector(".run-entry__actor--user") !== null);
    expect(users).toHaveLength(1);
    expect(users[0]).not.toHaveClass("run-entry--optimistic");
    expect(users[0]).toHaveTextContent("Steer · sent");

    // The loop acknowledges.
    queue = [{ ...queue[0]!, state: "acked", detail: "steering applied to attempt 2" }];
    await advance(2);
    const acked = items().at(-1)!;
    expect(acked).toHaveTextContent("Steer · acknowledged");
    expect(within(acked).getByTitle("steering applied to attempt 2")).toBeInTheDocument();
  });

  it("keeps the words and shows the refusal when the service says no", async () => {
    reply = () => Promise.resolve({ ok: false, status: 403, code: "forbidden", reason: "Viewers may not steer." });
    draw();
    await settle();

    fireEvent.change(input(), { target: { value: "try harder" } });
    fireEvent.click(sendButton());
    await settle();

    expect(input().value).toBe("try harder");
    expect(items().at(-1)).toHaveTextContent("Steer · Viewers may not steer.");
  });

  it("is closed, with its reason shown, on a terminal run", async () => {
    pages = [eventsPage({ live: false })];
    draw({ runLive: false });
    await settle();

    expect(input()).toBeDisabled();
    expect(sendButton()).toHaveAttribute("aria-disabled", "true");
    expect(sendButton()).toHaveAttribute("title", STEER_ENDED);
    expect(screen.getByText(STEER_ENDED)).toBeInTheDocument();
    expect(input()).toHaveAccessibleDescription(STEER_ENDED);
  });

  it("is closed to a viewer, and says why", async () => {
    draw({ mayContribute: false });
    await settle();

    expect(input()).toBeDisabled();
    expect(screen.getByText(STEER_READ_ONLY)).toBeInTheDocument();
  });
});

describe("the elision marker", () => {
  it("is drawn apart from content, stating what was refused", async () => {
    pages = [eventsPage({ elided: true, entries: [
      ...seededEntries().slice(0, 2),
      { seq: 3, ts: "2026-09-19T12:05:00.000Z", actor: "system", simulated: false,
        elision: { events: 37, bytes: 421_888, from: "2026-09-19T12:05:00.000Z", to: "2026-09-19T12:09:00.000Z" } },
    ] })];
    draw();
    await settle();

    const marker = items().at(-1)!;
    expect(marker).toHaveClass("run-entry--elision");
    expect(marker.querySelector(".run-entry__actor--system")).toHaveTextContent("SYSTEM");
    expect(marker).toHaveTextContent(/37 entries \(412\.0 KB\) were not kept/);
    expect(items()[0]).not.toHaveClass("run-entry--elision");
  });
});

describe("the stage filter", () => {
  it("keeps the stage's entries, says so, and clears on Show all", async () => {
    const { onClearStage } = draw({ stage: "implement" });
    await settle();

    expect(items()).toHaveLength(7);
    expect(screen.getByText(/Showing Implement only — 7 of 9 entries\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(onClearStage).toHaveBeenCalledOnce();
  });
});
