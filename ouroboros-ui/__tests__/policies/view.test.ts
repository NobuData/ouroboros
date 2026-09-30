import { describe, expect, it } from "vitest";

import type { DryRunPolicy } from "@/app/api/policies";
import {
  AUTO_MERGE_OVERRIDDEN,
  DRY_RUN_MERGE_LABEL,
  DRY_RUN_NOTE,
  attributionLine,
  dryRunNotes,
  flipConfirmation,
  flipLabel,
  policyStatus,
} from "@/app/policies/view";

/** The dry-run policy's words and decisions (BA.3, #382). */

/** A policy. */
function policy(over: Partial<DryRunPolicy> = {}): DryRunPolicy {
  return {
    dryRun: true,
    explicit: true,
    reason: "dry-run policy active",
    updatedAt: "2026-09-30T12:00:00.000Z",
    updatedBy: null,
    ...over,
  };
}

describe("the PR page's words", () => {
  it("keeps the relabelling contract and names the policy", () => {
    expect(DRY_RUN_MERGE_LABEL).toBe("Dry-run — review the draft PR");
    expect(DRY_RUN_NOTE).toContain("Dry-run policy active");
  });

  it("notes the policy while active, the override only when a workflow asked to auto-merge", () => {
    const on = { active: true, reason: "dry-run policy active" };

    expect(
      dryRunNotes({ ...on, autoMerge: { requested: true, effective: false, overridden: true } }),
    ).toEqual({ note: DRY_RUN_NOTE, override: AUTO_MERGE_OVERRIDDEN });
    expect(
      dryRunNotes({ ...on, autoMerge: { requested: false, effective: false, overridden: false } }),
    ).toEqual({ note: DRY_RUN_NOTE, override: null });
    expect(
      dryRunNotes({
        active: false,
        reason: null,
        autoMerge: { requested: true, effective: true, overridden: false },
      }),
    ).toBeNull();
  });
});

describe("the Policies tab's words", () => {
  it("states where the policy stands — and that a never-set workspace is off until onboarding", () => {
    expect(policyStatus(policy())).toMatch(/^On — /);
    expect(policyStatus(policy({ dryRun: false }))).toMatch(/without a person/);
    expect(policyStatus(policy({ dryRun: false, explicit: false }))).toMatch(/Get Started wizard/);
  });

  it("names the flip by what it would do", () => {
    expect(flipLabel(policy())).toBe("Turn dry-run off");
    expect(flipLabel(policy({ dryRun: false }))).toBe("Turn dry-run on");
  });

  it("says when it last changed, and whether a person did", () => {
    expect(attributionLine(policy({ updatedAt: null }))).toBeNull();
    expect(attributionLine(policy())).toContain("Get Started wizard");
    expect(attributionLine(policy({ updatedBy: "user-1" }))).toBe(
      "Last changed 2026-09-30. Every change is in the audit log.",
    );
  });

  it("states the consequences of turning it off, as the dangerous direction", () => {
    const off = flipConfirmation(policy());

    expect(off).toMatchObject({ dryRun: false, loosens: true, confirm: "Turn dry-run off" });
    expect(off.consequences.join(" ")).toContain("without a person in the loop");
    expect(off.consequences.join(" ")).toContain("audit log");
  });

  it("states what turning it on does", () => {
    const on = flipConfirmation(policy({ dryRun: false }));

    expect(on).toMatchObject({ dryRun: true, loosens: false, confirm: "Turn dry-run on" });
    expect(on.consequences.join(" ")).toContain("drafts");
    expect(on.consequences.join(" ")).toContain("overridden, not changed");
  });
});
