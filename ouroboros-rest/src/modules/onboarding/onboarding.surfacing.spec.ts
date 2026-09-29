/** The fresh-org surfacing rule ([#385](https://github.com/NobuData/ouroboros/issues/385)). */

import { surfacing } from "./onboarding.surfacing";

describe("the surfacing rule", () => {
  it("offers the wizard to a fresh organization — no runs, no finished wizard", () => {
    expect(surfacing({ anyWizardFinished: false, hasRuns: false })).toEqual({
      offer: true,
      reason: "fresh_organization",
    });
  });

  it("does not nag an established organization", () => {
    expect(surfacing({ anyWizardFinished: false, hasRuns: true })).toEqual({
      offer: false,
      reason: "organization_has_runs",
    });
  });

  it("stops offering once any wizard is finished — dismissal sticks", () => {
    expect(surfacing({ anyWizardFinished: true, hasRuns: false })).toEqual({
      offer: false,
      reason: "wizard_finished",
    });
    expect(surfacing({ anyWizardFinished: true, hasRuns: true }).reason).toBe("wizard_finished");
  });
});
