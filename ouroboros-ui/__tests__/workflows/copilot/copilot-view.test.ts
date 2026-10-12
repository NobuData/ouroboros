import { describe, expect, it } from "vitest";

import {
  ACTIONS_NEED_PROMOTION,
  ACTIONS_NEED_WORKFLOW,
  BLOCKED_FALLBACK,
  BLOCKED_REASON,
  CONVERSATION_CLOSED_NOTICE,
  COPILOT_EMPTY_MEMBER_NOTE,
  COPILOT_EMPTY_NOTE,
  COPILOT_EYEBROW,
  COPILOT_SEATS,
  COPILOT_SUBLINE,
  COPILOT_TITLE,
  DISCARDED_NOTICE,
  DISCARDED_TRANSCRIPT_NOTE,
  DISCARD_FORBIDDEN_MESSAGE,
  DISCARD_MEMBER_REASON,
  DRY_RUN_IN_PROGRESS_MESSAGE,
  GUARD_ENFORCEMENT_WORDS,
  INTERRUPTED_BODY,
  SPEAKER_WORDS,
  TRANSCRIPT_EMPTY,
  NOTHING_TO_DISCARD_MESSAGE,
  NOTHING_TO_DISCARD_REASON,
  NO_DRAFT_REASON,
  PROMOTE_MEMBER_REASON,
  ROLE_TRANSCRIPT_NOTE,
  anchorDefinition,
  copilotMissingNote,
  copilotSeatCopy,
  copilotState,
  discardBody,
  discardFailure,
  discardReason,
  discardedNotice,
  fallbackTarget,
  findingStageTarget,
  flaggedHeading,
  promoteGate,
  promoteLabel,
  promotedNotice,
  promotedTranscriptNote,
  referenceLine,
  seatElementId,
  splitReferences,
  stageAnchorHref,
  stageAnchorId,
  transcriptNote,
  transcriptReason,
} from "@/app/workflows/copilot/copilot-view";

import {
  ADVISORY_REFERENCE,
  closedConversation,
  copilotConversation,
  copilotPromotion,
  copilotReadings,
  copilotReference,
  securityPatchDefinition,
  securityPatchEntry,
  selectedCopilot,
} from "../../helpers/workflow-copilot";
import { railEntry } from "../../helpers/workflows";

/**
 * Every judgement the copilot's frame makes (CE.1, #565), as values.
 *
 * The ticket's criteria that live here rather than in markup: **the head matches the mockup**
 * (its three strings, verbatim); **unresolved references block or flag per policy, naming the
 * specific references**; **an unpublishable draft says so before the press**; **discard preserves
 * the transcript read-only**; **validation findings anchor to the stage rows** (the id contract
 * CE.3 inherits); and **viewers get a read-only surface with an explanation**.
 */

/** The promotion as a successful reading. */
function read(overrides: Parameters<typeof copilotPromotion>[0] = {}) {
  return { ok: true as const, value: copilotPromotion(overrides) };
}

describe("the page head", () => {
  it("is mockup 20's eyebrow, title and subline, verbatim", () => {
    expect(COPILOT_EYEBROW).toBe("Workflow Studio · Copilot");
    expect(COPILOT_TITLE).toBe("Describe the workflow. Watch it build. Test it before it touches anything.");
    expect(COPILOT_SUBLINE).toBe(
      "The third way to edit workflows — same graph as the canvas and the code, driven by conversation. " +
        "Every draft can dry-run against a real issue first.",
    );
  });
});

describe("the page's state", () => {
  it("is failed for a rail nobody could read, with the service's reason", () => {
    expect(copilotState(copilotReadings({ rail: { ok: false, reason: "Down." }, selected: null }))).toEqual({
      kind: "failed",
      reason: "Down.",
    });
  });

  it("is empty for a workspace with no workflows", () => {
    expect(copilotState(copilotReadings({ rail: { ok: true, value: [] }, selected: null }))).toEqual({ kind: "empty" });
  });

  it("is missing for a slug the rail does not hold, naming it", () => {
    expect(copilotState(copilotReadings({ requested: "retired-loop", selected: null }))).toEqual({
      kind: "missing",
      slug: "retired-loop",
    });
  });

  it("is open on the workflow, whatever became of its three reads", () => {
    const selected = selectedCopilot({ promotion: { ok: false, reason: "Down." } });

    expect(copilotState(copilotReadings({ selected }))).toEqual({ kind: "open", ...selected });
  });

  it("says something different in each state with no workflow open, and suits the empty one to the role", () => {
    expect(copilotSeatCopy({ kind: "failed", reason: "Down." }, true).note).toMatch(/banner above/);
    expect(copilotSeatCopy({ kind: "empty" }, true).note).toBe(COPILOT_EMPTY_NOTE);
    expect(copilotSeatCopy({ kind: "empty" }, false).note).toBe(COPILOT_EMPTY_MEMBER_NOTE);
    expect(copilotSeatCopy({ kind: "missing", slug: "retired-loop" }, true).note).toBe(
      copilotMissingNote("retired-loop"),
    );
    expect(copilotMissingNote("retired-loop")).toMatch(/no workflow called retired-loop/);
  });
});

describe("the anchor contract (#567 inherits it)", () => {
  it("names a stage's row stage-<node id>, and links to it as a fragment", () => {
    expect(stageAnchorId("patch")).toBe("stage-patch");
    expect(stageAnchorHref("patch")).toBe("#stage-patch");
  });

  it("encodes a node id that could spell a second fragment or a query", () => {
    expect(stageAnchorHref("a b#c?d")).toBe("#stage-a%20b%23c%3Fd");
  });

  it("says where an anchored finding leads", () => {
    expect(findingStageTarget("Patch the dependency")).toBe("Go to stage Patch the dependency");
  });
});

describe("the unresolved references (W7)", () => {
  it("splits them into blockers and flags, each in the service's order", () => {
    const second = copilotReference({ node: "open-pr", name: "release-notes", path: "/nodes/2/config/skill" });

    expect(splitReferences([copilotReference(), ADVISORY_REFERENCE, second])).toEqual({
      blockers: [copilotReference(), second],
      flags: [ADVISORY_REFERENCE],
    });
  });

  it("names a reference by its stage and its name", () => {
    expect(referenceLine(copilotReference())).toBe("stage patch · dependency-bump");
  });

  it("counts the flags in a sentence that agrees with the count", () => {
    expect(flaggedHeading(1)).toBe("1 unresolved reference is flagged");
    expect(flaggedHeading(3)).toBe("3 unresolved references are flagged");
  });
});

describe("Promote draft", () => {
  it("is labelled with what it publishes, as the service labels it", () => {
    expect(promoteLabel("security-patch v1")).toBe("Promote draft → security-patch v1");
    expect(promoteLabel(null)).toBe("Promote draft");
  });

  it("can act for an owner on a present, unblocked draft", () => {
    expect(promoteGate({ entry: securityPatchEntry(), promotion: read(), mayAdminister: true })).toEqual({
      label: "Promote draft → security-patch v1",
      reason: undefined,
      draftBlocked: false,
      reasons: [],
      blockers: [],
      flags: [],
    });
  });

  it("is inert with nothing open", () => {
    const gate = promoteGate({ entry: null, promotion: null, mayAdminister: true });

    expect(gate.label).toBe("Promote draft");
    expect(gate.reason).toBe(ACTIONS_NEED_WORKFLOW);
    expect(gate.draftBlocked).toBe(false);
  });

  it("is inert for a role that may not publish, and still labelled with what it would publish", () => {
    const gate = promoteGate({ entry: securityPatchEntry(), promotion: read(), mayAdminister: false });

    expect(gate.label).toBe("Promote draft → security-patch v1");
    expect(gate.reason).toBe(PROMOTE_MEMBER_REASON);
    expect(gate.draftBlocked).toBe(false);
  });

  it("is inert when the summary could not be read, counting the version from the rail", () => {
    const refused = { ok: false as const, reason: "Down." };
    const published = railEntry({ slug: "standard-fix", currentVersion: 14 });

    expect(promoteGate({ entry: securityPatchEntry(), promotion: refused, mayAdminister: true })).toMatchObject({
      label: "Promote draft → security-patch v1",
      reason: ACTIONS_NEED_PROMOTION,
    });
    expect(fallbackTarget(published)).toBe("standard-fix v15");
    expect(promoteGate({ entry: published, promotion: refused, mayAdminister: false }).reason).toBe(
      PROMOTE_MEMBER_REASON,
    );
  });

  it("is inert with no draft, and says so as the draft's own reason", () => {
    const gate = promoteGate({
      entry: securityPatchEntry(),
      promotion: read({ draft: { present: false, label: "v0.0", etag: "" } }),
      mayAdminister: true,
    });

    expect(gate.reason).toBe(NO_DRAFT_REASON);
    expect(gate.draftBlocked).toBe(true);
    expect(gate.reasons).toEqual([NO_DRAFT_REASON]);
  });

  it("is inert for a blocked draft, carrying the service's reasons and the blocking references", () => {
    const gate = promoteGate({
      entry: securityPatchEntry(),
      promotion: read({
        blocked: true,
        blockedReasons: ["1 unresolved reference blocks publishing."],
        references: [copilotReference(), ADVISORY_REFERENCE],
      }),
      mayAdminister: true,
    });

    expect(gate.reason).toBe(BLOCKED_REASON);
    expect(gate.draftBlocked).toBe(true);
    expect(gate.reasons).toEqual(["1 unresolved reference blocks publishing."]);
    expect(gate.blockers).toEqual([copilotReference()]);
    expect(gate.flags).toEqual([ADVISORY_REFERENCE]);
  });

  it("never lists a blocked draft with no reason at all", () => {
    const gate = promoteGate({
      entry: securityPatchEntry(),
      promotion: read({ blocked: true, blockedReasons: [] }),
      mayAdminister: true,
    });

    expect(gate.reasons).toEqual([BLOCKED_FALLBACK]);
  });

  it("reports what blocks a draft to a reader who may not promote it, under the role's reason", () => {
    const gate = promoteGate({
      entry: securityPatchEntry(),
      promotion: read({ blocked: true, blockedReasons: ["Blocked."], references: [copilotReference()] }),
      mayAdminister: false,
    });

    expect(gate.reason).toBe(PROMOTE_MEMBER_REASON);
    expect(gate.draftBlocked).toBe(true);
    expect(gate.blockers).toEqual([copilotReference()]);
  });

  it("stays live for a draft that is only flagged, and carries the flags", () => {
    const gate = promoteGate({
      entry: securityPatchEntry(),
      promotion: read({ references: [ADVISORY_REFERENCE] }),
      mayAdminister: true,
    });

    expect(gate.reason).toBeUndefined();
    expect(gate.draftBlocked).toBe(false);
    expect(gate.flags).toEqual([ADVISORY_REFERENCE]);
  });

  it("says what a promote that took did, with the label the service gave", () => {
    expect(promotedNotice("security-patch v1")).toBe(
      "Promoted the draft to security-patch v1. Runs queued from now on use it, and the conversation is kept read-only.",
    );
  });
});

describe("Discard draft", () => {
  const entry = securityPatchEntry();

  it("can act for an owner while there is a draft", () => {
    expect(discardReason({ entry, promotion: read({ session: null }), mayAdminister: true })).toBeUndefined();
  });

  it("can act with no draft while a conversation is still open", () => {
    const promotion = read({ draft: { present: false, label: "v0.0", etag: "" } });

    expect(discardReason({ entry, promotion, mayAdminister: true })).toBeUndefined();
  });

  it.each(["promoted", "discarded"] as const)(
    "is inert with neither a draft nor an open conversation — a %s one is already closed",
    (status) => {
      const promotion = read({ draft: { present: false, label: "v0.0", etag: "" }, session: { id: "s", status } });

      expect(discardReason({ entry, promotion, mayAdminister: true })).toBe(NOTHING_TO_DISCARD_REASON);
    },
  );

  it("is inert with neither a draft nor any conversation", () => {
    const promotion = read({ draft: { present: false, label: "v0.0", etag: "" }, session: null });

    expect(discardReason({ entry, promotion, mayAdminister: true })).toBe(NOTHING_TO_DISCARD_REASON);
  });

  it("is inert for a role that may not discard, whatever there is to discard", () => {
    expect(discardReason({ entry, promotion: read(), mayAdminister: false })).toBe(DISCARD_MEMBER_REASON);
  });

  it("is inert with nothing open, and when the summary could not be read", () => {
    expect(discardReason({ entry: null, promotion: null, mayAdminister: true })).toBe(ACTIONS_NEED_WORKFLOW);
    expect(discardReason({ entry, promotion: { ok: false, reason: "Down." }, mayAdminister: true })).toBe(
      ACTIONS_NEED_PROMOTION,
    );
  });

  it("says before the press that the draft goes, the workflow stays and the conversation is kept read-only", () => {
    const never = discardBody("security-patch", null);
    const published = discardBody("standard-fix", 14);

    for (const body of [never, published]) {
      expect(body).toMatch(/The draft is thrown away and cannot be brought back/);
      expect(body).toMatch(/The conversation is kept, read-only/);
    }
    expect(never).toMatch(/security-patch stays and, having never been published, is left empty/);
    expect(published).toMatch(/standard-fix stays and returns to its published version, v14/);
  });

  it("says each refusal in words, and the service's own for one it does not know", () => {
    const refusal = (code: string) => ({ code, message: "The service's sentence.", details: {} });

    expect(discardFailure(refusal("copilot_nothing_to_discard"))).toBe(NOTHING_TO_DISCARD_MESSAGE);
    expect(discardFailure(refusal("dry_run_in_progress"))).toBe(DRY_RUN_IN_PROGRESS_MESSAGE);
    expect(discardFailure(refusal("forbidden"))).toBe(DISCARD_FORBIDDEN_MESSAGE);
    expect(discardFailure(refusal("workflow_not_found"))).toBe("The service's sentence.");
    for (const message of [NOTHING_TO_DISCARD_MESSAGE, DRY_RUN_IN_PROGRESS_MESSAGE, DISCARD_FORBIDDEN_MESSAGE]) {
      expect(message).toMatch(/Nothing changed|was not discarded|Nothing was discarded/);
    }
  });

  it("says what a discard that took did — and does not claim a draft that was not there", () => {
    expect(discardedNotice(true)).toBe(DISCARDED_NOTICE);
    expect(discardedNotice(false)).toBe(CONVERSATION_CLOSED_NOTICE);
    expect(DISCARDED_NOTICE).toMatch(/kept read-only/);
    expect(CONVERSATION_CLOSED_NOTICE).toMatch(/no draft to discard/);
  });
});

describe("the guards' words", () => {
  it("never names a dry-run-only guard as enforced", () => {
    expect(GUARD_ENFORCEMENT_WORDS.enforced).toBe("Enforced on real runs");
    expect(GUARD_ENFORCEMENT_WORDS.dry_run_only).toBe("Not enforced on real runs yet");
  });
});

describe("the document findings are anchored in", () => {
  it("is the workflow's draft, as the canvas reads it", () => {
    expect(anchorDefinition(selectedCopilot())).toEqual(securityPatchDefinition());
  });

  it("falls back to the draft the conversation sees when the workflow could not be read", () => {
    const definition = { nodes: [{ id: "only", type: "agent" }] } as never;
    const selected = selectedCopilot({
      detail: { ok: false, reason: "Down." },
      conversation: { ok: true, value: copilotConversation({ draft: { ...copilotConversation().draft, definition } }) },
    });

    expect(anchorDefinition(selected)).toEqual(definition);
  });

  it("is an empty document when neither could be read — every finding listed, none a link", () => {
    const selected = selectedCopilot({
      detail: { ok: false, reason: "Down." },
      conversation: { ok: true, value: null },
    });

    expect(anchorDefinition(selected)).toEqual({});
  });
});

describe("the seats", () => {
  it("names the issue that fills each, and fakes nothing", () => {
    // The conversation is drawn (#566): its seat is only what a failed read leaves, and says so.
    expect(COPILOT_SEATS.conversation.note).toMatch(/could not be read/);
    expect(COPILOT_SEATS.conversation.note).not.toMatch(/#\d/);
    expect(COPILOT_SEATS.stages.note).toMatch(/#567/);
    expect(COPILOT_SEATS["dry-run"].note).toMatch(/#568/);
    expect(Object.keys(COPILOT_SEATS)).toEqual(["conversation", "stages", "dry-run"]);
  });

  it("gives each a stable element id", () => {
    expect(seatElementId("conversation")).toBe("copilot-conversation");
    expect(seatElementId("dry-run")).toBe("copilot-dry-run");
  });
});

describe("the read-only conversation", () => {
  it("is drawn for a closed conversation, whoever is reading", () => {
    for (const mayAdminister of [true, false]) {
      expect(transcriptReason(closedConversation("discarded"), mayAdminister)).toBe("discarded");
      expect(transcriptReason(closedConversation("promoted"), mayAdminister)).toBe("promoted");
    }
  });

  it("is drawn for an open conversation only for a reader who may not edit", () => {
    expect(transcriptReason(copilotConversation(), false)).toBe("role");
    expect(transcriptReason(copilotConversation(), true)).toBeNull();
  });

  it("is not drawn for a workflow that never had a conversation", () => {
    expect(transcriptReason(null, false)).toBeNull();
  });

  it("says why it is read-only", () => {
    expect(transcriptNote("discarded", "security-patch")).toBe(DISCARDED_TRANSCRIPT_NOTE);
    expect(DISCARDED_TRANSCRIPT_NOTE).toBe("This conversation was discarded with its draft. It is kept for reference.");
    expect(transcriptNote("promoted", "security-patch")).toBe(promotedTranscriptNote("security-patch"));
    expect(promotedTranscriptNote("security-patch")).toBe(
      "This conversation was promoted to a published version of security-patch. It is kept for reference.",
    );
    expect(transcriptNote("role", "security-patch")).toBe(ROLE_TRANSCRIPT_NOTE);
  });

  it("names each side of the conversation, and has words for a reply interrupted before it said anything", () => {
    expect(SPEAKER_WORDS).toEqual({ user: "You", copilot: "Copilot" });
    expect(INTERRUPTED_BODY).toBe("(This reply was interrupted before it said anything.)");
    expect(TRANSCRIPT_EMPTY).toBe("Nothing was said in this conversation.");
  });
});
