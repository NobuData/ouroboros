import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxQueue, InboxResolved } from "@/app/api/inbox";
import type { QueuePollOptions } from "@/app/inbox/queue-poll";
import { resetResolvedCollapsed } from "@/app/inbox/resolved-collapse";
import type { ResolvedPollOptions } from "@/app/inbox/resolved-poll";
import { INBOX_BADGE_SOURCE } from "@/app/shell/nav-modules";
import { navRegistry, setNavBadge } from "@/app/shell/nav-registry";
import type { PollAnswer } from "@/app/poll";

import {
  ALLOW_ITEM,
  INBOX_READ_AT,
  MERGE_ITEM,
  WAIVE_ITEM,
  actionResult,
  emptyQueue,
  inboxItem,
  inboxQueue,
  inboxReadings,
  preferences,
  resolvedDay,
  resolvedRow,
  snoozedItem,
  utcClock,
} from "../helpers/inbox";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";

/**
 * The `/inbox` frame (BO.1, #466): the head the service composed, *Snooze all 1h* and its
 * confirmation, *Notification settings*, the queue as decision cards (BO.2, #467), the badge, the
 * poll that keeps them fresh, and under the queue the *Inbox zero* card and the resolved list
 * (BO.3, #468).
 */

const snoozeAll = vi.fn();
const readNotificationSettings = vi.fn();
const updateNotificationSettings = vi.fn();
const answerDecision = vi.fn();
const snoozeDecision = vi.fn();

vi.mock("@/app/inbox/inbox-actions", () => ({
  snoozeAll: () => snoozeAll(),
  readNotificationSettings: () => readNotificationSettings(),
  updateNotificationSettings: (patch: unknown) => updateNotificationSettings(patch),
  answerDecision: (itemId: string, actionId: string, press: unknown) => answerDecision(itemId, actionId, press),
  snoozeDecision: (itemId: string, minutes: number) => snoozeDecision(itemId, minutes),
}));

const { InboxScreen, askingCount } = await import("@/app/inbox/inbox-screen");

/** What the poll answers next; `null` never answers. */
let answer: PollAnswer<InboxQueue> | null = null;

/** How many times the poll read. */
let reads = 0;

const POLL: QueuePollOptions = {
  read: () => {
    reads += 1;

    return answer === null ? new Promise(() => {}) : Promise.resolve(answer);
  },
  visible: () => true,
};

/** What each resolved endpoint answers; an endpoint with no entry never answers. */
const days = new Map<string, InboxResolved>();

/** Every resolved endpoint the page read, in order. */
let dayReads: string[] = [];

const RESOLVED_POLL: ResolvedPollOptions = {
  read: (endpoint) => {
    dayReads.push(endpoint);

    const day = days.get(endpoint);

    return day === undefined
      ? new Promise(() => {})
      : Promise.resolve({ state: "fresh", payload: day, etag: null, pollAfterSeconds: null });
  },
  visible: () => true,
};

/** A fresh poll answer. */
function fresh(queue: InboxQueue): PollAnswer<InboxQueue> {
  return { state: "fresh", payload: queue, etag: null, pollAfterSeconds: null };
}

/** The frame, over these readings, as Ken sees it. */
function frame(queue: InboxQueue | null = inboxQueue(), resolved: InboxResolved | null = resolvedDay()) {
  return render(
    <InboxScreen
      clock={utcClock}
      poll={POLL}
      readerId="user-ken"
      readings={inboxReadings(queue, resolved)}
      resolvedPoll={RESOLVED_POLL}
    />,
  );
}

/** The level-one heading. */
const headline = () => screen.getByRole("heading", { level: 1 });

beforeEach(() => {
  answer = null;
  reads = 0;
  days.clear();
  dayReads = [];
  window.localStorage.clear();
  resetResolvedCollapsed();
  snoozeAll.mockReset();
  readNotificationSettings.mockReset();
  updateNotificationSettings.mockReset();
  answerDecision.mockReset();
  snoozeDecision.mockReset();
  setNavBadge(INBOX_BADGE_SOURCE, null);
  vi.spyOn(Date, "now").mockReturnValue(INBOX_READ_AT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the head", () => {
  it("renders the seeded head verbatim, under the mockup's eyebrow and subline", () => {
    frame();

    expect(headline()).toHaveTextContent("3 decisions. About 90 seconds of your time.");
    expect(screen.getByText("Needs You", { selector: ".ou-eyebrow" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Everything the loops are blocked on, newest first. Answer here, from Slack, or from your phone — the loop resumes instantly.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the singular, the cold-org omission and the zero-state swap exactly as served", () => {
    const one = frame(
      inboxQueue({
        head: {
          count: 1,
          noun: "decision",
          estimateSeconds: 20,
          estimate: "About 20 seconds of your time.",
          sentence: "1 decision. About 20 seconds of your time.",
        },
        items: [inboxItem()],
      }),
    );
    expect(headline()).toHaveTextContent(/^1 decision\. About 20 seconds of your time\.$/);
    one.unmount();

    const cold = frame(
      inboxQueue({
        head: { count: 3, noun: "decisions", estimateSeconds: null, estimate: null, sentence: "3 decisions." },
      }),
    );
    expect(headline()).toHaveTextContent(/^3 decisions\.$/);
    cold.unmount();

    frame(emptyQueue());
    expect(headline()).toHaveTextContent(/^No decisions waiting\.$/);
    expect(screen.queryByText(/0 decisions/)).toBeNull();
  });

  it("follows the poll: the estimate moves with the queue's mix, the count as items resolve", async () => {
    // The first paint is the server's three; the poll's first answer is the queue a moment later.
    answer = fresh(
      inboxQueue({
        head: {
          count: 2,
          noun: "decisions",
          estimateSeconds: 49,
          estimate: "About 50 seconds of your time.",
          sentence: "2 decisions. About 50 seconds of your time.",
        },
        items: inboxQueue().items.slice(1),
      }),
    );
    frame();
    expect(headline()).toHaveTextContent("3 decisions. About 90 seconds of your time.");

    await waitFor(() => expect(headline()).toHaveTextContent("2 decisions. About 50 seconds of your time."));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("says the head is unread, with a retry banner, when the first read failed", () => {
    frame(null);

    expect(headline()).toHaveTextContent("Needs You");
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});

describe("the sidebar badge", () => {
  it("publishes the first paint's snooze-aware count, then each poll's", async () => {
    const published: (number | undefined)[] = [];
    const record = () => published.push(navRegistry().badges[INBOX_BADGE_SOURCE]);
    const { subscribeNavRegistry } = await import("@/app/shell/nav-registry");
    const stop = subscribeNavRegistry(record);

    answer = fresh(emptyQueue());
    frame();

    await waitFor(() => expect(navRegistry().badges[INBOX_BADGE_SOURCE]).toBe(0));
    stop();

    // The server's three first, then the poll's zero — snoozed items were never counted.
    expect(published).toEqual([3, 0]);
  });
});

describe("Snooze all 1h", () => {
  it("asks first, naming how many and until when", () => {
    frame();

    fireEvent.click(screen.getByRole("button", { name: "Snooze all 1h" }));

    const dialog = screen.getByRole("alertdialog");

    expect(within(dialog).getByRole("heading")).toHaveTextContent("Snooze 3 decisions until 14:20?");
    expect(dialog).toHaveTextContent("the Needs You badge until 14:20");
    expect(snoozeAll).not.toHaveBeenCalled();
  });

  it("round-trips: the snooze is sent, the dialog closes, and the page re-reads the queue", async () => {
    snoozeAll.mockResolvedValue({
      ok: true,
      value: { snoozed: inboxQueue().items.map((item) => item.id), until: "2026-10-04T14:20:00.000Z", eventId: "e-1" },
    });
    frame();

    fireEvent.click(screen.getByRole("button", { name: "Snooze all 1h" }));
    const before = reads;

    answer = fresh(
      inboxQueue({
        head: { count: 0, noun: "decisions", estimateSeconds: 0, estimate: null, sentence: "No decisions waiting." },
        items: [],
        snoozed: inboxQueue().items.map((item) =>
          snoozedItem({ id: item.id, question: item.question, severity: item.severity }),
        ),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Snooze until 14:20" }));
    await settle();

    expect(snoozeAll).toHaveBeenCalledOnce();
    await waitFor(() => expect(headline()).toHaveTextContent("No decisions waiting."));
    expect(reads).toBeGreaterThan(before);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // The items moved to the snoozed group rather than vanishing.
    const snoozed = screen.getByRole("region", { name: "Snoozed" });

    expect(within(snoozed).getByRole("heading")).toHaveTextContent("Snoozed (3)");
    expect(within(snoozed).getAllByText("until 14:20")).toHaveLength(3);
  });

  it("keeps the dialog open with the refusal when the service says no", async () => {
    snoozeAll.mockResolvedValue({ ok: false, reason: "Viewers cannot snooze." });
    frame();

    fireEvent.click(screen.getByRole("button", { name: "Snooze all 1h" }));
    fireEvent.click(screen.getByRole("button", { name: "Snooze until 14:20" }));
    await settle();

    expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent("Viewers cannot snooze.");
  });

  it("is inert at zero, and for a reader who may not snooze", () => {
    const empty = frame(emptyQueue());

    expect(screen.getByRole("button", { name: "Snooze all 1h" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Snooze all 1h" })).toHaveAttribute("title", "Nothing is waiting on you.");
    empty.unmount();

    frame(inboxQueue({ items: inboxQueue().items.map((item) => ({ ...item, snooze: { allowed: false } })) }));
    expect(screen.getByRole("button", { name: "Snooze all 1h" })).toHaveAttribute(
      "title",
      "Viewers can read the inbox but not snooze it.",
    );
  });
});

describe("Notification settings", () => {
  it("opens the preferences sheet on the reader's own settings", async () => {
    readNotificationSettings.mockResolvedValue({ ok: true, value: preferences() });
    frame();

    fireEvent.click(screen.getByRole("button", { name: "Notification settings" }));
    await settle();

    const sheet = await screen.findByRole("dialog", { name: "Notification settings" });

    expect(within(sheet).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "false");
    expect(within(sheet).getByRole("switch", { name: "Instant mail for blocking decisions" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("the queue of cards", () => {
  it("draws one card per asking item, newest first, with the mockup's ages", () => {
    frame();

    const list = screen.getByRole("region", { name: "Decisions waiting" });
    const cards = within(list).getAllByRole("article");

    expect(cards.map((card) => within(card).getByRole("heading", { level: 2 }).textContent)).toEqual([
      "Approve merge for a refactor PR?",
      "Allow a one-time edit to a protected path?",
      "Waive a claim the bench can't verify?",
    ]);
    expect(cards.map((card) => card.querySelector(".inbox-card__age > [aria-hidden]")?.textContent)).toEqual([
      "8m",
      "21m",
      "34m",
    ]);
    expect(within(cards[0]!).getByRole("button", { name: "Approve & merge" })).toBeInTheDocument();
  });

  it("draws no cards and no snoozed rows for an empty queue — the zero card stands there instead", () => {
    frame(emptyQueue());

    expect(screen.queryByRole("region", { name: "Decisions waiting" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Snoozed" })).toBeNull();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Inbox zero" })).toBeInTheDocument();
  });

  it("keeps an answered card on screen with its receipt after the queue stops listing it", async () => {
    answerDecision.mockResolvedValue({ outcome: "answered", result: actionResult() });
    frame();
    await settle();

    // The next read is the queue without the answered item.
    answer = fresh(
      inboxQueue({
        head: {
          count: 2,
          noun: "decisions",
          estimateSeconds: 82,
          estimate: "About 80 seconds of your time.",
          sentence: "2 decisions. About 80 seconds of your time.",
        },
        items: inboxQueue().items.filter((item) => item.id !== ALLOW_ITEM),
        asOf: "2026-10-04T13:20:06.000Z",
      }),
    );
    const before = reads;

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() => expect(headline()).toHaveTextContent("2 decisions. About 80 seconds of your time."));
    // The answer asked for a fresh read rather than waiting for the poll's next tick.
    expect(reads).toBeGreaterThan(before);

    const cards = screen.getAllByRole("article");

    // Still three cards, in the same order: the answered one holds its place and its receipt.
    expect(cards).toHaveLength(3);
    expect(cards[1]).toHaveAccessibleName("Allow a one-time edit to a protected path?");
    expect(within(cards[1]!).getByRole("status")).toHaveTextContent(
      "exception granted · resume sent to loop #1844",
    );
    expect(within(cards[1]!).getByRole("link", { name: "Run console →" })).toBeInTheDocument();
  });

  it("holds a card whose answer is still in flight when a read drops its item", async () => {
    let land!: (value: unknown) => void;
    answerDecision.mockReturnValue(new Promise((resolve) => (land = resolve)));
    snoozeDecision.mockResolvedValue({
      ok: true,
      value: { snoozed: [WAIVE_ITEM], until: "2026-10-04T14:20:00.000Z", eventId: "e-1" },
    });
    frame();
    await settle();

    // The answer leaves and does not come back yet…
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    // …and meanwhile another card settles, which re-reads a queue that no longer lists either.
    answer = fresh(
      inboxQueue({
        head: { count: 1, noun: "decision", estimateSeconds: 41, estimate: null, sentence: "1 decision." },
        items: inboxQueue().items.filter((item) => item.id === MERGE_ITEM),
        asOf: "2026-10-04T13:20:06.000Z",
      }),
    );
    const waiver = screen.getByRole("article", { name: "Waive a claim the bench can't verify?" });
    fireEvent.click(within(waiver).getByRole("button", { name: "Snooze" }));
    fireEvent.click(within(waiver).getByRole("button", { name: "1 hour" }));
    await waitFor(() => expect(headline()).toHaveTextContent("1 decision."));

    // The pressed card is still there, still in flight.
    const pressed = screen.getByRole("article", { name: "Allow a one-time edit to a protected path?" });
    expect(within(pressed).getByRole("status")).toHaveTextContent("answering…");

    await act(async () => land({ outcome: "answered", result: actionResult() }));

    expect(within(pressed).getByRole("status")).toHaveTextContent("exception granted");
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("dims a card snoozed here in place, and does not repeat it among the snoozed rows", async () => {
    snoozeDecision.mockResolvedValue({
      ok: true,
      value: { snoozed: [WAIVE_ITEM], until: "2026-10-04T14:20:00.000Z", eventId: "e-1" },
    });
    frame();
    await settle();

    const waiver = inboxQueue().items.find((item) => item.id === WAIVE_ITEM)!;
    answer = fresh(
      inboxQueue({
        head: { count: 2, noun: "decisions", estimateSeconds: 49, estimate: null, sentence: "2 decisions." },
        items: inboxQueue().items.filter((item) => item.id !== WAIVE_ITEM),
        snoozed: [snoozedItem({ id: WAIVE_ITEM, question: waiver.question, severity: "warn" })],
        asOf: "2026-10-04T13:20:06.000Z",
      }),
    );

    const card = screen.getByRole("article", { name: "Waive a claim the bench can't verify?" });
    fireEvent.click(within(card).getByRole("button", { name: "Snooze" }));
    fireEvent.click(within(card).getByRole("button", { name: "1 hour" }));

    await waitFor(() => expect(headline()).toHaveTextContent("2 decisions."));
    expect(screen.getByRole("article", { name: "Waive a claim the bench can't verify?" })).toHaveClass(
      "inbox-card--snoozed",
    );
    expect(screen.queryByRole("region", { name: "Snoozed" })).toBeNull();
  });

  it("lists items snoozed elsewhere as rows, linked where the service said", () => {
    frame(
      inboxQueue({
        snoozed: [
          snoozedItem({
            refs: [
              { type: "pr", id: "p-1", label: "PR #514", href: "/prs/p-1" },
              { type: "path", id: "docs/a.md", label: "docs/a.md", href: null },
            ],
          }),
        ],
      }),
    );

    const rows = screen.getByRole("region", { name: "Snoozed" });

    expect(within(rows).getByRole("heading", { level: 2 })).toHaveTextContent("Snoozed (1)");
    expect(within(rows).getByRole("link", { name: "PR #514" })).toHaveAttribute("href", "/prs/p-1");
    expect(within(rows).getByText("docs/a.md").tagName).toBe("SPAN");
    expect(within(rows).getByText("until 14:20")).toBeInTheDocument();
  });
});

describe("the badge and a card's answer", () => {
  it("drops the Needs You badge with the press, before any fresh read", async () => {
    answerDecision.mockResolvedValue({ outcome: "answered", result: actionResult() });
    frame();
    await waitFor(() => expect(navRegistry().badges[INBOX_BADGE_SOURCE]).toBe(3));

    // No newer read arrives: the poll keeps answering the same three.
    answer = fresh(inboxQueue());
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() => expect(navRegistry().badges[INBOX_BADGE_SOURCE]).toBe(2));
  });

  it("drops it for a per-item snooze too", async () => {
    snoozeDecision.mockResolvedValue({
      ok: true,
      value: { snoozed: [MERGE_ITEM], until: "2026-10-04T14:20:00.000Z", eventId: "e-1" },
    });
    frame();
    await settle();

    const card = screen.getByRole("article", { name: "Approve merge for a refactor PR?" });
    fireEvent.click(within(card).getByRole("button", { name: "Snooze" }));
    fireEvent.click(within(card).getByRole("button", { name: "1 hour" }));
    await waitFor(() => expect(navRegistry().badges[INBOX_BADGE_SOURCE]).toBe(2));
  });

  it("subtracts only what was settled against the read on screen — a newer read is the service's word", () => {
    const queue = inboxQueue();
    const settled = new Map([[ALLOW_ITEM, queue.asOf]]);

    expect(askingCount(queue, new Map())).toBe(3);
    expect(askingCount(queue, settled)).toBe(2);
    // The same items in a newer read: the service still counts three, and it is believed.
    expect(askingCount(inboxQueue({ asOf: "2026-10-04T13:25:00.000Z" }), settled)).toBe(3);
    // A newer read that dropped the item already counts without it.
    expect(
      askingCount(
        inboxQueue({
          head: { ...queue.head, count: 2 },
          items: queue.items.filter((item) => item.id !== ALLOW_ITEM),
          asOf: "2026-10-04T13:25:00.000Z",
        }),
        settled,
      ),
    ).toBe(2);
    expect(askingCount(null, settled)).toBeUndefined();
    expect(askingCount(inboxQueue({ head: { ...queue.head, count: 0 } }), settled)).toBe(0);
  });

  it("does not move the badge for a press that failed — the item is still asking", async () => {
    answerDecision.mockResolvedValue({ outcome: "failed", reason: "The guardrails still block this run." });
    frame();
    await waitFor(() => expect(navRegistry().badges[INBOX_BADGE_SOURCE]).toBe(3));

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The guardrails still block this run.");
    expect(navRegistry().badges[INBOX_BADGE_SOURCE]).toBe(3);
  });
});

describe("Inbox zero", () => {
  /** The zero card, or `null`. */
  const zero = () => screen.queryByRole("region", { name: "Inbox zero" });

  it("is the page's empty state: drawn when nothing is asking, with the two lines verbatim", () => {
    frame(emptyQueue());

    expect(zero()).toHaveTextContent("Inbox zero. The loop is turning on its own.");
    expect(zero()).toHaveTextContent("You'll be pinged only when policy says so.");
  });

  it("is NOT drawn while anything is asking — the page parts from the mockup's demonstration here", () => {
    frame();
    expect(zero()).toBeNull();
    cleanup();

    frame(inboxQueue({ head: { ...inboxQueue().head, count: 1, sentence: "1 decision." }, items: [inboxItem()] }));
    expect(zero()).toBeNull();
  });

  it("is not drawn for a queue that could not be read — unknown is not zero", () => {
    frame(null);

    expect(zero()).toBeNull();
  });

  it("arrives when the last decision is answered here, under that card's receipt", async () => {
    answerDecision.mockResolvedValue({ outcome: "answered", result: actionResult() });
    const one = inboxQueue({
      head: { count: 1, noun: "decision", estimateSeconds: 8, estimate: null, sentence: "1 decision." },
      items: inboxQueue().items.filter((item) => item.id === ALLOW_ITEM),
    });
    frame(one);
    await settle();
    expect(zero()).toBeNull();

    answer = fresh(emptyQueue());
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() => expect(zero()).not.toBeNull());

    const receipt = screen.getByRole("article", { name: "Allow a one-time edit to a protected path?" });

    expect(receipt).toHaveTextContent("exception granted");
    // The receipt first, then the zero card — it never pushes the card just answered down.
    expect(receipt.compareDocumentPosition(zero()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is drawn above the snoozed rows when everything left is snoozed", () => {
    frame(inboxQueue({ ...emptyQueue(), snoozed: [snoozedItem()] }));

    const rows = screen.getByRole("region", { name: "Snoozed" });

    expect(zero()).not.toBeNull();
    expect(zero()!.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the resolved list", () => {
  /** The list's heading button. */
  const heading = (name: string | RegExp) => screen.getByRole("button", { name });

  it("is there on the first paint, under the queue: *Resolved today · 5* and its rows", () => {
    frame();

    const list = screen.getByRole("region", { name: "Resolved decisions" });

    expect(heading("Resolved today · 5")).toHaveAttribute("aria-expanded", "true");
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(
      screen.getByRole("region", { name: "Decisions waiting" }).compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("follows its own poll: a decision resolved elsewhere joins today's list without a reload", async () => {
    days.set(
      "/api/inbox/resolved",
      resolvedDay({ rows: [resolvedRow({ itemId: "new", subject: "Merge PR #504", verdict: "approved" }), ...resolvedDay().rows] }),
    );
    frame();

    expect(await screen.findByRole("button", { name: "Resolved today · 6" })).toBeInTheDocument();
    expect(screen.getByText("Merge PR", { exact: false })).toBeInTheDocument();
  });

  it("re-reads when a card settles — the answer just given is history at once", async () => {
    answerDecision.mockResolvedValue({ outcome: "answered", result: actionResult() });
    days.set("/api/inbox/resolved", resolvedDay());
    frame();
    await settle();
    const before = dayReads.length;

    days.set(
      "/api/inbox/resolved",
      resolvedDay({
        rows: [
          resolvedRow({ itemId: ALLOW_ITEM, subject: "One-time edit to boot/rollback_flag.c", verdict: "allowed once" }),
          ...resolvedDay().rows,
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    expect(await screen.findByRole("button", { name: "Resolved today · 6" })).toBeInTheDocument();
    expect(dayReads.length).toBeGreaterThan(before);
  });

  it("folds, and stays folded across a reload — for this reader, not for another", async () => {
    const first = frame();

    fireEvent.click(heading("Resolved today · 5"));

    expect(heading("Resolved today · 5")).toHaveAttribute("aria-expanded", "false");
    expect(within(screen.getByRole("region", { name: "Resolved decisions" })).queryAllByRole("listitem")).toHaveLength(0);

    // A reload: the page is built again and reads the choice back from storage.
    first.unmount();
    resetResolvedCollapsed();
    const again = frame();
    await settle();

    expect(heading("Resolved today · 5")).toHaveAttribute("aria-expanded", "false");
    again.unmount();

    // Somebody else at the same browser keeps their own.
    render(
      <InboxScreen
        clock={utcClock}
        poll={POLL}
        readerId="user-maya"
        readings={inboxReadings()}
        resolvedPoll={RESOLVED_POLL}
      />,
    );
    expect(heading("Resolved today · 5")).toHaveAttribute("aria-expanded", "true");
  });

  it("still folds for a page that was handed no reader — one anonymous fold, never a dead heading", () => {
    render(<InboxScreen clock={utcClock} poll={POLL} readings={inboxReadings()} resolvedPoll={RESOLVED_POLL} />);

    fireEvent.click(heading("Resolved today · 5"));

    expect(heading("Resolved today · 5")).toHaveAttribute("aria-expanded", "false");
    expect(JSON.parse(window.localStorage.getItem("ouro-inbox-resolved-collapsed")!)).toEqual({ anonymous: true });
  });

  it("opens again, and remembers that too", async () => {
    window.localStorage.setItem("ouro-inbox-resolved-collapsed", JSON.stringify({ "user-ken": true }));
    resetResolvedCollapsed();
    frame();
    await settle();

    fireEvent.click(heading("Resolved today · 5"));

    expect(heading("Resolved today · 5")).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("ouro-inbox-resolved-collapsed")).toBeNull();
  });

  it("pages into history: Earlier loads the previous day, Later and Today come back", async () => {
    days.set(
      "/api/inbox/resolved?day=2026-10-02",
      resolvedDay({
        day: "2026-10-02",
        rows: [resolvedRow({ itemId: "old", subject: "Split #486 into 4 tickets", verdict: "discarded" })],
        previousDay: null,
        nextDay: "2026-10-03",
      }),
    );
    days.set(
      "/api/inbox/resolved?day=2026-10-03",
      resolvedDay({ day: "2026-10-03", rows: [], previousDay: "2026-10-02", nextDay: "2026-10-04" }),
    );
    frame();

    fireEvent.click(screen.getByRole("button", { name: "‹ Earlier" }));

    expect(await screen.findByRole("button", { name: "Resolved Oct 2, 2026 · 1" })).toBeInTheDocument();
    expect(dayReads).toContain("/api/inbox/resolved?day=2026-10-02");
    expect(screen.getByText("Split", { exact: false })).toHaveTextContent("Split #486 into 4 tickets — discarded");
    expect(screen.getByRole("button", { name: "‹ Earlier" })).toHaveAttribute("aria-disabled", "true");

    // A day forward: nothing was resolved on it, and it says so in one line.
    fireEvent.click(screen.getByRole("button", { name: "Later ›" }));
    expect(await screen.findByText("Nothing was resolved on Oct 3, 2026.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByRole("button", { name: "Resolved today · 5" })).toBeInTheDocument();
  });

  it("says a past day is being read rather than show today's rows under its name", () => {
    frame();

    fireEvent.click(screen.getByRole("button", { name: "‹ Earlier" }));

    expect(screen.getByRole("button", { name: "Resolved Oct 2, 2026" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Resolved decisions" })).queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("Reading…")).toBeInTheDocument();
  });

  it("says why when today's list could not be read, and still draws the queue", () => {
    frame(inboxQueue(), null);

    expect(screen.getByText("The resolved list could not be read.")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });
});

describe("both themes", () => {
  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <InboxScreen
        clock={utcClock}
        poll={POLL}
        readerId="user-ken"
        readings={inboxReadings()}
        resolvedPoll={RESOLVED_POLL}
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("inbox__title");
  });
});

describe("the poll", () => {
  it("starts on mount and keeps refreshing without a reload", async () => {
    frame();
    await act(async () => {});

    expect(reads).toBeGreaterThan(0);
  });
});
