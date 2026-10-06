import type { InvestigationEstimateOutcome } from "../db/schema";
import type { ResolvedPrice } from "../pricing/price";
import type { PricingService } from "../pricing/pricing.service";
import type { Resolution, ResolutionHop } from "../routing/resolution";
import type { ResolutionService } from "../routing/resolution.service";
import { routeNotFound } from "../routing/routing.errors";
import { ResearchEstimateService, synthesisRatesOf } from "./estimate.service";
import { RESEARCH_ERRORS } from "./research.errors";
import type { InvestigationScope, KindDefaults, ResearchRepository } from "./research.repository";

/**
 * The service's job is the reads around the pure estimate: resolve `research` through Z.1, price
 * the alias through CH.3, ask the hosted tools, and refuse what the database would. Every
 * collaborator is a stub here; the arithmetic is `estimate.spec.ts`'s, and the SQL
 * `research.repository.spec.ts`'s.
 */

const WORKSPACE = "org-acme";
const INVESTIGATION = "5eed0084-0000-4000-8000-000000000127";
const FIVE_TOOLS = ["web", "competitor", "code", "tickets", "telemetry"];

const GAP_ANALYSIS: KindDefaults = { slug: "gap_analysis", defaultTools: FIVE_TOOLS };

const PROVENANCE = {
  source: "bundled" as const,
  catalogVersion: "2026-08-15+litellm.70d51a1",
  effectiveAt: new Date("2026-08-15T00:00:00.000Z"),
};

const SONNET_PRICE: ResolvedPrice = {
  billingMode: "token",
  inputCentsPer1m: "300.0000",
  outputCentsPer1m: "1500.0000",
  provenance: PROVENANCE,
};

/**
 * One hop of a resolved chain.
 *
 * @param alias - The alias.
 * @param decision - Kept or dropped.
 * @param bound - Whether it has a provider.
 * @returns The hop.
 */
function hop(alias: string, decision: "kept" | "dropped", bound = true): ResolutionHop {
  return {
    index: 1,
    position: 1,
    alias,
    modelId: alias === "researcher-long-ctx" ? "claude-sonnet-4-6" : "claude-sonnet-5",
    params: {},
    provider: bound
      ? {
          id: "conn-anthropic",
          kind: "anthropic",
          displayName: "Anthropic Claude",
          baseUrl: null,
          status: "active",
          latencyMs: 42,
          detail: null,
        }
      : null,
    note: null,
    decision,
    code: decision === "kept" ? "provider_healthy" : "provider_down",
    explanation: "",
  } as ResolutionHop;
}

/**
 * A resolution of `research`.
 *
 * @param chain - The hops.
 * @param outcome - Resolved or fail_run.
 * @returns The resolution.
 */
function resolution(
  chain: ResolutionHop[],
  outcome: "resolved" | "fail_run" = "resolved",
): Resolution {
  return {
    resolutionVersion: "r1",
    taskKind: "research",
    routeTag: "research-primary",
    outcome,
    chain,
    rules: [],
    votes: [],
    floor: {},
    allowLocalFallback: true,
    maxCostCents: null,
    failure: null,
  } as unknown as Resolution;
}

const QUEUED: InvestigationScope = {
  id: INVESTIGATION,
  displayId: "RS-127",
  depth: "deep_dive",
  tools: FIVE_TOOLS,
  status: "queued",
};

describe("the research estimate service", () => {
  let repository: jest.Mocked<
    Pick<
      ResearchRepository,
      "findKind" | "unknownTools" | "findInvestigation" | "storeEstimate" | "recordOutcome"
    >
  >;
  let resolve: jest.Mock;
  let price: jest.Mock;
  let operationPrices: jest.Mock;
  let service: ResearchEstimateService;

  beforeEach(() => {
    repository = {
      findKind: jest.fn().mockResolvedValue(GAP_ANALYSIS),
      unknownTools: jest.fn().mockResolvedValue([]),
      findInvestigation: jest.fn().mockResolvedValue(QUEUED),
      storeEstimate: jest.fn().mockResolvedValue(true),
      recordOutcome: jest.fn(),
    };
    resolve = jest
      .fn()
      .mockResolvedValue(
        resolution([hop("researcher-long-ctx", "kept"), hop("coder-std", "kept")]),
      );
    price = jest.fn().mockResolvedValue(SONNET_PRICE);
    operationPrices = jest.fn().mockResolvedValue(new Map());

    service = new ResearchEstimateService(
      repository as unknown as ResearchRepository,
      { resolve } as unknown as ResolutionService,
      { resolve: price } as unknown as PricingService,
      { operationPrices },
    );
  });

  describe("estimating for the composer", () => {
    it("answers the seeded deep dive with the mockup's line and the resolved alias", async () => {
      const estimate = await service.estimate(WORKSPACE, {
        kind: "gap_analysis",
        depth: "deep_dive",
        tools: FIVE_TOOLS,
      });

      expect(estimate.label).toBe("est. 40–60 sources · ~$6");
      expect(estimate.researcher).toEqual({
        taskKind: "research",
        routeTag: "research-primary",
        alias: "researcher-long-ctx",
        modelId: "claude-sonnet-4-6",
      });
      expect(estimate.costCents).toEqual({ min: 522, max: 687 });
      expect(estimate.tools).toEqual(FIVE_TOOLS);
      expect(estimate.depth).toBe("deep_dive");
    });

    it("resolves through routing's `research` task kind, with no context", async () => {
      await service.estimate(WORKSPACE, { kind: "gap_analysis", depth: "quick" });

      expect(resolve).toHaveBeenCalledWith(WORKSPACE, "research", {});
    });

    it("prices the alias's model under its provider's kind, in this workspace", async () => {
      await service.estimate(WORKSPACE, { kind: "gap_analysis", depth: "quick" });

      expect(price).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-6", WORKSPACE);
    });

    it("uses the kind's playbook tools when none are given", async () => {
      repository.findKind.mockResolvedValue({
        slug: "bug_root_cause",
        defaultTools: ["code", "tickets"],
      });

      const estimate = await service.estimate(WORKSPACE, {
        kind: "bug_root_cause",
        depth: "standard",
      });

      expect(estimate.tools).toEqual(["code", "tickets"]);
      expect(estimate.operations.total).toBe(8);
    });

    it("names the first kept hop when the primary is dropped — what would actually run", async () => {
      resolve.mockResolvedValue(
        resolution([hop("researcher-long-ctx", "dropped"), hop("coder-std", "kept")]),
      );

      const estimate = await service.estimate(WORKSPACE, { kind: "gap_analysis", depth: "quick" });

      expect(estimate.researcher?.alias).toBe("coder-std");
    });

    it("asks the hosted tool providers about the selected tools and adds what they charge", async () => {
      operationPrices.mockResolvedValue(new Map([["web", 2.5]]));

      const estimate = await service.estimate(WORKSPACE, {
        kind: "gap_analysis",
        depth: "deep_dive",
        tools: FIVE_TOOLS,
      });

      expect(operationPrices).toHaveBeenCalledWith(WORKSPACE, FIVE_TOOLS);
      expect(estimate.costCents).toEqual({ min: 552, max: 717 });
    });
  });

  describe("no dollars without a price", () => {
    it.each<[string, ResolvedPrice | undefined]>([
      ["no price row", undefined],
      [
        "a seat price",
        {
          billingMode: "seat",
          inputCentsPer1m: null,
          outputCentsPer1m: null,
          provenance: PROVENANCE,
        },
      ],
      [
        "a vendor-metered price",
        {
          billingMode: "usage",
          inputCentsPer1m: null,
          outputCentsPer1m: null,
          provenance: PROVENANCE,
        },
      ],
    ])("gives a source range and no cost for %s", async (_name, resolved) => {
      price.mockResolvedValue(resolved);
      operationPrices.mockResolvedValue(new Map([["web", 2]]));

      const estimate = await service.estimate(WORKSPACE, {
        kind: "gap_analysis",
        depth: "deep_dive",
        tools: FIVE_TOOLS,
      });

      expect(estimate.sources).toEqual({ min: 40, max: 60 });
      expect(estimate.costCents).toBeNull();
      expect(estimate.label).toBe("est. 40–60 sources");
      expect(JSON.stringify(estimate)).not.toContain("$");
      expect(estimate.researcher?.alias).toBe("researcher-long-ctx");
    });

    it("has no researcher and no cost when the workspace has no research route", async () => {
      resolve.mockRejectedValue(routeNotFound("research"));

      const estimate = await service.estimate(WORKSPACE, {
        kind: "gap_analysis",
        depth: "deep_dive",
      });

      expect(estimate.researcher).toBeNull();
      expect(estimate.costCents).toBeNull();
      expect(estimate.sources).toEqual({ min: 40, max: 60 });
      expect(price).not.toHaveBeenCalled();
    });

    it("has no researcher when the resolution fails the run", async () => {
      resolve.mockResolvedValue(resolution([hop("researcher-long-ctx", "kept")], "fail_run"));

      const estimate = await service.estimate(WORKSPACE, { kind: "gap_analysis", depth: "quick" });

      expect(estimate.researcher).toBeNull();
      expect(estimate.costCents).toBeNull();
    });

    it("has no researcher when every hop is dropped", async () => {
      resolve.mockResolvedValue(resolution([hop("researcher-long-ctx", "dropped")]));

      expect(
        (await service.estimate(WORKSPACE, { kind: "gap_analysis", depth: "quick" })).researcher,
      ).toBeNull();
    });

    it("does not price an unbound hop", async () => {
      resolve.mockResolvedValue(resolution([hop("researcher-long-ctx", "kept", false)]));

      const estimate = await service.estimate(WORKSPACE, { kind: "gap_analysis", depth: "quick" });

      expect(price).not.toHaveBeenCalled();
      expect(estimate.costCents).toBeNull();
    });

    it("lets any other routing failure through", async () => {
      resolve.mockRejectedValue(new Error("pool exhausted"));

      await expect(
        service.estimate(WORKSPACE, { kind: "gap_analysis", depth: "quick" }),
      ).rejects.toThrow("pool exhausted");
    });
  });

  describe("refusals", () => {
    it("refuses a kind the workspace lacks with a 404 naming it", async () => {
      repository.findKind.mockResolvedValue(undefined);

      await expect(
        service.estimate(WORKSPACE, { kind: "market_sizing", depth: "quick" }),
      ).rejects.toMatchObject({
        code: RESEARCH_ERRORS.kindNotFound,
        details: { kind: "market_sizing" },
      });
    });

    it("refuses an unregistered tool with a 422 naming it, before resolving anything", async () => {
      repository.unknownTools.mockResolvedValue(["patents"]);

      await expect(
        service.estimate(WORKSPACE, {
          kind: "gap_analysis",
          depth: "quick",
          tools: ["web", "patents"],
        }),
      ).rejects.toMatchObject({
        code: RESEARCH_ERRORS.toolUnknown,
        details: { tools: ["patents"] },
      });
      expect(resolve).not.toHaveBeenCalled();
    });

    it("refuses when no tools were given and the kind defaults to none", async () => {
      repository.findKind.mockResolvedValue({ slug: "custom", defaultTools: [] });

      await expect(
        service.estimate(WORKSPACE, { kind: "custom", depth: "quick" }),
      ).rejects.toMatchObject({ code: RESEARCH_ERRORS.toolsRequired });
    });
  });

  describe("storing an estimate on an investigation", () => {
    it("computes from the investigation's own depth and tools and stores it with its calibration", async () => {
      const estimate = await service.storeEstimate(WORKSPACE, INVESTIGATION);

      expect(estimate.label).toBe("est. 40–60 sources · ~$6");
      expect(repository.storeEstimate).toHaveBeenCalledWith(
        WORKSPACE,
        INVESTIGATION,
        { sources: { min: 40, max: 60 }, cost_cents: { min: 522, max: 687 } },
        1,
      );
    });

    it("stores a null cost for an unpriced researcher", async () => {
      price.mockResolvedValue(undefined);

      await service.storeEstimate(WORKSPACE, INVESTIGATION);

      expect(repository.storeEstimate).toHaveBeenCalledWith(
        WORKSPACE,
        INVESTIGATION,
        { sources: { min: 40, max: 60 }, cost_cents: null },
        1,
      );
    });

    it("refuses an investigation the workspace lacks", async () => {
      repository.findInvestigation.mockResolvedValue(undefined);

      await expect(service.storeEstimate(WORKSPACE, INVESTIGATION)).rejects.toMatchObject({
        code: RESEARCH_ERRORS.investigationNotFound,
      });
    });

    it("refuses one that has started — it keeps the estimate it started under", async () => {
      repository.findInvestigation.mockResolvedValue({ ...QUEUED, status: "running" });

      await expect(service.storeEstimate(WORKSPACE, INVESTIGATION)).rejects.toMatchObject({
        code: RESEARCH_ERRORS.investigationNotQueued,
        details: { investigation: "RS-127", status: "running" },
      });
      expect(repository.storeEstimate).not.toHaveBeenCalled();
    });

    it("names the status it moved to when it started between the read and the write", async () => {
      repository.storeEstimate.mockResolvedValue(false);
      repository.findInvestigation
        .mockResolvedValueOnce(QUEUED)
        .mockResolvedValueOnce({ ...QUEUED, status: "cancelled" });

      await expect(service.storeEstimate(WORKSPACE, INVESTIGATION)).rejects.toMatchObject({
        code: RESEARCH_ERRORS.investigationNotQueued,
        details: { status: "cancelled" },
      });
    });

    it("says not found when it vanished between the read and the write", async () => {
      repository.storeEstimate.mockResolvedValue(false);
      repository.findInvestigation.mockResolvedValueOnce(QUEUED).mockResolvedValueOnce(undefined);

      await expect(service.storeEstimate(WORKSPACE, INVESTIGATION)).rejects.toMatchObject({
        code: RESEARCH_ERRORS.investigationNotFound,
      });
    });
  });

  describe("reconciling estimate and actuals", () => {
    const OUTCOME: InvestigationEstimateOutcome = {
      investigation_id: INVESTIGATION,
      organization_id: WORKSPACE,
      calibration_version: 1,
      depth: "deep_dive",
      tools_enabled: FIVE_TOOLS,
      alias: "researcher-long-ctx",
      estimated_sources_min: 40,
      estimated_sources_max: 60,
      estimated_cost_cents_min: 522,
      estimated_cost_cents_max: 687,
      actual_sources: 44,
      actual_spend_cents: 612,
      sources_within_estimate: true,
      cost_within_estimate: true,
      recorded_at: new Date("2026-10-06T12:00:00.000Z"),
    };

    it("records the comparison and answers it — RS-127's 44 sources and 612¢ inside 40–60 and 522–687¢", async () => {
      repository.recordOutcome.mockResolvedValue(OUTCOME);

      const outcome = await service.reconcile(WORKSPACE, INVESTIGATION);

      expect(repository.recordOutcome).toHaveBeenCalledWith(WORKSPACE, INVESTIGATION);
      expect(outcome).toEqual({
        investigationId: INVESTIGATION,
        calibrationVersion: 1,
        depth: "deep_dive",
        tools: FIVE_TOOLS,
        alias: "researcher-long-ctx",
        estimated: { sources: { min: 40, max: 60 }, costCents: { min: 522, max: 687 } },
        actual: { sources: 44, spendCents: 612 },
        sourcesWithinEstimate: true,
        costWithinEstimate: true,
        recordedAt: "2026-10-06T12:00:00.000Z",
      });
    });

    it("refuses an investigation the workspace lacks", async () => {
      repository.findInvestigation.mockResolvedValue(undefined);

      await expect(service.reconcile(WORKSPACE, INVESTIGATION)).rejects.toMatchObject({
        code: RESEARCH_ERRORS.investigationNotFound,
      });
      expect(repository.recordOutcome).not.toHaveBeenCalled();
    });

    it("refuses one with nothing to compare yet", async () => {
      repository.recordOutcome.mockResolvedValue(undefined);

      await expect(service.reconcile(WORKSPACE, INVESTIGATION)).rejects.toMatchObject({
        code: RESEARCH_ERRORS.outcomeUnavailable,
        details: { investigation: "RS-127" },
      });
    });
  });
});

describe("the rates a price gives", () => {
  it("gives both rates of a per-token price", () => {
    expect(synthesisRatesOf(SONNET_PRICE)).toEqual({
      inputCentsPer1m: "300.0000",
      outputCentsPer1m: "1500.0000",
    });
  });

  it("gives zero for a free model with no stated rates", () => {
    expect(
      synthesisRatesOf({
        billingMode: "free",
        inputCentsPer1m: null,
        outputCentsPer1m: null,
        provenance: PROVENANCE,
      }),
    ).toEqual({ inputCentsPer1m: 0, outputCentsPer1m: 0 });
  });

  it("keeps a free model's stated zeroes", () => {
    expect(
      synthesisRatesOf({
        billingMode: "free",
        inputCentsPer1m: "0.0000",
        outputCentsPer1m: "0",
        provenance: PROVENANCE,
      }),
    ).toEqual({ inputCentsPer1m: "0.0000", outputCentsPer1m: "0" });
  });

  it("gives none for no price", () => {
    expect(synthesisRatesOf(undefined)).toBeNull();
  });
});
