import {
  DRY_RUN_CODE,
  DRY_RUN_MERGE_LABEL,
  DRY_RUN_REASON,
  autoMergeUnderPolicy,
  draftFor,
  dryRunStateOf,
} from "./org-policy.rules";

/** The dry-run policy's pure rules (BA.3, #382). */

describe("the dry-run policy's rules", () => {
  it("states the designed reason, code and label", () => {
    expect(DRY_RUN_REASON).toBe("dry-run policy active");
    expect(DRY_RUN_CODE).toBe("dry_run_policy_active");
    expect(DRY_RUN_MERGE_LABEL).toBe("Dry-run — review the draft PR");
  });

  describe("createPR's draft", () => {
    it.each([
      [undefined, true, true],
      [false, true, true],
      [true, true, true],
      [undefined, false, false],
      [false, false, false],
      [true, false, true],
    ])("asked %p with dry-run %p → draft %p", (requested, dryRun, draft) => {
      expect(draftFor(requested, dryRun)).toBe(draft);
    });
  });

  describe("a workflow's auto-merge terminal", () => {
    it("is overridden, never mutated, while dry-run is active", () => {
      expect(autoMergeUnderPolicy(true, true)).toEqual({
        requested: true,
        effective: false,
        overridden: true,
      });
    });

    it("comes back exactly when dry-run is off", () => {
      expect(autoMergeUnderPolicy(true, false)).toEqual({
        requested: true,
        effective: true,
        overridden: false,
      });
    });

    it("is not called overridden when the workflow never asked", () => {
      expect(autoMergeUnderPolicy(false, true)).toEqual({
        requested: false,
        effective: false,
        overridden: false,
      });
    });
  });

  it("renders one state shape for every surface", () => {
    expect(dryRunStateOf(true, true)).toEqual({
      active: true,
      reason: DRY_RUN_REASON,
      autoMerge: { requested: true, effective: false, overridden: true },
    });
    expect(dryRunStateOf(false, false)).toEqual({
      active: false,
      reason: null,
      autoMerge: { requested: false, effective: false, overridden: false },
    });
  });
});
