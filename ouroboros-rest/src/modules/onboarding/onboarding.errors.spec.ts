/** The onboarding refusals ([#385](https://github.com/NobuData/ouroboros/issues/385)). */

import { deriveRail } from "./onboarding.derivation";
import {
  issueNotFound,
  issueTicketMissing,
  ONBOARDING_ERRORS,
  pickAmbiguous,
  pickRequired,
  stepIncomplete,
  templateInvalid,
  templateLocked,
  templateUnknown,
  ticketNotFound,
} from "./onboarding.errors";

describe("the onboarding errors", () => {
  it("are the strings the specification publishes", () => {
    expect(ONBOARDING_ERRORS).toEqual({
      ticketNotFound: "onboarding_ticket_not_found",
      templateUnknown: "onboarding_template_unknown",
      stepIncomplete: "onboarding_step_incomplete",
      templateLocked: "onboarding_template_locked",
      templateInvalid: "onboarding_template_invalid",
      issueNotFound: "onboarding_issue_not_found",
      issueTicketMissing: "onboarding_issue_ticket_missing",
      pickAmbiguous: "onboarding_pick_ambiguous",
      pickRequired: "onboarding_pick_required",
    });
  });

  it("answers an unknown ticket with a 404 naming it", () => {
    const error = ticketNotFound("7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f");

    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toMatchObject({
      code: "onboarding_ticket_not_found",
      details: { ticketId: "7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f" },
    });
  });

  it("answers an unknown template with a 422 listing the offered ones", () => {
    const error = templateUnknown("nope", ["quick-fixes"]);

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({
      code: "onboarding_template_unknown",
      details: { selectedTemplate: "nope", offered: ["quick-fixes"] },
    });
  });

  it("answers a refused guard with a 409 whose message is the stated reason", () => {
    const rail = deriveRail({
      repo: "acme-robotics/helios-firmware",
      source: null,
      repository: null,
      scanned: false,
      selectedTemplate: null,
      workflow: null,
      pickedTicket: null,
      completed: false,
    });
    const error = stepIncomplete(3, rail.steps[0]);

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      code: "onboarding_step_incomplete",
      message: rail.steps[0].reason,
      details: { step: 3, blockingStep: 1, reason: rail.steps[0].reason },
    });
  });

  it("answers a locked tier with a 409 carrying the tile's own progress (#386)", () => {
    const error = templateLocked("deep-refactor", {
      locked: true,
      mergedLoops: 3,
      threshold: 10,
      rule: "unlock after 10 merged loops",
      progress: "3 of 10 merged loops",
    });

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      code: "onboarding_template_locked",
      message:
        "The deep-refactor template is locked: unlock after 10 merged loops (3 of 10 merged loops so far).",
      details: {
        slug: "deep-refactor",
        mergedLoops: 3,
        threshold: 10,
        progress: "3 of 10 merged loops",
      },
    });
  });

  it("answers a refused definition with a 422 carrying the gate's findings unchanged (#386)", () => {
    const findings = [
      { source: "dsl" as const, code: "structure.no_terminal", message: "No terminal.", node: "x" },
    ];
    const error = templateInvalid("quick-fixes", 3, findings);

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({
      code: "onboarding_template_invalid",
      details: { slug: "quick-fixes", version: 3, findings },
    });
    // The envelope and nothing else — no stack, no driver text.
    expect(Object.keys(error.getResponse() as object).sort()).toEqual([
      "code",
      "details",
      "message",
    ]);
  });

  describe("the launch and pick refusals (BB.5, #388)", () => {
    const ISSUE_ID = "5eed004e-0000-4000-8000-000000000488";

    it("answers an issue outside the repository's backlog with a 404 naming only the id sent", () => {
      const error = issueNotFound(ISSUE_ID);

      expect(error.getStatus()).toBe(404);
      expect(error.getResponse()).toEqual({
        code: "onboarding_issue_not_found",
        message: "No such issue in this repository's backlog.",
        details: { issueId: ISSUE_ID },
      });
    });

    it("answers an issue no source has read with a 422 naming the issue and the repository", () => {
      const error = issueTicketMissing(ISSUE_ID, 488, "acme-robotics/helios-firmware");

      expect(error.getStatus()).toBe(422);
      expect(error.getResponse()).toEqual({
        code: "onboarding_issue_ticket_missing",
        message:
          "#488 has not been read by a GitHub source of acme-robotics/helios-firmware yet, so it cannot be picked.",
        details: { issueId: ISSUE_ID, issueNumber: 488, repo: "acme-robotics/helios-firmware" },
      });
    });

    it("answers a pick named twice with a 422 naming both fields", () => {
      const error = pickAmbiguous();

      expect(error.getStatus()).toBe(422);
      expect(error.getResponse()).toMatchObject({
        code: "onboarding_pick_ambiguous",
        details: { fields: ["pickedTicketId", "pickedIssueId"] },
      });
    });

    it("answers a launch with nothing to queue with a 409 whose message is the stated reason", () => {
      const error = pickRequired("No first issue has been picked yet.");

      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual({
        code: "onboarding_pick_required",
        message: "No first issue has been picked yet.",
        details: { step: 4, reason: "No first issue has been picked yet." },
      });
    });
  });
});
