import { renderDecision } from "../decisions/decision.templates";
import { MOCKUP_PROSE, SEEDED_PAYLOADS, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import type { DecisionAction, PublishedDecisionKind } from "../decisions/decision.types";
import {
  CONFIRM_IN_APP_LABEL,
  CONFIRM_IN_APP_LINE,
  ESCALATED_ANNOTATION,
  answers,
  decisionCard,
  decisionSystemLine,
  resolutionFootnote,
  resolvedDecisionCard,
  waitingFootnote,
  type DecisionCardSubject,
  type EscalationTimerState,
} from "./chat.cards.decision";
import {
  ASKED_AT,
  DRAWN_AT,
  ITEM,
  MAYA_ALLOWED,
  QUESTION,
  QUESTION_TIMER,
  UI_URL,
} from "./chat.fixture";

/**
 * Decision cards (#536): the kind registry's words, the kind's buttons, and a lifetime — open,
 * then resolved with no button left. Since #538 the footnote is read off the escalation timer,
 * and a merge-class decision's answers are one link into the app.
 */

/**
 * A subject for one shipped kind, rendered from its seeded facts.
 *
 * @param kind - The kind.
 * @returns The subject.
 */
function subjectOf(kind: PublishedDecisionKind): DecisionCardSubject {
  return {
    itemId: ITEM,
    kind,
    rendered: renderDecision(kind, SEEDED_PAYLOADS[kind.kindId] ?? {}),
    severity: kind.severityDefault,
    refs: [{ type: "run", id: "a1360000-0000-4000-8000-000000001851", label: "loop #1851" }],
    sourceRef: "fixture",
    askedAt: ASKED_AT,
  };
}

/**
 * A signed value for every action of a kind.
 *
 * @param kind - The kind.
 * @returns Values by action id.
 */
function valuesFor(kind: PublishedDecisionKind): Map<string, string> {
  return new Map(kind.actions.map((action) => [action.id, `signed:${action.id}`]));
}

describe("a decision card's words", () => {
  it.each(Object.values(SHIPPED_KINDS))(
    "takes $kindId's headline and body from the kind's own declaration",
    (kind) => {
      const card = decisionCard(subjectOf(kind), {
        uiUrl: UI_URL,
        values: valuesFor(kind),
        now: DRAWN_AT,
      });
      const prose = MOCKUP_PROSE[kind.kindId];

      expect(card.headline).toBe(prose.question);
      expect(card.lines[0]).toBe(prose.why);
    },
  );

  it("changes when the kind's declaration changes — with no change here", () => {
    const reworded: PublishedDecisionKind = {
      ...SHIPPED_KINDS.protected_path_allow_once,
      version: 2,
      questionTemplate: "May {subject} touch {path}?",
      whyTemplate: "It is a protected path; the change is {diff_lines} lines.",
    };
    const card = decisionCard(subjectOf(reworded), {
      uiUrl: UI_URL,
      values: valuesFor(reworded),
      now: DRAWN_AT,
    });

    expect(card.headline).toBe("May The OTA rollback fix touch boot/rollback_flag.c?");
    expect(card.lines[0]).toBe("It is a protected path; the change is 3 lines.");
  });

  it("changes its buttons when the kind's actions change", () => {
    const extra: DecisionAction = {
      id: "allow_always",
      label: "Always allow",
      style: "danger",
      required_role: "admin",
      consequence_text: "",
      takes_note: false,
      handler_binding: "guardrail.allow_always",
    };
    const kind: PublishedDecisionKind = {
      ...SHIPPED_KINDS.protected_path_allow_once,
      actions: [...SHIPPED_KINDS.protected_path_allow_once.actions, extra],
      resolutionSemantics: {
        ...SHIPPED_KINDS.protected_path_allow_once.resolutionSemantics,
        answered_by: ["allow_once", "deny", "allow_always"],
      },
    };
    const card = decisionCard(subjectOf(kind), {
      uiUrl: UI_URL,
      values: valuesFor(kind),
      now: DRAWN_AT,
    });

    expect(card.actions.at(-1)).toEqual({
      type: "answer",
      id: "allow_always",
      label: "Always allow",
      style: "danger",
      value: "signed:allow_always",
    });
  });
});

describe("a decision card's buttons", () => {
  it("gives an answer button to exactly the actions that answer, and a link to those that navigate", () => {
    const kind = SHIPPED_KINDS.protected_path_allow_once;
    const card = decisionCard(QUESTION, { uiUrl: UI_URL, values: valuesFor(kind), now: DRAWN_AT });

    expect(
      card.actions.filter((action) => action.type === "answer").map((action) => action.id),
    ).toEqual(kind.resolutionSemantics.answered_by);
    expect(
      card.actions.filter((action) => action.type === "link").map((action) => action.id),
    ).toEqual(["view_diff", "edit_protected_paths"]);
    expect(
      kind.actions.every(
        (action) => answers(kind, action) !== action.handler_binding.startsWith("navigate."),
      ),
    ).toBe(true);
  });

  it("never draws an answer button it has no signed value for", () => {
    const card = decisionCard(QUESTION, {
      uiUrl: UI_URL,
      values: new Map([["deny", "signed:deny"]]),
      now: DRAWN_AT,
    });

    expect(card.actions.filter((action) => action.type === "answer")).toEqual([
      { type: "answer", id: "deny", label: "Deny", style: "default", value: "signed:deny" },
    ]);
  });

  it("omits a link whose destination this decision cannot resolve", () => {
    // *View diff* leads to the run's changes; a decision with no run ref has nowhere to send it.
    const card = decisionCard(
      { ...QUESTION, refs: [] },
      {
        uiUrl: UI_URL,
        values: valuesFor(SHIPPED_KINDS.protected_path_allow_once),
        now: DRAWN_AT,
      },
    );

    expect(card.actions.map((action) => action.id)).not.toContain("view_diff");
    expect(card.lines).toHaveLength(1);
  });
});

/**
 * A pending timer due some minutes after the question was asked.
 *
 * @param minutes - The window.
 * @returns The timer.
 */
function dueAfter(minutes: number): EscalationTimerState {
  return {
    dueAt: new Date(ASKED_AT.getTime() + minutes * 60_000),
    firedAt: null,
    cancelledAt: null,
  };
}

describe("a merge-class decision's card", () => {
  const kind = SHIPPED_KINDS.merge_approval;
  const subject: DecisionCardSubject = {
    ...subjectOf(kind),
    refs: [
      { type: "run", id: "a1360000-0000-4000-8000-000000001851", label: "loop #1851" },
      { type: "pr", id: "a1370000-0000-4000-8000-000000000514", label: "PR #514" },
    ],
  };

  it("offers one link into the app instead of answers — even when signed values are supplied", () => {
    const card = decisionCard(subject, { uiUrl: UI_URL, values: valuesFor(kind), now: DRAWN_AT });

    expect(card.actions.filter((action) => action.type === "answer")).toEqual([]);
    expect(card.actions[0]).toEqual({
      type: "link",
      id: "confirm_in_app",
      label: CONFIRM_IN_APP_LABEL,
      url: `${UI_URL}/inbox?item=${ITEM}`,
    });
    // The kind's own link actions are still links; its two answers are nowhere.
    expect(card.actions.map((action) => action.id)).toEqual([
      "confirm_in_app",
      "open_verification",
    ]);
    expect(JSON.stringify(card)).not.toContain("signed:");
  });

  it("says why, after the kind's own lines", () => {
    const card = decisionCard(subject, { uiUrl: UI_URL, values: valuesFor(kind), now: DRAWN_AT });

    expect(card.lines).toEqual([
      MOCKUP_PROSE.merge_approval.why,
      "loop #1851 · PR #514",
      CONFIRM_IN_APP_LINE,
    ]);
  });

  it("builds the link on the UI origin without a doubled slash, and encodes the item", () => {
    const card = decisionCard(
      { ...subject, itemId: "item 1&2" },
      { uiUrl: `${UI_URL}//`, values: new Map(), now: DRAWN_AT },
    );

    expect(card.actions[0]).toMatchObject({ url: `${UI_URL}/inbox?item=item%201%262` });
  });

  it("is what makes the difference: the same subject, not merge-class, keeps its answer buttons", () => {
    const card = decisionCard(
      { ...subject, kind: { ...kind, mergeClass: false } },
      { uiUrl: UI_URL, values: valuesFor(kind), now: DRAWN_AT },
    );

    expect(
      card.actions.filter((action) => action.type === "answer").map((action) => action.id),
    ).toEqual(["approve_merge", "return_to_loop"]);
    expect(card.actions.map((action) => action.id)).not.toContain("confirm_in_app");
    expect(card.lines).not.toContain(CONFIRM_IN_APP_LINE);
  });

  it("counts down like any other card", () => {
    const card = decisionCard(subject, {
      uiUrl: UI_URL,
      values: valuesFor(kind),
      now: DRAWN_AT,
      timer: QUESTION_TIMER,
    });

    expect(card.footnote).toBe("paused 4m · escalates to the Needs-you inbox in 26m");
  });
});

describe("the countdown", () => {
  it("counts from when the decision was asked to when its timer is due", () => {
    expect(waitingFootnote(QUESTION, DRAWN_AT, QUESTION_TIMER)).toBe(
      "paused 4m · escalates to the Needs-you inbox in 26m",
    );
    expect(
      waitingFootnote(
        QUESTION,
        new Date(ASKED_AT.getTime() + 29 * 60_000 + 30_000),
        QUESTION_TIMER,
      ),
    ).toBe("paused 29m · escalates to the Needs-you inbox in 30s");
  });

  it("follows the timer, not a constant: a shorter window changes the line and nothing else", () => {
    // The same subject at the same instant — only the timer's due time differs.
    const usual = decisionCard(QUESTION, {
      uiUrl: UI_URL,
      values: valuesFor(SHIPPED_KINDS.protected_path_allow_once),
      now: DRAWN_AT,
      timer: dueAfter(30),
    });
    const shortened = decisionCard(QUESTION, {
      uiUrl: UI_URL,
      values: valuesFor(SHIPPED_KINDS.protected_path_allow_once),
      now: DRAWN_AT,
      timer: dueAfter(10),
    });

    expect(usual.footnote).toBe("paused 4m · escalates to the Needs-you inbox in 26m");
    expect(shortened.footnote).toBe("paused 4m · escalates to the Needs-you inbox in 6m");
    expect({ ...shortened, footnote: null }).toEqual({ ...usual, footnote: null });
  });

  it("follows a longer window too", () => {
    expect(waitingFootnote(QUESTION, DRAWN_AT, dueAfter(24 * 60))).toBe(
      "paused 4m · escalates to the Needs-you inbox in 23h 56m",
    );
  });

  it("does not read the kind's declared window — only the timer", () => {
    const slow = { ...QUESTION, kind: { ...QUESTION.kind, escalationWindow: "1 day" } };

    expect(waitingFootnote(slow, DRAWN_AT, QUESTION_TIMER)).toBe(
      "paused 4m · escalates to the Needs-you inbox in 26m",
    );
  });

  it.each([
    ["at the instant it is due", 30],
    ["a minute past due", 31],
    ["long past due, after downtime", 30 + 26 * 60],
  ])("never counts below zero: %s it is escalating, with no figure", (_when, minutes) => {
    const footnote = waitingFootnote(
      QUESTION,
      new Date(ASKED_AT.getTime() + minutes * 60_000),
      QUESTION_TIMER,
    );

    expect(footnote).toMatch(/^paused \S+( \S+)? · escalating to the Needs-you inbox$/);
    expect(footnote).not.toMatch(/ in |-\d/);
  });

  it("says escalating — not yet escalated — for a pending timer a minute overdue", () => {
    expect(
      waitingFootnote(QUESTION, new Date(ASKED_AT.getTime() + 31 * 60_000), QUESTION_TIMER),
    ).toBe("paused 31m · escalating to the Needs-you inbox");
  });

  it("carries the escalated annotation once the timer has fired", () => {
    const firedAt = new Date(ASKED_AT.getTime() + 30 * 60_000 + 4000);

    expect(
      waitingFootnote(QUESTION, new Date(ASKED_AT.getTime() + 31 * 60_000), {
        ...QUESTION_TIMER,
        firedAt,
      }),
    ).toBe(`paused 31m · ${ESCALATED_ANNOTATION}`);
    expect(ESCALATED_ANNOTATION).toBe("⚠ escalated — now in the Needs-you inbox");
  });

  it.each([
    ["no timer", undefined],
    ["a cancelled timer", { ...QUESTION_TIMER, cancelledAt: DRAWN_AT }],
    [
      "a timer cancelled after it fired",
      { ...QUESTION_TIMER, firedAt: DRAWN_AT, cancelledAt: DRAWN_AT },
    ],
  ])("promises nothing with %s: only the wait is stated", (_what, timer) => {
    expect(waitingFootnote(QUESTION, DRAWN_AT, timer)).toBe("paused 4m");
  });

  it("reads waiting, not paused, for a decision that holds no run up", () => {
    expect(waitingFootnote({ ...QUESTION, refs: [] }, DRAWN_AT, QUESTION_TIMER)).toBe(
      "waiting 4m · escalates to the Needs-you inbox in 26m",
    );
    expect(waitingFootnote({ ...QUESTION, refs: [] }, DRAWN_AT, undefined)).toBe("waiting 4m");
  });

  it("never states a negative wait, for a card drawn by a clock behind the one that asked", () => {
    expect(waitingFootnote(QUESTION, new Date(ASKED_AT.getTime() - 5000), QUESTION_TIMER)).toMatch(
      /^paused 0s · escalates to the Needs-you inbox in /,
    );
  });
});

describe("an escalated card", () => {
  const fired: EscalationTimerState = {
    ...QUESTION_TIMER,
    firedAt: new Date(ASKED_AT.getTime() + 30 * 60_000),
  };
  const now = new Date(ASKED_AT.getTime() + 31 * 60_000);

  it("is the same open card, annotated — its buttons still there to press", () => {
    const values = valuesFor(SHIPPED_KINDS.protected_path_allow_once);
    const before = decisionCard(QUESTION, { uiUrl: UI_URL, values, now, timer: QUESTION_TIMER });
    const after = decisionCard(QUESTION, { uiUrl: UI_URL, values, now, timer: fired });

    expect(after.footnote).toBe(`paused 31m · ${ESCALATED_ANNOTATION}`);
    expect(after.mark).toBe("⏸");
    expect({ ...after, footnote: null }).toEqual({ ...before, footnote: null });
    expect(
      after.actions.filter((action) => action.type === "answer").map((action) => action.id),
    ).toEqual(["allow_once", "deny"]);
  });
});

describe("the resolved card", () => {
  const resolved = resolvedDecisionCard(QUESTION, MAYA_ALLOWED);

  it("is the same card with no buttons, saying how it ended and who ended it", () => {
    const open = decisionCard(QUESTION, {
      uiUrl: UI_URL,
      values: valuesFor(SHIPPED_KINDS.protected_path_allow_once),
      now: DRAWN_AT,
    });

    expect(resolved.headline).toBe(open.headline);
    expect(resolved.lines).toEqual(open.lines);
    expect(resolved.actions).toEqual([]);
    expect(resolved.footnote).toBe("Maya Chen answered: allowed once · in Slack");
    expect(resolved.mark).toBe("✓");
  });

  it.each([
    [
      { ...MAYA_ALLOWED, actionId: "deny", channel: "web" as const },
      "Maya Chen answered: denied · in Ouroboros",
    ],
    [{ ...MAYA_ALLOWED, channel: "email" as const }, "Maya Chen answered: allowed once · by email"],
    [{ ...MAYA_ALLOWED, actorName: null }, "Someone answered: allowed once · in Slack"],
    [
      {
        resolver: "policy" as const,
        policy: "source_resolved",
        actionId: "source_resolved",
        actorName: null,
        channel: "api" as const,
      },
      "Closed — settled elsewhere",
    ],
    [
      {
        resolver: "policy" as const,
        policy: "auto_resize",
        actionId: "accept_resize",
        actorName: null,
        channel: "api" as const,
      },
      "Auto-accepted by policy",
    ],
  ])("says how it ended: %#", (resolution, footnote) => {
    expect(resolutionFootnote(resolution)).toBe(footnote);
  });
});

describe("the system line", () => {
  it("names the action by the kind's label and says what the decision was about", () => {
    expect(decisionSystemLine(QUESTION, MAYA_ALLOWED).text).toBe(
      "✓ Maya Chen answered: allow once — loop #1851",
    );
  });

  it("claims no effect it did not observe", () => {
    expect(decisionSystemLine(QUESTION, MAYA_ALLOWED).text).not.toMatch(/resumed|merged|continued/);
  });

  it("reads a policy's closure in the policy's words", () => {
    expect(
      decisionSystemLine(QUESTION, {
        resolver: "policy",
        policy: "source_resolved",
        actionId: "source_resolved",
        actorName: null,
        channel: "api",
      }).text,
    ).toBe("✓ Closed — settled elsewhere — loop #1851");
  });

  it("falls back to the action id for an action the kind no longer declares, and to no subject without refs", () => {
    expect(
      decisionSystemLine(
        { kind: QUESTION.kind, refs: [] },
        { ...MAYA_ALLOWED, actionId: "allow_twice" },
      ).text,
    ).toBe("✓ Maya Chen answered: allow twice");
  });
});
