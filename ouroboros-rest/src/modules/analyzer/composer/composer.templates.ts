/**
 * The composer registry — one typed template per kind of suggestion (BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513); mockup 18's suggestion rows).
 *
 * A template **selects** the findings it can speak about, then fills every part of the suggestion
 * from their typed data — there is no free text anywhere in the path:
 *
 *   * **title and evidence line** — fixed sentences with slots, each slot a value read from the
 *     finding (`composer.slots.ts`);
 *   * **impact** — a named formula over the finding's *measured* fields, scaled by BU.3's
 *     calibration factor for that analyzer and impact class; its basis stores the formula id, every
 *     input, the window and the calibration, so the number reconstructs;
 *   * **spike rule** — when a formula's inputs are missing the impact is `unquantified` and the
 *     suggestion `needs_spike`, bound to a spike-ticket draft. A smaller number would be a bluff;
 *   * **action binding** — the plane and change payload BV.5 executes;
 *   * **confidence** — `composer.math.ts`'s formula with the template's `scale` and `target`.
 *
 * A finding no template selects produces no suggestion — not every true thing is a thing to do.
 *
 * | Template | Cites | Mockup 18 |
 * |---|---|---|
 * | `test_gate_split` | every `unique_failures` stage whose unique catches are all at the merge gate | *Split the test gate* |
 * | `ccache_rewarm` | a `cache_window` | *Re-warm ccache right after deps-refresh merges* |
 * | `runner_move` | a `queue_correlation` | *Move forge-02 to pool-a during 14:00–16:00 UTC* |
 * | `link_cache` | a `link_share` outcome | *Link zephyr.elf incrementally* (needs a spike) |
 * | `review_first` | a `failed_builds_flagged_by_review` outcome | *standard-fix: run self-review BEFORE the build stage* |
 * | `flake_retry_stage` | a `flake_ratio_<N>d` outcome | *Loops touching drivers/can/: add a … test stage* |
 * | `fixture_timeout_ticket` | a fixture-timeout `log_signature` | BA-1 |
 * | `upstream_fix_ticket` | a `log_signature` naming a catalogued upstream issue | BA-2 |
 * | `rig_capability_ticket` | a `waiver_cite` naming a rig and the capability it lacks | BA-3 |
 * | `dead_options_ticket` | every `config_usage` option no build set | BA-4 |
 */

import { calibrated, confidenceOf, percent, type ConfidenceShape } from "./composer.math";
import { num, scoped, text, texts } from "./composer.slots";
import type {
  ActionBinding,
  ComposeContext,
  ComposedSuggestion,
  ComposerFinding,
  Impact,
  SuggestionKind,
} from "./composer.types";

/** One template. */
export interface SuggestionTemplate {
  /** The template's id — stored in the confidence basis and the impact formula id. */
  id: string;
  kind: SuggestionKind;
  confidence: ConfidenceShape;
  /**
   * Compose every suggestion this template makes from a run's findings.
   *
   * @param findings - All of the run's findings.
   * @param context - The window, calibration and name lookups.
   * @returns Zero or more suggestions.
   */
  compose: (findings: readonly ComposerFinding[], context: ComposeContext) => ComposedSuggestion[];
}

/** What an impact formula produced, before calibration. */
interface ImpactSpec {
  /** The formula id. */
  formula: string;
  /** The analyzer whose calibration applies, and its impact class. */
  analyzer: string;
  impactClass: string;
  unit: Impact["unit"];
  appliesTo: string;
  method: "measured" | "extrapolated";
  description: string;
  /** For a measured basis, the sample it was measured over. */
  sampleSize?: number;
  share?: number;
  /** The inputs, by name — `undefined` values are the missing ones. */
  inputs: Record<string, number | undefined>;
  /** The raw estimate from the inputs; only called when every input is present. */
  raw: (inputs: Record<string, number>) => number;
}

/**
 * Compute an impact — calibrated, or unquantified when an input is missing.
 *
 * @param spec - The formula and its inputs.
 * @param context - The window and the calibration lookup.
 * @returns The impact, and whether its inputs were all present.
 */
export function impactOf(spec: ImpactSpec, context: ComposeContext): Impact {
  const factor = context.factor(spec.analyzer, spec.impactClass);
  const calibration = { analyzer: spec.analyzer, impact_class: spec.impactClass, factor };
  const missing = Object.entries(spec.inputs)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  const share =
    spec.share !== undefined && spec.share > 0 && spec.share <= 1 ? spec.share : undefined;

  if (missing.length > 0) {
    return {
      estimate: null,
      unit: spec.unit,
      applies_to: spec.appliesTo,
      basis: {
        method: "unquantified",
        description: `not computable — the finding does not carry ${missing.join(", ")}`,
        formula: spec.formula,
        inputs: spec.inputs,
        window: context.window,
        calibration,
        raw: null,
      },
    };
  }

  const inputs = spec.inputs as Record<string, number>;
  const raw = spec.raw(inputs);
  return {
    estimate: calibrated(raw, factor),
    unit: spec.unit,
    applies_to: spec.appliesTo,
    ...(share === undefined ? {} : { share }),
    basis: {
      method: spec.method,
      description: spec.description,
      ...(spec.method === "measured" && spec.sampleSize !== undefined
        ? { sample_size: spec.sampleSize }
        : {}),
      formula: spec.formula,
      inputs,
      window: context.window,
      calibration,
      raw,
    },
  };
}

/**
 * Assemble a suggestion; an unquantified impact turns it into a spike bound to planning.
 *
 * @param template - The template.
 * @param findings - The findings it cites.
 * @param parts - The composed content.
 * @returns The suggestion.
 */
function suggestion(
  template: SuggestionTemplate,
  findings: readonly ComposerFinding[],
  parts: {
    title: string;
    evidenceLine: string;
    impact: Impact | null;
    binding: ActionBinding;
    /** A spike even when the impact is quantified — the remedy itself is unproven. */
    alwaysSpike?: boolean;
  },
): ComposedSuggestion {
  const confidenceBasis = confidenceOf(template.id, template.confidence, findings);
  const unquantified = parts.impact?.basis.method === "unquantified";
  const needsSpike =
    template.kind !== "ticket_draft" && (unquantified || parts.alwaysSpike === true);

  return {
    template: template.id,
    kind: template.kind,
    findingIds: findings.map((finding) => finding.id),
    title: parts.title,
    evidenceLine: parts.evidenceLine,
    confidence: confidenceBasis.value,
    confidenceBasis,
    impact: parts.impact,
    needsSpike,
    actionBinding: needsSpike
      ? { plane: "planning", change: { spike: parts.title } }
      : parts.binding,
  };
}

/**
 * The findings of one type, optionally one metric.
 *
 * @param findings - The run's findings.
 * @param type - The finding type.
 * @param metric - A test on `data.metric`, if any.
 * @returns The matching findings, in subject order.
 */
function ofType(
  findings: readonly ComposerFinding[],
  type: string,
  metric?: (metric: string) => boolean,
): ComposerFinding[] {
  return findings
    .filter(
      (finding) =>
        finding.findingType === type &&
        (metric === undefined || metric(text(finding, "metric") ?? "")),
    )
    .sort((a, b) => a.subjectKey.localeCompare(b.subjectKey));
}

/** How a stage's label is said in a title — the rest are said as they are. */
const STAGE_NAMES: Readonly<Record<string, string>> = { qemu_cortex_m3: "QEMU" };

/** Known upstream fixes a log signature can cite (`upstream_fix_ticket`). */
export const UPSTREAM_FIXES: Readonly<
  Record<string, Readonly<Record<string, { fixedIn: string; symptom: string; signature: string }>>>
> = {
  ccache: { "1412": { fixedIn: "4.11", symptom: "hash misses", signature: "cache-miss" } },
};

/** The spike a link-cache suggestion would draft, and the share it assumes it wins back. */
const LINK_CACHE_RECOVERY = 0.5;

/** The stage a path-flake suggestion adds. */
const FLAKE_RETRY_STAGE = "flake-retry under load profile";

/** The job a cache re-warm hook runs. */
const CCACHE_WARM_COMMAND = "west build -t ccache-warm";

// ---------------------------------------------------------------------------
// Build-process cards.
// ---------------------------------------------------------------------------

/** Split the test gate: the stages that catch nothing a PR needs move to the merge gate. */
export const TEST_GATE_SPLIT: SuggestionTemplate = {
  id: "test_gate_split",
  kind: "build_process",
  confidence: { scale: 20, effectTarget: null },
  compose(findings, context) {
    const gated = ofType(findings, "workflow_outcome", (m) => m === "unique_failures")
      .filter((finding) => {
        const unique = num(finding, "value");
        return (
          unique !== undefined &&
          num(finding, "at_merge_gate") === unique &&
          (texts(finding, "co_stages")?.length ?? 0) > 0 &&
          scoped(finding, "stage ") !== undefined
        );
      })
      .sort(
        (a, b) =>
          (num(b, "sample") ?? 0) - (num(a, "sample") ?? 0) ||
          a.subjectKey.localeCompare(b.subjectKey),
      );
    if (gated.length === 0) {
      return [];
    }
    const labels = gated.map((finding) => scoped(finding, "stage ") ?? "");
    const kept = [...new Set(gated.flatMap((finding) => texts(finding, "co_stages") ?? []))]
      .filter((label) => !labels.includes(label))
      .sort();
    if (kept.length === 0) {
      return [];
    }

    const [first, ...rest] = gated;
    const clauses = [
      `${labels[0]} caught ${String(num(first, "value"))} unique failures in ` +
        `${String(num(first, "sample"))} builds`,
      ...rest.map((finding, index) => {
        const unique = num(finding, "value") ?? 0;
        return `${labels[index + 1]} caught ${String(unique)}${unique > 0 ? " — all at merge gates" : ""}`;
      }),
    ];
    const seconds = Object.fromEntries(
      gated.map((finding, index) => [
        `${labels[index]}.pr_seconds_per_commit`,
        num(finding, "pr_seconds_per_commit"),
      ]),
    );

    return [
      suggestion(this, gated, {
        title:
          `Split the test gate: ${kept.join(" + ")} every build, ` +
          `${labels.map((label) => STAGE_NAMES[label] ?? label).join(" + ")} only before merge`,
        evidenceLine: clauses.join("; "),
        impact: impactOf(
          {
            formula: "test_gate_split v1: -sum(pr_seconds_per_commit of the gated stages)",
            analyzer: "workflow_outcome",
            impactClass: "duration_delta",
            unit: "seconds",
            appliesTo: "per loop",
            method: "extrapolated",
            description:
              "the gated stages' measured pre-merge seconds per commit, which a PR stops paying, " +
              "scaled by the workflow model's calibration",
            inputs: seconds,
            raw: (inputs) => -Object.values(inputs).reduce((sum, value) => sum + value, 0),
          },
          context,
        ),
        binding: {
          plane: "test_gate",
          change: { pr_builds: kept, merge_gate: [...kept, ...labels] },
        },
      }),
    ];
  },
};

/** Re-warm the cache right after the merges that empty it. */
export const CCACHE_REWARM: SuggestionTemplate = {
  id: "ccache_rewarm",
  kind: "build_process",
  confidence: { scale: 50, effectTarget: 0.5 },
  compose(findings, context) {
    return ofType(findings, "cache_window").flatMap((finding) => {
      const trigger = text(finding, "trigger");
      const before = num(finding, "hit_rate_before");
      const after = num(finding, "hit_rate_after");
      const hours = num(finding, "window_hours");
      const occurrences = num(finding, "occurrences");
      if (
        trigger === undefined ||
        before === undefined ||
        after === undefined ||
        hours === undefined ||
        occurrences === undefined
      ) {
        return [];
      }
      const slowdown = num(finding, "slowdown_seconds");
      const poolId = text(finding, "pool_id");
      const triggerTitle = text(finding, "trigger_title");
      const change: Record<string, unknown> = { on: "merge", run: CCACHE_WARM_COMMAND };
      if (triggerTitle !== undefined) {
        change.title = triggerTitle;
      }
      if (poolId !== undefined) {
        change.pool = context.poolName(poolId) ?? poolId;
      }
      return [
        suggestion(this, [finding], {
          title: `Re-warm ccache right after ${trigger.replace(/ merge$/, "")} merges`,
          evidenceLine:
            `cache hit rate drops ${String(percent(before))}%→${String(percent(after))}% for ` +
            `~${String(hours)}h after every ${trigger} (${String(occurrences)} occurrences)`,
          impact: impactOf(
            {
              formula: "ccache_rewarm v1: -slowdown_seconds",
              analyzer: "cache_window",
              impactClass: "duration_delta",
              unit: "seconds",
              appliesTo: `builds after a ${trigger}`,
              method: "measured",
              sampleSize: occurrences,
              share: num(finding, "share"),
              description:
                "the slowdown measured inside each window, scaled by the cache model's calibration",
              inputs: {
                slowdown_seconds: slowdown !== undefined && slowdown > 0 ? slowdown : undefined,
              },
              raw: (inputs) => -inputs.slowdown_seconds,
            },
            context,
          ),
          binding: { plane: "job_hook", change },
        }),
      ];
    });
  },
};

/** Move an idle runner into the starved pool for the window it starves in. */
export const RUNNER_MOVE: SuggestionTemplate = {
  id: "runner_move",
  kind: "build_process",
  confidence: { scale: 5, effectTarget: 0.75 },
  compose(findings, context) {
    return ofType(findings, "queue_correlation").flatMap((finding) => {
      const window = finding.data.window as { from?: unknown; to?: unknown } | undefined;
      const from = typeof window?.from === "string" ? window.from : undefined;
      const to = typeof window?.to === "string" ? window.to : undefined;
      const pool = text(finding, "pool");
      const idlePool = text(finding, "idle_pool");
      const runnerId = text(finding, "move_runner_id");
      const threshold = num(finding, "threshold_seconds");
      const exceeded = num(finding, "days_exceeded");
      const observed = num(finding, "days_observed");
      const idle = num(finding, "idle_share");
      if (
        from === undefined ||
        to === undefined ||
        pool === undefined ||
        idlePool === undefined ||
        runnerId === undefined ||
        threshold === undefined ||
        exceeded === undefined ||
        observed === undefined ||
        idle === undefined
      ) {
        return [];
      }
      const runner = context.runnerName(runnerId) ?? runnerId;
      return [
        suggestion(this, [finding], {
          title: `Move ${runner} to ${pool} during ${from}–${to} UTC`,
          evidenceLine:
            `${pool} queue exceeds ${String(roundMinutes(threshold))} min in that window on ` +
            `${String(exceeded)} of last ${String(observed)} weekdays; ${idlePool} sits idle ` +
            `${String(percent(idle))}% of it`,
          impact: impactOf(
            {
              formula: "runner_move v1: -wait_reduction_seconds",
              analyzer: "queue_correlation",
              impactClass: "queue_wait",
              unit: "seconds",
              appliesTo: "queue p95",
              method: "extrapolated",
              description: `${pool}'s window waits with ${runner} taking the backlog`,
              inputs: { wait_reduction_seconds: num(finding, "wait_reduction_seconds") },
              raw: (inputs) => -inputs.wait_reduction_seconds,
            },
            context,
          ),
          binding: {
            plane: "farm_config",
            change: {
              runner,
              pool,
              days_of_week: [1, 2, 3, 4, 5],
              starts_at: from,
              ends_at: to,
            },
          },
        }),
      ];
    });
  },
};

/** A build step that grew: a partial cache for it — a spike, since the remedy is unproven. */
export const LINK_CACHE: SuggestionTemplate = {
  id: "link_cache",
  kind: "build_process",
  confidence: { scale: 50, effectTarget: 0.25 },
  compose(findings, context) {
    return ofType(findings, "workflow_outcome", (m) => m === "link_share").flatMap((finding) => {
      const artifact = text(finding, "artifact");
      const step = scoped(finding, "step ");
      const before = num(finding, "before");
      const after = num(finding, "value");
      const since = text(finding, "since");
      if (
        artifact === undefined ||
        step === undefined ||
        before === undefined ||
        after === undefined ||
        since === undefined
      ) {
        return [];
      }
      return [
        suggestion(this, [finding], {
          title: `Link ${artifact} incrementally (partial link cache)`,
          evidenceLine:
            `${step} step grew from ${String(percent(before))}% to ${String(percent(after))}% ` +
            `of build time since ${since}`,
          impact: impactOf(
            {
              formula: `link_cache v1: -step_seconds_delta * ${String(LINK_CACHE_RECOVERY)}`,
              analyzer: "workflow_outcome",
              impactClass: "build_duration",
              unit: "seconds",
              appliesTo: "per build",
              method: "extrapolated",
              description: `the ${step} step's growth, if a partial link cache won half of it back`,
              inputs: { step_seconds_delta: num(finding, "step_seconds_delta") },
              raw: (inputs) => -inputs.step_seconds_delta * LINK_CACHE_RECOVERY,
            },
            context,
          ),
          binding: { plane: "planning", change: { spike: `partial link cache for ${artifact}` } },
          alwaysSpike: true,
        }),
      ];
    });
  },
};

// ---------------------------------------------------------------------------
// Workflow cards.
// ---------------------------------------------------------------------------

/** Run the review stage before the build stage that keeps failing on what review catches. */
export const REVIEW_FIRST: SuggestionTemplate = {
  id: "review_first",
  kind: "workflow",
  confidence: { scale: 10, effectTarget: 0.3 },
  compose(findings, context) {
    return ofType(
      findings,
      "workflow_outcome",
      (m) => m === "failed_builds_flagged_by_review",
    ).flatMap((finding) => {
      const workflow = text(finding, "workflow");
      const share = num(finding, "value");
      const [scopeBuild, scopeReview] = (scoped(finding, "stage ") ?? "").split(/\s*→\s*/);
      const build = text(finding, "build_stage") ?? (scopeBuild === "" ? undefined : scopeBuild);
      const review = text(finding, "review_stage") ?? scopeReview;
      if (
        workflow === undefined ||
        share === undefined ||
        build === undefined ||
        review === undefined
      ) {
        return [];
      }
      const attempt = num(finding, "attempt_seconds");
      return [
        suggestion(this, [finding], {
          title: `${workflow}: run ${review} BEFORE the ${build} stage`,
          evidenceLine:
            `${String(percent(share))}% of failed builds in ${workflow} loops contained ` +
            `defects the later ${review} flagged anyway — reordering catches them pre-${build}`,
          impact: impactOf(
            {
              formula: "review_first v1: -attempt_seconds * share",
              analyzer: "workflow_outcome",
              impactClass: "attempt_duration",
              unit: "seconds",
              appliesTo: "per failed attempt",
              method: "extrapolated",
              description:
                "a failed build attempt's wall-clock, for the share review would have caught first",
              inputs: { attempt_seconds: attempt, share },
              raw: (inputs) => -inputs.attempt_seconds * inputs.share,
            },
            context,
          ),
          binding: { plane: "workflow", change: { workflow, move: review, before: build } },
        }),
      ];
    });
  },
};

/** Changes under a path flake more: add a retry-under-load stage for loops touching it. */
export const FLAKE_RETRY_STAGE_TEMPLATE: SuggestionTemplate = {
  id: "flake_retry_stage",
  kind: "workflow",
  confidence: { scale: 10, effectTarget: 2 },
  compose(findings, context) {
    return ofType(findings, "workflow_outcome", (m) => /(?:^|_)flake_ratio_\d+d$/.test(m)).flatMap(
      (finding) => {
        const workflow = text(finding, "workflow");
        const path = scoped(finding, "merges touching ")?.replace(/\/+$/, "");
        const ratio = num(finding, "value");
        const cases = num(finding, "sample");
        const suite = text(finding, "suite");
        const days = Number(/flake_ratio_(\d+)d$/.exec(text(finding, "metric") ?? "")?.[1]);
        if (
          workflow === undefined ||
          path === undefined ||
          path === "" ||
          ratio === undefined ||
          cases === undefined ||
          suite === undefined
        ) {
          return [];
        }
        return [
          suggestion(this, [finding], {
            title: `Loops touching ${path}/: add a '${FLAKE_RETRY_STAGE}' test stage`,
            evidenceLine:
              `merges touching ${path} are ${String(ratio)}× more likely to flake the ${suite} ` +
              `suite within ${String(days)} days (${String(cases)} cases)`,
            impact: impactOf(
              {
                formula: "flake_retry_stage v1: -(rate - baseline) * cases * 7 / window days",
                analyzer: "workflow_outcome",
                impactClass: "interventions",
                unit: "interventions",
                appliesTo: "per week",
                method: "extrapolated",
                description:
                  "the excess flakes over the baseline that reach a person each week, retried under load first",
                inputs: {
                  rate: num(finding, "rate"),
                  baseline: num(finding, "baseline"),
                  cases,
                  window_days: context.window.days,
                },
                raw: (inputs) =>
                  (-(inputs.rate - inputs.baseline) * inputs.cases * 7) / inputs.window_days,
              },
              context,
            ),
            binding: {
              plane: "workflow",
              change: { workflow, when_paths: [`${path}/**`], add_stage: FLAKE_RETRY_STAGE },
            },
          }),
        ];
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Ticket drafts.
// ---------------------------------------------------------------------------

/** A shared fixture timing out: refactor the suite's fixtures. */
export const FIXTURE_TIMEOUT_TICKET: SuggestionTemplate = {
  id: "fixture_timeout_ticket",
  kind: "ticket_draft",
  confidence: { scale: 50, effectTarget: 0.05 },
  compose(findings) {
    return ofType(findings, "log_signature").flatMap((finding) => {
      const match = /^FAIL - (\w+)\.fixture\.(\w+): fixture '[^']+' setup timed out/.exec(
        text(finding, "template") ?? "",
      );
      const share = num(finding, "share");
      const count = num(finding, "count");
      if (match === null || share === undefined || count === undefined) {
        return [];
      }
      const [, suite, fixture] = match;
      return [
        suggestion(this, [finding], {
          title: `Refactor tests/${suite} fixtures — ${fixture.replace(/_/g, " ")} times out under load`,
          evidenceLine:
            `${String(percent(share, 1))}% of ${suite.toUpperCase()} suite failures share one ` +
            `fixture timeout signature (${String(count)} builds)`,
          impact: null,
          binding: { plane: "planning", change: { ticket: "fixture_timeout_ticket" } },
        }),
      ];
    });
  },
};

/** A signature matching a known upstream issue: bump to the release that fixes it. */
export const UPSTREAM_FIX_TICKET: SuggestionTemplate = {
  id: "upstream_fix_ticket",
  kind: "ticket_draft",
  confidence: { scale: 50, effectTarget: 0.2 },
  compose(findings) {
    return ofType(findings, "log_signature").flatMap((finding) => {
      const match = /^(\w+): .*\((\w+)#(\d+)\)$/.exec(text(finding, "template") ?? "");
      const version = text(finding, "tool_version");
      const count = num(finding, "count");
      if (match === null || version === undefined || count === undefined || match[1] !== match[2]) {
        return [];
      }
      const [, tool, , issue] = match;
      const fix = UPSTREAM_FIXES[tool]?.[issue];
      if (fix === undefined) {
        return [];
      }
      return [
        suggestion(this, [finding], {
          title: `Bump ${tool} ${version} → ${fix.fixedIn} — upstream fixes the ${fix.symptom} in our logs`,
          evidenceLine: `${fix.signature} signature matches ${tool} issue #${issue} in ${String(count)} builds`,
          impact: null,
          binding: { plane: "planning", change: { ticket: "upstream_fix_ticket" } },
        }),
      ];
    });
  },
};

/** Waivers that keep citing a rig's missing capability: add it to the rig. */
export const RIG_CAPABILITY_TICKET: SuggestionTemplate = {
  id: "rig_capability_ticket",
  kind: "ticket_draft",
  confidence: { scale: 1, effectTarget: 0.5 },
  compose(findings) {
    return ofType(findings, "waiver_cite").flatMap((finding) => {
      const rig = text(finding, "rig");
      const capability = text(finding, "capability");
      const topic = text(finding, "topic");
      const count = num(finding, "waiver_count");
      const days = num(finding, "window_days");
      if (
        rig === undefined ||
        capability === undefined ||
        topic === undefined ||
        count === undefined ||
        days === undefined
      ) {
        return [];
      }
      return [
        suggestion(this, [finding], {
          title: `Add ${capability} to rig ${rig}`,
          evidenceLine: `${String(count)} verification waivers in ${String(days)} days cite ${topic}`,
          impact: null,
          binding: { plane: "planning", change: { ticket: "rig_capability_ticket" } },
        }),
      ];
    });
  },
};

/** Options no build sets: delete them — one draft for all of them. */
export const DEAD_OPTIONS_TICKET: SuggestionTemplate = {
  id: "dead_options_ticket",
  kind: "ticket_draft",
  confidence: { scale: 480, effectTarget: null },
  compose(findings, context) {
    const dead = ofType(findings, "config_usage").filter(
      (finding) =>
        num(finding, "occurrences") === 0 &&
        text(finding, "option") !== undefined &&
        num(finding, "builds_considered") !== undefined,
    );
    if (dead.length === 0) {
      return [];
    }
    const options = dead.map((finding) => text(finding, "option") ?? "");
    const label = options.every((option) => option.startsWith("CONFIG_"))
      ? "Kconfig"
      : "configuration";
    const considered = Math.max(...dead.map((finding) => num(finding, "builds_considered") ?? 0));
    const drifting = dead.filter((finding) => (num(finding, "drift_warnings") ?? 0) > 0).length;
    const qualified = dead.some((finding) => finding.data.qualified === true);
    const since = new Date(`${context.window.from}T00:00:00Z`).toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    return [
      suggestion(this, dead, {
        title: `Delete ${String(dead.length)} dead ${label} options — never set in any build since ${since}`,
        evidenceLine:
          `0 of ${considered.toLocaleString("en-US")} builds toggled them; ` +
          `${String(drifting)} caused config-drift warnings` +
          (qualified ? " (sampled corpus — verify before deleting)" : ""),
        impact: null,
        binding: { plane: "planning", change: { ticket: "dead_options_ticket", options } },
      }),
    ];
  },
};

/** Every template, in the order suggestions are composed. */
export const TEMPLATES: readonly SuggestionTemplate[] = [
  TEST_GATE_SPLIT,
  CCACHE_REWARM,
  RUNNER_MOVE,
  LINK_CACHE,
  REVIEW_FIRST,
  FLAKE_RETRY_STAGE_TEMPLATE,
  FIXTURE_TIMEOUT_TICKET,
  UPSTREAM_FIX_TICKET,
  RIG_CAPABILITY_TICKET,
  DEAD_OPTIONS_TICKET,
];

/**
 * A threshold in seconds as whole minutes.
 *
 * @param seconds - The threshold.
 * @returns Minutes, rounded down as the seed's integer division does.
 */
function roundMinutes(seconds: number): number {
  return Math.floor(seconds / 60);
}
