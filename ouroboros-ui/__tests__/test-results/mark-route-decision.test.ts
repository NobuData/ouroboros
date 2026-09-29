import { describe, expect, it } from "vitest";

import {
  AUTHOR_REMOVED,
  AUTHOR_UNNAMED,
  WAIVE_DEFERRED,
  actorName,
  currentDecision,
  flaggedLine,
  receiptView,
  recordedView,
  supersededLine,
  waiverView,
} from "@/app/test-results/mark-route-decision";

import { SEEDED_RUN_ID } from "../helpers/runs";
import {
  COLLEAGUE_ID,
  CONTROL_ID,
  CORRECTION_NOTE,
  DECIDER_ID,
  FLAKY_CASE,
  OVERSHOOT_CASE,
  PEOPLE,
  RERUN_JOB_ID,
  classification,
  classifyResult,
  waiver,
} from "../helpers/test-results";

/**
 * What Mark & Route shows of a decision once it is made (#340), without rendering: what a
 * receipt holds, who a decision is attributed to, which decision stands, and what a waiver
 * says.
 */

describe("the receipt", () => {
  it("holds the control's id, the attempt as a link into the run console, and when", () => {
    expect(receiptView(classification(), SEEDED_RUN_ID, "build-farm")).toEqual({
      headline: "Correction round queued",
      controlId: CONTROL_ID,
      attempt: { label: "attempt 4", href: `/runs/${SEEDED_RUN_ID}?from=build-farm` },
      rerunJobId: null,
      at: "2026-09-19T14:22:10.000Z",
      time: "14:22",
    });
  });

  it("holds the re-run's build for a flake, and no attempt", () => {
    const receipt = receiptView(
      classification({
        class: "flake_retry",
        routed: {
          controlId: null,
          rerunJobId: RERUN_JOB_ID,
          targetAttempt: null,
          route: "flake_retry",
        },
      }),
      SEEDED_RUN_ID,
      "dashboard",
    );

    expect(receipt).toEqual(
      expect.objectContaining({
        headline: "Flake marked, case re-run queued",
        controlId: null,
        attempt: null,
        rerunJobId: RERUN_JOB_ID,
      }),
    );
  });

  it("keeps a rejected round's control and names no attempt it did not open", () => {
    const receipt = receiptView(
      classification({
        routed: {
          controlId: CONTROL_ID,
          rerunJobId: null,
          targetAttempt: null,
          route: "correction_round",
        },
      }),
      SEEDED_RUN_ID,
      "dashboard",
    );

    expect(receipt?.controlId).toBe(CONTROL_ID);
    expect(receipt?.attempt).toBeNull();
  });

  it("is nothing when nothing was dispatched", () => {
    expect(receiptView(classification({ routed: null }), SEEDED_RUN_ID, "dashboard")).toBeNull();
  });

  it("names a route this client does not know without inventing one", () => {
    const receipt = receiptView(
      classification({
        routed: { controlId: CONTROL_ID, rerunJobId: null, targetAttempt: 4, route: null },
      }),
      SEEDED_RUN_ID,
      "dashboard",
    );

    expect(receipt?.headline).toBe("Dispatched");
  });
});

describe("who decided", () => {
  it("is you, a colleague by name, or what decided", () => {
    expect(actorName(classification(), DECIDER_ID, PEOPLE)).toBe("you");
    expect(actorName(classification({ createdBy: COLLEAGUE_ID }), DECIDER_ID, PEOPLE)).toBe(
      "Mel Member",
    );
    expect(
      actorName(
        classification({
          actor: "heuristic",
          createdBy: null,
          ruleId: "flake.pass_on_retry",
        }),
        DECIDER_ID,
        PEOPLE,
      ),
    ).toBe("heuristic · passed on a sanctioned retry");
    expect(
      actorName(classification({ actor: "model", createdBy: null }), DECIDER_ID, PEOPLE),
    ).toBe("a model");
  });

  it("never claims a former member over somebody who was merely not looked up", () => {
    expect(actorName(classification({ createdBy: COLLEAGUE_ID }), DECIDER_ID, null)).toBe(
      AUTHOR_UNNAMED,
    );
    expect(actorName(classification({ createdBy: "gone" }), DECIDER_ID, PEOPLE)).toBe(
      AUTHOR_REMOVED,
    );
    expect(actorName(classification({ createdBy: null }), DECIDER_ID, PEOPLE)).toBe(
      AUTHOR_REMOVED,
    );
  });

  it("is still you when the members could not be read", () => {
    expect(actorName(classification(), DECIDER_ID, null)).toBe("you");
  });
});

describe("the recorded decision", () => {
  /** The recorded view of a current decision. */
  function recorded(current: NonNullable<ReturnType<typeof currentDecision>>) {
    return recordedView({
      current,
      runId: SEEDED_RUN_ID,
      from: "dashboard",
      readerId: DECIDER_ID,
      people: PEOPLE,
    });
  }

  it("is undecided while nothing is served and nothing is held", () => {
    expect(currentDecision([], null, OVERSHOOT_CASE.caseId)).toBeNull();
    expect(
      currentDecision(
        [classification({ testCaseId: FLAKY_CASE.caseId })],
        null,
        OVERSHOOT_CASE.caseId,
      ),
    ).toBeNull();
  });

  it("is what the page serves — after a reload, with its receipt", () => {
    const current = currentDecision([classification()], null, OVERSHOOT_CASE.caseId)!;

    expect(recorded(current)).toEqual({
      id: classification().id,
      classLabel: "Product bug",
      actor: "you",
      note: CORRECTION_NOTE,
      at: "2026-09-19T14:22:10.000Z",
      time: "14:22",
      receipt: expect.objectContaining({ controlId: CONTROL_ID }) as unknown,
      flagged: null,
      skipped: [],
      supersedes: null,
    });
  });

  it("is what was just recorded, with what only the answer carries", () => {
    const held = {
      result: classifyResult(
        { routed: null },
        { skipped: ["The run has finished, so no correction round was queued: rejected."] },
      ),
      prior: null,
    };
    const view = recorded(currentDecision([], held, OVERSHOOT_CASE.caseId)!);

    expect(view.receipt).toBeNull();
    expect(view.skipped).toEqual([
      "The run has finished, so no correction round was queued: rejected.",
    ]);
  });

  it("shows the new decision and remembers the one it replaced", () => {
    const prior = classification({ id: "prior", createdAt: "2026-09-19T14:22:10.000Z" });
    const held = {
      result: classifyResult({
        id: "next",
        class: "test_update",
        note: "The test assumes FIFO.",
        createdAt: "2026-09-19T14:40:00.000Z",
      }),
      prior,
    };
    // The page's poll has not caught up: it still serves the decision that was replaced.
    const view = recorded(currentDecision([prior], held, OVERSHOOT_CASE.caseId)!);

    expect(view.id).toBe("next");
    expect(view.classLabel).toBe("Test needs update");
    expect(view.supersedes).toBe(
      "Product bug, by you at 14:22 — kept in the record as superseded.",
    );
    expect(supersededLine(prior, COLLEAGUE_ID, PEOPLE)).toBe(
      "Product bug, by Ken Suenobu at 14:22 — kept in the record as superseded.",
    );
  });

  it("gives way to a later decision somebody else made", () => {
    const held = { result: classifyResult({ id: "mine" }), prior: null };
    const theirs = classification({
      id: "theirs",
      class: "infra_rig",
      createdBy: COLLEAGUE_ID,
      createdAt: "2026-09-19T15:00:00.000Z",
    });
    const current = currentDecision([theirs], held, OVERSHOOT_CASE.caseId)!;

    expect(current.held).toBeNull();
    expect(recorded(current)).toEqual(
      expect.objectContaining({ id: "theirs", actor: "Mel Member", supersedes: null }),
    );
  });

  it("holds a decision to its own case", () => {
    const held = { result: classifyResult({ testCaseId: FLAKY_CASE.caseId }), prior: null };

    expect(currentDecision([], held, OVERSHOOT_CASE.caseId)).toBeNull();
  });

  it("names the runner the infra route flagged", () => {
    expect(flaggedLine(null)).toBeNull();
    expect(
      flaggedLine({ runnerId: "r", runnerName: "helios-rig-02", note: "n", notedAt: "t" }),
    ).toBe("Runner helios-rig-02 flagged with a farm health note.");
    expect(flaggedLine({ runnerId: "r", runnerName: null, note: "n", notedAt: "t" })).toBe(
      "The attempt's runner was flagged with a farm health note.",
    );
  });
});

describe("the waiver", () => {
  it("says who waived, when and why — and that the PR was not annotated", () => {
    expect(waiverView(waiver(), DECIDER_ID, PEOPLE)).toEqual({
      id: waiver().id,
      headline: "Waived by you at 14:25",
      reason: "Known rig drift on helios-rig-02; tracked in #512.",
      at: "2026-09-19T14:25:00.000Z",
      annotation: WAIVE_DEFERRED,
    });
    expect(WAIVE_DEFERRED).toContain("#344");
    expect(WAIVE_DEFERRED).toContain("not posted on the pull request");
  });

  it("does not say so of a waiver the service says was posted", () => {
    expect(
      waiverView(waiver({ annotationState: "annotated" as never }), DECIDER_ID, PEOPLE).annotation,
    ).toBeNull();
  });
});
