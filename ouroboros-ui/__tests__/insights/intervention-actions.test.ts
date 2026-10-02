import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  EVENTS_UNREADABLE,
  RECATEGORIZE_FAILED,
  RECATEGORIZE_FORBIDDEN,
  RECATEGORIZE_GONE,
  RECATEGORIZE_INVALID,
  RECATEGORIZE_UNCHANGED,
} from "@/app/insights/bars-view";

vi.mock("server-only", () => ({}));

const interventions = vi.fn();
const recategorize = vi.fn();

vi.mock("@/app/api/insights", () => ({
  insights: {
    interventions: (...args: unknown[]) => interventions(...args),
    recategorize: (...args: unknown[]) => recategorize(...args),
  },
}));

const { listCauseEvents, recategorizeEvent } = await import("@/app/insights/intervention-actions");

/**
 * The interventions card's Server Actions (#445): a list or a write comes back as a value, the
 * service's refusals become sentences — a viewer's direct call included — and anything that is
 * not the service's refusal still throws.
 */

/**
 * A refusal as the client raises it.
 *
 * @param status The HTTP status.
 * @param code The contract's code.
 * @returns The error.
 */
function refusal(status: number, code: string): ApiError {
  return new ApiError(status, code, "refused");
}

beforeEach(() => {
  interventions.mockReset();
  recategorize.mockReset();
});

describe("listCauseEvents", () => {
  it("lists one bar's events for the page's range", async () => {
    interventions.mockResolvedValue({ total: 0, interventions: [] });

    await expect(listCauseEvents("7d", "infra_rig")).resolves.toEqual({
      ok: true,
      value: { total: 0, interventions: [] },
    });
    expect(interventions).toHaveBeenCalledWith("7d", "infra_rig");
  });

  it("says so when the list cannot be read", async () => {
    interventions.mockRejectedValue(refusal(500, "internal_error"));

    await expect(listCauseEvents("7d", "other")).resolves.toEqual({ ok: false, reason: EVENTS_UNREADABLE });
  });

  it("lets anything that is not a refusal through", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    interventions.mockRejectedValue(redirect);

    await expect(listCauseEvents("7d", "other")).rejects.toBe(redirect);
  });
});

describe("recategorizeEvent", () => {
  it("writes the trimmed reason and answers the corrected event", async () => {
    recategorize.mockResolvedValue({ id: "e1", cause: "infra_rig" });

    await expect(recategorizeEvent("e1", "infra_rig", "  The rig was down.  ")).resolves.toEqual({
      ok: true,
      value: { id: "e1", cause: "infra_rig" },
    });
    expect(recategorize).toHaveBeenCalledWith("e1", "infra_rig", "The rig was down.");
  });

  it("refuses a blank reason without calling the service", async () => {
    await expect(recategorizeEvent("e1", "other", "   ")).resolves.toEqual({
      ok: false,
      reason: RECATEGORIZE_INVALID,
    });
    expect(recategorize).not.toHaveBeenCalled();
  });

  it.each([
    [403, "forbidden", RECATEGORIZE_FORBIDDEN],
    [404, "intervention_not_found", RECATEGORIZE_GONE],
    [409, "intervention_cause_unchanged", RECATEGORIZE_UNCHANGED],
    [422, "validation_failed", RECATEGORIZE_INVALID],
    [500, "internal_error", RECATEGORIZE_FAILED],
  ])("turns a %i %s into a sentence — a viewer's direct call is refused", async (status, code, sentence) => {
    recategorize.mockRejectedValue(refusal(status, code));

    await expect(recategorizeEvent("e1", "other", "Because.")).resolves.toEqual({ ok: false, reason: sentence });
  });
});
