import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxQueue } from "@/app/api/inbox";
import type { QueuePollOptions } from "@/app/inbox/queue-poll";
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
  snoozedItem,
  utcClock,
} from "../helpers/inbox";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";
import { settle } from "../helpers/settle";

/**
 * The `/inbox` frame (BO.1, #466): the head the service composed, *Snooze all 1h* and its
 * confirmation, *Notification settings*, the queue as decision cards (BO.2, #467), the badge, and
 * the poll that keeps them fresh.
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

/** A fresh poll answer. */
function fresh(queue: InboxQueue): PollAnswer<InboxQueue> {
  return { state: "fresh", payload: queue, etag: null, pollAfterSeconds: null };
}

/** The frame, over these readings. */
function frame(queue: InboxQueue | null = inboxQueue()) {
  return render(<InboxScreen clock={utcClock} poll={POLL} readings={inboxReadings(queue)} />);
}

/** The level-one heading. */
const headline = () => screen.getByRole("heading", { level: 1 });

beforeEach(() => {
  answer = null;
  reads = 0;
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
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
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

  it("draws nothing below the head for an empty queue", () => {
    frame(emptyQueue());

    expect(screen.queryByRole("region", { name: "Decisions waiting" })).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
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

describe("both themes", () => {
  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <InboxScreen clock={utcClock} poll={POLL} readings={inboxReadings()} />,
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
