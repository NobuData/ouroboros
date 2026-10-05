import { describe, expect, it } from "vitest";

import {
  DOMAIN_INVALID,
  NAME_INVALID,
  NAME_TOO_LONG,
  PER_CLASS_OPTION,
  type WorkspaceCardValues,
  auditFloorReason,
  classEdit,
  classHint,
  domainChangeNote,
  effectiveTiers,
  loopDayOptions,
  loopDaysEdit,
  reasonSentence,
  regionReason,
  retentionFieldErrors,
  retentionNotSaved,
  selectValue,
  sweepNote,
  sweepWhen,
  tierError,
  trainingSentence,
  validateWorkspace,
  workspaceBaseline,
  workspaceFieldErrors,
  workspacePatches,
  workspaceUnread,
} from "@/app/settings/workspace";

import {
  CONSEQUENCE,
  EFFECT,
  READ_AT,
  retentionSettings,
  tier,
  workspaceSettings,
} from "../helpers/workspace";

/**
 * The Workspace card's rules (BS.2, [#492](https://github.com/NobuData/ouroboros/issues/492)):
 * deployment truth said as sentences, the select and the advanced editor as one set of tiers,
 * the service's bounds checked first, and a refusal routed back to the control that caused it.
 */

const NOW = Date.parse(READ_AT);
const BASELINE: WorkspaceCardValues = workspaceBaseline(workspaceSettings(), retentionSettings());

/**
 * The baseline with some fields edited.
 *
 * @param edits The fields to change.
 * @returns The draft.
 */
function draft(edits: Partial<WorkspaceCardValues>): WorkspaceCardValues {
  return { ...BASELINE, ...edits };
}

describe("the baseline", () => {
  it("is every field as the control's own text", () => {
    expect(BASELINE).toEqual({
      name: "acme-robotics",
      domain: "acme.ouroboros.dev",
      loopDays: "30",
      transcripts: "30",
      build_logs: "30",
      artifacts: "30",
      audit: "400",
    });
  });

  it("holds no domain and no shared tier as empty text", () => {
    const owner = workspaceSettings();
    const values = workspaceBaseline(
      workspaceSettings({ domain: { ...owner.domain, value: null } }),
      retentionSettings({ loopDays: null }),
    );

    expect(values.domain).toBe("");
    expect(values.loopDays).toBe("");
  });
});

describe("the select and the advanced editor", () => {
  it("records one change for one choice in the select, and moves all three loop classes", () => {
    const edits = loopDaysEdit("7", BASELINE);
    const next = draft(edits);

    expect(edits).toEqual({ loopDays: "7", transcripts: "30", build_logs: "30", artifacts: "30" });
    expect(effectiveTiers(next, BASELINE)).toEqual({
      transcripts: "7",
      build_logs: "7",
      artifacts: "7",
      audit: "400",
    });
    expect(selectValue(effectiveTiers(next, BASELINE))).toBe("7");
  });

  it("ignores the per-class option, which is a state and not a choice", () => {
    expect(loopDaysEdit("", BASELINE)).toEqual({});
  });

  it("sets one class on its own", () => {
    const next = draft(classEdit("build_logs", "60", BASELINE, BASELINE));
    const tiers = effectiveTiers(next, BASELINE);

    expect(tiers).toEqual({ transcripts: "30", build_logs: "60", artifacts: "30", audit: "400" });
    expect(selectValue(tiers)).toBe("");
  });

  it("turns an unsaved select choice into per-class values before a loop class is edited", () => {
    const chosen = draft(loopDaysEdit("14", BASELINE));
    const edits = classEdit("artifacts", "90", chosen, BASELINE);
    const next = { ...chosen, ...edits };

    expect(edits.loopDays).toBe("30");
    expect(effectiveTiers(next, BASELINE)).toEqual({
      transcripts: "14",
      build_logs: "14",
      artifacts: "90",
      audit: "400",
    });
  });

  it("leaves a select choice alone when audit is edited — audit is not loop data", () => {
    const chosen = draft(loopDaysEdit("14", BASELINE));

    expect(classEdit("audit", "730", chosen, BASELINE)).toEqual({ audit: "730" });
  });
});

describe("the select's options", () => {
  it("are the usual choices within the loop classes' bounds", () => {
    expect(loopDayOptions(["30"], 7, 365)).toEqual([7, 14, 30, 60, 90, 180, 365]);
    expect(loopDayOptions(["30"], 14, 90)).toEqual([14, 30, 60, 90]);
  });

  it("carry the saved value and the editor's shared value, so the select never shows what it cannot hold", () => {
    expect(loopDayOptions(["45", "21"], 7, 365)).toEqual([7, 14, 21, 30, 45, 60, 90, 180, 365]);
    expect(loopDayOptions(["", "abc", "30"], 7, 365)).toEqual([7, 14, 30, 60, 90, 180, 365]);
  });
});

describe("the deployment-truth sentences", () => {
  it("say the region is the deployment's, with the reason, never offering a choice", () => {
    expect(regionReason("configured")).toMatch(/^Self-hosted — single region/);
    expect(regionReason("default")).toMatch(/OURO_DATA_REGION/);
  });

  it("say training is off because nothing here trains — no lock and no plan", () => {
    const sentence = trainingSentence({ enabled: false, changeable: false, reason: "deployment" });

    expect(sentence).toBe("Off — this deployment never trains on your data.");
    expect(sentence).not.toMatch(/plan|lock|enterprise/i);
  });

  it("say the SaaS variants as text too, since the card has no control for them", () => {
    expect(trainingSentence({ enabled: true, changeable: false, reason: "plan" })).toBe(
      "On — set by your plan.",
    );
    expect(trainingSentence({ enabled: false, changeable: true })).toMatch(/^Off — /);
  });

  it("name who can change a field the reader may not", () => {
    expect(reasonSentence("role")).toBe("Changing it takes an owner or an admin.");
    expect(reasonSentence("deployment")).toMatch(/deployment/);
  });

  it("state the domain's consequence with the move it makes", () => {
    expect(domainChangeNote(CONSEQUENCE, "acme.ouroboros.dev", "acme.example.com")).toBe(
      `${CONSEQUENCE} After saving, sign-in finds this workspace at acme.example.com instead of acme.ouroboros.dev.`,
    );
    expect(domainChangeNote(CONSEQUENCE, "", "acme.example.com")).toMatch(/at acme\.example\.com\.$/);
  });
});

describe("the sweep", () => {
  it("is said relative to the read", () => {
    expect(sweepWhen("2026-10-05T14:00:00.000Z", NOW)).toBe("in 4h");
    expect(sweepWhen("2026-10-05T09:00:00.000Z", NOW)).toBe("due now");
    expect(sweepWhen(null, NOW)).toBeNull();
  });

  it("names the soonest loop-class sweep beside the service's effect note", () => {
    expect(sweepNote(retentionSettings(), NOW)).toBe(`${EFFECT} Next sweep in 4h.`);
  });

  it("says so when nothing sweeps the loop classes here", () => {
    const unswept = retentionSettings({
      classes: ["transcripts", "build_logs", "artifacts"].map((name) => tier(name, 30, null)),
    });

    expect(sweepNote(unswept, NOW)).toMatch(/No sweep is scheduled/);
  });

  it("gives each class its bounds and sweep, and audit the reason for its floor", () => {
    expect(classHint(tier("transcripts", 30, "2026-10-05T14:00:00.000Z"), NOW)).toBe(
      "7–365 days · next sweep in 4h",
    );
    expect(classHint(tier("audit", 400, null), NOW)).toBe(
      `90–3650 days · no sweep scheduled yet. ${auditFloorReason(90)}`,
    );
  });
});

describe("validation", () => {
  const retention = retentionSettings();

  it("passes the saved card", () => {
    expect(validateWorkspace(BASELINE, BASELINE, retention)).toEqual({});
  });

  it("holds the service's name and domain rules", () => {
    expect(validateWorkspace(draft({ name: " acme" }), BASELINE, retention)).toEqual({
      name: NAME_INVALID,
    });
    expect(validateWorkspace(draft({ name: "a".repeat(101) }), BASELINE, retention)).toEqual({
      name: NAME_TOO_LONG,
    });
    expect(validateWorkspace(draft({ domain: "Acme.Dev" }), BASELINE, retention)).toEqual({
      domain: DOMAIN_INVALID,
    });
  });

  it("explains the audit floor rather than merely refusing", () => {
    const errors = validateWorkspace(draft({ audit: "30" }), BASELINE, retention);

    expect(errors.audit).toBe(`30 days is below the audit floor. ${auditFloorReason(90)}`);
  });

  it("holds each class to its bounds and to whole days", () => {
    const audit = tier("audit", 400, null);

    expect(tierError("transcripts", "3", tier("transcripts", 30, null))).toMatch(/at least 7 days/);
    expect(tierError("artifacts", "400", tier("artifacts", 30, null))).toMatch(/at most 365 days/);
    expect(tierError("audit", "1.5", audit)).toMatch(/whole number/);
    expect(tierError("audit", "", audit)).toMatch(/whole number/);
    expect(tierError("audit", "3650", audit)).toBeUndefined();
  });
});

describe("the writes", () => {
  it("send nothing for the saved card", () => {
    expect(workspacePatches(BASELINE, BASELINE)).toEqual({ retentionFields: [] });
  });

  it("send only what changed of name and domain", () => {
    expect(workspacePatches(draft({ domain: "acme.example.com" }), BASELINE)).toEqual({
      workspace: { domain: "acme.example.com" },
      retentionFields: [],
    });
  });

  it("send the select as {loopDays} — the service's one-control save", () => {
    const next = draft(loopDaysEdit("7", BASELINE));

    expect(workspacePatches(next, BASELINE)).toEqual({
      retention: { loopDays: 7 },
      retentionFields: ["loopDays"],
    });
  });

  it("send the advanced editor as {classes}, each class independently", () => {
    const next = draft({ build_logs: "60", audit: "730" });

    expect(workspacePatches(next, BASELINE).retention).toEqual({
      classes: { build_logs: 60, audit: 730 },
    });
  });

  it("fold a select choice and an audit edit into one {classes} body", () => {
    const next = draft({ ...loopDaysEdit("14", BASELINE), audit: "730" });

    expect(workspacePatches(next, BASELINE).retention).toEqual({
      classes: { transcripts: 14, build_logs: 14, artifacts: 14, audit: 730 },
    });
  });
});

describe("a refusal", () => {
  it("routes the workspace's fields to their inputs", () => {
    expect(
      workspaceFieldErrors({ fields: { domain: ["That domain is already used by another workspace."] } }),
    ).toEqual({ domain: "That domain is already used by another workspace." });
    expect(workspaceFieldErrors(undefined)).toEqual({});
  });

  it("routes a class's refusal to the control that set it", () => {
    const details = { fields: { "classes.audit": ["Too short."], "classes.transcripts": ["Too long."] } };

    expect(retentionFieldErrors(details, ["audit", "loopDays"])).toEqual({
      audit: "Too short.",
      loopDays: "Too long.",
    });
    expect(retentionFieldErrors({ fields: { loopDays: ["No."] } }, ["loopDays"])).toEqual({
      loopDays: "No.",
    });
  });

  it("says what landed when only the tiers were refused", () => {
    expect(retentionNotSaved("Forbidden.")).toBe(
      "The name and domain were saved; the retention tiers were not. Forbidden.",
    );
  });

  it("names the read that failed when the card cannot be drawn", () => {
    expect(workspaceUnread(null, "Restarting.")).toBe(
      "The retention tiers could not be read, so this card is not drawn. Restarting.",
    );
    expect(workspaceUnread("Restarting.", "Restarting.")).toMatch(
      /^The workspace settings and retention tiers .* Restarting\.$/,
    );
  });

  it("keeps the per-class option's words for the select", () => {
    expect(PER_CLASS_OPTION).toBe("Set per class");
  });
});
