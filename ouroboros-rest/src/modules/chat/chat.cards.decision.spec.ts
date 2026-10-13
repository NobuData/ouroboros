import { renderDecision } from "../decisions/decision.templates";
import { MOCKUP_PROSE, SEEDED_PAYLOADS, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import type { DecisionAction, PublishedDecisionKind } from "../decisions/decision.types";
import {
  answers,
  decisionCard,
  decisionSystemLine,
  resolutionFootnote,
  resolvedDecisionCard,
  waitingFootnote,
  type DecisionCardSubject,
} from "./chat.cards.decision";
import { ASKED_AT, DRAWN_AT, MAYA_ALLOWED, QUESTION, UI_URL } from "./chat.fixture";

/**
 * Decision cards (#536): the kind registry's words, the kind's buttons, and a lifetime — open,
 * then resolved with no button left.
 */

/**
 * A subject for one shipped kind, rendered from its seeded facts.
 *
 * @param kind - The kind.
 * @returns The subject.
 */
function subjectOf(kind: PublishedDecisionKind): DecisionCardSubject {
  return {
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

describe("the countdown", () => {
  it("counts from when the decision was asked to the end of the kind's window", () => {
    expect(waitingFootnote(QUESTION, DRAWN_AT)).toBe(
      "paused 4m · escalates to the Needs-you inbox in 26m",
    );
    expect(waitingFootnote(QUESTION, new Date(ASKED_AT.getTime() + 29 * 60_000 + 30_000))).toBe(
      "paused 29m · escalates to the Needs-you inbox in 30s",
    );
  });

  it("follows the kind's window, not a constant", () => {
    const slow = { ...QUESTION, kind: { ...QUESTION.kind, escalationWindow: "1 day" } };

    expect(waitingFootnote(slow, DRAWN_AT)).toBe(
      "paused 4m · escalates to the Needs-you inbox in 23h 56m",
    );
  });

  it("never counts below zero: past the window it says the decision escalated", () => {
    expect(waitingFootnote(QUESTION, new Date(ASKED_AT.getTime() + 31 * 60_000))).toBe(
      "paused 31m · escalated to the Needs-you inbox",
    );
  });

  it("reads waiting, not paused, for a decision that holds no run up", () => {
    expect(waitingFootnote({ ...QUESTION, refs: [] }, DRAWN_AT)).toMatch(/^waiting 4m · /);
  });

  it("states only the wait when the window cannot be read", () => {
    const odd = { ...QUESTION, kind: { ...QUESTION.kind, escalationWindow: "soon" } };

    expect(waitingFootnote(odd, DRAWN_AT)).toBe("paused 4m");
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
