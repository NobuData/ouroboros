import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxQueue, InboxResolved, InboxSide, InboxStats, NotificationPreferences } from "@/app/api/inbox";
import type { QueuePollOptions } from "@/app/inbox/queue-poll";
import { resetResolvedCollapsed } from "@/app/inbox/resolved-collapse";
import type { ResolvedPollOptions } from "@/app/inbox/resolved-poll";
import type { SidePollOptions } from "@/app/inbox/side-poll";
import type { StatsPollOptions } from "@/app/inbox/stats-poll";
import { CARD_FAILED_TITLE, STALE_HEADLINE } from "@/app/inbox/view";
import { INBOX_BADGE_SOURCE } from "@/app/shell/nav-modules";
import { navRegistry, setNavBadge } from "@/app/shell/nav-registry";
import type { PollAnswer } from "@/app/poll";

import {
  ALLOW_ITEM,
  INBOX_READ_AT,
  MERGE_ITEM,
  WAIVE_ITEM,
  actionResult,
  coldStats,
  digestOn,
  emptyQueue,
  inboxItem,
  inboxQueue,
  inboxReadings,
  inboxSide,
  inboxStats,
  preferences,
  resolvedDay,
  resolvedRow,
  seededChannels,
  seededPolicyCard,
  snoozedItem,
  utcClock,
} from "../helpers/inbox";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";

/**
 * The `/inbox` frame (BO.1, #466): the head the service composed, *Snooze all 1h* and its
 * confirmation, *Notification settings*, the queue as decision cards (BO.2, #467), the badge, the
 * poll that keeps them fresh, and under the queue the *Inbox zero* card and the resolved list
 * (BO.3, #468). Beside them, the side column (BO.4, #469): the channels' truth and the policy
 * card on a poll of their own, and the reader's preferences shared by the email row and the
 * sheet's two entry points. The states (BO.5, #470): the week's stat card on a poll of its own,
 * the snoozed section's early wake, the lag banner's last refresh and one card failing alone.
 */

const snoozeAll = vi.fn();
const readNotificationSettings = vi.fn();
const updateNotificationSettings = vi.fn();
const answerDecision = vi.fn();
const snoozeDecision = vi.fn();
const unsnoozeDecision = vi.fn();

vi.mock("@/app/inbox/inbox-actions", () => ({
  snoozeAll: () => snoozeAll(),
  readNotificationSettings: () => readNotificationSettings(),
  updateNotificationSettings: (patch: unknown) => updateNotificationSettings(patch),
  answerDecision: (itemId: string, actionId: string, press: unknown) => answerDecision(itemId, actionId, press),
  snoozeDecision: (itemId: string, minutes: number) => snoozeDecision(itemId, minutes),
  unsnoozeDecision: (itemId: string) => unsnoozeDecision(itemId),
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

/** What the side column's poll answers next; `null` never answers. */
let sideAnswer: PollAnswer<InboxSide> | null = null;

/** How many times the side column's poll read. */
let sideReads = 0;

const SIDE_POLL: SidePollOptions = {
  read: () => {
    sideReads += 1;

    return sideAnswer === null ? new Promise(() => {}) : Promise.resolve(sideAnswer);
  },
  visible: () => true,
};

/** What the stat card's poll answers next; `null` never answers. */
let statsAnswer: PollAnswer<InboxStats> | null = null;

/** How many times the stat card's poll read. */
let statsReads = 0;

const STATS_POLL: StatsPollOptions = {
  read: () => {
    statsReads += 1;

    return statsAnswer === null ? new Promise(() => {}) : Promise.resolve(statsAnswer);
  },
  visible: () => true,
};

/** A fixed stamp for the lag banner: the instant as UTC `HH:MM:SS`. */
function utcStamp(atMs: number): string {
  return new Date(atMs).toISOString().slice(11, 19);
}

/** A fresh poll answer. */
function fresh<T>(payload: T): PollAnswer<T> {
  return { state: "fresh", payload, etag: null, pollAfterSeconds: null };
}

/** The frame, over these readings, as Ken sees it. */
function frame(
  queue: InboxQueue | null = inboxQueue(),
  resolved: InboxResolved | null = resolvedDay(),
  side: InboxSide | null = inboxSide(),
  notifications: NotificationPreferences | null = preferences(),
  stats: InboxStats | null = inboxStats(),
) {
  return render(
    <InboxScreen
      clock={utcClock}
      poll={POLL}
      readerId="user-ken"
      readings={inboxReadings(queue, resolved, side, notifications, stats)}
      resolvedPoll={RESOLVED_POLL}
      sidePoll={SIDE_POLL}
      stamp={utcStamp}
      statsPoll={STATS_POLL}
    />,
  );
}

/** Ask every poll on the page for a fresh read — what the summary refresh does. */
async function refreshAll(): Promise<void> {
  await act(async () => {
    (await import("@/app/dashboard/summary-refresh")).requestSummaryRefresh();
  });
}

/** The level-one heading. */
const headline = () => screen.getByRole("heading", { level: 1 });

beforeEach(() => {
  answer = null;
  reads = 0;
  sideAnswer = null;
  sideReads = 0;
  statsAnswer = null;
  statsReads = 0;
  days.clear();
  dayReads = [];
  window.localStorage.clear();
  resetResolvedCollapsed();
  snoozeAll.mockReset();
  readNotificationSettings.mockReset();
  updateNotificationSettings.mockReset();
  answerDecision.mockReset();
  snoozeDecision.mockReset();
  unsnoozeDecision.mockReset();
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

    expect(within(snoozed).getByRole("heading", { level: 2 })).toHaveTextContent("Snoozed (3)");
    expect(within(snoozed).getAllByRole("article")).toHaveLength(3);
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

describe("the side column", () => {
  /** The column. */
  const column = () => screen.getByRole("complementary", { name: "Channels and policies" });

  /** The two cards. */
  const channels = () => within(column()).getByRole("region", { name: "Answer from anywhere" });
  const policies = () => within(column()).getByRole("region", { name: "What needs a human" });

  /** A channel's row, by its name. */
  function channelRow(name: string): HTMLElement {
    return within(channels())
      .getAllByRole("listitem")
      .find((item) => item.querySelector(".inbox-channels__name")?.textContent === name)!;
  }

  /** The policy card's rules, in order. */
  const rules = () =>
    within(policies())
      .queryAllByRole("listitem")
      .map((item) => item.querySelector(".inbox-rules__rule")!.textContent);

  it("sits beside the queue and the resolved list, drawn from the first read", () => {
    frame();

    expect(column()).toHaveClass("inbox__side");
    expect(column().closest(".inbox__grid")).toContainElement(screen.getByRole("region", { name: "Decisions waiting" }));
    expect(screen.getByRole("region", { name: "Resolved decisions" }).closest(".inbox__main")).not.toBeNull();
    expect(column().closest(".inbox__main")).toBeNull();

    expect(channelRow("GitHub").querySelector(".inbox-channels__mark")).toHaveTextContent("✓ connected");
    expect(channelRow("Slack")).toHaveTextContent("Arrives with Chat Ops.");
    expect(rules()).toEqual(["refactor label", "protected paths", "unverifiable claims"]);
    expect(policies()).toHaveTextContent("Everything else merges itself when gates are green.");
  });

  it("reads both cards on one poll of their own", async () => {
    frame();
    await act(async () => {});

    expect(sideReads).toBeGreaterThan(0);
  });

  it("flips a channel that landed, with no reload and no change to the page", async () => {
    sideAnswer = fresh(
      inboxSide({ channels: seededChannels({ slack: { state: "connected", until: null, reason: null } }) }),
    );
    frame();

    // The first paint is the server's read, a moment before Chat Ops landed.
    expect(channelRow("Slack").querySelector(".inbox-channels__mark")).toHaveTextContent("not yet");

    await waitFor(() =>
      expect(channelRow("Slack").querySelector(".inbox-channels__mark")).toHaveTextContent("✓ connected"),
    );
    expect(channelRow("Slack")).not.toHaveTextContent("Arrives with Chat Ops.");
  });

  it("takes a channel's ✓ away the same way — a mail server that went", async () => {
    sideAnswer = fresh(
      inboxSide({
        channels: seededChannels({
          email: { state: "available", reason: "This deployment has no mail server: set OURO_SMTP_URL." },
        }),
      }),
    );
    frame();

    expect(within(channelRow("Email")).getByRole("switch", { name: "Daily digest" })).toBeInTheDocument();

    await waitFor(() =>
      expect(channelRow("Email").querySelector(".inbox-channels__mark")).toHaveTextContent("not connected"),
    );
    // The digest's switch goes with it: a switch on a channel that cannot deliver does nothing.
    expect(within(channelRow("Email")).queryByRole("switch")).toBeNull();
  });

  it("drops a removed policy's row and rephrases the caption under dry-run, live", async () => {
    sideAnswer = fresh(
      inboxSide({
        policies: seededPolicyCard({
          rows: seededPolicyCard().rows.filter((row) => row.id !== "human_review:label:refactor"),
          dryRun: true,
          caption: "Dry-run is on: nothing merges itself — every loop's PR opens as a draft for a person to review.",
        }),
      }),
    );
    frame();

    expect(rules()).toContain("refactor label");

    await waitFor(() => expect(rules()).toEqual(["protected paths", "unverifiable claims"]));
    expect(policies()).toHaveTextContent("Dry-run is on: nothing merges itself");
    expect(policies()).not.toHaveTextContent("merges itself when gates are green");
  });

  it("says each card could not be read when the first read failed, then fills them from the poll", async () => {
    frame(inboxQueue(), resolvedDay(), null);

    expect(channels()).toHaveTextContent("The inbox's channels and policies could not be read.");
    expect(policies()).toHaveTextContent("The inbox's channels and policies could not be read.");
    expect(column().textContent).not.toContain("✓");
    expect(rules()).toEqual([]);

    sideAnswer = fresh(inboxSide());
    await act(async () => {
      (await import("@/app/dashboard/summary-refresh")).requestSummaryRefresh();
    });

    await waitFor(() => expect(rules()).toHaveLength(3));
    expect(channels()).not.toHaveTextContent("could not be read");
  });

  it("keeps the cards it has when a later read fails — the queue's banner is not theirs", async () => {
    sideAnswer = { state: "failed", reason: "The inbox's channels and policies could not be reached.", pollAfterSeconds: null };
    frame();
    await act(async () => {});

    expect(rules()).toHaveLength(3);
    expect(channelRow("GitHub").querySelector(".inbox-channels__mark")).toHaveTextContent("✓ connected");
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("leaves the queue's cards alone: an answer there does not wait on the side column", () => {
    frame();

    expect(within(screen.getByRole("region", { name: "Decisions waiting" })).getAllByRole("article")).toHaveLength(3);
    expect(within(column()).queryByRole("article")).toBeNull();
  });
});

describe("the preferences, from both entry points", () => {
  /** The email row. */
  const emailRow = () =>
    within(screen.getByRole("region", { name: "Answer from anywhere" }))
      .getAllByRole("listitem")
      .find((item) => item.querySelector(".inbox-channels__name")?.textContent === "Email")!;

  /** Open the sheet from one of its two buttons. */
  async function openFrom(name: "Notification settings" | "All notification settings"): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole("button", { name }));
    await settle();

    return screen.findByRole("dialog", { name: "Notification settings" });
  }

  /** Close the open sheet. */
  async function close(sheet: HTMLElement): Promise<void> {
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Notification settings" })).toBeNull());
  }

  it("opens the same sheet from the head and from the card", async () => {
    readNotificationSettings.mockResolvedValue({ ok: true, value: preferences() });
    frame();

    const fromHead = await openFrom("Notification settings");

    expect(within(fromHead).getByRole("switch", { name: "Instant mail for blocking decisions" })).toBeInTheDocument();
    expect(within(fromHead).getByRole("group", { name: "Never mail me about" })).toBeInTheDocument();
    await close(fromHead);

    const fromCard = await openFrom("All notification settings");

    expect(within(fromCard).getByRole("switch", { name: "Instant mail for blocking decisions" })).toBeInTheDocument();
    expect(within(fromCard).getByRole("group", { name: "Never mail me about" })).toBeInTheDocument();
    expect(readNotificationSettings).toHaveBeenCalledTimes(2);
  });

  it("saves from the head, and shows the saved values on reopening from the card — mutes included", async () => {
    const saved = {
      ...digestOn("08:15"),
      instant: { severity: "off" as const },
      mutedKinds: ["fact_review", "resize_review"],
    };

    readNotificationSettings.mockResolvedValueOnce({ ok: true, value: preferences() });
    updateNotificationSettings.mockResolvedValue({ ok: true, value: saved });
    frame();

    const sheet = await openFrom("Notification settings");

    fireEvent.click(within(sheet).getByRole("switch", { name: "Daily digest" }));
    fireEvent.change(within(sheet).getByLabelText("Send at (UTC)"), { target: { value: "08:15" } });
    fireEvent.click(within(sheet).getByRole("switch", { name: "Instant mail for blocking decisions" }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Fact reviews" }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Re-sizes" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await settle();

    expect(updateNotificationSettings).toHaveBeenCalledExactlyOnceWith({
      digestEnabled: true,
      digestTime: "08:15",
      instantSeverity: "off",
      mutedKinds: ["fact_review", "resize_review"],
    });
    await waitFor(() => expect(within(sheet).getByText("Saved.")).toBeInTheDocument());

    // The email row is the same preferences: it follows the save without a read of its own.
    expect(emailRow()).toHaveTextContent("daily · 08:15 UTC");
    expect(within(emailRow()).getByText("Next digest 2026-10-05 08:15 UTC")).toBeInTheDocument();
    await close(sheet);

    // Reopened from the other entry point, the sheet reads again — and the service has them.
    readNotificationSettings.mockResolvedValueOnce({ ok: true, value: saved });

    const again = await openFrom("All notification settings");

    expect(within(again).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "true");
    expect(within(again).getByLabelText("Send at (UTC)")).toHaveValue("08:15");
    expect(within(again).getByRole("switch", { name: "Instant mail for blocking decisions" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(within(again).getByRole("checkbox", { name: "Fact reviews" })).toBeChecked();
    expect(within(again).getByRole("checkbox", { name: "Re-sizes" })).toBeChecked();
    expect(within(again).getByRole("checkbox", { name: "Merge approvals" })).not.toBeChecked();
  });

  it("switches the digest on from the email row, and the sheet opens on it", async () => {
    updateNotificationSettings.mockResolvedValue({ ok: true, value: digestOn("09:00") });
    readNotificationSettings.mockResolvedValue({ ok: true, value: digestOn("09:00") });
    frame();

    fireEvent.click(within(emailRow()).getByRole("switch", { name: "Daily digest" }));
    await settle();

    expect(updateNotificationSettings).toHaveBeenCalledExactlyOnceWith({ digestEnabled: true });
    expect(within(emailRow()).getByText("Next digest 2026-10-05 09:00 UTC")).toBeInTheDocument();

    const sheet = await openFrom("Notification settings");

    expect(within(sheet).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByText("Next digest 2026-10-05 09:00 UTC")).toBeInTheDocument();
  });

  it("drops the held preferences for a fresh server read — they are one workspace's, and it switched", async () => {
    updateNotificationSettings.mockResolvedValue({ ok: true, value: digestOn("09:00") });

    const first = inboxReadings();
    const screenOver = (readings: typeof first) => (
      <InboxScreen
        clock={utcClock}
        poll={POLL}
        readerId="user-ken"
        readings={readings}
        resolvedPoll={RESOLVED_POLL}
        sidePoll={SIDE_POLL}
      />
    );
    const { rerender } = render(screenOver(first));

    fireEvent.click(within(emailRow()).getByRole("switch", { name: "Daily digest" }));
    await settle();
    expect(emailRow()).toHaveTextContent("daily · 09:00 UTC");

    // The same read again — any other re-render — keeps what was saved.
    rerender(screenOver(first));
    expect(emailRow()).toHaveTextContent("daily · 09:00 UTC");

    // The route re-rendered for another workspace, where this person's digest is at 18:30.
    rerender(screenOver(inboxReadings(inboxQueue(), resolvedDay(), inboxSide(), digestOn("18:30"))));
    expect(emailRow()).toHaveTextContent("daily · 18:30 UTC");
    expect(within(emailRow()).getByLabelText("Digest time (UTC)")).toHaveValue("18:30");

    // …and one where it was never switched on.
    rerender(screenOver(inboxReadings()));
    expect(within(emailRow()).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "false");
  });

  it("gives the email row its switch once the sheet has read what the first paint could not", async () => {
    readNotificationSettings.mockResolvedValue({ ok: true, value: digestOn("09:00") });
    frame(inboxQueue(), resolvedDay(), inboxSide(), null);

    expect(within(emailRow()).queryByRole("switch")).toBeNull();
    expect(emailRow()).toHaveTextContent("Your notification settings could not be read.");

    const sheet = await openFrom("All notification settings");
    await close(sheet);

    expect(within(emailRow()).getByRole("switch", { name: "Daily digest" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("both themes", () => {
  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <InboxScreen
        clock={utcClock}
        poll={POLL}
        readerId="user-ken"
        readings={inboxReadings(inboxQueue(), resolvedDay(), inboxSide(), digestOn("09:00"))}
        resolvedPoll={RESOLVED_POLL}
        sidePoll={SIDE_POLL}
        stamp={utcStamp}
        statsPoll={STATS_POLL}
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("inbox__title");
    // The side column is in the comparison: both cards, the digest's controls included.
    expect(light).toContain("inbox-channels__digest-time");
    expect(light).toContain("inbox-rules__caption");
    expect(light).toContain("inbox-stat__figure");
  });
});

describe("This week (#470)", () => {
  /** The stat card. */
  const week = () => screen.getByRole("region", { name: "This week" });

  it("closes the side column with the seeded week, from the first read", () => {
    frame();

    const column = screen.getByRole("complementary", { name: "Channels and policies" });
    const cards = [...column.children];

    expect(cards.at(-1)).toBe(week());
    expect(week()).toHaveTextContent("11 decisions");
    expect(week()).toHaveTextContent("median answer time 41s · loops never waited longer than 6m");
  });

  it("follows a poll of its own — the figures change when the week does", async () => {
    statsAnswer = fresh(inboxStats({ decisions: 12, display: { decisions: "12", medianAnswer: "39s", maxLoopWait: "6m" } }));
    frame();

    await waitFor(() => expect(week()).toHaveTextContent("12 decisions"));
    expect(week()).toHaveTextContent("median answer time 39s");
    expect(statsReads).toBeGreaterThan(0);
  });

  it("draws em dashes for a cold workspace, never zeros", () => {
    frame(inboxQueue(), resolvedDay(), inboxSide(), preferences(), coldStats());

    expect(week()).toHaveTextContent("— decisions");
    expect(week()).toHaveTextContent("median answer time — · loops never waited longer than —");
    expect(week().querySelector(".ou-stat__value")!.textContent).not.toMatch(/\d/);
  });

  it("says its read failed in its own card, and leaves every other card alone", () => {
    frame(inboxQueue(), resolvedDay(), inboxSide(), preferences(), null);

    expect(week()).toHaveTextContent("This week's figures could not be read.");
    expect(week().querySelector(".ou-stat__delta")).toHaveClass("ou-stat__delta--failed");
    expect(screen.getByRole("region", { name: "What needs a human" })).toHaveTextContent("refactor label");
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});

describe("the snoozed section (#470)", () => {
  /** A decision snoozed elsewhere, waking at 13:42. */
  const asleep = snoozedItem({
    id: "snoozed-1",
    question: "Should the loops trust this fact?",
    createdAt: "2026-10-04T12:00:00.000Z",
    ageSeconds: 4800,
    snoozedUntil: "2026-10-04T13:42:00.000Z",
  });

  it("draws dimmed cards with the original age and a countdown, out of the badge", async () => {
    frame(inboxQueue({ snoozed: [asleep] }));

    const card = screen.getByRole("article", { name: asleep.question });

    expect(card).toHaveClass("inbox-snoozed");
    expect(card.querySelector(".inbox-snoozed__age")).toHaveTextContent("1h");
    expect(card.querySelector(".inbox-snoozed__countdown")).toHaveTextContent("wakes in 22m");
    // The head's count is the service's, snooze-aware: three asking, the snoozed one not among them.
    await waitFor(() => expect(navRegistry().badges[INBOX_BADGE_SOURCE]).toBe(3));
  });

  it("wakes one early and re-reads the queue, which brings it back as a card", async () => {
    unsnoozeDecision.mockResolvedValue({ ok: true, value: { unsnoozed: [asleep.id] } });
    frame(inboxQueue({ snoozed: [asleep] }));
    await settle();

    const before = reads;
    answer = fresh(
      inboxQueue({
        head: { count: 4, noun: "decisions", estimateSeconds: 120, estimate: null, sentence: "4 decisions." },
        items: [...inboxQueue().items, inboxItem({ id: asleep.id, question: asleep.question, severity: "info" })],
        snoozed: [],
        asOf: "2026-10-04T13:20:06.000Z",
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Wake now: ${asleep.question}` }));
    });

    expect(unsnoozeDecision).toHaveBeenCalledExactlyOnceWith(asleep.id);
    await waitFor(() => expect(headline()).toHaveTextContent("4 decisions."));
    expect(reads).toBeGreaterThan(before);
    expect(screen.queryByRole("region", { name: "Snoozed" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Decisions waiting" })).getAllByRole("article")).toHaveLength(4);
  });
});

describe("the lag banner (#470)", () => {
  /** The banner's paragraph. */
  const bannerText = () => document.querySelector(".inbox__stale .ou-retry__text")!;

  it("prints the queue's last refresh, to the second, when a poll fails", async () => {
    answer = { state: "failed", reason: "The inbox could not be reached.", pollAfterSeconds: null };
    frame();

    await waitFor(() => expect(document.querySelector(".inbox__stale")).not.toBeNull());
    expect(bannerText()).toHaveTextContent(`${STALE_HEADLINE} Last refreshed 13:20:00. The inbox could not be reached.`);
    // The queue it is stale about is still on screen.
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("moves with each good read, so it says how far behind the page really is", async () => {
    answer = fresh(inboxQueue({ asOf: "2026-10-04T13:20:45.000Z" }));
    frame();
    await waitFor(() => expect(reads).toBeGreaterThan(0));
    await settle();

    answer = { state: "failed", reason: "The inbox could not be reached.", pollAfterSeconds: null };
    await refreshAll();

    await waitFor(() => expect(bannerText()).toHaveTextContent("Last refreshed 13:20:45."));
  });

  it("does not invent a refresh for a queue that was never read", () => {
    frame(null);

    expect(bannerText().querySelector(".ou-retry__headline")).toHaveTextContent(new RegExp(`^${STALE_HEADLINE.replace(".", "\\.")}$`));
  });
});

describe("one card that cannot draw (#470)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("degrades a decision card alone — its neighbours, the head and the side column stay", () => {
    const broken = inboxItem({ id: "broken-1", question: "A card with a shape it did not expect", refs: null as never });
    frame(inboxQueue({ items: [...inboxQueue().items, broken] }));

    const standIn = screen.getByRole("region", { name: broken.question });

    expect(standIn).toHaveTextContent(CARD_FAILED_TITLE);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(headline()).toHaveTextContent("3 decisions.");
    expect(screen.getByRole("region", { name: "This week" })).toHaveTextContent("11 decisions");
  });

  it("degrades a side card alone — the queue and the other side cards stay", () => {
    frame(inboxQueue(), resolvedDay(), inboxSide({ channels: { channels: null as never } }));

    expect(screen.getByRole("region", { name: "Answer from anywhere" })).toHaveTextContent(CARD_FAILED_TITLE);
    expect(screen.getByRole("region", { name: "What needs a human" })).toHaveTextContent("refactor label");
    expect(screen.getByRole("region", { name: "This week" })).toHaveTextContent("11 decisions");
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("degrades the stat card alone", () => {
    frame(inboxQueue(), resolvedDay(), inboxSide(), preferences(), inboxStats({ display: null as never }));

    expect(screen.getByRole("region", { name: "This week" })).toHaveTextContent(CARD_FAILED_TITLE);
    expect(screen.getByRole("region", { name: "What needs a human" })).toHaveTextContent("refactor label");
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });
});

describe("as a member and as a viewer (#470)", () => {
  /** The queue as the service resolves it for a role: the actions it may press, and its snooze. */
  function queueFor(role: "member" | "viewer"): InboxQueue {
    const allowed = role === "member";

    return inboxQueue({
      items: inboxQueue().items.map((item) =>
        inboxItem({
          ...item,
          snooze: { allowed },
          actions: item.actions.map((action) =>
            action.requiredRole === "viewer" || (allowed && action.requiredRole === "member")
              ? action
              : { ...action, allowed: false, disabledReason: "role_required" as const },
          ),
        }),
      ),
      snoozed: [snoozedItem({ snooze: { allowed } })],
    });
  }

  it("lets a member snooze and wake, and holds back what needs an approver — with the reason", () => {
    frame(queueFor("member"));

    const merge = screen.getByRole("article", { name: "Approve merge for a refactor PR?" });

    expect(within(merge).getByRole("button", { name: "Approve & merge" })).toHaveAttribute("aria-disabled", "true");
    expect(within(merge).getByRole("button", { name: "Return to loop with note" })).not.toHaveAttribute("aria-disabled");
    expect(within(merge).getByRole("button", { name: "Snooze" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: /^Wake now:/ })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: "Snooze all 1h" })).not.toHaveAttribute("aria-disabled");
  });

  it("gives a viewer every card to read and no write it would be refused — each inert with why", () => {
    frame(queueFor("viewer"));

    const merge = screen.getByRole("article", { name: "Approve merge for a refactor PR?" });

    expect(within(merge).getByRole("button", { name: "Approve & merge" })).toHaveAttribute("aria-disabled", "true");
    expect(within(merge).getByRole("button", { name: "Return to loop with note" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(merge).getByRole("button", { name: "Snooze" })).toHaveAttribute(
      "title",
      "Viewers can read the inbox but not snooze it.",
    );
    expect(screen.getByRole("button", { name: /^Wake now:/ })).toHaveAttribute(
      "title",
      "Viewers can read the inbox but not snooze it.",
    );
    expect(screen.getByRole("button", { name: "Snooze all 1h" })).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(screen.getByRole("button", { name: /^Wake now:/ }));
    expect(unsnoozeDecision).not.toHaveBeenCalled();
    // Navigation is not a write: a viewer may still open what the card points at.
    expect(within(merge).getByRole("link", { name: "Open PR verification →" })).toBeInTheDocument();
  });
});

describe("the poll", () => {
  it("starts on mount and keeps refreshing without a reload", async () => {
    frame();
    await act(async () => {});

    expect(reads).toBeGreaterThan(0);
  });
});
