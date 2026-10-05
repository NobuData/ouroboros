import { describe, expect, it } from "vitest";

import { INBOX_QUEUE_ENDPOINT, isInboxQueue } from "@/app/inbox/queue-poll";

import { emptyQueue, inboxQueue } from "../helpers/inbox";

describe("the inbox poll (#466)", () => {
  it("asks this origin", () => {
    expect(INBOX_QUEUE_ENDPOINT).toBe("/api/inbox");
  });

  it("reads the queue, the empty one included", () => {
    expect(isInboxQueue(inboxQueue())).toBe(true);
    expect(isInboxQueue(emptyQueue())).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["a feed", { open: 3, bySeverity: { err: 1, warn: 2, info: 0 }, snoozed: 0 }],
    ["a queue without its sentence", { head: { count: 1 }, items: [], snoozed: [] }],
    ["a negative count", { head: { count: -1, sentence: "" }, items: [], snoozed: [] }],
  ])("refuses %s", (_label, value) => {
    expect(isInboxQueue(value)).toBe(false);
  });
});
