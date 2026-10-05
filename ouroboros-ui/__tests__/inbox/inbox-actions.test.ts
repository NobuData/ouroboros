import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { ANSWER_FAILED, ITEM_SNOOZE_FAILED } from "@/app/inbox/card-view";
import { WAKE_FAILED } from "@/app/inbox/snoozed-view";

import { ALLOW_ITEM, actionResult } from "../helpers/inbox";

/**
 * A decision card's server hop (#467). The role gate, the first-answer-wins claim and the planes
 * are the service's: this sends one press with its key, and hands back how it ended — answered,
 * raced, or failed with a sentence — as a value the card can draw. A snoozed card's one (#470)
 * wakes it early, and hands a refusal back the same way.
 */

const answer = vi.fn();
const snoozeItem = vi.fn();
const unsnooze = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/inbox", async (original) => ({
  ...(await original<typeof import("@/app/api/inbox")>()),
  inbox: {
    answer: (itemId: string, actionId: string, body: unknown) => answer(itemId, actionId, body),
    snoozeItem: (itemId: string, minutes: number) => snoozeItem(itemId, minutes),
    unsnooze: (itemId: string) => unsnooze(itemId),
  },
}));

const { answerDecision, snoozeDecision, unsnoozeDecision } = await import("@/app/inbox/inbox-actions");

beforeEach(() => {
  answer.mockReset();
  snoozeItem.mockReset();
  unsnooze.mockReset();
});

describe("answerDecision", () => {
  it("sends the press with its key, and returns the resolution and its receipt", async () => {
    answer.mockResolvedValue(actionResult());

    const outcome = await answerDecision(ALLOW_ITEM, "allow_once", { idempotencyKey: "key-1" });

    expect(answer).toHaveBeenCalledExactlyOnceWith(ALLOW_ITEM, "allow_once", { idempotencyKey: "key-1" });
    expect(outcome).toEqual({ outcome: "answered", result: actionResult() });
  });

  it("carries a note, trimmed — and no note at all when it is blank", async () => {
    answer.mockResolvedValue(actionResult());

    await answerDecision(ALLOW_ITEM, "waive_annotate", { idempotencyKey: "k", note: "  no thermal chamber  " });
    await answerDecision(ALLOW_ITEM, "allow_once", { idempotencyKey: "k", note: "   " });

    expect(answer.mock.calls[0]![2]).toEqual({ idempotencyKey: "k", note: "no thermal chamber" });
    expect(answer.mock.calls[1]![2]).toEqual({ idempotencyKey: "k" });
  });

  it("cuts a note to the service's limit rather than have the whole press refused", async () => {
    answer.mockResolvedValue(actionResult());

    await answerDecision(ALLOW_ITEM, "waive_annotate", { idempotencyKey: "k", note: "x".repeat(2500) });

    expect((answer.mock.calls[0]![2] as { note: string }).note).toHaveLength(2000);
  });

  it("answers a 409 decision_already_answered as a race, with the winner", async () => {
    answer.mockRejectedValue(
      new ApiError(409, "decision_already_answered", "This decision was already answered by Priya.", {
        itemId: ALLOW_ITEM,
        resolution: {
          actionId: "deny",
          resolver: "human",
          policy: null,
          actor: { id: "u-priya", name: "Priya" },
          channel: "email",
          resolvedAt: "2026-10-04T13:20:00.000Z",
        },
      }),
    );

    expect(await answerDecision(ALLOW_ITEM, "allow_once", { idempotencyKey: "k" })).toEqual({
      outcome: "raced",
      winner: {
        who: "Priya",
        policy: null,
        actionId: "deny",
        resolvedAtMs: Date.parse("2026-10-04T13:20:00.000Z"),
      },
    });
  });

  it.each([
    [409, "decision_action_in_progress", "Priya is answering this decision right now."],
    [409, "allow_once_still_blocked", "The guardrails still block this run."],
    [409, "decision_item_expired", "This decision expired before it was answered."],
    [403, "decision_action_forbidden", "Approving needs the approve-loops capability."],
    [501, "decision_action_unbound", "This action's plane is not built yet."],
  ])("hands a %i %s back as a failure with the service's own sentence", async (status, code, message) => {
    answer.mockRejectedValue(new ApiError(status, code, message));

    expect(await answerDecision(ALLOW_ITEM, "allow_once", { idempotencyKey: "k" })).toEqual({
      outcome: "failed",
      reason: message,
    });
  });

  it("says something plain for the service's own failure, and for a malformed request", async () => {
    answer.mockRejectedValueOnce(new ApiError(500, "internal_error", "Something went wrong."));
    answer.mockRejectedValueOnce(new ApiError(422, "validation_failed", "The request is not valid."));
    answer.mockRejectedValueOnce(new ApiError(409, "decision_already_answered", "Already answered.", {}));

    expect(await answerDecision(ALLOW_ITEM, "allow_once", { idempotencyKey: "k" })).toEqual({
      outcome: "failed",
      reason: ANSWER_FAILED,
    });
    expect(await answerDecision(ALLOW_ITEM, "allow_once", { idempotencyKey: "k" })).toEqual({
      outcome: "failed",
      reason: ANSWER_FAILED,
    });
    // A race the service could not describe is still told in the service's words.
    expect(await answerDecision(ALLOW_ITEM, "allow_once", { idempotencyKey: "k" })).toEqual({
      outcome: "failed",
      reason: "Already answered.",
    });
  });

  it("lets anything that is not the service's refusal throw", async () => {
    answer.mockRejectedValue(new TypeError("fetch failed"));

    await expect(answerDecision(ALLOW_ITEM, "allow_once", { idempotencyKey: "k" })).rejects.toThrow("fetch failed");
  });
});

describe("snoozeDecision", () => {
  const snoozed = { snoozed: [ALLOW_ITEM], until: "2026-10-04T14:20:00.000Z", eventId: "e-1" };

  it("snoozes the item for the minutes asked", async () => {
    snoozeItem.mockResolvedValue(snoozed);

    expect(await snoozeDecision(ALLOW_ITEM, 240)).toEqual({ ok: true, value: snoozed });
    expect(snoozeItem).toHaveBeenCalledExactlyOnceWith(ALLOW_ITEM, 240);
  });

  it("keeps the minutes inside the service's one minute to one week", async () => {
    snoozeItem.mockResolvedValue(snoozed);

    await snoozeDecision(ALLOW_ITEM, 0);
    await snoozeDecision(ALLOW_ITEM, 99_999);
    await snoozeDecision(ALLOW_ITEM, Number.NaN);

    expect(snoozeItem.mock.calls.map((call) => call[1])).toEqual([1, 10_080, 60]);
  });

  it("hands a refusal back as its sentence, and the service's own failure as a plain one", async () => {
    snoozeItem.mockRejectedValueOnce(new ApiError(403, "forbidden", "Viewers may not snooze."));
    snoozeItem.mockRejectedValueOnce(new ApiError(500, "internal_error", "Something went wrong."));

    expect(await snoozeDecision(ALLOW_ITEM, 60)).toEqual({ ok: false, reason: "Viewers may not snooze." });
    expect(await snoozeDecision(ALLOW_ITEM, 60)).toEqual({ ok: false, reason: ITEM_SNOOZE_FAILED });
  });
});

describe("unsnoozeDecision", () => {
  it("wakes the item and hands back what came back to the queue", async () => {
    unsnooze.mockResolvedValue({ unsnoozed: [ALLOW_ITEM] });

    expect(await unsnoozeDecision(ALLOW_ITEM)).toEqual({ ok: true, value: { unsnoozed: [ALLOW_ITEM] } });
    expect(unsnooze).toHaveBeenCalledExactlyOnceWith(ALLOW_ITEM);
  });

  it("counts an item that was no longer snoozed as back — it is, either way", async () => {
    unsnooze.mockResolvedValue({ unsnoozed: [] });

    expect(await unsnoozeDecision(ALLOW_ITEM)).toEqual({ ok: true, value: { unsnoozed: [] } });
  });

  it("hands a viewer's refusal back as its sentence, and the service's own failure as a plain one", async () => {
    unsnooze.mockRejectedValueOnce(new ApiError(403, "forbidden", "Viewers may not wake a decision."));
    unsnooze.mockRejectedValueOnce(new ApiError(500, "internal_error", "Something went wrong."));

    expect(await unsnoozeDecision(ALLOW_ITEM)).toEqual({ ok: false, reason: "Viewers may not wake a decision." });
    expect(await unsnoozeDecision(ALLOW_ITEM)).toEqual({ ok: false, reason: WAKE_FAILED });
  });

  it("lets anything that is not the service's refusal through", async () => {
    unsnooze.mockRejectedValue(new TypeError("boom"));

    await expect(unsnoozeDecision(ALLOW_ITEM)).rejects.toThrow("boom");
  });
});
