/** The onboarding refusals ([#385](https://github.com/NobuData/ouroboros/issues/385)). */

import { deriveRail } from "./onboarding.derivation";
import {
  ONBOARDING_ERRORS,
  stepIncomplete,
  templateUnknown,
  ticketNotFound,
} from "./onboarding.errors";

describe("the onboarding errors", () => {
  it("are the strings the specification publishes", () => {
    expect(ONBOARDING_ERRORS).toEqual({
      ticketNotFound: "onboarding_ticket_not_found",
      templateUnknown: "onboarding_template_unknown",
      stepIncomplete: "onboarding_step_incomplete",
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
});
