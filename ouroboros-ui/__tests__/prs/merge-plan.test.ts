import { describe, expect, it } from "vitest";

import type { PullRequestPage } from "@/app/api/pull-requests";
import { workflowPath } from "@/app/paths";
import { SAVE_FIRST } from "@/app/prs/merge-message";
import {
  CHOOSE_EPIC,
  DISARM_TO_EDIT,
  EPICS_UNREAD,
  MERGED_ELSEWHERE,
  type MergePlanCardInput,
  NO_EPICS,
  NO_TICKET,
  PLAN_FINAL,
  READ_ONLY,
  UNKNOWN_EPIC,
  armedNotice,
  confirmation,
  effectivePage,
  epicName,
  handedOff,
  mergePlanCard,
  mergedNotice,
  planStanding,
  stateOf,
  strategyTag,
  termsMoved,
} from "@/app/prs/merge-plan";
import { IDENTITY_LINE } from "@/app/prs/merge-receipt";
import { MERGE_NOW_TERMS } from "@/app/prs/merge-terms";
import { futureStep } from "@/app/prs/strip";
import {
  ALREADY_ARMED,
  MERGE_LABEL,
  MERGE_NOW_LABEL,
  NOT_VERIFYING,
  NO_REVISION,
  mergeAction,
  prHead,
} from "@/app/prs/view";

import {
  BLE_EPIC,
  KEN,
  OTA_EPIC,
  REV_1_ID,
  REV_2_ID,
  SEEDED_MESSAGE,
  armedPlan,
  blockedPage,
  dryRunOn,
  mergeOutcome,
  mergePlan,
  mergedPlan,
  prPage,
  readyPage,
  revision,
} from "../helpers/pull-requests";
import {
  AUTO_MERGE_OVERRIDDEN,
  DRY_RUN_MERGE_LABEL,
  DRY_RUN_NOTE,
} from "@/app/policies/view";

/**
 * The Merge plan card's decisions (#369): where the plan stands, what each reader may change,
 * which control is offered — the direct merge only when every gate is already green — and the
 * one plan the head, the strip and the card all read.
 */

const EPICS = [OTA_EPIC, BLE_EPIC];

/**
 * The card, as an owner unless told otherwise.
 *
 * @param page The page.
 * @param over What else to change.
 * @returns The card.
 */
function card(page: PullRequestPage = prPage(), over: Partial<MergePlanCardInput> = {}) {
  return mergePlanCard({
    page,
    epics: EPICS,
    draft: null,
    answer: null,
    mayArm: true,
    mayContribute: true,
    chosen: null,
    ...over,
  });
}

/** The page, armed. */
function armedPage(over: Parameters<typeof prPage>[0] = {}): PullRequestPage {
  return prPage({ pullRequest: { state: "armed" }, plan: armedPlan(), ...over });
}

describe("stateOf — the plan is read before the PR's state", () => {
  it("is merged once the plan recorded a merge, whatever the mirror still says", () => {
    for (const state of ["verifying", "armed", "open", "merged"] as const) {
      expect(stateOf(state, mergedPlan())).toBe("merged");
    }
  });

  it("is armed for an armed plan of a PR still being verified", () => {
    expect(stateOf("verifying", armedPlan())).toBe("armed");
    expect(stateOf("armed", armedPlan())).toBe("armed");
  });

  it("is verifying again once the plan is no longer armed", () => {
    expect(stateOf("armed", mergePlan())).toBe("verifying");
  });

  it("leaves what the host owns, and what the plan does not decide, alone", () => {
    expect(stateOf("closed", armedPlan())).toBe("closed");
    expect(stateOf("blocked", armedPlan())).toBe("blocked");
    expect(stateOf("blocked", mergePlan())).toBe("blocked");
    expect(stateOf("open", mergePlan())).toBe("open");
    expect(stateOf("merged", mergePlan())).toBe("merged");
  });
});

describe("effectivePage", () => {
  it("is the page itself when nothing differs", () => {
    const page = prPage();

    expect(effectivePage(page, [], null)).toBe(page);
    expect(effectivePage(page, [], 1_000)).toBe(page);
  });

  it("draws an answer until a read made after it has caught up", () => {
    const page = prPage();
    const locals = [{ plan: armedPlan(), at: 2_000 }];

    // Read before the answer: the answer stands.
    expect(effectivePage(page, locals, 1_000)).toMatchObject({
      plan: { armed: true },
      pullRequest: { state: "armed" },
    });
    expect(effectivePage(page, locals, null).plan.armed).toBe(true);
    // Read after it: the read is the newer statement.
    expect(effectivePage(page, locals, 3_000)).toBe(page);
  });

  it("draws the newest of several answers", () => {
    const locals = [
      { plan: armedPlan(), at: 2_000 },
      { plan: mergePlan({ closeTicket: false }), at: 2_500 },
    ];

    expect(effectivePage(prPage(), locals, 1_000).plan).toMatchObject({
      armed: false,
      closeTicket: false,
    });
  });

  it("makes the head, the strip and the card agree on an answer", () => {
    const armed = effectivePage(prPage(), [{ plan: armedPlan(), at: 2_000 }], 1_000);

    expect(prHead(armed, "dashboard").pill.label).toBe("armed — 5 of 7 gates green");
    expect(mergeAction(armed).reason).toBe(ALREADY_ARMED);
    expect(futureStep(armed)).toMatchObject({ treatment: "armed" });
    expect(card(armed).standing).toBe("armed");

    const merged = effectivePage(prPage(), [{ plan: mergedPlan(), at: 2_000 }], 1_000);

    expect(prHead(merged, "dashboard").pill.label).toContain("merged");
    expect(futureStep(merged)).toBeNull();
    expect(card(merged).standing).toBe("merged");
  });

  it("reads a merge the mirror has not caught up with as merged", () => {
    const lagging = prPage({ pullRequest: { state: "armed" }, plan: mergedPlan() });

    expect(effectivePage(lagging, [], 1_000).pullRequest.state).toBe("merged");
  });
});

describe("planStanding", () => {
  it.each([
    ["planned", prPage()],
    ["armed", armedPage()],
    ["merged", prPage({ pullRequest: { state: "merged" }, plan: mergedPlan() })],
    ["merged_elsewhere", prPage({ pullRequest: { state: "merged" } })],
    ["closed", prPage({ pullRequest: { state: "closed" } })],
    [
      "disarmed",
      prPage({
        plan: mergePlan({ disarmReason: { code: "gate_red", message: "Physical HIL is red." } }),
      }),
    ],
  ] as const)("is %s", (standing, page) => {
    expect(planStanding(page)).toBe(standing);
  });

  it("puts the plan's own record first, then what the host owns, then the arm", () => {
    // Closed while armed: the host owns it, and the arm is still there to be withdrawn.
    const closedArmed = prPage({ pullRequest: { state: "closed" }, plan: armedPlan() });

    expect(planStanding(closedArmed)).toBe("closed");
    expect(card(closedArmed)).toMatchObject({ disarm: true, primary: null, editable: false });
  });
});

describe("the seeded card (mockup 12)", () => {
  it("draws the strategy, the message, the three switches and the footer", () => {
    const view = card();

    expect(view.strategy).toBe("squash · delete branch");
    expect(view.message).toBe(SEEDED_MESSAGE);
    expect(view.toggles.map((toggle) => [toggle.text, toggle.checked])).toEqual([
      ["Close issue #482 on merge", true],
      ["Comment evidence summary on the host PR", true],
      ["Back-annotate roadmap", false],
    ]);
    expect(view.footer).toBe(IDENTITY_LINE);
    expect(view.close).toEqual({ kind: "agrees" });
    expect(view.primary).toEqual({ kind: "arm", label: MERGE_LABEL, reason: null });
    expect(view).toMatchObject({ armed: null, disarmed: null, receipt: null, disarm: false });
  });

  it("names the epic the plan back-annotates, as the mockup does", () => {
    const view = card(prPage({ plan: mergePlan({ epicId: OTA_EPIC.id }) }));

    expect(view.toggles[2]?.text).toBe("Back-annotate roadmap (OTA hardening)");
    expect(view.epic.value).toBe(OTA_EPIC.id);
  });

  it("says what pressing each switch would do", () => {
    expect(card().toggles.map((toggle) => toggle.label)).toEqual([
      "Switch off: Close issue #482 on merge",
      "Switch off: Comment evidence summary on the host PR",
      "Switch on: Back-annotate roadmap",
    ]);
  });

  it("says the branch is kept when it is", () => {
    expect(strategyTag(mergePlan({ strategy: "rebase", deleteBranch: false }))).toBe(
      "rebase · keep branch",
    );
  });
});

describe("Edit policy →", () => {
  it("leads an owner or admin to the PR's pinned workflow", () => {
    expect(card().policy).toBe(workflowPath("standard-fix"));
  });

  it("is not drawn where the role does not permit, or no loop pinned a workflow", () => {
    expect(card(prPage(), { mayArm: false }).policy).toBeNull();
    expect(card(prPage({ pullRequest: { run: null } })).policy).toBeNull();
  });
});

describe("the primary control — the direct merge only when all gates are already green", () => {
  it("offers arming while a required gate is not yet satisfied", () => {
    expect(card().primary).toEqual({ kind: "arm", label: MERGE_LABEL, reason: null });
  });

  it("offers Merge now once every required gate is green, and the head says the same", () => {
    expect(card(readyPage()).primary).toEqual({
      kind: "merge",
      label: MERGE_NOW_LABEL,
      reason: null,
    });
    expect(mergeAction(readyPage()).label).toBe(MERGE_NOW_LABEL);
    expect(mergeAction(prPage()).label).toBe(MERGE_LABEL);
  });

  it.each([
    ["nothing was evaluated", prPage({ gates: null })],
    [
      "the revision has no aggregate yet",
      prPage({ gates: { revisionId: REV_2_ID, aggregate: null, rows: [] } }),
    ],
    ["a gate is red", blockedPage({ pullRequest: { state: "verifying" } })],
    ["a gate is pending", prPage()],
  ])("never offers the direct merge while %s", (_, page) => {
    expect(card(page).primary?.kind).toBe("arm");
    expect(mergeAction(page).label).toBe(MERGE_LABEL);
  });

  it("is inert, with the reason, for a PR that cannot be armed", () => {
    expect(card(blockedPage()).primary).toMatchObject({
      kind: "arm",
      reason: "2 gates are red on revision 2 — a blocked PR cannot be armed.",
    });
    expect(card(prPage({ pullRequest: { state: "open" } })).primary?.reason).toBe(NOT_VERIFYING);
    expect(card(prPage({ revisions: [] })).primary?.reason).toBe(NO_REVISION);
  });

  it("is inert while the message has unsaved edits — the saved message is what merges", () => {
    const draft = { text: "reworded", base: SEEDED_MESSAGE };

    expect(card(prPage(), { draft }).primary?.reason).toBe(SAVE_FIRST);
    expect(card(readyPage(), { draft }).primary).toMatchObject({
      kind: "merge",
      reason: SAVE_FIRST,
    });
    // A PR that cannot be armed says that first.
    expect(card(blockedPage(), { draft }).primary?.reason).toContain("blocked PR");
  });

  it("is not drawn once there is nothing left to decide", () => {
    expect(
      card(prPage({ pullRequest: { state: "merged" }, plan: mergedPlan() })).primary,
    ).toBeNull();
    expect(card(prPage({ pullRequest: { state: "merged" } })).primary).toBeNull();
    expect(card(prPage({ pullRequest: { state: "closed" } })).primary).toBeNull();
  });

  it("is not drawn while armed — until every gate is green and the armed merge has not fired", () => {
    expect(card(armedPage()).primary).toBeNull();
    expect(card(readyPage({ pullRequest: { state: "armed" }, plan: armedPlan() })).primary).toEqual(
      { kind: "merge", label: MERGE_NOW_LABEL, reason: null },
    );
  });

  it("is offered again after a re-check disarmed the plan", () => {
    const disarmed = prPage({
      plan: mergePlan({ disarmReason: { code: "head_moved", message: "Revision 3 landed." } }),
    });

    expect(card(disarmed).primary).toEqual({ kind: "arm", label: MERGE_LABEL, reason: null });
  });
});

describe("arm and disarm are role-gated, hidden", () => {
  it("draws a member no arm, no merge and nothing editable", () => {
    for (const page of [prPage(), readyPage(), blockedPage()]) {
      const view = card(page, { mayArm: false });

      expect(view.primary).toBeNull();
      expect(view.editable).toBe(false);
      expect(view.policy).toBeNull();
      expect(view.toggles.every((toggle) => toggle.reason === READ_ONLY)).toBe(true);
      expect(view.epic.enabled).toBe(false);
    }
  });

  it("draws a member Disarm while armed — the safe direction is any contributor's", () => {
    expect(card(armedPage(), { mayArm: false })).toMatchObject({ disarm: true, primary: null });
  });

  it("draws a viewer neither, and still the plan", () => {
    const view = card(armedPage(), { mayArm: false, mayContribute: false });

    expect(view).toMatchObject({ disarm: false, primary: null, editable: false });
    expect(view.armed).not.toBeNull();
    expect(view.message).toBe(SEEDED_MESSAGE);
    expect(view.toggles).toHaveLength(3);
  });

  it("draws Disarm only for a plan that is armed", () => {
    expect(card().disarm).toBe(false);
    expect(card(prPage({ plan: mergedPlan() })).disarm).toBe(false);
  });
});

describe("what can be changed, and why not", () => {
  it("is everything, for an owner, while planned", () => {
    const view = card();

    expect(view.editable).toBe(true);
    expect(view.toggles.map((toggle) => toggle.reason)).toEqual([null, null, CHOOSE_EPIC]);
    expect(view.epic.enabled).toBe(true);
  });

  it("is nothing while armed — arming confirmed the plan's terms", () => {
    const view = card(armedPage());

    expect(view.editable).toBe(false);
    expect(view.toggles.every((toggle) => toggle.reason === DISARM_TO_EDIT)).toBe(true);
    expect(view.epic.enabled).toBe(false);
  });

  it("is nothing once merged, or once the host owns the PR", () => {
    expect(
      card(prPage({ plan: mergedPlan() })).toggles.every((toggle) => toggle.reason === PLAN_FINAL),
    ).toBe(true);
    expect(card(prPage({ pullRequest: { state: "closed" } })).toggles[0]?.reason).toBe(
      "This PR is closed on its host.",
    );
    expect(card(prPage({ pullRequest: { state: "closed" } })).editable).toBe(false);
  });

  it("makes the close switch inert for a PR with no ticket", () => {
    const view = card(prPage({ pullRequest: { ticket: null } }));

    expect(view.toggles[0]).toMatchObject({
      text: "Close the ticket on merge",
      reason: NO_TICKET,
    });
    expect(view.close).toEqual({ kind: "agrees" });
  });

  it("lets back-annotate be switched on once an epic is chosen", () => {
    expect(card(prPage({ plan: mergePlan({ epicId: OTA_EPIC.id }) })).toggles[2]?.reason).toBeNull();
  });
});

describe("the epic picker", () => {
  it("offers the roadmap's epics, with none chosen on the seed", () => {
    expect(card().epic).toEqual({ value: "", options: EPICS, hint: null, enabled: true });
  });

  it("says so when the workspace has no roadmap, and when it could not be read", () => {
    expect(card(prPage(), { epics: [] }).epic).toMatchObject({ hint: NO_EPICS, enabled: false });
    expect(card(prPage(), { epics: null }).epic).toMatchObject({
      hint: EPICS_UNREAD,
      enabled: false,
      options: [],
    });
  });

  it("never shows No epic for a plan that names one the roadmap no longer lists", () => {
    const gone = "5eed001f-0000-4000-8000-0000000000aa";
    const view = card(prPage({ plan: mergePlan({ epicId: gone, backAnnotateEpic: true }) }));

    expect(view.epic.value).toBe(gone);
    expect(view.epic.options).toEqual([...EPICS, { id: gone, name: UNKNOWN_EPIC }]);
    expect(view.toggles[2]?.text).toBe(`Back-annotate roadmap (${UNKNOWN_EPIC})`);
    expect(epicName(mergePlan({ epicId: gone }), null)).toBe(UNKNOWN_EPIC);
    expect(epicName(mergePlan(), EPICS)).toBeNull();
  });
});

describe("the Closes warning", () => {
  it("follows the draft, not the stored message", () => {
    const dropped = { text: "can: fix flaky telemetry frame order", base: SEEDED_MESSAGE };

    expect(card(prPage(), { draft: dropped }).close.kind).toBe("missing");
    expect(card(prPage(), { draft: null }).close.kind).toBe("agrees");
  });

  it("warns on a stored message that lost the keyword, for every reader", () => {
    const page = prPage({ plan: mergePlan({ commitMessage: "reworded" }) });

    expect(card(page).close.kind).toBe("missing");
    expect(card(page, { mayArm: false, mayContribute: false }).close.kind).toBe("missing");
    expect(card(armedPage({ plan: armedPlan({ commitMessage: "reworded" }) })).close.kind).toBe(
      "missing",
    );
  });

  it("is silent once the close switch is off, and once the merge has happened", () => {
    expect(
      card(prPage({ plan: mergePlan({ commitMessage: "reworded", closeTicket: false }) })).close,
    ).toEqual({ kind: "agrees" });
    expect(card(prPage({ plan: mergedPlan({ commitMessage: "reworded" }) })).close).toEqual({
      kind: "agrees",
    });
  });
});

describe("the armed state", () => {
  it("says what it waits on, against which revision, and who armed it", () => {
    const view = card(armedPage());

    expect(view.armed).toEqual({
      terms: "Merges automatically when Second-model review turns green.",
      against: "against revision 2 · b7e41d0",
      time: "14:40:12",
      at: "2026-09-27T14:40:12.000Z",
      stale: null,
    });
    expect(view.footer).toBe(`${IDENTITY_LINE} Armed by ${KEN.name}.`);
  });

  it("warns when the armed revision is no longer the head", () => {
    const moved = armedPage({ plan: armedPlan({ armedAgainstRevisionId: REV_1_ID }) });

    expect(card(moved).armed?.against).toBe("against revision 1 · 3f9c2ae");
    expect(card(moved).armed?.stale).toContain("revision 2 is now the head");
    expect(card(moved).armed?.stale).toContain("disarm rather than merge");
  });

  it("names no revision the page no longer holds", () => {
    const unknown = armedPage({
      plan: armedPlan({ armedAgainstRevisionId: "5eed003b-0000-4000-8000-000000000099" }),
    });

    expect(card(unknown).armed).toMatchObject({ against: null, stale: null });
  });
});

describe("a failed re-check renders its disarm reason", () => {
  it("draws the reason, and the control to arm again", () => {
    const view = card(
      prPage({
        plan: mergePlan({
          disarmReason: { code: "gate_red", message: "Physical HIL is red on revision 2." },
        }),
      }),
    );

    expect(view.standing).toBe("disarmed");
    expect(view.disarmed).toMatchObject({
      headline: "A gate went red",
      message: "Physical HIL is red on revision 2.",
    });
    expect(view.armed).toBeNull();
  });

  it("draws none after a manual disarm, or once armed again", () => {
    expect(card().disarmed).toBeNull();
    expect(card(armedPage()).disarmed).toBeNull();
  });
});

describe("the merged states", () => {
  it("draws the receipt, and no footer — the receipt states who merged", () => {
    const view = card(prPage({ pullRequest: { state: "merged" }, plan: mergedPlan() }));

    expect(view.receipt).toMatchObject({ sha: "9c4ab7f", identity: "ken-s" });
    expect(view).toMatchObject({ footer: null, note: null, armed: null, disarm: false });
  });

  it("says a PR merged on its host, not by this plan, recorded nothing", () => {
    const view = card(prPage({ pullRequest: { state: "merged" } }));

    expect(view).toMatchObject({ standing: "merged_elsewhere", note: MERGED_ELSEWHERE });
    expect(view.receipt).toBeNull();
    expect(view.footer).toBeNull();
  });

  it("says a closed PR is closed on its host", () => {
    expect(card(prPage({ pullRequest: { state: "closed" } })).note).toBe(
      "This PR is closed on its host.",
    );
  });
});

describe("the hand-off from the head", () => {
  it("says nothing has happened, and which revision the terms will be for", () => {
    expect(card(prPage(), { chosen: 2 }).handedOff).toBe(handedOff(2, "arm"));
    expect(handedOff(2, "arm")).toContain("Nothing has happened yet");
    expect(handedOff(2, "arm")).toContain("revision 2");
    expect(card(readyPage(), { chosen: 2 }).handedOff).toBe(handedOff(2, "merge"));
  });

  it("says nothing when there is no control to confirm", () => {
    expect(card(prPage(), { chosen: null }).handedOff).toBeNull();
    expect(card(blockedPage(), { chosen: 2 }).handedOff).toBeNull();
    expect(card(prPage(), { chosen: 2, mayArm: false }).handedOff).toBeNull();
  });
});

describe("confirmation — the exact terms", () => {
  it("names the specific gate, the re-check's subject, and what the merge will do", () => {
    expect(confirmation(prPage(), "arm")).toEqual({
      kind: "arm",
      title: "Merge PR #514 when all gates are green",
      revisionId: REV_2_ID,
      revision: "Revision 2 · b7e41d0",
      terms: "Merges automatically when Second-model review turns green.",
      waiting: [
        expect.objectContaining({
          key: "model_review",
          line: "Second-model review — unavailable",
        }),
      ],
      strategy: "squash · delete branch",
      actions: ["close issue #482", "comment the evidence summary", "delete the branch"],
      identity: IDENTITY_LINE,
      planAt: "2026-09-27T14:32:00.000Z",
    });
  });

  it("states a direct merge's terms, and waits on nothing", () => {
    expect(confirmation(readyPage(), "merge")).toMatchObject({
      kind: "merge",
      title: "Merge PR #514 now",
      terms: MERGE_NOW_TERMS,
      waiting: [],
      revisionId: REV_2_ID,
    });
  });

  it("is nothing for a PR with no revision — there is nothing to arm against", () => {
    expect(confirmation(prPage({ revisions: [] }), "arm")).toBeNull();
  });

  it("never says who merges is a bot", () => {
    expect(JSON.stringify(confirmation(prPage(), "arm"))).not.toContain("[bot]");
  });
});

describe("termsMoved — the PR moved under an open confirmation", () => {
  const open = confirmation(prPage(), "arm")!;

  it("has not while the page is what was confirmed", () => {
    expect(termsMoved(open, prPage())).toBe(false);
    // A gate turning green under an arm changes nothing that was promised.
    expect(termsMoved(open, readyPage())).toBe(false);
  });

  it("has when a new revision is the head", () => {
    const next = revision({ id: "5eed003b-0000-4000-8000-000000005143", seq: 3 });

    expect(
      termsMoved(open, prPage({ revisions: [...prPage().revisions, next] })),
    ).toBe(true);
    expect(termsMoved(open, prPage({ revisions: [] }))).toBe(true);
  });

  it("has when the plan was changed", () => {
    expect(
      termsMoved(
        open,
        prPage({ plan: mergePlan({ closeTicket: false, updatedAt: "2026-09-27T14:50:00.000Z" }) }),
      ),
    ).toBe(true);
  });

  it("has when a direct merge's gates are no longer all green", () => {
    const merging = confirmation(readyPage(), "merge")!;

    expect(termsMoved(merging, readyPage())).toBe(false);
    expect(termsMoved(merging, prPage())).toBe(true);
    expect(termsMoved(merging, prPage({ gates: null }))).toBe(true);
  });
});

describe("the notices", () => {
  it("says an arm, with what it waits on", () => {
    expect(armedNotice(armedPlan(), prPage())).toEqual({
      text: "Armed. Merges automatically when Second-model review turns green.",
      failed: false,
    });
  });

  it("says a merge, as whom, and how many actions did not run", () => {
    expect(mergedNotice(mergeOutcome())).toEqual({
      text: "Merged as ken-s (9c4ab7f).",
      failed: false,
    });
    expect(
      mergedNotice(
        mergeOutcome({
          failedActions: [{ action: "close_ticket", detail: "#482 is still open" }],
        }),
      ).text,
    ).toBe("Merged as ken-s (9c4ab7f). 1 action did not run — see the receipt.");
  });

  it("never says a bot merged", () => {
    const bot = mergeOutcome({
      plan: mergedPlan({
        mergedResult: {
          sha: "9c4ab7f02d31",
          identityUsed: "ouroboros-app[bot]",
          actionsExecuted: [],
          mergedAt: "2026-09-27T14:45:02.000Z",
        },
      }),
    });

    expect(mergedNotice(bot).text).toBe("Merged as configured token (9c4ab7f).");
  });
});

describe("the dry-run policy (#382)", () => {
  it("relabels the primary control and holds it inert with the policy as its reason", () => {
    for (const page of [
      prPage({ plan: mergePlan({ dryRun: dryRunOn() }) }),
      readyPage({ plan: mergePlan({ dryRun: dryRunOn() }) }),
    ]) {
      expect(card(page).primary).toEqual({
        kind: "arm",
        label: DRY_RUN_MERGE_LABEL,
        reason: DRY_RUN_NOTE,
      });
    }
  });

  it("states the policy to every reader, the member and the viewer included", () => {
    const page = prPage({ plan: mergePlan({ dryRun: dryRunOn() }) });

    expect(card(page, { mayArm: false, mayContribute: false }).dryRun).toEqual({
      note: DRY_RUN_NOTE,
      override: null,
    });
    expect(card(page, { mayArm: false }).primary).toBeNull();
  });

  it("says a workflow's auto-merge is overridden, never edited", () => {
    const page = prPage({ plan: mergePlan({ dryRun: dryRunOn(true) }) });

    expect(card(page).dryRun?.override).toBe(AUTO_MERGE_OVERRIDDEN);
  });

  it("offers no hand-off sentence for an inert control", () => {
    const page = prPage({ plan: mergePlan({ dryRun: dryRunOn() }) });

    expect(card(page, { chosen: 2 }).handedOff).toBeNull();
  });

  it("says nothing once the plan is final, and nothing while dry-run is off", () => {
    expect(card(prPage({ plan: mergedPlan({ dryRun: dryRunOn() }) })).dryRun).toBeNull();
    expect(card(prPage()).dryRun).toBeNull();
    expect(card(prPage()).primary?.label).toBe(MERGE_LABEL);
  });

  it("relabels the head's button the same way, from the same plan", () => {
    const page = readyPage({ plan: mergePlan({ dryRun: dryRunOn() }) });

    expect(mergeAction(page)).toEqual({ label: DRY_RUN_MERGE_LABEL, reason: DRY_RUN_NOTE });
    // A PR the host owns keeps its own reason.
    expect(
      mergeAction(prPage({ pullRequest: { state: "merged" }, plan: mergePlan({ dryRun: dryRunOn() }) }))
        .label,
    ).toBe(MERGE_LABEL);
  });
});
