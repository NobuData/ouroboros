import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalyzerPage, AnalyzerPollOptions } from "@/app/analyzer/analyzer-poll";
import { CHOOSE_TRACKER, DRAFT_ROLE_REASON as DRAFT_TICKET_ROLE_REASON } from "@/app/analyzer/suggestions-view";
import {
  BODY_SOURCE_NOTE,
  DRAFT_LEDE,
  INTAKE_SYNC_NOTE,
  NOTHING_TO_DRAFT,
  NO_EVIDENCE_LINE,
  NO_TICKETS_YET,
  PUSHED_TICK_REASON,
  RETRY_NOTE,
  TICKETS_TITLE,
  TICK_FAILED,
  TRACKER_FIXED_NOTE,
  UNDRAFTED_HEADING,
  UNDRAFTED_NOTE,
  WILL_CARRY_NOTE,
  ticketRows,
} from "@/app/analyzer/tickets-view";
import type { AnalysisTickets } from "@/app/api/analyzer";
import type { PlanningBatch } from "@/app/api/planning";
import {
  DRAFT_ROLE_REASON,
  NOTHING_SELECTED_REASON,
  PUSHING,
  PUSH_ROLE_REASON,
  SOURCES_UNREAD,
  rowPush,
  rowSizing,
  trackerOptions,
} from "@/app/planning/generator";
import type { PollAnswer } from "@/app/poll";
import { resetFocusRepos, setFocusRepo } from "@/app/shell/focus-repo";
import { setNavOrigin } from "@/app/shell/nav-registry";

import {
  ANALYZER_NOW,
  ANALYZER_REPOS,
  ANALYZER_WORKSPACE,
  analyzerPage,
  analyzerReadings,
  freshPage,
} from "../helpers/analyzer";
import { emptySuggestions } from "../helpers/analyzer-suggestions";
import {
  TICKETS_BATCH_ID,
  TICKET_EVIDENCE,
  TICKET_TITLES,
  anotherBatch,
  emptyTickets,
  landed,
  pushReport,
  refused,
  seededBatch,
  seededTickets,
  ticketsWith,
  undraftedTicket,
} from "../helpers/analyzer-tickets";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { SEEDED_GITHUB_ID, seededSources } from "../helpers/sources";

/**
 * The drafted-tickets card (#519) on the analyzer screen, under its store: the seeded card against
 * mockup 18; a tick that is drawn at once, moves the total only with the service's answer and is
 * put back when refused; a push whose rows say what happened to each draft, with a retry that is
 * the same push; the toast that says where the tickets went; the batch's summary once it closes;
 * the suggestions nobody has drafted yet and the dialog that drafts them; every evidence line
 * opening its references; and what a member, and a viewer, may do.
 */

const selectTicket = vi.fn();
const pushTickets = vi.fn();
const draftTickets = vi.fn();

vi.mock("@/app/analyzer/analyzer-actions", () => ({
  startAnalysis: vi.fn(),
  saveAnalyzerSchedule: vi.fn(),
  selectTicket: (...args: unknown[]) => selectTicket(...args),
  pushTickets: (...args: unknown[]) => pushTickets(...args),
  draftTickets: (...args: unknown[]) => draftTickets(...args),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { AnalyzerScreen } = await import("@/app/analyzer/analyzer-screen");
const { TicketItem } = await import("@/app/analyzer/tickets-card");

/** What the poll answers next; reassigned by the cases that move the page along. */
let answer: PollAnswer<AnalyzerPage> | null = null;

/** How often the page has been read. */
const reads = vi.fn();

/** A reader answering {@link answer}, or never while it is `null`. */
const POLL: AnalyzerPollOptions = {
  read: () => {
    reads();

    return answer === null ? new Promise(() => {}) : Promise.resolve(answer);
  },
  visible: () => true,
  now: () => ANALYZER_NOW,
};

/** A page whose drafted-tickets card is the given one. */
function pageWith(tickets: AnalysisTickets, over: Partial<AnalyzerPage> = {}): PollAnswer<AnalyzerPage> {
  return freshPage(analyzerPage({ tickets, ...over }));
}

/** A page whose one batch is the given one. */
function pageOf(batch: PlanningBatch): PollAnswer<AnalyzerPage> {
  return pageWith(ticketsWith(batch));
}

/** The seeded batch with one draft unticked. */
function without(key: string): PlanningBatch {
  return seededBatch((draft) => (draft.localKey === key ? { selected: false } : undefined));
}

/** A draft's issue number in the sandbox — `BA-1` is `#621`. */
function issueOf(key: string): number {
  return 620 + Number(key.slice(3));
}

/**
 * Render the screen and wait for the poll's first page.
 *
 * @param readings The route's readings.
 * @returns The render result.
 */
async function draw(readings = analyzerReadings()) {
  const view = render(<AnalyzerScreen poll={POLL} readings={readings} />);
  if (answer !== null) await screen.findByRole("region", { name: "Analysis summary" });
  await act(async () => {});

  return view;
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: TICKETS_TITLE });
}

/** A drafted row, by its key. */
function row(key: string): HTMLElement {
  const box = within(card()).getByRole("checkbox", { name: `Include ${key}` });

  return box.closest("li")!;
}

/** A row's checkbox. */
function box(key: string): HTMLInputElement {
  return within(card()).getByRole<HTMLInputElement>("checkbox", { name: `Include ${key}` });
}

/** The select-all checkbox. */
function allBox(): HTMLInputElement {
  return within(card()).getByRole<HTMLInputElement>("checkbox", { name: "All drafts" });
}

/** A control of the card, by its name. */
function control(name: string | RegExp): HTMLElement {
  return within(card()).getByRole("button", { name });
}

/** The card's total line. */
function total(): string {
  return card().querySelector(".analyzer-tix__total")?.textContent ?? "";
}

/** The toast, when there is one. */
function toast(): HTMLElement | null {
  return card().querySelector(".analyzer-toast");
}

/** Press a control and let whatever it started settle. */
async function press(element: HTMLElement): Promise<void> {
  fireEvent.click(element);
  await act(async () => {});
}

/** A promise a case resolves when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

beforeEach(() => {
  answer = freshPage();
  for (const stub of [selectTicket, pushTickets, draftTickets, reads]) stub.mockReset();
  setFocusRepo(ANALYZER_WORKSPACE, { id: ANALYZER_REPOS[1]!.id, name: "helios-firmware" });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
  resetFocusRepos();
  setNavOrigin(null);
});

describe("the seeded card, against mockup 18", () => {
  it("opens the side column, under the mockup's title", async () => {
    await draw();

    expect(within(card()).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Drafted tickets — from patterns, not people",
    );
    expect(card().closest(".analyzer__side")).not.toBeNull();
    expect(document.querySelector(".analyzer__side")?.firstElementChild).toBe(card());
    // Beside the main column, not inside it.
    expect(card().closest(".analyzer__main")).toBeNull();
  });

  it("draws the four rows — ticked checkbox, mono key, title, effort chip and evidence line", async () => {
    await draw();

    const expected = [
      ["BA-1", "M"],
      ["BA-2", "XS"],
      ["BA-3", "L"],
      ["BA-4", "S"],
    ] as const;

    expect(within(card()).getAllByRole("checkbox", { name: /^Include / })).toHaveLength(4);

    for (const [key, effort] of expected) {
      const element = row(key);

      expect(box(key)).toBeChecked();
      expect(element.querySelector(".analyzer-tix__key")).toHaveTextContent(key);
      expect(element.querySelector(".analyzer-tix__title")).toHaveTextContent(TICKET_TITLES[key]);
      expect(element.querySelector(".ou-chip--effort")).toHaveTextContent(effort);
      expect(element.querySelector(".analyzer-tix__evidence")).toHaveTextContent(TICKET_EVIDENCE[key]);
    }
  });

  it("keeps the mockup's order within a row: key, title, chip — then the evidence under them", async () => {
    await draw();

    const line = row("BA-2").querySelector(".analyzer-tix__line")!;

    expect([...line.children].map((child) => child.textContent)).toEqual(["BA-2", TICKET_TITLES["BA-2"], "XS"]);
    expect(line.nextElementSibling).toHaveClass("analyzer-tix__evidence");
  });

  it("says `est. total ~1.5 days of loop time` and offers Push 4 tickets to backlog → and Edit drafts", async () => {
    await draw();

    expect(total()).toBe("est. total ~1.5 days of loop time");
    expect(control("Push 4 tickets to backlog")).toHaveTextContent("Push 4 tickets to backlog →");
    expect(control("Push 4 tickets to backlog")).not.toHaveAttribute("aria-disabled");
    expect(within(card()).getByRole("link", { name: "Edit drafts" })).toHaveAttribute(
      "href",
      `/planning?batch=${TICKETS_BATCH_ID}`,
    );
  });

  it("says where the push files them, since the label says only *backlog*", async () => {
    await draw();

    expect(control("Push 4 tickets to backlog")).toHaveAttribute("title", "Files them in GitHub Issues.");
  });

  it("is one group: no caption, no un-drafted section, no toast", async () => {
    await draw();

    expect(card().querySelectorAll(".analyzer-tix__group")).toHaveLength(1);
    expect(card().querySelector(".analyzer-tix__caption")).toBeNull();
    expect(within(card()).queryByText(UNDRAFTED_HEADING)).toBeNull();
    expect(toast()).toBeNull();
    // The seat is there before it has anything to say.
    expect(card().querySelector(".analyzer-toast__seat")).toHaveAttribute("role", "status");
  });

  it("holds the rows' place while the page is unread, and says it is busy", async () => {
    answer = null;
    await draw();

    expect(card()).toHaveAttribute("aria-busy", "true");
    expect(card().querySelector(".analyzer-tix__skeleton")).not.toBeNull();
    expect(within(card()).queryAllByRole("checkbox")).toHaveLength(0);
  });
});

describe("selection", () => {
  it("draws a tick at once and moves the count with it — the total waits for the service", async () => {
    const answered = deferred<unknown>();
    selectTicket.mockReturnValue(answered.promise);
    await draw();

    await press(box("BA-3"));

    expect(selectTicket).toHaveBeenCalledExactlyOnceWith(TICKETS_BATCH_ID, "BA-3", false);
    expect(box("BA-3")).not.toBeChecked();
    expect(control("Push 3 tickets to backlog")).toBeInTheDocument();
    // No arithmetic in the browser: the total is still the service's last answer.
    expect(total()).toBe("est. total ~1.5 days of loop time");

    await act(async () => {
      answered.resolve({ ok: true, batch: without("BA-3") });
    });

    expect(total()).toBe("est. total ~0.8 days of loop time");
    expect(box("BA-3")).not.toBeChecked();
    expect(control("Push 3 tickets to backlog")).toBeInTheDocument();
  });

  it("asks for the page again once a tick is saved, and keeps what the service answered meanwhile", async () => {
    selectTicket.mockResolvedValue({ ok: true, batch: without("BA-3") });
    await draw();
    const before = reads.mock.calls.length;

    await press(box("BA-3"));

    expect(reads.mock.calls.length).toBeGreaterThan(before);
    // The poll answered the page it had — the same payload — so the tick's answer still stands.
    expect(box("BA-3")).not.toBeChecked();
    expect(total()).toBe("est. total ~0.8 days of loop time");
  });

  it("gives way to a newer page: what the poll delivers after the write is what is drawn", async () => {
    const answered = deferred<unknown>();
    selectTicket.mockReturnValue(answered.promise);
    await draw();

    await press(box("BA-3"));
    // Meanwhile somebody else unticked BA-1 too; the page read after the write carries both.
    answer = pageOf(seededBatch((draft) => (draft.localKey === "BA-3" || draft.localKey === "BA-1" ? { selected: false } : undefined)));
    await act(async () => {
      answered.resolve({ ok: true, batch: without("BA-3") });
    });
    await act(async () => {});

    expect(box("BA-1")).not.toBeChecked();
    expect(box("BA-3")).not.toBeChecked();
    expect(control("Push 2 tickets to backlog")).toBeInTheDocument();
  });

  it("puts a refused tick back, and says why", async () => {
    selectTicket.mockResolvedValue({ ok: false, reason: `${TICK_FAILED} This batch is being pushed.` });
    await draw();

    await press(box("BA-3"));

    expect(box("BA-3")).toBeChecked();
    expect(control("Push 4 tickets to backlog")).toBeInTheDocument();
    expect(within(card()).getByRole("alert")).toHaveTextContent(`${TICK_FAILED} This batch is being pushed.`);
    expect(total()).toBe("est. total ~1.5 days of loop time");
  });

  it("clears the refusal on the next tick", async () => {
    selectTicket.mockResolvedValueOnce({ ok: false, reason: TICK_FAILED });
    selectTicket.mockResolvedValueOnce({ ok: true, batch: without("BA-2") });
    await draw();

    await press(box("BA-3"));
    expect(within(card()).getByRole("alert")).toBeInTheDocument();

    await press(box("BA-2"));
    expect(within(card()).queryByRole("alert")).toBeNull();
    expect(box("BA-2")).not.toBeChecked();
  });

  it("ticks a row back on", async () => {
    answer = pageOf(without("BA-3"));
    selectTicket.mockResolvedValue({ ok: true, batch: seededBatch() });
    await draw();

    expect(box("BA-3")).not.toBeChecked();
    expect(control("Push 3 tickets to backlog")).toBeInTheDocument();

    await press(box("BA-3"));

    expect(selectTicket).toHaveBeenCalledExactlyOnceWith(TICKETS_BATCH_ID, "BA-3", true);
    expect(box("BA-3")).toBeChecked();
    expect(total()).toBe("est. total ~1.5 days of loop time");
  });

  it("leaves nothing to push with nothing ticked — the button says so, and the total says nothing is selected", async () => {
    answer = pageOf(seededBatch(() => ({ selected: false })));
    await draw();

    const push = control("Push 0 tickets to backlog");

    expect(push).toHaveAttribute("aria-disabled", "true");
    expect(push).toHaveAttribute("title", NOTHING_SELECTED_REASON);
    expect(total()).toBe("est. total — nothing selected");

    await press(push);
    expect(pushTickets).not.toHaveBeenCalled();
  });
});

describe("select all", () => {
  it("is checked with every row ticked, and unticks them all — one request per draft, in order", async () => {
    let batch = seededBatch();
    selectTicket.mockImplementation((_batch: string, key: string, selected: boolean) => {
      const previous = batch;
      batch = seededBatch((draft) =>
        draft.localKey === key ? { selected } : { selected: previous.drafts.find((entry) => entry.id === draft.id)!.selected },
      );

      return Promise.resolve({ ok: true, batch });
    });
    await draw();

    expect(allBox()).toBeChecked();
    expect(allBox().indeterminate).toBe(false);

    await press(allBox());

    expect(selectTicket.mock.calls).toEqual([
      [TICKETS_BATCH_ID, "BA-1", false],
      [TICKETS_BATCH_ID, "BA-2", false],
      [TICKETS_BATCH_ID, "BA-3", false],
      [TICKETS_BATCH_ID, "BA-4", false],
    ]);
    for (const key of ["BA-1", "BA-2", "BA-3", "BA-4"]) expect(box(key)).not.toBeChecked();
    expect(allBox()).not.toBeChecked();
    expect(total()).toBe("est. total — nothing selected");
  });

  it("is mixed with some ticked, and a press ticks only the rows that are not", async () => {
    answer = pageOf(without("BA-3"));
    selectTicket.mockResolvedValue({ ok: true, batch: seededBatch() });
    await draw();

    expect(allBox().indeterminate).toBe(true);
    expect(allBox()).not.toBeChecked();

    await press(allBox());

    expect(selectTicket.mock.calls).toEqual([[TICKETS_BATCH_ID, "BA-3", true]]);
    expect(allBox()).toBeChecked();
    expect(allBox().indeterminate).toBe(false);
  });

  it("stops at the first refusal and puts back what was not saved", async () => {
    selectTicket.mockResolvedValueOnce({ ok: true, batch: without("BA-1") });
    selectTicket.mockResolvedValueOnce({ ok: false, reason: `${TICK_FAILED} The service failed.` });
    await draw();

    await press(allBox());

    expect(selectTicket).toHaveBeenCalledTimes(2);
    expect(box("BA-1")).not.toBeChecked();
    for (const key of ["BA-2", "BA-3", "BA-4"]) expect(box(key)).toBeChecked();
    expect(within(card()).getByRole("alert")).toHaveTextContent("The service failed.");
    expect(control("Push 3 tickets to backlog")).toBeInTheDocument();
  });
});

describe("pushing", () => {
  /** The batch after a push that landed everything but one. */
  const partial = () =>
    seededBatch((draft) => (draft.localKey === "BA-2" ? refused("GitHub answered 502.") : landed(issueOf(draft.localKey))), {
      status: "pushing",
    });

  /** The batch once everything has landed. */
  const pushed = () => seededBatch((draft) => landed(issueOf(draft.localKey)), { status: "pushed" });

  it("pushes the batch, and says so while it runs — each ticked row `pushing…`, nothing else pressable", async () => {
    const answered = deferred<unknown>();
    pushTickets.mockReturnValue(answered.promise);
    await draw();

    await press(control("Push 4 tickets to backlog"));

    expect(pushTickets).toHaveBeenCalledExactlyOnceWith(TICKETS_BATCH_ID);
    expect(within(card()).getByText(PUSHING)).toHaveAttribute("role", "status");
    for (const key of ["BA-1", "BA-2", "BA-3", "BA-4"]) {
      expect(row(key)).toHaveTextContent("pushing…");
      expect(box(key)).toBeDisabled();
    }
    expect(allBox()).toBeDisabled();
    // A second press while it runs does nothing.
    await press(control("Push 4 tickets to backlog"));
    expect(pushTickets).toHaveBeenCalledTimes(1);

    await act(async () => {
      answered.resolve({ ok: true, report: pushReport(pushed()), batch: pushed() });
    });
  });

  it("reads the page every two seconds while it runs, so each row's state appears as it lands", async () => {
    pushTickets.mockReturnValue(new Promise(() => {}));
    await draw();
    vi.useFakeTimers();

    fireEvent.click(control("Push 4 tickets to backlog"));
    await act(async () => {});
    const before = reads.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(reads.mock.calls.length).toBe(before + 1);

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(reads.mock.calls.length).toBe(before + 3);
  });

  it("does not deselected drafts the favour: the row somebody unticked is not marked pushing", async () => {
    answer = pageOf(without("BA-3"));
    pushTickets.mockReturnValue(new Promise(() => {}));
    await draw();

    await press(control("Push 3 tickets to backlog"));

    expect(row("BA-3")).not.toHaveTextContent("pushing…");
    expect(row("BA-1")).toHaveTextContent("pushing…");
  });

  it("shows each draft's outcome: a tracker link where it landed, the reason and a Retry where it did not", async () => {
    pushTickets.mockResolvedValue({ ok: true, report: pushReport(partial()), batch: partial() });
    await draw();

    await press(control("Push 4 tickets to backlog"));

    const link = within(row("BA-1")).getByRole("link", { name: "pushed ✓ #621" });

    expect(link).toHaveAttribute("href", "https://github.com/acme-robotics/helios-firmware/issues/621");
    expect(link).toHaveAttribute("target", "_blank");
    expect(row("BA-2")).toHaveTextContent("failed — GitHub answered 502.");
    expect(within(row("BA-2")).getByRole("button", { name: "Retry — BA-2 did not land" })).toHaveAttribute(
      "title",
      RETRY_NOTE,
    );
    // The footer offers the same push, in the planning page's words.
    expect(control("Resume push")).not.toHaveAttribute("aria-disabled");
    // A pushed draft is not something to select any more.
    expect(box("BA-1")).toBeDisabled();
    expect(box("BA-1")).toHaveAttribute("title", PUSHED_TICK_REASON);
    expect(box("BA-2")).not.toBeDisabled();
  });

  it("announces the outcome, with the way to Issues and why the tickets may not be there yet", async () => {
    pushTickets.mockResolvedValue({ ok: true, report: pushReport(partial()), batch: partial() });
    await draw();

    await press(control("Push 4 tickets to backlog"));

    expect(toast()).toHaveTextContent("Pushed 3 tickets to GitHub; 1 ticket did not land — Resume push re-runs only those.");
    expect(toast()).toHaveTextContent(INTAKE_SYNC_NOTE);
    expect(within(toast()!).getByRole("link", { name: "Open Issues" })).toHaveAttribute("href", "/issues");
    expect(toast()!.closest('[role="status"]')).toHaveClass("analyzer-toast__seat");
  });

  it("retries from the failed row — the same push, which files only what did not land", async () => {
    pushTickets.mockResolvedValueOnce({ ok: true, report: pushReport(partial()), batch: partial() });
    pushTickets.mockResolvedValueOnce({
      ok: true,
      report: pushReport(pushed(), { pushedThisRun: 1 }),
      batch: pushed(),
    });
    await draw();

    await press(control("Push 4 tickets to backlog"));
    await press(within(row("BA-2")).getByRole("button", { name: /^Retry/ }));

    expect(pushTickets).toHaveBeenCalledTimes(2);
    expect(pushTickets).toHaveBeenLastCalledWith(TICKETS_BATCH_ID);
    expect(toast()).toHaveTextContent("Pushed 1 ticket to GitHub.");
  });

  it("gives way to a summary once the batch is closed — what reached the tracker, and the way to the batch", async () => {
    pushTickets.mockResolvedValue({ ok: true, report: pushReport(pushed()), batch: pushed() });
    await draw();

    await press(control("Push 4 tickets to backlog"));

    expect(card()).toHaveTextContent("All 4 tickets are in GitHub.");
    expect(within(card()).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(card()).queryByRole("button", { name: /^Push/ })).toBeNull();
    for (const key of ["BA-1", "BA-2", "BA-3", "BA-4"]) {
      expect(within(card()).getByRole("link", { name: `#${issueOf(key)}` })).toHaveAttribute(
        "href",
        `https://github.com/acme-robotics/helios-firmware/issues/${issueOf(key)}`,
      );
    }
    expect(within(card()).getByRole("link", { name: "Open the batch" })).toHaveAttribute(
      "href",
      `/planning?batch=${TICKETS_BATCH_ID}`,
    );
    // The toast outlives the rows that were pushed.
    expect(toast()).toHaveTextContent("Pushed 4 tickets to GitHub.");
  });

  it("pushes exactly what is ticked: with BA-3 unticked three land, and the summary says what was left out", async () => {
    const after = seededBatch((draft) => (draft.localKey === "BA-3" ? { selected: false } : landed(issueOf(draft.localKey))), {
      status: "pushed",
    });
    answer = pageOf(without("BA-3"));
    pushTickets.mockResolvedValue({ ok: true, report: pushReport(after), batch: after });
    await draw();

    await press(control("Push 3 tickets to backlog"));

    expect(toast()).toHaveTextContent("Pushed 3 tickets to GitHub.");
    expect(card()).toHaveTextContent("3 of 4 drafts were pushed to GitHub. BA-3 was left out.");
    expect(within(card()).queryByRole("link", { name: "#623" })).toBeNull();
    expect(within(card()).getAllByRole("link", { name: /^#\d+$/ })).toHaveLength(3);
  });

  it("says why a push that could not be made was not — and announces nothing", async () => {
    pushTickets.mockResolvedValue({ ok: false, reason: "The push could not be made. A push of this batch is already running." });
    await draw();
    const before = reads.mock.calls.length;

    await press(control("Push 4 tickets to backlog"));

    expect(within(card()).getByRole("alert")).toHaveTextContent("A push of this batch is already running.");
    expect(toast()).toBeNull();
    // The page is read again: something else may have moved the batch.
    expect(reads.mock.calls.length).toBeGreaterThan(before);
    expect(control("Push 4 tickets to backlog")).not.toHaveAttribute("aria-disabled");
  });

  it("reads the page again when the push answered and the batch could not be re-read", async () => {
    pushTickets.mockResolvedValue({ ok: true, report: pushReport(pushed()), batch: null });
    await draw();
    answer = pageOf(pushed());

    await press(control("Push 4 tickets to backlog"));
    await act(async () => {});

    expect(card()).toHaveTextContent("All 4 tickets are in GitHub.");
  });

  it("keeps the toast until it is dismissed", async () => {
    pushTickets.mockResolvedValue({ ok: true, report: pushReport(pushed()), batch: pushed() });
    await draw();

    await press(control("Push 4 tickets to backlog"));
    expect(toast()).not.toBeNull();

    await press(within(toast()!).getByRole("button", { name: "Dismiss" }));
    expect(toast()).toBeNull();
  });

  it("offers a push to a tracker that cannot be written to as an inert control, with why", async () => {
    await draw(
      analyzerReadings({
        trackers: {
          ok: true,
          value: trackerOptions(seededSources(), { ok: false, reason: "The catalog could not be read." }),
        },
      }),
    );

    const push = control("Push 4 tickets to backlog");

    expect(push).toHaveAttribute("aria-disabled", "true");
    expect(push.getAttribute("title")).toMatch(/could not be read/);
  });

  it("says the trackers could not be read, rather than that nobody connected one", async () => {
    await draw(analyzerReadings({ trackers: { ok: false, reason: `${SOURCES_UNREAD} The service failed.` } }));

    const push = control("Push 4 tickets to backlog");

    expect(push).toHaveAttribute("aria-disabled", "true");
    expect(push).toHaveAttribute("title", `${SOURCES_UNREAD} The service failed.`);
    await press(push);
    expect(pushTickets).not.toHaveBeenCalled();
  });

  it("says a batch whose tracker is no longer among the workspace's cannot be pushed", async () => {
    answer = pageOf(seededBatch(undefined, { targetSourceId: "5eed001a-0000-4000-8000-00000000dead" }));
    await draw();

    const push = control("Push 4 tickets to backlog");

    expect(push).toHaveAttribute("aria-disabled", "true");
    expect(push.getAttribute("title")).toMatch(/not connected/);
  });

  it("moves focus to the summary when the push closes the batch — its own button is gone", async () => {
    pushTickets.mockResolvedValue({ ok: true, report: pushReport(pushed()), batch: pushed() });
    await draw();

    const push = control("Push 4 tickets to backlog");
    push.focus();
    await press(push);

    const group = within(card()).getByRole("group", { name: "Drafted Oct 2 for GitHub Issues" });

    expect(group).toHaveTextContent("All 4 tickets are in GitHub.");
    expect(document.activeElement).toBe(group);
  });

  it("does not take focus for a batch that was already closed when the page was read", async () => {
    answer = pageOf(pushed());
    await draw();

    expect(document.activeElement).not.toBe(within(card()).getByRole("group"));
  });
});

describe("a batch already closed when the page is read", () => {
  it("draws the summary, not an empty box and not rows nothing can be done with", async () => {
    answer = pageOf(
      seededBatch((draft) => (draft.localKey === "BA-3" ? { selected: false } : landed(issueOf(draft.localKey))), {
        status: "pushed",
      }),
    );
    await draw();

    expect(card()).toHaveTextContent("3 of 4 drafts were pushed to GitHub. BA-3 was left out.");
    expect(within(card()).getByRole("link", { name: "Open the batch" })).toBeInTheDocument();
    expect(within(card()).queryByRole("link", { name: "Edit drafts" })).toBeNull();
    expect(card().querySelector(".ou-empty")).toBeNull();
  });
});

describe("sizing", () => {
  it("says `sizing…` where the estimator has not answered, counts what is sized, and marks the total `so far`", async () => {
    answer = pageOf(seededBatch((draft) => (draft.localKey === "BA-2" ? { estimate: null } : undefined)));
    await draw();

    expect(row("BA-2")).toHaveTextContent("sizing…");
    expect(row("BA-2").querySelector(".ou-chip--effort")).toBeNull();
    expect(card()).toHaveTextContent("sized 3 of 4");
    expect(total()).toBe("est. total ~1.4 days of loop time so far");
  });

  it("says `unsized` for a batch nothing will size", async () => {
    answer = pageOf(seededBatch(() => ({ estimate: null }), { autoSize: false }));
    await draw();

    expect(row("BA-1")).toHaveTextContent("unsized");
  });
});

describe("the evidence line", () => {
  it("opens the references behind it, each a link to the surface it resolves on", async () => {
    await draw();

    await press(control(`Evidence for BA-3: ${TICKET_EVIDENCE["BA-3"]}`));

    const sheet = screen.getByRole("dialog");

    expect(sheet).toHaveAccessibleName(`Evidence · ${TICKET_TITLES["BA-3"]}`);
    expect(within(sheet).getByRole("heading", { level: 2 })).toHaveTextContent(TICKET_TITLES["BA-3"]);
    expect(sheet).toHaveTextContent("Evidence · BA-3");
    expect(sheet.querySelector(".analyzer-tixev__line")).toHaveTextContent(TICKET_EVIDENCE["BA-3"]);
    // Three waivers, each opening on its loop's test results.
    const links = within(sheet).getAllByRole("link");

    expect(links).toHaveLength(3);
    for (const link of links) expect(link.getAttribute("href")).toMatch(/^\/runs\/[0-9a-f-]+\/tests/);
    expect(sheet).toHaveTextContent(BODY_SOURCE_NOTE);
  });

  it("says how many references there are when the page carries only the first of them", async () => {
    await draw();

    await press(control(`Evidence for BA-2: ${TICKET_EVIDENCE["BA-2"]}`));

    expect(screen.getByRole("dialog")).toHaveTextContent("3 of 118 references listed.");
  });

  it("is a note, not a control, on a draft whose body states no evidence", async () => {
    answer = pageWith(
      seededTickets((tickets) => {
        tickets.batches[0]!.drafts[0] = { localKey: "BA-1", evidenceLine: null, evidence: [], evidenceTotal: 0 };
      }),
    );
    await draw();

    expect(row("BA-1")).toHaveTextContent(NO_EVIDENCE_LINE);
    expect(within(row("BA-1")).queryByRole("button", { name: /^Evidence for/ })).toBeNull();
    expect(within(row("BA-2")).getByRole("button", { name: /^Evidence for BA-2/ })).toBeInTheDocument();
  });

  it("closes by itself when its row leaves the card", async () => {
    await draw();
    await press(control(`Evidence for BA-3: ${TICKET_EVIDENCE["BA-3"]}`));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    answer = pageWith(emptyTickets());
    selectTicket.mockResolvedValue({ ok: true, batch: seededBatch() });
    // Anything that reads the page again: a tick does.
    fireEvent.click(box("BA-1"));
    await act(async () => {});
    await act(async () => {});

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("suggestions nobody has drafted yet", () => {
  const first = undraftedTicket();
  const second = undraftedTicket({
    id: "5eed0067-0000-4000-8000-000000000026",
    title: "Quarantine the flaky radio soak test",
    evidenceLine: "14 of 60 nightly runs failed on rf_soak with no code change between them",
    confidence: 61,
  });

  /** A card with two un-drafted suggestions and no batch. */
  const undraftedOnly = () =>
    seededTickets((tickets) => {
      tickets.batches = [];
      tickets.undrafted = [first, second];
    });

  it("lists each with its title, its confidence and its evidence line — no key, no checkbox, no chip", async () => {
    answer = pageWith(undraftedOnly());
    await draw();

    expect(card()).toHaveTextContent(UNDRAFTED_HEADING);
    expect(card()).toHaveTextContent(UNDRAFTED_NOTE);
    expect(within(card()).queryAllByRole("checkbox")).toHaveLength(0);
    expect(card().querySelector(".ou-chip--effort")).toBeNull();

    const rows = within(card()).getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(first.title);
    expect(rows[0]).toHaveTextContent("conf 77%");
    expect(rows[1]).toHaveTextContent("conf 61%");
    expect(within(rows[1]!).getByRole("button", { name: `Evidence for ${second.title}: ${second.evidenceLine}` })).toBeInTheDocument();
  });

  it("opens an un-drafted suggestion's evidence, as what its draft will carry", async () => {
    answer = pageWith(undraftedOnly());
    await draw();

    await press(control(`Evidence for ${first.title}: ${first.evidenceLine}`));

    const sheet = screen.getByRole("dialog");

    expect(sheet).toHaveTextContent(WILL_CARRY_NOTE);
    expect(sheet).toHaveTextContent("2 of 9 references listed.");
    expect(sheet).not.toHaveTextContent(BODY_SOURCE_NOTE);
  });

  it("drafts them for the chosen tracker, most confident first, and shows the batch the page then reads", async () => {
    answer = pageWith(undraftedOnly());
    draftTickets.mockImplementation(() => {
      // By the time the draft answers, the page has the batch and nothing is un-drafted.
      answer = freshPage();

      return Promise.resolve({ ok: true, batch: seededBatch() });
    });
    await draw();

    await press(control("Draft 2 tickets"));

    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Draft 2 tickets from the analyzer's findings",
    );
    expect(dialog).toHaveTextContent(DRAFT_LEDE);
    expect(dialog).toHaveTextContent(TRACKER_FIXED_NOTE);
    expect(dialog).toHaveTextContent(first.title);
    expect(dialog).toHaveTextContent(second.evidenceLine);
    // The planning page's own segment, opened on the first tracker that can be written to.
    expect(within(dialog).getByRole("button", { name: /GitHub Issues/ })).toHaveAttribute("aria-pressed", "true");

    await press(within(dialog).getByRole("button", { name: "Draft 2 tickets" }));
    await act(async () => {});

    expect(draftTickets).toHaveBeenCalledExactlyOnceWith([first.id, second.id], SEEDED_GITHUB_ID);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(card()).queryByText(UNDRAFTED_HEADING)).toBeNull();
    expect(box("BA-1")).toBeChecked();
  });

  it("keeps a refused draft in the dialog, in the service's words", async () => {
    answer = pageWith(undraftedOnly());
    draftTickets.mockResolvedValue({ ok: false, reason: "The tickets could not be drafted. That tracker cannot be written to." });
    await draw();

    await press(control("Draft 2 tickets"));
    await press(within(screen.getByRole("dialog")).getByRole("button", { name: "Draft 2 tickets" }));

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("That tracker cannot be written to.");
    expect(card()).toHaveTextContent(UNDRAFTED_HEADING);
  });

  it("drafts nothing when the dialog is backed out of", async () => {
    answer = pageWith(undraftedOnly());
    await draw();

    await press(control("Draft 2 tickets"));
    await press(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(draftTickets).not.toHaveBeenCalled();
  });

  it("cannot draft with no tracker to draft for — the confirm says to choose one", async () => {
    answer = pageWith(undraftedOnly());
    await draw(
      analyzerReadings({
        trackers: {
          ok: true,
          value: trackerOptions(seededSources(), { ok: false, reason: "The catalog could not be read." }),
        },
      }),
    );

    await press(control("Draft 2 tickets"));

    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Draft 2 tickets" });

    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("title", CHOOSE_TRACKER);
    await press(confirm);
    expect(draftTickets).not.toHaveBeenCalled();
  });

  it("says so when the workspace's trackers could not be read", async () => {
    answer = pageWith(undraftedOnly());
    await draw(analyzerReadings({ trackers: { ok: false, reason: `${SOURCES_UNREAD} The service failed.` } }));

    await press(control("Draft 2 tickets"));

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(SOURCES_UNREAD);
  });

  it("stands above the batches, each group captioned once there is more than one", async () => {
    answer = pageWith(
      seededTickets((tickets) => {
        tickets.undrafted = [first];
        tickets.batches.push(anotherBatch("5eed006a-0000-4000-8000-000000000009", "2026-09-25T09:00:00.000Z"));
      }),
    );
    await draw();

    const captions = [...card().querySelectorAll(".analyzer-tix__caption")].map((caption) => caption.textContent);

    expect(captions).toEqual([UNDRAFTED_HEADING, "Drafted Oct 2 for GitHub Issues", "Drafted Sep 25 for GitHub Issues"]);
    expect(card().querySelectorAll(".analyzer-tix__group")).toHaveLength(3);
    // Two batches both hold a BA-1; each group has its own controls.
    expect(within(card()).getAllByRole("checkbox", { name: "Include BA-1" })).toHaveLength(2);
    expect(within(card()).getAllByRole("button", { name: "Push 4 tickets to backlog" })).toHaveLength(2);
    expect(within(card()).getAllByRole("link", { name: "Edit drafts" }).map((link) => link.getAttribute("href"))).toEqual([
      `/planning?batch=${TICKETS_BATCH_ID}`,
      "/planning?batch=5eed006a-0000-4000-8000-000000000009",
    ]);
  });

  it("pushes only the group whose button was pressed", async () => {
    const other = "5eed006a-0000-4000-8000-000000000009";
    answer = pageWith(
      seededTickets((tickets) => {
        tickets.batches.push(anotherBatch(other, "2026-09-25T09:00:00.000Z"));
      }),
    );
    pushTickets.mockReturnValue(new Promise(() => {}));
    await draw();

    await press(within(card()).getAllByRole("button", { name: "Push 4 tickets to backlog" })[1]!);

    expect(pushTickets).toHaveBeenCalledExactlyOnceWith(other);
    // The first group is not pushing: its rows may still be ticked.
    expect(within(card()).getAllByRole("checkbox", { name: "Include BA-1" })[0]).not.toBeDisabled();
    expect(within(card()).getAllByRole("checkbox", { name: "Include BA-1" })[1]).toBeDisabled();
  });
});

describe("nothing to show", () => {
  it("says an analysis has yet to compose anything, rather than drawing an empty box", async () => {
    answer = pageWith(emptyTickets(), { suggestions: emptySuggestions() });
    await draw();

    expect(card()).toHaveTextContent(NO_TICKETS_YET.title);
    expect(card()).toHaveTextContent(NO_TICKETS_YET.note);
    expect(card().querySelector(".analyzer-tix__group")).toBeNull();
  });

  it("says the last analysis found nothing to draft, once one has run", async () => {
    answer = pageWith(emptyTickets());
    await draw();

    expect(card()).toHaveTextContent(NOTHING_TO_DRAFT.title);
    expect(card()).toHaveTextContent(NOTHING_TO_DRAFT.note);
  });
});

describe("who may do what", () => {
  it("lets a member tick and untick, and tells them why they cannot push", async () => {
    selectTicket.mockResolvedValue({ ok: true, batch: without("BA-3") });
    await draw(analyzerReadings({ mayAdminister: false, mayDismiss: true, mayContribute: true }));

    expect(box("BA-3")).not.toBeDisabled();
    await press(box("BA-3"));
    expect(selectTicket).toHaveBeenCalledTimes(1);

    const push = control("Push 3 tickets to backlog");

    expect(push).toHaveAttribute("aria-disabled", "true");
    expect(push).toHaveAttribute("title", PUSH_ROLE_REASON);
    await press(push);
    expect(pushTickets).not.toHaveBeenCalled();
    // Edit drafts is a link to the planning page, which gates its own controls.
    expect(within(card()).getByRole("link", { name: "Edit drafts" })).toBeInTheDocument();
  });

  it("lets a viewer read everything and change nothing, each control saying why", async () => {
    await draw(analyzerReadings({ mayAdminister: false, mayDismiss: false, mayContribute: false }));

    for (const key of ["BA-1", "BA-2", "BA-3", "BA-4"]) {
      expect(box(key)).toBeDisabled();
      expect(box(key)).toHaveAttribute("title", DRAFT_ROLE_REASON);
    }
    expect(allBox()).toBeDisabled();
    expect(control("Push 4 tickets to backlog")).toHaveAttribute("title", PUSH_ROLE_REASON);
    // The evidence is theirs to read.
    await press(control(`Evidence for BA-1: ${TICKET_EVIDENCE["BA-1"]}`));
    expect(screen.getByRole("dialog")).toHaveTextContent(TICKET_EVIDENCE["BA-1"]);
  });

  it("tells a member why they cannot draft, on the control itself", async () => {
    answer = pageWith(
      seededTickets((tickets) => {
        tickets.undrafted = [undraftedTicket()];
      }),
    );
    await draw(analyzerReadings({ mayAdminister: false }));

    const draftControl = control("Draft 1 ticket");

    expect(draftControl).toHaveAttribute("aria-disabled", "true");
    expect(draftControl).toHaveAttribute("title", DRAFT_TICKET_ROLE_REASON);
    await press(draftControl);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells a member why a failed row's Retry is not theirs", async () => {
    answer = pageOf(
      seededBatch((draft) => (draft.localKey === "BA-2" ? refused("GitHub answered 502.") : landed(issueOf(draft.localKey))), {
        status: "pushing",
      }),
    );
    await draw(analyzerReadings({ mayAdminister: false }));

    const retry = within(row("BA-2")).getByRole("button", { name: /^Retry/ });

    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(retry).toHaveAttribute("title", PUSH_ROLE_REASON);
    expect(control("Resume push")).toHaveAttribute("title", PUSH_ROLE_REASON);
  });
});

describe("theming and markup", () => {
  it("draws the same markup in light and dark — every tint is a token", () => {
    const batch = seededBatch((draft) =>
      draft.localKey === "BA-1" ? landed(621) : draft.localKey === "BA-2" ? refused("GitHub answered 502.") : undefined,
    );
    const rows = ticketRows(batch, seededTickets().batches[0]!.drafts);
    const [light, dark] = renderInBothPalettes(
      <ul>
        {rows.map((entry) => (
          <TicketItem
            key={entry.draft.id}
            onEvidence={() => {}}
            onRetry={() => {}}
            onSelect={() => {}}
            push={rowPush(entry.draft, entry.draft.selected, false)}
            retryReason={undefined}
            row={entry}
            selected={entry.draft.selected}
            sizing={rowSizing(entry.draft, batch.autoSize)}
            tickReason={undefined}
          />
        ))}
      </ul>,
    );

    expect(light).toContain("ou-chip--effort");
    expect(light).toContain("analyzer-tix__pushed");
    expect(light).toContain("analyzer-tix__failed");
    expect(maskIds(light!)).toBe(maskIds(dark!));
  });

  it("writes no inline style into the card", async () => {
    await draw();

    expect(card().querySelectorAll("[style]")).toHaveLength(0);
  });

  it("names each group, so two batches that both hold a BA-1 are two things", async () => {
    answer = pageWith(
      seededTickets((tickets) => {
        tickets.undrafted = [undraftedTicket()];
        tickets.batches.push(anotherBatch("5eed006a-0000-4000-8000-000000000009", "2026-09-25T09:00:00.000Z"));
      }),
    );
    await draw();

    expect(within(card()).getAllByRole("group").map((group) => group.getAttribute("aria-label"))).toEqual([
      UNDRAFTED_HEADING,
      "Drafted Oct 2 for GitHub Issues",
      "Drafted Sep 25 for GitHub Issues",
    ]);
    expect(
      within(within(card()).getByRole("group", { name: "Drafted Sep 25 for GitHub Issues" })).getAllByRole("checkbox", {
        name: /^Include /,
      }),
    ).toHaveLength(4);
  });

  it("names every control, so a list of rows is not a list of identical checkboxes", async () => {
    await draw();

    const names = within(card())
      .getAllByRole("checkbox")
      .map((element) => element.getAttribute("aria-label") ?? element.closest("label")?.textContent);

    expect(names).toEqual(["All drafts", "Include BA-1", "Include BA-2", "Include BA-3", "Include BA-4"]);
  });
});
