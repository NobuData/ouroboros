import type { CopilotToolTrace } from "../db/schema";
import { draftSpendGuardCents, effectiveBudget, engineBudget } from "./dry-runs.budget";
import { guardTrace } from "./dry-runs.store.fixture";

const EMPTY: CopilotToolTrace = { operations: [], reads: [], dry_run_proposals: [] };

describe("the draft's spend guard", () => {
  it("is absent when no reply proposed one", () => {
    expect(draftSpendGuardCents([])).toBeNull();
    expect(draftSpendGuardCents([EMPTY])).toBeNull();
  });

  it("reads the copilot's own set_guard call", () => {
    expect(draftSpendGuardCents([guardTrace(500)])).toBe(500);
  });

  it("reads the flat form the development seed records", () => {
    const seeded: CopilotToolTrace = {
      ...EMPTY,
      operations: [
        {
          op: { kind: "set_guard", params: { spend_cap_cents: 500, per: "run" } },
          outcome: "proposed",
        },
      ],
    };

    expect(draftSpendGuardCents([seeded])).toBe(500);
  });

  it("takes the newest reply's proposal, and the last one within a reply", () => {
    const twice: CopilotToolTrace = {
      ...EMPTY,
      operations: [...guardTrace(900).operations, ...guardTrace(300).operations],
    };

    expect(draftSpendGuardCents([twice, guardTrace(500)])).toBe(300);
  });

  it("ignores a bounced proposal, another guard, a monthly cap and a cap that is not cents", () => {
    const noise: CopilotToolTrace = {
      ...EMPTY,
      operations: [
        {
          op: {
            kind: "set_guard",
            params: { guard: "spend_guard", params: { per_run_cap_cents: 200 } },
          },
          outcome: "bounced",
          validator_message: "no",
        },
        {
          op: { kind: "set_guard", params: { guard: "auto_merge", params: {} } },
          outcome: "proposed",
        },
        {
          op: {
            kind: "set_guard",
            params: { guard: "spend_guard", params: { monthly_cap_cents: 9 } },
          },
          outcome: "proposed",
        },
        {
          op: {
            kind: "set_guard",
            params: { guard: "spend_guard", params: { per_run_cap_cents: 2.5 } },
          },
          outcome: "proposed",
        },
        {
          op: { kind: "set_guard", params: { guard: "spend_guard", params: "five" } },
          outcome: "proposed",
        },
        {
          op: { kind: "set_guard", params: { spend_cap_cents: 0, per: "run" } },
          outcome: "proposed",
        },
        {
          op: { kind: "set_guard", params: { spend_cap_cents: 500, per: "month" } },
          outcome: "proposed",
        },
        { op: { kind: "set_guard" }, outcome: "proposed" },
        {
          op: { kind: "add_stage", params: { spend_cap_cents: 1, per: "run" } },
          outcome: "applied",
        },
      ],
    };

    expect(draftSpendGuardCents([noise])).toBeNull();
  });
});

describe("the effective budget", () => {
  it("is the draft's $5 guard under a larger workspace cap", () => {
    expect(effectiveBudget(1000, 500)).toEqual({
      capCents: 500,
      source: "draft_guard",
      workspaceCapCents: 1000,
      draftGuardCents: 500,
    });
  });

  it("is the workspace cap when the draft's guard is looser", () => {
    expect(effectiveBudget(300, 500)).toMatchObject({ capCents: 300, source: "workspace_cap" });
  });

  it("is the workspace cap when the draft carries no guard, and on a tie", () => {
    expect(effectiveBudget(1000, null)).toMatchObject({
      capCents: 1000,
      source: "workspace_cap",
      draftGuardCents: null,
    });
    expect(effectiveBudget(500, 500)).toMatchObject({ capCents: 500, source: "workspace_cap" });
  });

  it("caps the run's spend for the harness and nothing else", () => {
    expect(engineBudget(effectiveBudget(1000, 500))).toEqual({
      runCostCents: 500,
      stageCostCents: null,
      runTokens: null,
      stageTokens: null,
    });
  });
});
