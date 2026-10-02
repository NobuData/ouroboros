import { compose } from "./composer";
import { CONFIDENCE_FORMULA, roundHalf } from "./composer.math";
import { calibrationKey } from "./composer.repository";
import {
  SEEDED_CONTEXT,
  SEEDED_FACTORS,
  SEEDED_FINDINGS,
  seededContext,
  seededId,
} from "./composer.seed.fixture";
import { TEMPLATES, type SuggestionTemplate } from "./composer.templates";
import type { ComposedSuggestion, ComposerFinding } from "./composer.types";

/** The seeded run's composition, by template. */
function composed(
  findings: readonly ComposerFinding[] = SEEDED_FINDINGS,
  context = SEEDED_CONTEXT,
): Record<string, ComposedSuggestion> {
  const { suggestions, failures } = compose(findings, context);

  expect(failures).toEqual([]);
  return Object.fromEntries(suggestions.map((suggestion) => [suggestion.template, suggestion]));
}

/**
 * Mockup 18's six cards and four ticket drafts, composed from the seeded findings — the exact
 * titles, evidence lines, impact values and confidence figures the page prints.
 */
describe("the seeded findings compose to mockup 18", () => {
  const cards = composed();

  it.each([
    [
      "test_gate_split",
      "build_process",
      "Split the test gate: native_sim every build, QEMU + HIL only before merge",
      "qemu_cortex_m3 caught 0 unique failures in 214 builds; HIL caught 9 — all at merge gates",
      -220,
      91,
      false,
    ],
    [
      "ccache_rewarm",
      "build_process",
      "Re-warm ccache right after deps-refresh merges",
      "cache hit rate drops 78%→31% for ~6h after every deps-refresh merge (14 occurrences)",
      -110,
      88,
      false,
    ],
    [
      "runner_move",
      "build_process",
      "Move forge-02 to pool-a during 14:00–16:00 UTC",
      "pool-a queue exceeds 5 min in that window on 11 of last 14 weekdays; pool-b sits idle 82% of it",
      -240,
      84,
      false,
    ],
    [
      "link_cache",
      "build_process",
      "Link zephyr.elf incrementally (partial link cache)",
      "link step grew from 18% to 42% of build time since v2.3 (LTO enabled)",
      -55,
      72,
      true,
    ],
    [
      "review_first",
      "workflow",
      "standard-fix: run self-review BEFORE the build stage",
      "34% of failed builds in standard-fix loops contained defects the later self-review flagged anyway — reordering catches them pre-build",
      -125,
      89,
      false,
    ],
    [
      "flake_retry_stage",
      "workflow",
      "Loops touching drivers/can/: add a 'flake-retry under load profile' test stage",
      "merges touching drivers/can are 3.1× more likely to flake the telemetry suite within 7 days (21 cases)",
      -1,
      77,
      false,
    ],
  ])("%s", (template, kind, title, evidence, estimate, confidence, spike) => {
    const card = cards[template];

    expect(card).toMatchObject({
      kind,
      title,
      evidenceLine: evidence,
      confidence,
      needsSpike: spike,
    });
    expect(card.impact?.estimate).toBe(estimate);
  });

  it.each([
    [
      "fixture_timeout_ticket",
      "Refactor tests/ota fixtures — shared setup times out under load",
      "7.2% of OTA suite failures share one fixture timeout signature (31 builds)",
      86,
    ],
    [
      "upstream_fix_ticket",
      "Bump ccache 4.9 → 4.11 — upstream fixes the hash misses in our logs",
      "cache-miss signature matches ccache issue #1412 in 118 builds",
      90,
    ],
    [
      "rig_capability_ticket",
      "Add thermal chamber to rig helios-rig-02",
      "3 verification waivers in 60 days cite missing thermal coverage",
      82,
    ],
    [
      "dead_options_ticket",
      "Delete 12 dead Kconfig options — never set in any build since May",
      "0 of 1,284 builds toggled them; 4 caused config-drift warnings",
      93,
    ],
  ])("%s (ticket draft)", (template, title, evidence, confidence) => {
    expect(cards[template]).toMatchObject({
      kind: "ticket_draft",
      title,
      evidenceLine: evidence,
      confidence,
      impact: null,
      needsSpike: false,
      actionBinding: { plane: "planning" },
    });
  });

  it("composes exactly those ten — no template speaks for a finding it was not built for", () => {
    expect(Object.keys(cards).sort()).toEqual(TEMPLATES.map((template) => template.id).sort());
  });

  it("binds each card to the plane BV.5 executes, with its change payload", () => {
    expect(cards.test_gate_split.actionBinding).toEqual({
      plane: "test_gate",
      change: { pr_builds: ["native_sim"], merge_gate: ["native_sim", "qemu_cortex_m3", "HIL"] },
    });
    expect(cards.ccache_rewarm.actionBinding).toEqual({
      plane: "job_hook",
      change: {
        on: "merge",
        title: "deps: refresh west manifest",
        pool: "pool-a",
        run: "west build -t ccache-warm",
      },
    });
    expect(cards.runner_move.actionBinding).toEqual({
      plane: "farm_config",
      change: {
        runner: "forge-02",
        pool: "pool-a",
        days_of_week: [1, 2, 3, 4, 5],
        starts_at: "14:00",
        ends_at: "16:00",
      },
    });
    expect(cards.link_cache.actionBinding).toEqual({
      plane: "planning",
      change: { spike: "Link zephyr.elf incrementally (partial link cache)" },
    });
    expect(cards.review_first.actionBinding).toEqual({
      plane: "workflow",
      change: { workflow: "standard-fix", move: "self-review", before: "build" },
    });
    expect(cards.flake_retry_stage.actionBinding).toEqual({
      plane: "workflow",
      change: {
        workflow: "standard-fix",
        when_paths: ["drivers/can/**"],
        add_stage: "flake-retry under load profile",
      },
    });
  });

  it("links every cited finding of a composite suggestion", () => {
    expect(cards.test_gate_split.findingIds).toEqual([seededId(171), seededId(172)]);
    expect([...cards.dead_options_ticket.findingIds].sort()).toEqual(
      Array.from({ length: 12 }, (_, index) => seededId(121 + index)).sort(),
    );
  });
});

describe("every impact reconstructs from its basis", () => {
  /**
   * An independent recomputation of each formula from nothing but the stored basis — not the
   * template's own code.
   */
  const RECOMPUTE: Record<string, (inputs: Record<string, number>) => number> = {
    test_gate_split: (inputs) => -Object.values(inputs).reduce((sum, value) => sum + value, 0),
    ccache_rewarm: (inputs) => -inputs.slowdown_seconds,
    runner_move: (inputs) => -inputs.wait_reduction_seconds,
    link_cache: (inputs) => -inputs.step_seconds_delta / 2,
    review_first: (inputs) => -inputs.attempt_seconds * inputs.share,
    flake_retry_stage: (inputs) =>
      (-(inputs.rate - inputs.baseline) * inputs.cases * 7) / inputs.window_days,
  };

  it.each(Object.keys(RECOMPUTE))("%s", (template) => {
    const card = composed()[template];
    const basis = card.impact?.basis;

    if (basis === undefined) throw new Error(`${template} has no impact`);
    const raw = RECOMPUTE[template](basis.inputs as Record<string, number>);

    expect(basis.raw).toBeCloseTo(raw, 9);
    expect(card.impact?.estimate).toBe(roundHalf(raw * basis.calibration.factor));
    expect(basis.formula).toMatch(new RegExp(`^${template} v1: `));
    expect(basis.window).toEqual(SEEDED_CONTEXT.window);
  });

  it("names the calibration it applied", () => {
    const cards = composed();

    expect(cards.test_gate_split.impact?.basis.calibration).toEqual({
      analyzer: "workflow_outcome",
      impact_class: "duration_delta",
      factor: 1.0682,
    });
    expect(cards.ccache_rewarm.impact?.basis.calibration).toEqual({
      analyzer: "cache_window",
      impact_class: "duration_delta",
      factor: 0.6545,
    });
    // An impact class with no history is uncalibrated: factor 1.
    expect(cards.runner_move.impact?.basis.calibration.factor).toBe(1);
  });

  it("records a measured basis with the sample it was measured over", () => {
    expect(composed().ccache_rewarm.impact).toMatchObject({
      share: 0.2,
      applies_to: "builds after a deps-refresh merge",
      basis: { method: "measured", sample_size: 14 },
    });
  });
});

describe("calibration moves the numbers", () => {
  it("re-composes the cache estimate when its factor changes from 1.00 to 0.65", () => {
    const uncalibrated = composed(SEEDED_FINDINGS, seededContext(new Map()));
    const calibrated = composed(
      SEEDED_FINDINGS,
      seededContext(new Map([[calibrationKey("cache_window", "duration_delta"), 0.65]])),
    );

    expect(uncalibrated.ccache_rewarm.impact?.estimate).toBe(-168);
    expect(calibrated.ccache_rewarm.impact?.estimate).toBe(-109);
    expect(calibrated.ccache_rewarm.impact?.basis.calibration.factor).toBe(0.65);
    // Nothing else moved: the factor is the cache model's alone.
    expect(calibrated.test_gate_split.impact?.estimate).toBe(-206);
  });

  it("applies the seeded factors as BU.3 recorded them", () => {
    expect(SEEDED_FACTORS.get(calibrationKey("workflow_outcome", "duration_delta"))).toBe(1.0682);
  });
});

describe("a formula whose inputs are missing is a spike, not a number", () => {
  /** The seeded findings with one data key removed from one finding. */
  function without(n: number, key: string): ComposerFinding[] {
    return SEEDED_FINDINGS.map((finding) => {
      if (finding.id !== seededId(n)) return finding;
      const data = { ...finding.data };
      delete data[key];
      return { ...finding, data };
    });
  }

  it.each([
    ["test_gate_split", 171, "pr_seconds_per_commit"],
    ["ccache_rewarm", 141, "slowdown_seconds"],
    ["runner_move", 151, "wait_reduction_seconds"],
    ["review_first", 173, "attempt_seconds"],
    ["flake_retry_stage", 174, "baseline"],
  ])("%s without %s", (template, n, key) => {
    const card = composed(without(n, key))[template];

    expect(card.needsSpike).toBe(true);
    expect(card.impact).toMatchObject({
      estimate: null,
      basis: { method: "unquantified", raw: null },
    });
    expect(card.impact?.basis.description).toContain(key);
    expect(card.actionBinding).toEqual({ plane: "planning", change: { spike: card.title } });
  });

  it("does not spike over a zero or negative measured slowdown — it is not a slowdown", () => {
    const findings = SEEDED_FINDINGS.map((finding) =>
      finding.id === seededId(141)
        ? { ...finding, data: { ...finding.data, slowdown_seconds: -4 } }
        : finding,
    );

    expect(composed(findings).ccache_rewarm.impact?.basis.method).toBe("unquantified");
  });

  it("composes nothing from a finding missing what its title needs", () => {
    const findings = SEEDED_FINDINGS.map((finding) =>
      finding.id === seededId(151) ? { ...finding, data: { ...finding.data, pool: 7 } } : finding,
    );

    expect(composed(findings).runner_move).toBeUndefined();
  });
});

describe("confidence is reproducible from confidence_basis by hand", () => {
  it.each(TEMPLATES.map((template) => template.id))("%s", (template) => {
    const { confidence, confidenceBasis } = composed()[template];
    const {
      n,
      scale,
      stability,
      effect_size: effectSize,
      effect_target: target,
    } = confidenceBasis.inputs;

    const support = 1 - Math.exp(-n / scale);
    const effect = target === null ? 1 : Math.min(1, (effectSize ?? 0) / target);

    expect(confidenceBasis.formula).toBe(CONFIDENCE_FORMULA);
    expect(confidenceBasis.inputs.template).toBe(template);
    expect(Math.round(100 * support * stability * effect)).toBe(confidence);
    expect(confidenceBasis.value).toBe(confidence);
  });

  it("draws n and stability from the weakest cited finding", () => {
    const { inputs } = composed().test_gate_split.confidenceBasis;

    expect({ n: inputs.n, stability: inputs.stability }).toEqual({ n: 62, stability: 0.95 });
  });
});

describe("the composer's isolation", () => {
  it("keeps the other templates' suggestions when one template throws", () => {
    const broken: SuggestionTemplate = {
      id: "broken",
      kind: "build_process",
      confidence: { scale: 1, effectTarget: null },
      compose: () => {
        throw new Error("boom");
      },
    };
    const { suggestions, failures } = compose(SEEDED_FINDINGS, SEEDED_CONTEXT, [
      broken,
      ...TEMPLATES,
    ]);

    expect(failures.map((failure) => failure.template)).toEqual(["broken"]);
    expect(suggestions).toHaveLength(TEMPLATES.length);
  });

  it("is deterministic: the same findings compose the same suggestions", () => {
    expect(compose(SEEDED_FINDINGS, SEEDED_CONTEXT)).toEqual(
      compose(SEEDED_FINDINGS, SEEDED_CONTEXT),
    );
  });

  it("composes nothing from no findings", () => {
    expect(compose([], SEEDED_CONTEXT)).toEqual({ suggestions: [], failures: [] });
  });
});
