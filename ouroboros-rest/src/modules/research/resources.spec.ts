import { estimateInvestigation } from "./estimate";
import { estimateOutcomeResource, scopeEstimateResource } from "./resources";

/** The published shapes — composed once, so the endpoint and the store path agree. */

const TOOLS = ["web", "competitor", "code", "tickets", "telemetry"];
const RESEARCHER = {
  taskKind: "research",
  routeTag: "research-primary",
  alias: "researcher-long-ctx",
  modelId: "claude-sonnet-4-6",
};

describe("the scope estimate resource", () => {
  it("carries the estimate, its inputs, the researcher and the composed line", () => {
    const estimate = estimateInvestigation({
      depth: "deep_dive",
      tools: TOOLS,
      synthesisRates: { inputCentsPer1m: "300.0000", outputCentsPer1m: "1500.0000" },
      toolOperationCents: new Map(),
    });

    const resource = scopeEstimateResource(estimate, "deep_dive", TOOLS, RESEARCHER);

    expect(resource).toEqual({
      depth: "deep_dive",
      tools: TOOLS,
      researcher: RESEARCHER,
      calibrationVersion: 1,
      operations: estimate.operations,
      synthesisCalls: { min: 44, max: 64 },
      sources: { min: 40, max: 60 },
      costCents: { min: 522, max: 687 },
      label: "est. 40–60 sources · ~$6",
    });
    expect(resource.tools).not.toBe(TOOLS);
  });

  it("composes an unpriced line with no dollar sign", () => {
    const estimate = estimateInvestigation({
      depth: "quick",
      tools: ["web"],
      synthesisRates: null,
      toolOperationCents: new Map(),
    });

    expect(scopeEstimateResource(estimate, "quick", ["web"], null).label).toBe("est. 3–5 sources");
  });
});

describe("the estimate outcome resource", () => {
  const ROW = {
    investigation_id: "5eed0084-0000-4000-8000-000000000127",
    organization_id: "org-acme",
    calibration_version: 1,
    depth: "deep_dive" as const,
    tools_enabled: TOOLS,
    alias: "researcher-long-ctx",
    estimated_sources_min: 40,
    estimated_sources_max: 60,
    estimated_cost_cents_min: null,
    estimated_cost_cents_max: null,
    actual_sources: 61,
    actual_spend_cents: null,
    sources_within_estimate: false,
    cost_within_estimate: null,
    recorded_at: new Date("2026-10-06T12:00:00.000Z"),
  };

  it("keeps an unpriced estimate's cost null rather than zero", () => {
    expect(estimateOutcomeResource(ROW)).toMatchObject({
      estimated: { sources: { min: 40, max: 60 }, costCents: null },
      actual: { sources: 61, spendCents: null },
      sourcesWithinEstimate: false,
      costWithinEstimate: null,
      recordedAt: "2026-10-06T12:00:00.000Z",
    });
  });
});
