import { describe, expect, it } from "vitest";

import type { AnalysisSuggestion, AnalysisSuggestionImpact, SuggestionPreview } from "@/app/api/analyzer";
import {
  CARD_TITLES,
  DISMISSED_NOTE,
  DRAFT_HUMAN_NOTE,
  FINDINGS_GONE,
  MAX_REASON_LENGTH,
  MEASUREMENTS_ANCHOR,
  NO_CALIBRATION,
  NO_CONFIDENCE_BASIS,
  NO_IMPACT,
  NO_SUGGESTIONS_YET,
  NO_UNCERTAINTY,
  NOTHING_OF_KIND,
  SPIKE_IMPACT_NOTE,
  WORKFLOW_GONE_REASON,
  calibrationCell,
  calibrationHistory,
  calibrationLines,
  cardEmpty,
  cardRows,
  confidenceLines,
  confidenceText,
  confirmLabels,
  daysText,
  deltaGroups,
  evidenceNote,
  figure,
  findingConfidence,
  findingFacts,
  findingHeading,
  impactAmount,
  impactLines,
  impactText,
  impactTone,
  measurementNote,
  openTag,
  previewFacts,
  primaryAction,
  reasonOf,
  reasonProblem,
  resolved,
  sheetEyebrow,
  spikeTitle,
  spikeUncertainty,
  withLocal,
} from "@/app/analyzer/suggestions-view";

import {
  SUGGESTION,
  emptySuggestions,
  resolvedSuggestions,
  seededSuggestion,
  seededSuggestions,
} from "../helpers/analyzer-suggestions";

/**
 * Every decision the suggestion cards make (#518), as values: a figure is drawn as the composer
 * stored it and never without the route to what produced it; a spike is a different action and
 * never an invented estimate; the preview's facts are the payload's; and a resolved row says what
 * follows from its resolution.
 */

const SEEDED = seededSuggestions();

/** A seeded suggestion, by what it is about. */
function seeded(key: keyof typeof SUGGESTION): AnalysisSuggestion {
  return seededSuggestion(SUGGESTION[key]);
}

/** An impact, from the runner move's with fields replaced. */
function impactOf(over: Partial<AnalysisSuggestionImpact>): AnalysisSuggestionImpact {
  return { ...seeded("move").impact!, ...over };
}

/** A preview of a plane, with a payload. */
function previewOf(over: Partial<SuggestionPreview>): SuggestionPreview {
  return {
    suggestionId: SUGGESTION.move,
    plane: "farm_config",
    appliable: true,
    draftable: false,
    summary: "forge-02 joins pool-a between 14:00–16:00 UTC on weekdays (Mon–Fri); outside that window it stays in its own pool.",
    lands: "Build farm · pool windows",
    reason: null,
    change: { runner: "forge-02", pool: "pool-a", daysOfWeek: [1, 2, 3, 4, 5], startsAt: "14:00", endsAt: "16:00" },
    studioPath: null,
    delta: null,
    fingerprint: `sha256:${"4f".repeat(32)}`,
    ...over,
  };
}

describe("the two cards' rows", () => {
  it("are the mockup's: four build-process rows and two workflow rows, most confident first", () => {
    expect(cardRows(SEEDED, "build_process").map((row) => row.title)).toEqual([
      "Split the test gate: native_sim every build, QEMU + HIL only before merge",
      "Re-warm ccache right after deps-refresh merges",
      "Move forge-02 to pool-a during 14:00–16:00 UTC",
      "Link zephyr.elf incrementally (partial link cache)",
    ]);
    expect(cardRows(SEEDED, "workflow").map((row) => row.title)).toEqual([
      "standard-fix: run self-review BEFORE the build stage",
      "Loops touching drivers/can/: add a 'flake-retry under load profile' test stage",
    ]);
  });

  it("count the open ones — the mockup's `4 open`", () => {
    expect(openTag(cardRows(SEEDED, "build_process"))).toBe("4 open");
    expect(openTag(cardRows(resolvedSuggestions(SUGGESTION.move, "applied"), "build_process"))).toBe("3 open");
  });

  it("put resolved rows after the open ones, whatever their confidence", () => {
    const rows = cardRows(resolvedSuggestions(SUGGESTION.gate, "dismissed"), "build_process");

    expect(rows.map((row) => row.status)).toEqual(["open", "open", "open", "dismissed"]);
    expect(rows[3]?.id).toBe(SUGGESTION.gate);
  });

  it("carry the card titles verbatim", () => {
    expect(CARD_TITLES).toEqual({
      build_process: "Suggested build-process changes",
      workflow: "Suggested workflow changes",
    });
  });

  it("say why a card is empty: no analysis yet, or nothing of its kind suggested", () => {
    expect(cardEmpty(emptySuggestions(), "build_process")).toBe(NO_SUGGESTIONS_YET);
    expect(cardEmpty(SEEDED, "workflow")).toBeNull();
    expect(
      cardEmpty({ ...SEEDED, suggestions: SEEDED.suggestions.filter((row) => row.kind !== "workflow") }, "workflow"),
    ).toBe(NOTHING_OF_KIND.workflow);
  });
});

describe("the page's own resolutions", () => {
  const local = {
    status: "applied" as const,
    at: "2026-10-02T20:00:00.000Z",
    reason: null,
    draftBatchId: null,
    windowDays: 14,
  };

  it("resolve an open row at once — an apply with the measurement it opened, on day 0", () => {
    const row = withLocal(seeded("move"), local);

    expect(row).toMatchObject({
      status: "applied",
      resolution: { at: "2026-10-02T20:00:00.000Z", by: null },
      measurement: { appliedOn: "2026-10-02", day: 0, windowDays: 14, windowEndsOn: "2026-10-16", verdict: "pending" },
    });
  });

  it("carry a dismissal's reason, and a draft's batch", () => {
    expect(
      withLocal(seeded("flake"), { ...local, status: "dismissed", reason: "Being rewritten.", windowDays: null }),
    ).toMatchObject({ status: "dismissed", resolution: { reason: "Being rewritten." }, measurement: null });
    expect(
      withLocal(seeded("link"), { ...local, status: "drafted", draftBatchId: "batch-1", windowDays: null }).resolution,
    ).toMatchObject({ draftBatchId: "batch-1" });
  });

  it("give way to the service's resolution once the poll reports one", () => {
    const served = resolvedSuggestions(SUGGESTION.move, "dismissed", { by: "Mira Okafor" }).suggestions.find(
      (row) => row.id === SUGGESTION.move,
    )!;

    expect(withLocal(served, local)).toBe(served);
  });

  it("are laid over the rows they belong to, and no other", () => {
    const rows = cardRows(SEEDED, "build_process", new Map([[SUGGESTION.ccache, local]]));

    expect(rows.map((row) => [row.id, row.status])).toEqual([
      [SUGGESTION.gate, "open"],
      [SUGGESTION.move, "open"],
      [SUGGESTION.link, "open"],
      [SUGGESTION.ccache, "applied"],
    ]);
  });
});

describe("the impact pill", () => {
  it("writes each seeded impact as the mockup does", () => {
    expect(impactText(seeded("gate").impact)).toBe("−3m 40s per loop");
    expect(impactText(seeded("ccache").impact)).toBe("−1m 50s on ~20% of builds");
    expect(impactText(seeded("move").impact)).toBe("−4m queue p95");
    expect(impactText(seeded("link").impact)).toBe("−55s per build");
    expect(impactText(seeded("review").impact)).toBe("−2m 05s per failed attempt");
    expect(impactText(seeded("flake").impact)).toBe("−1 intervention/wk projected");
  });

  it("draws no figure for an impact that was never quantified, or that is not there", () => {
    expect(impactText(impactOf({ estimate: null }))).toBeNull();
    expect(impactText(null)).toBeNull();
  });

  it("writes a cost with a plus sign, a count bare, and several interventions in the plural", () => {
    expect(impactAmount(12, "seconds")).toBe("+12s");
    expect(impactAmount(-3, "count")).toBe("−3");
    expect(impactAmount(0, "seconds")).toBe("0s");
    expect(impactText(impactOf({ estimate: -3, unit: "interventions", appliesTo: "per sprint" }))).toBe(
      "−3 interventions per sprint projected",
    );
    expect(
      impactText(
        impactOf({
          estimate: -2,
          unit: "interventions",
          appliesTo: "per week",
          basis: { ...impactOf({}).basis, method: "measured" },
        }),
      ),
    ).toBe("−2 interventions/wk");
  });

  it("is tinted by the sign of the estimate — a saving is good news, a cost a warning", () => {
    expect(impactTone({ estimate: -220 })).toBe("ok");
    expect(impactTone({ estimate: 0 })).toBe("ok");
    expect(impactTone({ estimate: 40 })).toBe("warn");
  });
});

describe("the route from an impact to its basis", () => {
  it("states the method, the formula, every input, the calibration arithmetic and the window", () => {
    expect(impactLines(seeded("gate"))).toEqual([
      "Extrapolated — the gated stages' measured pre-merge seconds per commit, which a PR stops paying, scaled by the workflow model's calibration.",
      "Formula: test_gate_split v1: -sum(pr_seconds_per_commit of the gated stages).",
      "Inputs: HIL.pr_seconds_per_commit = 48 · qemu_cortex_m3.pr_seconds_per_commit = 158.",
      "−206 s raw × 1.0682 calibration (workflow_outcome · duration_delta) = −220 s.",
      "Inputs read from Jul 4 – Oct 1 (90 days).",
    ]);
  });

  it("says what a measured basis was measured over, and the share of builds it applies to", () => {
    const lines = impactLines(seeded("ccache"));

    expect(lines[0]).toBe(
      "Measured over 14 occurrences — the slowdown measured inside each window, scaled by the cache model's calibration.",
    );
    expect(lines).toContain("−168 s raw × 0.6545 calibration (cache_window · duration_delta) = −110 s.");
    expect(lines).toContain("Applies to about 20% of builds — builds after a deps-refresh merge.");
  });

  it("says a spike's figure is extrapolated and unverified", () => {
    const lines = impactLines(seeded("link"));

    expect(lines[0]).toBe("Extrapolated — the link step's growth, if a partial link cache won half of it back.");
    expect(lines.at(-1)).toBe(SPIKE_IMPACT_NOTE);
    expect(impactLines(seeded("move"))).not.toContain(SPIKE_IMPACT_NOTE);
  });

  it("says an unquantified impact is not quantified, and why — with no arithmetic to show", () => {
    const lines = impactLines({
      needsSpike: true,
      impact: impactOf({
        estimate: null,
        basis: {
          method: "unquantified",
          description: "the finding does not carry step_seconds_delta",
          sampleSize: null,
          formula: null,
          inputs: null,
          window: null,
          calibration: null,
          raw: null,
        },
      }),
    });

    expect(lines).toEqual(["Not quantified — the finding does not carry step_seconds_delta."]);
  });

  it("shows what an older row stored, and nothing it did not", () => {
    const lines = impactLines({
      needsSpike: false,
      impact: impactOf({
        estimate: -110,
        appliesTo: "first build after a runner start",
        basis: {
          method: "measured",
          description: "9 runner starts, cold against warm",
          sampleSize: 9,
          formula: null,
          inputs: null,
          window: null,
          calibration: null,
          raw: null,
        },
      }),
    });

    expect(lines).toEqual(["Measured over 9 occurrences — 9 runner starts, cold against warm."]);
    expect(impactLines({ needsSpike: false, impact: null })).toEqual([NO_IMPACT]);
  });

  it("writes a fractional raw estimate and an interventions unit as they are", () => {
    expect(impactLines(seeded("flake"))).toContain(
      "−0.686 interventions raw × 1 calibration (workflow_outcome · interventions) = −1 interventions.",
    );
    expect(impactLines(seeded("review"))).toContain(
      "−125.12 s raw × 1 calibration (workflow_outcome · attempt_duration) = −125 s.",
    );
  });
});

describe("the confidence affix and its scoring", () => {
  it("is `conf NN%`", () => {
    expect(SEEDED.suggestions.map((row) => confidenceText(row.confidence))).toEqual([
      "conf 91%",
      "conf 89%",
      "conf 88%",
      "conf 84%",
      "conf 77%",
      "conf 72%",
    ]);
  });

  it("shows sample size, effect size, stability, the arithmetic and the formula", () => {
    expect(confidenceLines(seeded("review"))).toEqual([
      "Sample size: 50 — the smallest sample among the cited findings. Support 1 − e^(−50/10) = 0.993.",
      "Effect size: 0.34 against a decisive 0.3 → 1.00.",
      "Stability: 0.896 — the least stable cited finding.",
      "Score: round(100 × 0.993 × 0.896 × 1.00) = 89.",
      "Formula: composer v1: round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target)).",
    ]);
  });

  it("says an absence claim has no effect size to weigh, rather than showing a made-up one", () => {
    const lines = confidenceLines(seeded("gate"));

    expect(lines[1]).toBe("Effect size: none to weigh — an absence claim counts in full.");
    expect(lines[3]).toBe("Score: round(100 × 0.955 × 0.95 × 1.00) = 91.");
  });

  it("shows an effect that fell short of decisive as the fraction it counted for", () => {
    expect(confidenceLines(seeded("ccache"))[1]).toBe("Effect size: 0.47 against a decisive 0.5 → 0.94.");
  });

  it("says so when a suggestion was composed before its scoring inputs were stored", () => {
    expect(confidenceLines({ confidence: 90, confidenceBasis: null })).toEqual([NO_CONFIDENCE_BASIS]);
  });
});

describe("a row's primary control", () => {
  it("is Apply for a build-process change", () => {
    expect(primaryAction(seeded("move"))).toEqual({ kind: "apply", label: "Apply", leads: false });
    expect(primaryAction(seeded("gate")).kind).toBe("apply");
  });

  it("is Draft spike ticket for a spike — instead of Apply, whatever plane it names", () => {
    expect(primaryAction(seeded("link"))).toEqual({ kind: "draft_spike", label: "Draft spike ticket", leads: false });
    expect(primaryAction({ ...seeded("review"), needsSpike: true }).kind).toBe("draft_spike");
  });

  it("is Draft as vN for a workflow change — the version the workflow would really become", () => {
    expect(primaryAction(seeded("review"))).toEqual({ kind: "draft_workflow", label: "Draft as v15", leads: true });
    expect(
      primaryAction({ ...seeded("review"), workflow: { slug: "standard-fix", nextVersion: 16, studioPath: "/w" } })
        .label,
    ).toBe("Draft as v16");
  });

  it("is inert with the reason when the workflow it names is gone", () => {
    expect(primaryAction({ ...seeded("review"), workflow: null })).toMatchObject({
      kind: "draft_workflow",
      reason: WORKFLOW_GONE_REASON,
    });
  });
});

describe("a resolved row", () => {
  /** A seeded suggestion, resolved. */
  function row(key: keyof typeof SUGGESTION, status: "applied" | "dismissed" | "drafted", over = {}) {
    return resolvedSuggestions(SUGGESTION[key], status, over).suggestions.find((entry) => entry.id === SUGGESTION[key])!;
  }

  it("is nothing for an open one", () => {
    expect(resolved(seeded("move"))).toBeNull();
  });

  it("applied: says who and when, that measurement is pending, and links to the measurement card", () => {
    expect(resolved(row("move", "applied"))).toEqual({
      headline: "Applied Oct 2 by Ken Suenobu",
      note: "measurement pending — day 0 of 14",
      reason: null,
      links: [{ label: "Predicted vs measured", href: `#${MEASUREMENTS_ANCHOR}`, anchor: true }],
    });
  });

  it("a workflow draft: says publishing remains a person's step, and links to the studio first", () => {
    const state = resolved(row("review", "applied"))!;

    expect(state.headline).toBe("Draft created Oct 2 by Ken Suenobu");
    expect(state.note).toBe(`${DRAFT_HUMAN_NOTE} · measurement pending — day 0 of 14`);
    expect(state.links.map((link) => [link.label, link.href])).toEqual([
      ["Open in the studio", "/workflows/standard-fix"],
      ["Predicted vs measured", "#predicted-vs-measured"],
    ]);
  });

  it("dismissed: states the persistence guarantee, with the reason as written", () => {
    expect(resolved(row("flake", "dismissed", { reason: "The telemetry suite is being rewritten." }))).toEqual({
      headline: "Dismissed Oct 2 by Ken Suenobu",
      note: DISMISSED_NOTE,
      reason: "The telemetry suite is being rewritten.",
      links: [],
    });
    expect(DISMISSED_NOTE).toBe("won't be suggested again");
  });

  it("drafted: links to the planning batch the spike went into", () => {
    expect(resolved(row("link", "drafted"))).toMatchObject({
      headline: "Spike drafted Oct 2 by Ken Suenobu",
      links: [
        { label: "Open the draft in Planning", href: "/planning?batch=5eed006a-0000-4000-8000-000000000002", anchor: false },
      ],
    });
  });

  it("names nobody when the person is gone, or when the page resolved it itself", () => {
    expect(resolved(row("move", "applied", { by: null }))?.headline).toBe("Applied Oct 2");
  });

  it("reads a closed measurement as its verdict", () => {
    const measurement = row("move", "applied").measurement!;

    expect(measurementNote({ ...measurement, day: 3 })).toBe("measurement pending — day 3 of 14");
    expect(measurementNote({ ...measurement, verdict: "delivered" })).toBe("measured — delivered what was predicted");
    expect(measurementNote({ ...measurement, verdict: "under" })).toBe("measured — under-delivered");
    expect(measurementNote({ ...measurement, verdict: "confounded" })).toBe(
      "measured — confounded by another change",
    );
    expect(measurementNote(null)).toBe("measurement pending");
  });
});

describe("the consequence preview", () => {
  it("lays a pool move out as its runner, pool, UTC window and days — from the payload", () => {
    expect(previewFacts(previewOf({}))).toEqual([
      { label: "Runner", value: "forge-02", mono: true },
      { label: "Joins pool", value: "pool-a", mono: true },
      { label: "Window", value: "14:00–16:00 UTC", mono: false },
      { label: "Days", value: "weekdays (Mon–Fri)", mono: false },
    ]);
  });

  it("lays a job hook out as its repository, trigger, command and pool", () => {
    const hook = previewOf({
      plane: "job_hook",
      change: {
        repo: "acme-robotics/helios-firmware",
        pool: "pool-a",
        event: "merge",
        titleContains: "deps: refresh west manifest",
        label: "post-merge hook",
        title: "Re-warm ccache right after deps-refresh merges",
        command: ["west", "build", "-t", "ccache-warm"],
      },
    });

    expect(previewFacts(hook)).toEqual([
      { label: "Repository", value: "acme-robotics/helios-firmware", mono: true },
      { label: "Runs on", value: "every merge whose title contains “deps: refresh west manifest”", mono: false },
      { label: "Command", value: "west build -t ccache-warm", mono: true },
      { label: "In pool", value: "pool-a", mono: true },
    ]);
    expect(previewFacts({ ...hook, change: { ...hook.change, titleContains: null } })[1]?.value).toBe("every merge");
  });

  it("lays a workflow draft out as its workflow, the version it becomes and its change note", () => {
    const draft = previewOf({
      plane: "workflow",
      change: {
        workflowId: "5eed001b-0000-4000-8000-000000000001",
        slug: "standard-fix",
        ifMatch: "etag",
        nextVersion: 15,
        changeNote: "Proposed by the Build Analyzer (suggestion 5eed0067-…): standard-fix: run self-review BEFORE the build stage.",
        definition: { nodes: [], edges: [] },
      },
    });

    expect(previewFacts(draft)).toEqual([
      { label: "Workflow", value: "standard-fix", mono: true },
      { label: "Becomes", value: "v15 — only when a person publishes it", mono: false },
      {
        label: "Change note",
        value: "Proposed by the Build Analyzer (suggestion 5eed0067-…): standard-fix: run self-review BEFORE the build stage.",
        mono: false,
      },
    ]);
  });

  it("has no facts for a change no plane can take — and survives a payload it does not recognise", () => {
    expect(previewFacts(previewOf({ plane: "test_gate", change: null }))).toEqual([]);
    expect(previewFacts(previewOf({ plane: "planning", change: { spike: "x" } }))).toEqual([]);
    expect(previewFacts(previewOf({ change: { runner: 7, daysOfWeek: "weekdays" } }))).toEqual([]);
  });

  it("says days as a person does", () => {
    expect(daysText([5, 4, 3, 2, 1])).toBe("weekdays (Mon–Fri)");
    expect(daysText([6, 7])).toBe("weekends");
    expect(daysText([1, 2, 3, 4, 5, 6, 7])).toBe("every day");
    expect(daysText([3, 1, 1])).toBe("Mon, Wed");
  });

  it("lists a workflow draft's delta: the stages and connections it adds and removes", () => {
    expect(
      deltaGroups({
        nodesAdded: ["`touches-drivers-can` (Touches drivers/can/**?)"],
        nodesRemoved: [],
        edgesAdded: ["test → touches-drivers-can"],
        edgesRemoved: ["test → review"],
      }),
    ).toEqual([
      { heading: "Stages added", items: ["`touches-drivers-can` (Touches drivers/can/**?)"] },
      { heading: "Connections added", items: ["test → touches-drivers-can"] },
      { heading: "Connections removed", items: ["test → review"] },
    ]);
    expect(deltaGroups(null)).toEqual([]);
  });

  it("confirms a workflow draft as creating a draft — never as publishing", () => {
    expect(confirmLabels({ plane: "workflow" })).toEqual({
      label: "Create draft & open studio",
      busy: "Creating the draft…",
      leads: true,
    });
    expect(confirmLabels({ plane: "farm_config" })).toMatchObject({ label: "Apply", leads: false });
  });
});

describe("dismissing", () => {
  it("needs no reason, and sends one trimmed when it is given", () => {
    expect(reasonOf("   ")).toBeNull();
    expect(reasonOf("  pool-b is reserved for HIL  ")).toBe("pool-b is reserved for HIL");
  });

  it("refuses a reason longer than the service keeps", () => {
    expect(reasonProblem("x".repeat(MAX_REASON_LENGTH))).toBeUndefined();
    expect(reasonProblem("x".repeat(MAX_REASON_LENGTH + 1))).toBe("Keep the reason under 4,096 characters.");
    expect(reasonProblem("")).toBeUndefined();
  });
});

describe("drafting a spike", () => {
  it("titles the ticket as the service will, and carries the uncertainty in the basis's own words", () => {
    expect(spikeTitle(seeded("link"))).toBe("Spike: Link zephyr.elf incrementally (partial link cache)");
    expect(spikeUncertainty(seeded("link"))).toBe(
      "the link step's growth, if a partial link cache won half of it back",
    );
  });

  it("says the analyzer did not say, rather than inventing an uncertainty", () => {
    expect(spikeUncertainty({ impact: null })).toBe(NO_UNCERTAINTY);
    expect(spikeUncertainty({ impact: impactOf({ basis: { ...impactOf({}).basis, description: "" } }) })).toBe(
      NO_UNCERTAINTY,
    );
  });
});

describe("the Details sheet", () => {
  const finding = seeded("move").findings[0]!;

  it("is headed by the suggestion's kind", () => {
    expect(sheetEyebrow(seeded("move"))).toBe("Suggestion · build process");
    expect(sheetEyebrow(seeded("review"))).toBe("Suggestion · workflow");
  });

  it("heads a finding by its analyzer, version and subject", () => {
    expect(findingHeading(finding)).toBe("queue_correlation v1 · pool-a@14:00-16:00");
  });

  it("shows a finding's own confidence with what it was computed from", () => {
    expect(findingConfidence(finding)).toBe("confidence 84% — sample 14 · effect 0.786 · stability 0.895");
    expect(
      findingConfidence({
        confidence: 70,
        confidenceBasis: { method: null, sampleSize: null, effectSize: null, stability: null },
      }),
    ).toBe("confidence 70%");
  });

  it("lists a finding's data as the analyzer wrote it — keys in words, ids left to the evidence list", () => {
    const facts = new Map(findingFacts(finding));

    expect(facts.get("days exceeded")).toBe("11");
    expect(facts.get("days observed")).toBe("14");
    expect(facts.get("idle share")).toBe("0.82");
    expect(facts.get("window from")).toBe("14:00");
    expect(facts.get("window to")).toBe("16:00");
    expect(facts.get("pool")).toBe("pool-a");
    expect([...facts.keys()].some((key) => key.endsWith(" id"))).toBe(false);
  });

  it("joins a list of scalars, and leaves a list of references out", () => {
    expect(
      findingFacts({
        data: {
          co_stages: ["native_sim", "qemu"],
          sample_refs: [{ kind: "build", id: "b" }],
          candidates: [{ label: "x" }],
          flagged: true,
          empty: [],
        },
      }),
    ).toEqual([
      ["co stages", "native_sim, qemu"],
      ["flagged", "yes"],
    ]);
  });

  it("says how many references a finding cites when the page lists only the first", () => {
    expect(evidenceNote(finding)).toBe("3 of 14 references listed.");
    expect(evidenceNote({ evidence: finding.evidence, evidenceTotal: 3 })).toBeNull();
  });

  it("names the calibration in effect, whose it is, and how many measurements taught it", () => {
    const impact = seeded("ccache").impact;
    const cell = calibrationCell(SEEDED.calibration, impact);

    expect(cell).toMatchObject({ analyzer: "cache_window", impactClass: "duration_delta", factor: 0.6545 });
    expect(calibrationLines(impact, cell)).toEqual([
      "× 0.6545 — the cache_window model's factor for duration_delta when this was composed.",
      "Learned from 1 closed measurement of what this model predicted.",
    ]);
  });

  it("shows every update that moved the factor, with the measured and predicted sums", () => {
    const cell = calibrationCell(SEEDED.calibration, seeded("ccache").impact)!;

    expect(calibrationHistory(cell)).toEqual([
      "Sep 17 · × 1 → × 0.6545 · measured −72 against −110 predicted, over 1 measurement",
    ]);
  });

  it("says a model nothing has measured yet is taken as made — and that a factor has moved since", () => {
    const impact = seeded("move").impact;

    expect(calibrationCell(SEEDED.calibration, impact)).toBeNull();
    expect(calibrationLines(impact, null)).toEqual([
      "× 1 — the queue_correlation model's factor for queue_wait when this was composed.",
      "No measurement of this model has closed yet, so its estimates are taken as made.",
    ]);

    const cache = seeded("ccache").impact;
    const moved = { ...calibrationCell(SEEDED.calibration, cache)!, factor: 0.71, sampleCount: 2 };

    expect(calibrationLines(cache, moved).at(-1)).toBe(
      "The factor is now × 0.71; the next analysis composes with it.",
    );
  });

  it("says so for an impact that recorded no calibration, and for findings retention has removed", () => {
    expect(calibrationLines(null, null)).toEqual([NO_CALIBRATION]);
    expect(calibrationCell(SEEDED.calibration, null)).toBeNull();
    expect(FINDINGS_GONE).toMatch(/aged out of retention/);
  });
});

describe("figure", () => {
  it("groups, keeps a calibration factor's four decimals, and writes a true minus", () => {
    expect(figure(-206)).toBe("−206");
    expect(figure(1.0682)).toBe("1.0682");
    expect(figure(0.65449)).toBe("0.6545");
    expect(figure(1284)).toBe("1,284");
  });
});
