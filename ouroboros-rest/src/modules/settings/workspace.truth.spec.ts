import {
  CONTROL_REASONS,
  DEPLOYMENT_KIND,
  RESIDENCY_DOCS_URL,
  UNNAMED_REGION_LABEL,
  regionPayload,
  trainingDataPayload,
  type TrainingDataPayload,
} from "./workspace.truth";

/**
 * Decision S6, held as values: a self-hosted deployment reports a read-only region and the
 * truthful training line, and never the plan lock the mockup draws.
 */

describe("the region a self-hosted deployment reports", () => {
  it("is the operator's label, read-only, sourced from configuration", () => {
    expect(regionPayload(DEPLOYMENT_KIND, "eu-central-1")).toEqual({
      label: "eu-central-1",
      selectable: false,
      source: "configured",
      reason: "deployment",
      docsUrl: RESIDENCY_DOCS_URL,
    });
  });

  it("says self-hosted, by default, when the operator named none", () => {
    expect(regionPayload(DEPLOYMENT_KIND, undefined)).toEqual({
      label: UNNAMED_REGION_LABEL,
      selectable: false,
      source: "default",
      reason: "deployment",
      docsUrl: RESIDENCY_DOCS_URL,
    });
    expect(UNNAMED_REGION_LABEL).toBe("self-hosted");
  });

  it("links to the security model's residency section (#226)", () => {
    expect(RESIDENCY_DOCS_URL).toMatch(
      /docs\/SECURITY_MODEL\.md#67-where-a-workspaces-data-lives$/,
    );
  });
});

describe("the training-data row a self-hosted deployment reports", () => {
  it("is off, unchangeable, because of the deployment — never the plan", () => {
    const payload = trainingDataPayload(DEPLOYMENT_KIND);

    expect(payload).toEqual({ enabled: false, changeable: false, reason: "deployment" });
    expect(payload.reason).not.toBe("plan");
  });

  it("can still represent the plan-locked variant BT.4 activates", () => {
    // Compiles only while the union admits it; the contract spec holds the wire shape.
    const planLocked: TrainingDataPayload = { enabled: false, changeable: false, reason: "plan" };

    expect(planLocked.reason).toBe("plan");
    expect(CONTROL_REASONS).toContain("plan");
  });

  it("is the only deployment kind there is", () => {
    expect(DEPLOYMENT_KIND).toBe("self_hosted");
  });
});
