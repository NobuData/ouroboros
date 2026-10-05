import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxItem } from "@/app/api/inbox";
import { LINK_UNAVAILABLE } from "@/app/inbox/card-view";

import { INBOX_READ_AT, actionResult, inboxAction, utcClock } from "../helpers/inbox";

/**
 * **The registry's promise, at the last mile** (BO.2, #467, decision X1): a kind no migration
 * declares renders correctly with **zero changes to the card**. The item below is what BN.4 serves
 * for `custom:fixture-oven` — the fixture kind BN.1's own generality proof registers
 * (`ouroboros-rest/src/modules/decisions/decision.kinds.fixture.ts`, `FIXTURE_KIND`) — with a
 * severity, facts, tags, a link target and action ids the card has never seen.
 *
 * The second half holds the claim structurally: the card's sources name no kind and no action.
 */

const answerDecision = vi.fn();

vi.mock("@/app/inbox/inbox-actions", () => ({
  answerDecision: (itemId: string, actionId: string, press: unknown) => answerDecision(itemId, actionId, press),
  snoozeDecision: vi.fn(),
}));

const { DecisionCard } = await import("@/app/inbox/decision-card");

const RUN = "5eed0009-0000-4000-8000-00000000f1c7";

/** `custom:fixture-oven`, as the queue serves one of its items to a member. */
const OVEN: InboxItem = {
  id: "5eed0082-0000-4000-8000-0000000000f1",
  kindId: "custom:fixture-oven",
  kindVersion: 1,
  severity: "warn",
  status: "open",
  question: "Let the oven at rig-7 run 20 minutes over?",
  why: "rig-7 drifted 3.5°C off its setpoint; extending lets the soak finish.",
  tags: ["rig-7", "farm"],
  facts: { rig: "rig-7", minutes: 20, drift_c: 3.5 },
  refs: [{ type: "run", id: RUN, label: "loop #1901", href: `/runs/${RUN}` }],
  mergeClass: false,
  actions: [
    inboxAction({ id: "extend", label: "Extend soak", style: "primary", consequenceText: "Extend soak." }),
    // A link target the service has no route for: it comes back with no destination.
    inboxAction({ id: "open_rig", label: "Open rig →", requiredRole: "viewer", navigates: true, href: null }),
    inboxAction({
      id: "abort",
      label: "Abort soak",
      style: "danger",
      requiredRole: "approver",
      consequenceText: "Abort soak.",
      takesNote: true,
      allowed: false,
      disabledReason: "capability_required",
    }),
  ],
  createdAt: "2026-10-04T13:17:00.000Z",
  ageSeconds: 180,
  snooze: { allowed: true },
};

beforeEach(() => {
  answerDecision.mockReset();
  vi.spyOn(Date, "now").mockReturnValue(INBOX_READ_AT);
});

describe("a kind the card has never seen", () => {
  it("renders from its declaration alone: severity, question, age, tags, why and the action row", () => {
    render(<DecisionCard asOfSeconds={Math.floor(INBOX_READ_AT / 1000)} clock={utcClock} item={OVEN} />);

    const card = screen.getByRole("article", { name: "Let the oven at rig-7 run 20 minutes over?" });

    expect(card.querySelector(".inbox-card__body")).toHaveClass("inbox-card__body--warn");
    expect(card.querySelector(".inbox-card__age")).toHaveTextContent("3m");
    expect([...card.querySelectorAll(".inbox-card__refs .ou-tag")].map((tag) => tag.textContent)).toEqual([
      "loop #1901",
      "rig-7",
      "farm",
    ]);
    expect(within(card).getByRole("link", { name: "loop #1901" })).toHaveAttribute("href", `/runs/${RUN}`);
    // Its own fact, in mono, by the same rule that marks a path on a shipped card.
    expect([...card.querySelectorAll(".inbox-card__mono")].map((span) => span.textContent)).toEqual(["rig-7"]);
    expect(card.querySelector(".inbox-card__why")).toHaveTextContent(OVEN.why);

    expect(within(card).getByRole("button", { name: "Extend soak" })).toHaveClass("ou-btn--primary");
    expect(within(card).getByRole("button", { name: "Abort soak" })).toHaveClass("ou-btn--danger");
    expect(within(card).getByRole("button", { name: "Abort soak" })).toHaveAttribute("aria-disabled", "true");
    // A link with nowhere to go is held back with the reason, not drawn as a dead anchor.
    expect(within(card).queryByRole("link", { name: "Open rig →" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Open rig →" })).toHaveAttribute("title", LINK_UNAVAILABLE);
  });

  it("answers through the same lifecycle, and prints whatever receipt the service composed", async () => {
    answerDecision.mockResolvedValue({
      outcome: "answered",
      result: actionResult({
        itemId: OVEN.id,
        kindId: OVEN.kindId,
        // An operation the service has no words for reads as the action in the past tense.
        receipt: { effects: ["extend"], links: [{ label: "Run console", href: `/runs/${RUN}` }] },
      }),
    });
    render(
      <DecisionCard asOfSeconds={Math.floor(INBOX_READ_AT / 1000)} clock={utcClock} item={OVEN} newKey={() => "k"} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Extend soak" }));

    expect(answerDecision).toHaveBeenCalledExactlyOnceWith(OVEN.id, "extend", { idempotencyKey: "k" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Answered: extend"));
    expect(screen.getByRole("link", { name: "Run console →" })).toHaveAttribute("href", `/runs/${RUN}`);
  });
});

describe("zero kind branches", () => {
  const INBOX = join(import.meta.dirname, "..", "..", "app", "inbox");
  const SOURCES = ["decision-card.tsx", "decision-actions.tsx", "card-view.ts", "use-decision.ts", "queue-list.tsx"];

  /** Every kind the registry ships, and every action id any of them declares (V093, V097). */
  const KINDS = [
    "merge_approval",
    "protected_path_allow_once",
    "claim_waiver",
    "plan_sign_off",
    "fact_review",
    "run_needs_human",
    "split_approval",
    "resize_review",
    "spend_approval",
  ];
  const ACTIONS = [
    "approve_merge",
    "open_verification",
    "return_to_loop",
    "allow_once",
    "view_diff",
    "edit_protected_paths",
    "waive_annotate",
    "require_bench_upgrade",
    "see_evidence",
    "sign_off",
    "view_plan",
    "open_fact",
    "retire",
    "retry_with_note",
    "cancel_run",
    "open_run",
    "approve_split",
    "open_batch",
    "accept_resize",
    "keep_size",
    "open_ticket",
    "approve_spend",
    "stop_loop",
  ];

  it.each(SOURCES)("%s names no kind, no action and no route of its own", (file) => {
    // Comments may tell the mockup's story; the code may not branch on it.
    const code = readFileSync(join(INBOX, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    for (const name of [...KINDS, ...ACTIONS]) {
      expect(code, `${file} mentions ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }

    expect(code, `${file} reads the item's kind`).not.toMatch(/\bkindId\b/);
    // Destinations are the service's: no path is composed here.
    expect(code, `${file} composes a route`).not.toMatch(/["'`]\/(runs|prs|issues|planning|knowledge|settings)\b/);
    // The one thing taken from the route module is the same-origin guard, never a route.
    for (const imported of code.matchAll(/import \{([^}]*)\} from "@\/app\/paths"/g)) {
      expect(imported[1]!.trim(), `${file} imports a route`).toBe("safeReturnTo");
    }
  });
});
