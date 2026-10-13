import type { BacklogDetailService } from "../../backlog/detail.service";
import { ConflictError, NotFoundError, TooManyRequestsError } from "../../errors/error.envelope";
import type { EstimationTriggerService } from "../../estimation/estimation.trigger.service";
import type { Invoker } from "../grammar.types";
import { EstimateBinding } from "./estimate.binding";
import { bindsOf, contextFor, INVOKER, strictDouble, TICKET, WORKSPACE } from "./planes.fixture";

/**
 * `/ouro estimate <ticket>` (#537) is the backlog side panel's two calls:
 *
 *   * the read — `BacklogDetailService.detailOf`, which `GET /api/v1/backlog/:id` makes
 *     (`BacklogDetailController.detailOf`: `this.detail.detailOf(tenant.id, params.id)`);
 *   * the trigger, only when there is no estimate — `EstimationTriggerService.estimate`, the
 *     *Estimate* button's `POST /api/v1/backlog/:id/estimate`
 *     (`EstimationController.estimate`: `this.trigger.estimate(tenant.id, params.id)`), which
 *     carries the rate limit and the already-estimating refusal.
 *
 * Each double has its one method. Reading an estimate must never start one, and starting one
 * must go through the limiter — so the suite is mostly about which of the two was called.
 */

/** The estimate in force, as the side panel's payload carries it. */
const ESTIMATE = {
  effort: "m",
  confidence: 82.4,
  suggestedWorkflow: "standard-fix",
  breakdown: { cycleMin: 20, cycleMax: 45, estMinutes: 30, estTokens: 12_400 },
};

/** A viewer: admitted by the registry, because reading an estimate is every member's. */
const VIEWER: Invoker = { ...INVOKER, roles: ["viewer"] };

describe("the /ouro estimate binding", () => {
  let detailOf: jest.Mock;
  let estimate: jest.Mock;
  let binding: EstimateBinding;

  /**
   * What the side panel reads next.
   *
   * @param stored - The estimate in force, or `null`.
   * @param sizingStatus - The issue's sizing status.
   */
  function panel(stored: typeof ESTIMATE | null, sizingStatus = "not_sized"): void {
    detailOf.mockResolvedValue({ issue: { sizingStatus }, estimate: stored });
  }

  beforeEach(() => {
    detailOf = jest.fn();
    estimate = jest.fn().mockResolvedValue({ sizingStatus: "estimating" });
    binding = new EstimateBinding(
      strictDouble<BacklogDetailService>("BacklogDetailService", { detailOf }),
      strictDouble<EstimationTriggerService>("EstimationTriggerService", { estimate }),
    );
  });

  it("serves the estimate command, which the registry binds to the panel's read and button", () => {
    expect(binding.command).toBe("estimate");
    expect(bindsOf("estimate")).toBe(
      "GET /api/v1/backlog/{id} · POST /api/v1/backlog/{id}/estimate",
    );
  });

  describe("when the issue has an estimate", () => {
    beforeEach(() => {
      panel(ESTIMATE, "sized");
    });

    it("makes the side panel's read and starts nothing", async () => {
      await binding.run(contextFor("estimate", { ticket: TICKET }));

      expect(detailOf).toHaveBeenCalledTimes(1);
      expect(detailOf).toHaveBeenCalledWith(WORKSPACE, TICKET.issueId);
      expect(estimate).not.toHaveBeenCalled();
    });

    it("answers the estimate in one line, with tokens and no dollar figure", async () => {
      const result = await binding.run(contextFor("estimate", { ticket: TICKET }));

      expect(result).toEqual({
        kind: "done",
        reply: {
          text: "#485 — effort M · cycle 20–45 min · est. 30 min · ~12k tokens · confidence 82% · suggests standard-fix",
        },
        ref: { issueId: TICKET.issueId, issueNumber: 485 },
      });
      expect(result.reply.text).not.toContain("$");
    });

    it("reads it to a viewer as to anyone", async () => {
      const result = await binding.run(
        contextFor("estimate", { ticket: TICKET }, { invoker: VIEWER }),
      );

      expect(result.reply.text).toMatch(/^#485 — effort M · /);
      expect(estimate).not.toHaveBeenCalled();
    });
  });

  describe("when the issue has no estimate", () => {
    beforeEach(() => {
      panel(null);
    });

    it("starts one through the Estimate button's call, after the read", async () => {
      await binding.run(contextFor("estimate", { ticket: TICKET }));

      expect(detailOf).toHaveBeenCalledTimes(1);
      expect(estimate).toHaveBeenCalledTimes(1);
      expect(estimate).toHaveBeenCalledWith(WORKSPACE, TICKET.issueId);
      expect(detailOf.mock.invocationCallOrder[0]).toBeLessThan(
        estimate.mock.invocationCallOrder[0],
      );
    });

    it("says one was started — and claims no figure it does not have", async () => {
      expect(await binding.run(contextFor("estimate", { ticket: TICKET }))).toEqual({
        kind: "done",
        reply: {
          text: "#485 has no estimate yet — started one. Ask again in a minute: /ouro estimate #485",
        },
        ref: { issueId: TICKET.issueId, issueNumber: 485 },
      });
    });

    it.each(["owner", "admin", "member"] as const)(
      "starts one for a workspace %s, the roles the route's guard admits",
      async (role) => {
        await binding.run(
          contextFor("estimate", { ticket: TICKET }, { invoker: { ...INVOKER, roles: [role] } }),
        );

        expect(estimate).toHaveBeenCalledTimes(1);
      },
    );

    it("does not start one for a viewer, whom the route would refuse", async () => {
      const result = await binding.run(
        contextFor("estimate", { ticket: TICKET }, { invoker: VIEWER }),
      );

      expect(estimate).not.toHaveBeenCalled();
      expect(result.reply.text).toBe(
        "#485 has no estimate yet. Starting one is for workspace owners, admins and members.",
      );
    });

    it("tells a viewer when one is already being worked out", async () => {
      panel(null, "estimating");

      const result = await binding.run(
        contextFor("estimate", { ticket: TICKET }, { invoker: VIEWER }),
      );

      expect(estimate).not.toHaveBeenCalled();
      expect(result.reply.text).toBe(
        "#485 has no estimate yet — one is being worked out. Ask again in a minute.",
      );
    });

    it.each([
      [
        "issue_already_estimating",
        new ConflictError("issue_already_estimating", "One is already in flight."),
      ],
      [
        "estimation_rate_limited",
        new TooManyRequestsError("estimation_rate_limited", "The window is full."),
      ],
    ])("relays the trigger's %s refusal as the plane threw it", async (_code, refusal) => {
      estimate.mockRejectedValue(refusal);

      await expect(binding.run(contextFor("estimate", { ticket: TICKET }))).rejects.toBe(refusal);
    });
  });

  it("relays the read's issue_not_found as thrown, and starts nothing", async () => {
    const refusal = new NotFoundError("issue_not_found", "No such issue.");
    detailOf.mockRejectedValue(refusal);

    await expect(binding.run(contextFor("estimate", { ticket: TICKET }))).rejects.toBe(refusal);
    expect(estimate).not.toHaveBeenCalled();
  });
});
