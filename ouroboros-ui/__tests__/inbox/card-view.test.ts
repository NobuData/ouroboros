import { describe, expect, it } from "vitest";

import {
  LINK_UNAVAILABLE,
  NEEDS_APPROVER,
  type CardPhase,
  actionShapes,
  answerStep,
  inFlight,
  inertReason,
  isAsking,
  liveAgeSeconds,
  raceLine,
  receiptLine,
  sitePath,
  snoozedLine,
  whySegments,
  winnerOf,
} from "@/app/inbox/card-view";

import { allowOnceActions, inboxAction, mergeActions, seededItems, utcClock, waiverActions } from "../helpers/inbox";

/**
 * A decision card's pure rules (#467): none of them names a kind — each is a rule about the shapes
 * BN.4 sends for every kind.
 */

describe("the why paragraph", () => {
  const [merge, allow, waive] = seededItems();

  it("sets the mockup's two mono spans — the label and the path — and nothing else", () => {
    expect(whySegments(merge!.why, merge!.facts).filter((segment) => segment.mono)).toEqual([
      { text: "refactor", mono: true },
    ]);
    expect(whySegments(allow!.why, allow!.facts).filter((segment) => segment.mono)).toEqual([
      { text: "boot/rollback_flag.c", mono: true },
    ]);
    expect(whySegments(waive!.why, waive!.facts).some((segment) => segment.mono)).toBe(false);
  });

  it("gives the paragraph back whole, in order", () => {
    for (const item of seededItems()) {
      expect(
        whySegments(item.why, item.facts)
          .map((segment) => segment.text)
          .join(""),
      ).toBe(item.why);
    }
  });

  it("leaves counts and phrases as prose — a number or a fact with a space is not a token", () => {
    const segments = whySegments("13/13 checks green, all ✓ across 6 files.", {
      checks_passed: 13,
      matrix_state: "all ✓",
      files: 6,
    });

    expect(segments).toEqual([{ text: "13/13 checks green, all ✓ across 6 files.", mono: false }]);
  });

  it("matches whole tokens only, and the longest fact first", () => {
    expect(whySegments("refactoring is not refactor.", { label: "refactor" })).toEqual([
      { text: "refactoring is not ", mono: false },
      { text: "refactor", mono: true },
      { text: ".", mono: false },
    ]);
    expect(whySegments("edit src/boot/flag.c now", { dir: "src/boot", path: "src/boot/flag.c" })).toEqual([
      { text: "edit ", mono: false },
      { text: "src/boot/flag.c", mono: true },
      { text: " now", mono: false },
    ]);
  });

  it("sets a key such as #486 in mono, and ignores one- and two-character facts", () => {
    expect(
      whySegments("The estimator re-sized #486 from L to M.", { ticket_key: "#486", from_effort: "L", to_effort: "M" }),
    ).toEqual([
      { text: "The estimator re-sized ", mono: false },
      { text: "#486", mono: true },
      { text: " from L to M.", mono: false },
    ]);
  });

  it("is plain prose with no facts at all", () => {
    expect(whySegments("Nothing to mark.", {})).toEqual([{ text: "Nothing to mark.", mono: false }]);
    expect(whySegments("", { path: "a/b.c" })).toEqual([]);
  });
});

describe("the live age", () => {
  const item = { createdAt: "2026-10-04T13:12:00.000Z", ageSeconds: 480 };
  const asked = Date.parse(item.createdAt) / 1000;

  it("counts from when it was asked, so it moves with the clock and not with a poll", () => {
    expect(liveAgeSeconds(item, asked + 480)).toBe(480);
    expect(liveAgeSeconds(item, asked + 541)).toBe(541);
  });

  it("never falls below the service's own reading — a slow browser clock cannot rewind it", () => {
    expect(liveAgeSeconds(item, asked + 100)).toBe(480);
  });

  it("falls back to the service's reading for a stamp it cannot parse", () => {
    expect(liveAgeSeconds({ createdAt: "soon", ageSeconds: 30 }, asked)).toBe(30);
  });
});

describe("the action row's shapes", () => {
  it("draws answers as buttons, the first link as a button-link and any later link quietly", () => {
    expect(actionShapes(mergeActions())).toEqual(["answer", "link", "answer"]);
    expect(actionShapes(allowOnceActions())).toEqual(["answer", "link", "answer", "quiet-link"]);
    expect(actionShapes(waiverActions())).toEqual(["answer", "answer", "link"]);
    expect(actionShapes([])).toEqual([]);
  });
});

describe("role gating, in words", () => {
  it("lets an allowed action through", () => {
    expect(inertReason(inboxAction({ id: "a", label: "A" }))).toBeUndefined();
  });

  it("names the capability an approver action needs, and the role any other needs", () => {
    expect(
      inertReason(
        inboxAction({ id: "a", label: "A", allowed: false, disabledReason: "capability_required", requiredRole: "approver" }),
      ),
    ).toBe(NEEDS_APPROVER);
    expect(
      inertReason(inboxAction({ id: "a", label: "A", allowed: false, disabledReason: "role_required", requiredRole: "admin" })),
    ).toBe("Needs the admin role in this workspace.");
  });

  it("holds back a link the service could not resolve", () => {
    expect(inertReason(inboxAction({ id: "a", label: "A →", navigates: true, href: null }))).toBe(LINK_UNAVAILABLE);
    expect(inertReason(inboxAction({ id: "a", label: "A →", navigates: true, href: "/runs/r" }))).toBeUndefined();
  });
});

describe("destinations are this site's paths, or nothing", () => {
  it("passes the paths the service composes", () => {
    expect(sitePath("/runs/r-1#run-changes")).toBe("/runs/r-1#run-changes");
    expect(sitePath("/issues?q=%23465")).toBe("/issues?q=%23465");
  });

  it.each([null, undefined, "", "https://evil.test/x", "//evil.test/x", "/\\evil.test", "javascript:alert(1)", "/a\nb"])(
    "refuses %j",
    (href) => {
      expect(sitePath(href)).toBeNull();
    },
  );

  it("treats a link the reader could be sent off-site by as unavailable", () => {
    expect(inertReason(inboxAction({ id: "a", label: "A →", navigates: true, href: "https://evil.test" }))).toBe(
      LINK_UNAVAILABLE,
    );
  });
});

describe("who asks first", () => {
  it("stops a note-taking action for its note, confirms a danger one, and sends everything else", () => {
    expect(answerStep(inboxAction({ id: "a", label: "A", takesNote: true }))).toBe("note");
    expect(answerStep(inboxAction({ id: "a", label: "A", style: "danger" }))).toBe("confirm");
    expect(answerStep(inboxAction({ id: "a", label: "A", style: "primary" }))).toBe("send");
    expect(answerStep(inboxAction({ id: "a", label: "A", style: "danger", takesNote: true }))).toBe("note");
  });
});

describe("a card's phases", () => {
  const settled: CardPhase[] = [
    { kind: "answered", actionId: "a", receipt: { effects: ["done"], links: [] } },
    { kind: "raced", winner: { who: "Priya", policy: null, actionId: "a", resolvedAtMs: 1 } },
    { kind: "snoozed", untilMs: 1 },
  ];
  const open: CardPhase[] = [
    { kind: "idle" },
    { kind: "noting", actionId: "a" },
    { kind: "confirming", actionId: "a" },
    { kind: "choosing-snooze" },
    { kind: "answering", actionId: "a" },
    { kind: "snoozing" },
    { kind: "failed", reason: "no" },
  ];

  it("keep asking until answered, raced or snoozed — a failure leaves the card open", () => {
    expect(settled.map(isAsking)).toEqual([false, false, false]);
    expect(open.map(isAsking)).toEqual(open.map(() => true));
  });

  it("are in flight only while an answer or a snooze is on its way", () => {
    expect([...open, ...settled].filter(inFlight).map((phase) => phase.kind)).toEqual(["answering", "snoozing"]);
  });
});

describe("the receipt", () => {
  it("joins what executed with a middle dot", () => {
    expect(receiptLine({ effects: ["exception granted", "resume sent to loop #1844"], links: [] })).toBe(
      "exception granted · resume sent to loop #1844",
    );
  });
});

describe("the race state", () => {
  const NOW = Date.parse("2026-10-04T13:20:10.000Z");
  const details = {
    itemId: "i",
    resolution: {
      actionId: "approve_merge",
      resolver: "human",
      policy: null,
      actor: { id: "u", name: "Priya" },
      channel: "email",
      resolvedAt: "2026-10-04T13:20:00.000Z",
    },
  };

  it("reads who won from the 409's details", () => {
    expect(winnerOf(details)).toEqual({
      who: "Priya",
      policy: null,
      actionId: "approve_merge",
      resolvedAtMs: Date.parse("2026-10-04T13:20:00.000Z"),
    });
  });

  it("says who, how long ago and with what", () => {
    expect(raceLine(winnerOf(details)!, mergeActions(), NOW)).toBe("Answered by Priya 10s ago — Approve & merge.");
  });

  it("names a policy, and a source that settled itself", () => {
    const policy = winnerOf({ resolution: { ...details.resolution, actor: null, policy: "auto_accept_resize" } })!;
    const source = winnerOf({ resolution: { ...details.resolution, actor: null, policy: "source_resolved" } })!;

    expect(raceLine(policy, [], NOW)).toBe("Answered by policy 10s ago.");
    expect(raceLine(source, mergeActions(), NOW)).toBe("Settled at its source 10s ago — nothing is left to answer.");
  });

  it("says less rather than guess: no name, no time, no label", () => {
    const unknown = winnerOf({ resolution: { actionId: "unknown", actor: null, policy: null, resolvedAt: "1970-01-01T00:00:00.000Z" } })!;

    expect(unknown).toEqual({ who: null, policy: null, actionId: "unknown", resolvedAtMs: null });
    expect(raceLine(unknown, mergeActions(), NOW)).toBe("Already answered.");
  });

  it("is null for details that name no resolution", () => {
    expect(winnerOf(undefined)).toBeNull();
    expect(winnerOf({})).toBeNull();
    expect(winnerOf({ resolution: "x" })).toBeNull();
  });
});

describe("a snoozed card", () => {
  it("says when it returns", () => {
    expect(snoozedLine(Date.parse("2026-10-04T14:20:00.000Z"), utcClock)).toBe(
      "Snoozed until 14:20 — it returns to the queue then.",
    );
  });
});
