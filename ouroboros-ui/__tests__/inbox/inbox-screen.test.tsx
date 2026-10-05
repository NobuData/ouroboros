import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxQueue } from "@/app/api/inbox";
import type { QueuePollOptions } from "@/app/inbox/queue-poll";
import { INBOX_BADGE_SOURCE } from "@/app/shell/nav-modules";
import { navRegistry, setNavBadge } from "@/app/shell/nav-registry";
import type { PollAnswer } from "@/app/poll";

import {
  INBOX_READ_AT,
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
 * confirmation, *Notification settings*, the plain queue rows, the badge, and the poll that keeps
 * them fresh.
 */

const snoozeAll = vi.fn();
const readNotificationSettings = vi.fn();
const updateNotificationSettings = vi.fn();

vi.mock("@/app/inbox/inbox-actions", () => ({
  snoozeAll: () => snoozeAll(),
  readNotificationSettings: () => readNotificationSettings(),
  updateNotificationSettings: (patch: unknown) => updateNotificationSettings(patch),
}));

const { InboxScreen } = await import("@/app/inbox/inbox-screen");

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

describe("the queue rows", () => {
  it("lists each asking item's severity, question, refs and age, without action buttons", () => {
    frame();

    const list = screen.getByRole("region", { name: "Decisions waiting" });
    const rows = within(list).getAllByRole("listitem");

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Blocking");
    expect(rows[0]).toHaveTextContent("Approve merge for a refactor PR?");
    expect(rows[0]).toHaveTextContent("asked 6m ago");
    expect(within(rows[0]!).getByRole("link", { name: "PR #504" })).toHaveAttribute(
      "href",
      expect.stringContaining("/prs/5eed003a-0000-4000-8000-000000000504"),
    );
    // A ticket and a path have no page here: text, not a link.
    expect(within(rows[0]!).queryByRole("link", { name: "issue #465" })).toBeNull();
    expect(within(rows[1]!).getByText("boot/rollback_flag.c").tagName).toBe("SPAN");
    expect(within(list).queryByRole("button")).toBeNull();
  });

  it("draws nothing below the head for an empty queue", () => {
    frame(emptyQueue());

    expect(screen.queryByRole("region", { name: "Decisions waiting" })).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
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
