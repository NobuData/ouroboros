import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxSnoozedItem } from "@/app/api/inbox";
import { VIEWER_CANNOT_WAKE, WAKE_FAILED, WOKEN } from "@/app/inbox/snoozed-view";

import { INBOX_READ_AT, snoozedItem, utcClock } from "../helpers/inbox";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The snoozed section (BO.5, #470): dimmed cards with their severity, the question, the original
 * age still counting, a live countdown to the wake, and *Wake now* — inert for a viewer.
 */

const unsnoozeDecision = vi.fn();

vi.mock("@/app/inbox/inbox-actions", () => ({
  unsnoozeDecision: (itemId: string) => unsnoozeDecision(itemId),
}));

const { SnoozedList } = await import("@/app/inbox/snoozed-list");

/** The service's clock when the queue was read, whole seconds. */
const AS_OF = Math.floor(INBOX_READ_AT / 1000);

/** A blocking decision asked eight minutes ago and snoozed until 13:42 — 22 minutes from now. */
const BLOCKING = snoozedItem({
  id: "snoozed-1",
  severity: "err",
  question: "Approve merge for a refactor PR?",
  createdAt: "2026-10-04T13:12:00.000Z",
  ageSeconds: 480,
  snoozedUntil: "2026-10-04T13:42:00.000Z",
  refs: [
    { type: "pr", id: "p-1", label: "PR #504", href: "/prs/p-1" },
    { type: "path", id: "docs/a.md", label: "docs/a.md", href: null },
  ],
});

const onWoken = vi.fn();

/** The section over these items. */
function list(items: readonly InboxSnoozedItem[] = [BLOCKING]) {
  return render(<SnoozedList asOfSeconds={AS_OF} clock={utcClock} items={items} onWoken={onWoken} />);
}

/** The one snoozed card. */
const card = () => screen.getByRole("article", { name: BLOCKING.question });

beforeEach(() => {
  unsnoozeDecision.mockReset();
  onWoken.mockReset();
  vi.spyOn(Date, "now").mockReturnValue(INBOX_READ_AT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the section", () => {
  it("is named, headed with its count, and draws one dimmed card per item", () => {
    list([BLOCKING, snoozedItem()]);

    const section = screen.getByRole("region", { name: "Snoozed" });

    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Snoozed (2)");
    expect(within(section).getAllByRole("article")).toHaveLength(2);
    for (const article of within(section).getAllByRole("article")) expect(article).toHaveClass("inbox-snoozed");
  });

  it("draws nothing when nothing is snoozed", () => {
    const { container } = list([]);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("a snoozed card", () => {
  it("shows its severity on the border and in words, and its question", () => {
    list();

    expect(card().querySelector(".inbox-snoozed__body")).toHaveClass("inbox-snoozed__body--err");
    expect(within(card()).getByText("Blocking")).toBeInTheDocument();
    expect(within(card()).getByRole("heading", { level: 3 })).toHaveTextContent(BLOCKING.question);
  });

  it("links its refs where the service said, and leaves the rest as text", () => {
    list();

    expect(within(card()).getByRole("link", { name: "PR #504" })).toHaveAttribute("href", "/prs/p-1");
    expect(within(card()).getByText("docs/a.md").tagName).toBe("SPAN");
  });

  it("shows its original age and a countdown to when it wakes, with the wake time", () => {
    list();

    expect(card().querySelector(".inbox-snoozed__age")).toHaveTextContent("8m");
    expect(card().querySelector(".inbox-snoozed__age .sr-only")).toHaveTextContent("asked 8m ago");
    expect(card().querySelector(".inbox-snoozed__countdown")).toHaveTextContent("wakes in 22m");
    expect(within(card()).getByText("until 13:42")).toBeInTheDocument();
  });

  it("ticks both without a reload — the age keeps counting through the snooze", () => {
    vi.useFakeTimers();
    vi.setSystemTime(INBOX_READ_AT);
    list();

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(card().querySelector(".inbox-snoozed__age")).toHaveTextContent("9m");
    expect(card().querySelector(".inbox-snoozed__countdown")).toHaveTextContent("wakes in 20m");
  });

  it("says it is waking once its time has come", () => {
    list([{ ...BLOCKING, snoozedUntil: "2026-10-04T13:19:00.000Z" }]);

    expect(card().querySelector(".inbox-snoozed__countdown")).toHaveTextContent("waking now");
  });
});

describe("Wake now", () => {
  it("wakes the item, says it is back, and tells the page to re-read", async () => {
    unsnoozeDecision.mockResolvedValue({ ok: true, value: { unsnoozed: [BLOCKING.id] } });
    list();

    await act(async () => {
      fireEvent.click(within(card()).getByRole("button", { name: `Wake now: ${BLOCKING.question}` }));
    });

    expect(unsnoozeDecision).toHaveBeenCalledExactlyOnceWith(BLOCKING.id);
    expect(onWoken).toHaveBeenCalledExactlyOnceWith(BLOCKING.id);
    expect(within(card()).getByRole("status")).toHaveTextContent(WOKEN);
    expect(within(card()).queryByRole("button", { name: /Wake now/ })).toBeNull();
  });

  it("sends one wake for a double press", async () => {
    let finish: (value: unknown) => void = () => {};
    unsnoozeDecision.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    list();

    const wake = within(card()).getByRole("button", { name: `Wake now: ${BLOCKING.question}` });
    fireEvent.click(wake);
    fireEvent.click(wake);

    expect(wake).toHaveTextContent("Waking…");
    expect(wake).toHaveAttribute("aria-disabled", "true");
    expect(unsnoozeDecision).toHaveBeenCalledOnce();

    await act(async () => finish({ ok: true, value: { unsnoozed: [BLOCKING.id] } }));
  });

  it("leaves the card snoozed with the refusal under it", async () => {
    unsnoozeDecision.mockResolvedValue({ ok: false, reason: "Viewers may not wake a decision." });
    list();

    await act(async () => {
      fireEvent.click(within(card()).getByRole("button", { name: `Wake now: ${BLOCKING.question}` }));
    });

    expect(within(card()).getByRole("alert")).toHaveTextContent("Viewers may not wake a decision.");
    expect(card().querySelector(".inbox-snoozed__countdown")).toHaveTextContent("wakes in 22m");
    expect(onWoken).not.toHaveBeenCalled();
  });

  it("says a plain sentence when the hop itself fails", async () => {
    unsnoozeDecision.mockRejectedValue(new Error("network"));
    list();

    await act(async () => {
      fireEvent.click(within(card()).getByRole("button", { name: `Wake now: ${BLOCKING.question}` }));
    });

    expect(within(card()).getByRole("alert")).toHaveTextContent(WAKE_FAILED);
  });
});

describe("as a member and as a viewer", () => {
  it("lets a member wake it — the service resolved the snooze as theirs to undo", () => {
    list([{ ...BLOCKING, snooze: { allowed: true } }]);

    const wake = within(card()).getByRole("button", { name: `Wake now: ${BLOCKING.question}` });

    expect(wake).not.toHaveAttribute("aria-disabled");
  });

  it("draws Wake now inert for a viewer, with the reason, and never sends it", () => {
    list([{ ...BLOCKING, snooze: { allowed: false } }]);

    const wake = within(card()).getByRole("button", { name: `Wake now: ${BLOCKING.question}` });

    expect(wake).toHaveAttribute("aria-disabled", "true");
    expect(wake).toHaveAttribute("title", VIEWER_CANNOT_WAKE);

    fireEvent.click(wake);
    expect(unsnoozeDecision).not.toHaveBeenCalled();
  });
});

describe("both themes", () => {
  it("draws the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(
      <SnoozedList asOfSeconds={AS_OF} clock={utcClock} items={[BLOCKING]} onWoken={onWoken} />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
