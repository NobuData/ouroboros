import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxItem } from "@/app/api/inbox";
import {
  ANSWERING,
  ANSWER_FAILED,
  ANSWER_IN_FLIGHT,
  NEEDS_APPROVER,
  NOTE_REQUIRED,
  VIEWER_CANNOT_SNOOZE_ITEM,
  type DecisionAnswer,
} from "@/app/inbox/card-view";

import {
  ALLOW_ITEM,
  INBOX_READ_AT,
  MERGE_ITEM,
  WAIVE_ITEM,
  actionResult,
  inboxAction,
  inboxItem,
  seededItems,
  utcClock,
} from "../helpers/inbox";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * `DecisionCard` (BO.2, #467): the three seeded cards as mockup 16 draws them, and the answer
 * lifecycle — in flight, the receipt, someone else first, a failure that leaves the card asking —
 * with the consequence confirms, the role gates, the per-item snooze and the keyboard's path
 * through all of it.
 */

const answerDecision = vi.fn();
const snoozeDecision = vi.fn();

vi.mock("@/app/inbox/inbox-actions", () => ({
  answerDecision: (itemId: string, actionId: string, press: unknown) => answerDecision(itemId, actionId, press),
  snoozeDecision: (itemId: string, minutes: number) => snoozeDecision(itemId, minutes),
}));

const { DecisionCard } = await import("@/app/inbox/decision-card");

const AS_OF = Math.floor(INBOX_READ_AT / 1000);
const [MERGE, ALLOW, WAIVE] = seededItems() as [InboxItem, InboxItem, InboxItem];

/** Hears each press as it leaves, and each card that settles. */
const onPressed = vi.fn();
const onSettled = vi.fn();

/** One card. */
function card(item: InboxItem) {
  return render(
    <DecisionCard
      asOfSeconds={AS_OF}
      clock={utcClock}
      item={item}
      newKey={() => "key-1"}
      onPressed={onPressed}
      onSettled={onSettled}
    />,
  );
}

/** The card's frame. */
const article = () => screen.getByRole("article");

/** A press that the test settles by hand. */
function held(): { settle: (answer: DecisionAnswer) => Promise<void>; fail: () => Promise<void> } {
  let resolve!: (answer: DecisionAnswer) => void;
  let reject!: (error: Error) => void;

  answerDecision.mockReturnValue(
    new Promise<DecisionAnswer>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
  );

  return {
    settle: async (answer) => {
      await act(async () => resolve(answer));
    },
    fail: async () => {
      await act(async () => reject(new Error("fetch failed")));
    },
  };
}

beforeEach(() => {
  answerDecision.mockReset();
  snoozeDecision.mockReset();
  onPressed.mockReset();
  onSettled.mockReset();
  vi.spyOn(Date, "now").mockReturnValue(INBOX_READ_AT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the three seeded cards", () => {
  it("draws the merge approval as the mockup does: err border, question, 8m, tags, why, actions", () => {
    card(MERGE);

    expect(article().querySelector(".inbox-card__body")).toHaveClass("inbox-card__body--err");
    expect(screen.getByRole("heading", { level: 2, name: "Approve merge for a refactor PR?" })).toBeInTheDocument();
    expect(article().querySelector(".inbox-card__age")).toHaveTextContent("8m");
    expect(
      [...article().querySelectorAll(".inbox-card__refs .ou-tag")].map((tag) => tag.textContent),
    ).toEqual(["loop #1830", "PR #504", "issue #465", "refactor"]);
    expect(article().querySelector(".inbox-card__why")).toHaveTextContent(
      "Policy: anything labeled refactor needs a human. 13/13 checks green, verification matrix all ✓, +214 −180 across 6 files.",
    );
    expect([...article().querySelectorAll(".inbox-card__mono")].map((span) => span.textContent)).toEqual(["refactor"]);
    expect(
      [...article().querySelectorAll(".inbox-card__actions .inbox-card__action")].map((action) => action.firstElementChild?.textContent),
    ).toEqual(["Approve & merge", "Open PR verification →", "Return to loop with note"]);
    expect(screen.getByRole("button", { name: "Approve & merge" })).toHaveClass("ou-btn--primary");
    expect(screen.getByRole("link", { name: "Open PR verification →" })).toHaveClass("ou-btn", "ou-btn--ghost");
    expect(screen.getByRole("button", { name: "Return to loop with note" })).toHaveClass("ou-btn--ghost");
  });

  it("draws the protected-path card: warn, 21m, the path in mono, and the second link quietly", () => {
    card(ALLOW);

    expect(article().querySelector(".inbox-card__body")).toHaveClass("inbox-card__body--warn");
    expect(article().querySelector(".inbox-card__age")).toHaveTextContent("21m");
    expect(
      [...article().querySelectorAll(".inbox-card__refs .ou-tag")].map((tag) => tag.textContent),
    ).toEqual(["loop #1844", "issue #479", "boot/rollback_flag.c"]);
    expect([...article().querySelectorAll(".inbox-card__mono")].map((span) => span.textContent)).toEqual([
      "boot/rollback_flag.c",
    ]);
    expect(screen.getByRole("link", { name: "View diff →" })).toHaveClass("ou-btn");
    expect(screen.getByRole("link", { name: "Edit protected paths →" })).toHaveClass("inbox-card__quiet-link");
    expect(screen.getByRole("link", { name: "Edit protected paths →" })).not.toHaveClass("ou-btn");
    expect(screen.getByRole("button", { name: "Deny" })).toHaveClass("ou-btn--ghost");
  });

  it("draws the claim waiver: warn, 34m, the unlinked verification tag, and its consequence in the why", () => {
    card(WAIVE);

    expect(article().querySelector(".inbox-card__age")).toHaveTextContent("34m");
    expect(
      [...article().querySelectorAll(".inbox-card__refs .ou-tag")].map((tag) => tag.textContent),
    ).toEqual(["PR #514", "verification"]);
    expect(article().querySelector(".inbox-card__why")).toHaveTextContent("Waiving annotates the PR publicly.");
    expect(article().querySelectorAll(".inbox-card__mono")).toHaveLength(0);
    expect(
      [...article().querySelectorAll(".inbox-card__actions .inbox-card__action")].map((action) => action.firstElementChild?.textContent),
    ).toEqual(["Waive & annotate", "Require bench upgrade", "See evidence →"]);
  });

  it("draws an info card with a neutral border, and says each severity in words", () => {
    card(inboxItem({ severity: "info" }));
    expect(article().querySelector(".inbox-card__body")).toHaveClass("inbox-card__body--info");
    expect(article()).toHaveTextContent("FYI:");
    cleanup();

    card(MERGE);
    expect(article()).toHaveTextContent("Blocking:");
  });

  it("renders the same markup in both palettes — every hue is a token", () => {
    for (const item of seededItems()) {
      const [light, dark] = renderInBothPalettes(
        <DecisionCard asOfSeconds={AS_OF} clock={utcClock} item={item} newKey={() => "k"} />,
      );

      expect(maskIds(light!)).toBe(maskIds(dark!));
      expect(light).toContain("inbox-card__question");
    }
  });
});

describe("the live age", () => {
  it("ticks without a reload, from when the item was asked", () => {
    vi.useFakeTimers();
    vi.setSystemTime(INBOX_READ_AT);
    card(MERGE);

    expect(article().querySelector(".inbox-card__age")).toHaveTextContent("8m");

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(article().querySelector(".inbox-card__age")).toHaveTextContent("9m");
    expect(article().querySelector(".inbox-card__age .sr-only")).toHaveTextContent("asked 9m ago");
  });
});

describe("ref tags are navigation", () => {
  it("links each tag to the surface the service resolved: run console, PR verification, intake, diff", () => {
    card(MERGE);
    expect(screen.getByRole("link", { name: "loop #1830" })).toHaveAttribute(
      "href",
      "/runs/5eed0009-0000-4000-8000-000000001830",
    );
    expect(screen.getByRole("link", { name: "PR #504" })).toHaveAttribute(
      "href",
      "/prs/5eed003a-0000-4000-8000-000000000504",
    );
    expect(screen.getByRole("link", { name: "issue #465" })).toHaveAttribute("href", "/issues?q=%23465");
    // A plain tag is not a link.
    expect(screen.queryByRole("link", { name: "refactor" })).toBeNull();
    cleanup();

    card(ALLOW);
    expect(screen.getByRole("link", { name: "boot/rollback_flag.c" })).toHaveAttribute(
      "href",
      "/runs/5eed0009-0000-4000-8000-000000001844#run-changes",
    );
  });

  it("draws a ref with no page as a tag, not a dead link", () => {
    card(inboxItem({ refs: [{ type: "path", id: "docs/a.md", label: "docs/a.md", href: null }] }));

    expect(screen.queryByRole("link", { name: "docs/a.md" })).toBeNull();
    expect(screen.getByText("docs/a.md")).toHaveClass("ou-tag");
  });

  it("never links off-site, whatever arrives: the tag is plain and the receipt link is dropped", async () => {
    answerDecision.mockResolvedValue({
      outcome: "answered",
      result: actionResult({
        receipt: {
          effects: ["exception granted"],
          links: [
            { label: "Elsewhere", href: "https://evil.test/runs" },
            { label: "Run console", href: "/runs/r-1" },
          ],
        },
      }),
    });
    card(inboxItem({ ...ALLOW, refs: [{ type: "run", id: "r", label: "loop #9", href: "//evil.test/r" }] }));

    expect(screen.queryByRole("link", { name: "loop #9" })).toBeNull();
    expect(screen.getByText("loop #9")).toHaveClass("ou-tag");

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("exception granted"));
    expect(within(screen.getByRole("status")).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Run console →",
    ]);
  });

  it("sends link actions where the service said", () => {
    card(ALLOW);

    expect(screen.getByRole("link", { name: "View diff →" })).toHaveAttribute(
      "href",
      "/runs/5eed0009-0000-4000-8000-000000001844#run-changes",
    );
    expect(screen.getByRole("link", { name: "Edit protected paths →" })).toHaveAttribute("href", "/knowledge#repo-profile");
  });
});

describe("answering", () => {
  it("answers on one press: in flight, then the receipt with what executed and where to see it", async () => {
    const press = held();
    card(ALLOW);

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    expect(answerDecision).toHaveBeenCalledExactlyOnceWith(ALLOW_ITEM, "allow_once", { idempotencyKey: "key-1" });
    expect(onPressed).toHaveBeenCalledExactlyOnceWith(ALLOW_ITEM);
    expect(screen.getByRole("status")).toHaveTextContent(ANSWERING);
    // Everything else on the card waits for the answer.
    expect(screen.getByRole("button", { name: "Deny" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Deny" })).toHaveAttribute("title", ANSWER_IN_FLIGHT);
    expect(onSettled).not.toHaveBeenCalled();

    await press.settle({ outcome: "answered", result: actionResult() });

    expect(screen.getByRole("status")).toHaveTextContent("Answered: exception granted · resume sent to loop #1844");
    expect(within(screen.getByRole("status")).getByRole("link", { name: "Run console →" })).toHaveAttribute(
      "href",
      "/runs/5eed0009-0000-4000-8000-000000001844",
    );
    // Answered: nothing left to press.
    expect(within(article()).queryByRole("button")).toBeNull();
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(ALLOW_ITEM);
  });

  it("drops a second press while the first is in flight", () => {
    held();
    card(ALLOW);

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(answerDecision).toHaveBeenCalledTimes(1);
  });

  it("renders a concurrent answer as a state of the card — who, when, with what — and no alert", async () => {
    const press = held();
    card(MERGE);

    fireEvent.click(screen.getByRole("button", { name: "Approve & merge" }));
    await press.settle({
      outcome: "raced",
      winner: { who: "Priya", policy: null, actionId: "approve_merge", resolvedAtMs: INBOX_READ_AT - 10_000 },
    });

    expect(screen.getByRole("status")).toHaveTextContent("Answered by Priya 10s ago — Approve & merge.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(article()).queryByRole("button")).toBeNull();
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(MERGE_ITEM);
  });

  it("leaves the card open and answerable when the handler fails, with the reason beside it", async () => {
    const press = held();
    card(ALLOW);

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await press.settle({ outcome: "failed", reason: "The guardrails still block this run." });

    expect(screen.getByRole("alert")).toHaveTextContent("The guardrails still block this run.");
    expect(screen.getByRole("button", { name: "Allow once" })).not.toHaveAttribute("aria-disabled");
    expect(onSettled).not.toHaveBeenCalled();

    // A second try is a new press.
    answerDecision.mockResolvedValue({ outcome: "answered", result: actionResult() });
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("exception granted"));
    expect(answerDecision).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("treats a press that never arrived the same way: open, with a plain reason", async () => {
    const press = held();
    card(ALLOW);

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await press.fail();

    expect(screen.getByRole("alert")).toHaveTextContent(ANSWER_FAILED);
    expect(screen.getByRole("button", { name: "Allow once" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("consequence confirms", () => {
  it("confirms Waive & annotate with the kind's own declared sentence, and carries the note", async () => {
    answerDecision.mockResolvedValue({
      outcome: "answered",
      result: actionResult({
        itemId: WAIVE_ITEM,
        receipt: {
          effects: ["claim waived", "PR annotated publicly"],
          links: [{ label: "PR verification", href: "/prs/5eed003a-0000-4000-8000-000000000514#criteria" }],
        },
      }),
    });
    card(WAIVE);

    fireEvent.click(screen.getByRole("button", { name: "Waive & annotate" }));

    const panel = screen.getByRole("form", { name: "Waive & annotate" });
    expect(panel).toHaveAccessibleDescription("Waives the claim with your reason and annotates the PR publicly.");
    expect(answerDecision).not.toHaveBeenCalled();
    expect(within(panel).getByRole("textbox", { name: "Note" })).toHaveFocus();

    fireEvent.change(within(panel).getByRole("textbox", { name: "Note" }), {
      target: { value: "  The rig has no thermal chamber until Q1.  " },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Waive & annotate" }));

    expect(answerDecision).toHaveBeenCalledExactlyOnceWith(WAIVE_ITEM, "waive_annotate", {
      idempotencyKey: "key-1",
      note: "The rig has no thermal chamber until Q1.",
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("claim waived · PR annotated publicly"),
    );
  });

  it("opens an inline field for Return to loop with note, and delivers the note", async () => {
    answerDecision.mockResolvedValue({ outcome: "answered", result: actionResult({ itemId: MERGE_ITEM }) });
    card(MERGE);

    const opener = screen.getByRole("button", { name: "Return to loop with note" });
    fireEvent.click(opener);

    expect(opener).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("form", { name: "Return to loop with note" });
    expect(panel).toHaveTextContent("Sends the loop back with your note as steering; the PR stays unmerged.");

    fireEvent.change(within(panel).getByRole("textbox", { name: "Note" }), {
      target: { value: "Split the HAL change out first." },
    });
    fireEvent.submit(panel);

    expect(answerDecision).toHaveBeenCalledExactlyOnceWith(MERGE_ITEM, "return_to_loop", {
      idempotencyKey: "key-1",
      note: "Split the HAL change out first.",
    });
    await waitFor(() => expect(within(article()).queryByRole("form")).toBeNull());
  });

  it("will not send a note-taking answer without its note", () => {
    card(WAIVE);

    fireEvent.click(screen.getByRole("button", { name: "Waive & annotate" }));
    const panel = screen.getByRole("form", { name: "Waive & annotate" });
    fireEvent.change(within(panel).getByRole("textbox", { name: "Note" }), { target: { value: "   " } });
    fireEvent.submit(panel);

    expect(answerDecision).not.toHaveBeenCalled();
    expect(within(panel).getByRole("textbox", { name: "Note" })).toHaveAccessibleDescription(
      expect.stringContaining(NOTE_REQUIRED),
    );
  });

  it("gives the reader their note back when the answer fails, so a retry is one press", async () => {
    answerDecision.mockResolvedValueOnce({ outcome: "failed", reason: "The host refused the annotation." });
    card(WAIVE);

    fireEvent.click(screen.getByRole("button", { name: "Waive & annotate" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "No thermal chamber." } });
    fireEvent.submit(screen.getByRole("form"));

    expect(await screen.findByRole("alert")).toHaveTextContent("The host refused the annotation.");
    expect(screen.queryByRole("form")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Waive & annotate" }));

    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("No thermal chamber.");
  });

  it("cancels a note panel without answering, and hands focus back to its button", () => {
    card(WAIVE);

    const opener = screen.getByRole("button", { name: "Waive & annotate" });
    fireEvent.click(opener);
    fireEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form")).toBeNull();
    expect(opener).toHaveFocus();
    expect(answerDecision).not.toHaveBeenCalled();
  });

  it("confirms a danger action in a dialog carrying its declared consequence", async () => {
    answerDecision.mockResolvedValue({ outcome: "answered", result: actionResult() });
    card(
      inboxItem({
        actions: [
          inboxAction({
            id: "cancel_run",
            label: "Cancel loop",
            style: "danger",
            consequenceText: "Stops the loop for good; its branch is kept.",
          }),
        ],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel loop" }));

    const dialog = screen.getByRole("alertdialog", { name: "Cancel loop" });
    expect(dialog).toHaveAccessibleDescription("Stops the loop for good; its branch is kept.");
    expect(answerDecision).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel loop" }));

    expect(answerDecision).toHaveBeenCalledExactlyOnceWith(MERGE_ITEM, "cancel_run", { idempotencyKey: "key-1" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("asks nothing of an ordinary answer — one press sends it", () => {
    held();
    card(MERGE);

    fireEvent.click(screen.getByRole("button", { name: "Approve & merge" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
    expect(answerDecision).toHaveBeenCalledTimes(1);
  });
});

describe("role gating comes from the server", () => {
  /** The merge card as a member without the approve capability sees it. */
  function asMember(): InboxItem {
    return inboxItem({
      actions: MERGE.actions.map((action) =>
        action.id === "approve_merge"
          ? { ...action, allowed: false, disabledReason: "capability_required" as const }
          : action,
      ),
    });
  }

  it("keeps a gated action on the card, inert, with its reason — and never sends it", () => {
    card(asMember());

    const approve = screen.getByRole("button", { name: "Approve & merge" });
    expect(approve).toHaveAttribute("aria-disabled", "true");
    expect(approve).toHaveAttribute("title", NEEDS_APPROVER);
    expect(approve).toHaveAccessibleDescription(NEEDS_APPROVER);

    fireEvent.click(approve);
    expect(answerDecision).not.toHaveBeenCalled();
    // What the reader may do is untouched.
    expect(screen.getByRole("button", { name: "Return to loop with note" })).not.toHaveAttribute("aria-disabled");
  });

  it("holds back a link the reader may not follow, as an inert button with the role it needs", () => {
    card(
      inboxItem({
        ...ALLOW,
        actions: ALLOW.actions.map((action) =>
          action.id === "edit_protected_paths"
            ? { ...action, allowed: false, disabledReason: "role_required" as const }
            : action,
        ),
      }),
    );

    expect(screen.queryByRole("link", { name: "Edit protected paths →" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit protected paths →" })).toHaveAttribute(
      "title",
      "Needs the admin role in this workspace.",
    );
  });
});

describe("per-item snooze", () => {
  it("offers durations, snoozes for the one chosen, then dims the card and says when it returns", async () => {
    snoozeDecision.mockResolvedValue({
      ok: true,
      value: { snoozed: [ALLOW_ITEM], until: "2026-10-04T17:20:00.000Z", eventId: "e-1" },
    });
    card(ALLOW);

    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));

    const choices = screen.getByRole("group", { name: "Snooze for" });
    expect(within(choices).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "1 hour",
      "4 hours",
      "1 day",
      "Cancel",
    ]);
    expect(within(choices).getByRole("button", { name: "1 hour" })).toHaveFocus();

    fireEvent.click(within(choices).getByRole("button", { name: "4 hours" }));

    expect(snoozeDecision).toHaveBeenCalledExactlyOnceWith(ALLOW_ITEM, 240);
    await waitFor(() => expect(article()).toHaveClass("inbox-card--snoozed"));
    expect(screen.getByRole("status")).toHaveTextContent("Snoozed until 17:20 — it returns to the queue then.");
    expect(within(article()).queryByRole("button")).toBeNull();
    expect(onPressed).toHaveBeenCalledExactlyOnceWith(ALLOW_ITEM);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(ALLOW_ITEM);
  });

  it("closes the durations without snoozing", () => {
    card(ALLOW);

    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Snooze for" })).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("group", { name: "Snooze for" })).toBeNull();
    expect(snoozeDecision).not.toHaveBeenCalled();
  });

  it("leaves the card asking when the snooze is refused", async () => {
    snoozeDecision.mockResolvedValue({ ok: false, reason: "This decision was answered a moment ago." });
    card(ALLOW);

    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    fireEvent.click(screen.getByRole("button", { name: "1 hour" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This decision was answered a moment ago.");
    expect(article()).not.toHaveClass("inbox-card--snoozed");
    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("is inert, with the reason, for a reader who may not snooze", () => {
    card(inboxItem({ snooze: { allowed: false } }));

    const snooze = screen.getByRole("button", { name: "Snooze" });
    expect(snooze).toHaveAttribute("aria-disabled", "true");
    expect(snooze).toHaveAttribute("title", VIEWER_CANNOT_SNOOZE_ITEM);

    fireEvent.click(snooze);
    expect(screen.queryByRole("group", { name: "Snooze for" })).toBeNull();
  });

  it("is asking again once a snooze made here has run out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INBOX_READ_AT);
    snoozeDecision.mockResolvedValue({
      ok: true,
      value: { snoozed: [ALLOW_ITEM], until: new Date(INBOX_READ_AT + 60_000).toISOString(), eventId: "e-1" },
    });
    card(ALLOW);

    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    fireEvent.click(screen.getByRole("button", { name: "1 hour" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(article()).toHaveClass("inbox-card--snoozed");

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(article()).not.toHaveClass("inbox-card--snoozed");
    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
  });
});

describe("keyboard and screen reader", () => {
  it("is a tab stop named by its question", () => {
    card(MERGE);

    expect(article()).toHaveAttribute("tabindex", "0");
    expect(article()).toHaveAccessibleName("Approve merge for a refactor PR?");
  });

  it("describes every action by its declared consequence", () => {
    card(ALLOW);

    expect(screen.getByRole("button", { name: "Allow once" })).toHaveAccessibleDescription(
      "Grants a single-use exception for this path on this run; the run resumes.",
    );
    expect(screen.getByRole("link", { name: "View diff →" })).toHaveAccessibleDescription(
      "Opens the diff in the run console; nothing is decided.",
    );
    expect(screen.getByRole("link", { name: "Edit protected paths →" })).toHaveAccessibleDescription(
      "Opens the protected-path settings; nothing is decided.",
    );
  });

  it("keeps a polite live region on the card from the start, so the resolution is announced", async () => {
    answerDecision.mockResolvedValue({ outcome: "answered", result: actionResult() });
    card(ALLOW);

    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() => expect(live).toHaveTextContent("exception granted"));
    // The same element, so an assistive technology that registered it hears the change.
    expect(screen.getByRole("status")).toBe(live);
  });

  it("moves focus to the card when the button that held it is gone, and describes it by the receipt", async () => {
    answerDecision.mockResolvedValue({ outcome: "answered", result: actionResult() });
    card(ALLOW);

    const allow = screen.getByRole("button", { name: "Allow once" });
    allow.focus();
    fireEvent.click(allow);

    await waitFor(() => expect(article()).toHaveFocus());
    expect(article()).toHaveAccessibleDescription(expect.stringContaining("exception granted"));
  });

  it("leaves focus alone when the reader has moved on before the answer lands", async () => {
    const press = held();
    render(
      <>
        <DecisionCard asOfSeconds={AS_OF} clock={utcClock} item={ALLOW} newKey={() => "k"} />
        <button type="button">elsewhere</button>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    screen.getByRole("button", { name: "elsewhere" }).focus();
    await press.settle({ outcome: "answered", result: actionResult() });

    expect(screen.getByRole("button", { name: "elsewhere" })).toHaveFocus();
  });

  it("reaches every ref tag and action by keyboard — links and buttons, none removed from the order", () => {
    card(ALLOW);

    const stops = within(article()).getAllByRole("link").concat(within(article()).getAllByRole("button"));

    expect(stops.length).toBe(3 + 2 + 2 + 1);
    for (const stop of stops) expect(stop).not.toHaveAttribute("tabindex", "-1");
  });
});
