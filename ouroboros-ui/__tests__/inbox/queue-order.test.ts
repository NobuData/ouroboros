import { describe, expect, it, vi } from "vitest";

import { cardsOnScreen } from "@/app/inbox/queue-list";

import { inboxItem } from "../helpers/inbox";

/** The queue's order (#538): what the service sent, with the cards pressed here kept in place. */

// The list's cards import server actions, which a test cannot load; ordering needs none of them.
vi.mock("@/app/inbox/inbox-actions", () => ({}));

const OLD = inboxItem({ id: "item-old", createdAt: "2026-10-04T12:00:00.000Z" });
const NEW = inboxItem({ id: "item-new", createdAt: "2026-10-04T13:00:00.000Z" });
const ESCALATED = inboxItem({
  id: "item-escalated",
  createdAt: "2026-10-04T11:00:00.000Z",
  escalatedAt: "2026-10-04T11:30:00.000Z",
});

describe("cardsOnScreen", () => {
  it("draws the service's order untouched when no pressed card is kept", () => {
    const items = [ESCALATED, NEW, OLD];

    expect(cardsOnScreen(items, new Map()).map((item) => item.id)).toEqual([
      "item-escalated",
      "item-new",
      "item-old",
    ]);
  });

  it("keeps an escalated item first when a pressed card is merged back in", () => {
    const pressed = inboxItem({ id: "item-pressed", createdAt: "2026-10-04T12:30:00.000Z" });
    const cards = cardsOnScreen([ESCALATED, NEW, OLD], new Map([[pressed.id, pressed]]));

    expect(cards.map((item) => item.id)).toEqual([
      "item-escalated",
      "item-new",
      "item-pressed",
      "item-old",
    ]);
  });

  it("orders two escalated items newest first between themselves", () => {
    const later = inboxItem({
      id: "item-escalated-later",
      createdAt: "2026-10-04T11:45:00.000Z",
      escalatedAt: "2026-10-04T12:15:00.000Z",
    });
    const pressed = inboxItem({ id: "item-pressed", createdAt: "2026-10-04T10:00:00.000Z" });
    const cards = cardsOnScreen([later, ESCALATED, NEW], new Map([[pressed.id, pressed]]));

    expect(cards.map((item) => item.id)).toEqual([
      "item-escalated-later",
      "item-escalated",
      "item-new",
      "item-pressed",
    ]);
  });
});
