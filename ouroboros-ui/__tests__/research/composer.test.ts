import { describe, expect, it } from "vitest";

import {
  ADMIN_ONLY_START_REASON,
  DEFAULT_DEPTH,
  DEPTHS,
  ESTIMATE_FAILED_REASON,
  ESTIMATE_NEEDS_TOOLS,
  ESTIMATE_PENDING_REASON,
  ESTIMATE_UNAVAILABLE,
  ESTIMATING,
  NO_QUESTION_REASON,
  NO_RESEARCHER_REASON,
  NO_TOOLS_REASON,
  VIEWER_START_REASON,
  chipState,
  defaultSelection,
  deliverableSteps,
  depthBudget,
  depthButtonLabel,
  estimateStateOf,
  estimateWords,
  formatSpend,
  hasBrief,
  idleChipTip,
  inFlight,
  initialKind,
  progressWords,
  researcherWords,
  roundWords,
  runFromDetail,
  runOf,
  startGate,
  startReason,
  statusWords,
  toggleTool,
} from "@/app/research/composer";

import {
  FIVE_TOOLS,
  PRICED_RESEARCHER,
  SEEDED_LABEL,
  UNPRICED_RESEARCHER,
  depthEstimates,
  investigationDetail,
  kind,
  progress,
  seededKinds,
  seededTools,
  startedInvestigation,
} from "../helpers/research";

/**
 * The composer's rules (#628), each without rendering: which kind and chips it opens on, how the
 * deliverable line is composed, what the estimate line and the pill say in every state — never
 * a `$` the service did not send — why **Start** is inert, and what a run's line reads.
 */

const KINDS = seededKinds();
const TOOLS = seededTools();
const GAP = KINDS[3]!;
const BUG = KINDS[0]!;

describe("the kind the composer opens on", () => {
  it("is gap analysis — the mockup's selection — when the workspace has it", () => {
    expect(initialKind(KINDS)?.slug).toBe("gap_analysis");
  });

  it("is the first kind when gap analysis is absent, and nothing when there are none", () => {
    expect(initialKind([BUG])?.slug).toBe("bug_root_cause");
    expect(initialKind([])).toBeNull();
  });
});

describe("the chips a kind turns on", () => {
  it("are the playbook's defaults, in the catalog's order", () => {
    expect(defaultSelection(GAP, TOOLS)).toEqual(FIVE_TOOLS);
    expect(defaultSelection(BUG, TOOLS)).toEqual(["code", "tickets", "telemetry"]);
  });

  it("never include a tool this build cannot call", () => {
    const papers = kind("papers_review", "Papers review", "gap", ["docs", "web"], ["brief"]);

    expect(defaultSelection(papers, TOOLS)).toEqual(["web"]);
  });

  it("toggle one at a time and keep the catalog's order", () => {
    expect(toggleTool(new Set(FIVE_TOOLS), "web", TOOLS)).toEqual(["competitor", "code", "tickets", "telemetry"]);
    expect(toggleTool(new Set(["telemetry"]), "web", TOOLS)).toEqual(["web", "telemetry"]);
  });

  it("read as on, off or idle — idle whatever the selection says", () => {
    const on = new Set(["web", "docs"]);

    expect(chipState(TOOLS[0]!, on)).toBe("on");
    expect(chipState(TOOLS[1]!, on)).toBe("off");
    expect(chipState(TOOLS[5]!, on)).toBe("idle");
  });

  it("explain an idle chip by naming the tool and where to connect it", () => {
    expect(idleChipTip(TOOLS[5]!)).toBe(
      "Docs, standards & papers is not connected yet — enable it in Research tools.",
    );
  });
});

describe("the deliverable line", () => {
  it("is the mockup's for a gap analysis", () => {
    expect(deliverableSteps(["brief", "matrix"]).join(" → ")).toBe(
      "cited research brief → capability matrix → drafted epics & tickets",
    );
  });

  it("ends on the roadmap's drafted work, and on a fix draft's own ticket", () => {
    expect(deliverableSteps(["roadmap_doc", "brief"])).toEqual([
      "cited research brief",
      "roadmap document",
      "drafted epics & tickets",
    ]);
    expect(deliverableSteps(["brief", "fix_draft"])).toEqual(["cited research brief", "drafted fix ticket"]);
  });
});

describe("the Depth menu", () => {
  it("opens on the mockup's deep dive and names it on the button", () => {
    expect(DEFAULT_DEPTH).toBe("deep_dive");
    expect(DEPTHS).toEqual(["quick", "standard", "deep_dive"]);
    expect(depthButtonLabel("deep_dive")).toBe("Depth: Deep dive");
    expect(depthButtonLabel("quick")).toBe("Depth: Quick");
  });

  it("prints each option's budget as the service's own line for that depth", () => {
    const estimates = depthEstimates();

    expect(depthBudget("deep_dive", estimates)).toBe(SEEDED_LABEL);
    expect(depthBudget("quick", estimates)).toBe("est. 10–15 sources · ~$2");
    expect(depthBudget("quick", null)).toBe(ESTIMATING);
  });

  it("prints no dollars for an unpriced researcher, at any depth", () => {
    const estimates = depthEstimates(false);

    for (const depth of DEPTHS) expect(depthBudget(depth, estimates)).not.toMatch(/\$/);
  });
});

describe("the researcher pill", () => {
  it("names the alias routing resolved, and says so honestly when it has not or cannot", () => {
    expect(researcherWords(PRICED_RESEARCHER)).toBe("researcher: researcher-long-ctx");
    expect(researcherWords(UNPRICED_RESEARCHER)).toBe("researcher: researcher-experimental");
    expect(researcherWords(undefined)).toBe("researcher: resolving…");
    expect(researcherWords(null)).toBe("researcher: none routed");
  });
});

describe("the estimate line", () => {
  it("is the service's label for the chosen depth", () => {
    const ready = { kind: "ready" as const, estimates: depthEstimates(), stale: false };

    expect(estimateWords(ready, "deep_dive")).toBe(SEEDED_LABEL);
    expect(estimateWords(ready, "standard")).toBe("est. 20–30 sources · ~$3");
  });

  it("carries no dollar sign in any state the service did not price", () => {
    const unpriced = { kind: "ready" as const, estimates: depthEstimates(false), stale: false };

    expect(estimateWords(unpriced, "deep_dive")).toBe("est. 40–60 sources");
    expect(estimateWords({ kind: "no-tools" }, "deep_dive")).toBe(ESTIMATE_NEEDS_TOOLS);
    expect(estimateWords({ kind: "pending" }, "deep_dive")).toBe(ESTIMATING);
    expect(estimateWords({ kind: "failed", reason: "down" }, "deep_dive")).toBe(ESTIMATE_UNAVAILABLE);
    for (const words of [ESTIMATE_NEEDS_TOOLS, ESTIMATING, ESTIMATE_UNAVAILABLE]) expect(words).not.toMatch(/\$/);
  });

  it("is derived from the ask and the last answer, never set by hand", () => {
    const ok = { ok: true as const, estimates: depthEstimates() };
    const refused = { ok: false as const, refusal: { code: "down", message: "The service is away." } };

    expect(estimateStateOf(null, null)).toEqual({ kind: "no-tools" });
    expect(estimateStateOf("gap_analysis|web", null)).toEqual({ kind: "pending" });
    expect(estimateStateOf("gap_analysis|web", { key: "gap_analysis|web", outcome: ok })).toEqual({
      kind: "ready",
      estimates: ok.estimates,
      stale: false,
    });
    // An earlier estimate stays on the line, marked stale, while the newer ask is in flight…
    expect(estimateStateOf("gap_analysis|web,code", { key: "gap_analysis|web", outcome: ok })).toEqual({
      kind: "ready",
      estimates: ok.estimates,
      stale: true,
    });
    // …but an earlier refusal said nothing about these choices.
    expect(estimateStateOf("gap_analysis|web", { key: "gap_analysis|web", outcome: refused })).toEqual({
      kind: "failed",
      reason: "The service is away.",
    });
    expect(estimateStateOf("gap_analysis|web,code", { key: "gap_analysis|web", outcome: refused })).toEqual({
      kind: "pending",
    });
  });
});

describe("why Start is inert", () => {
  const ready = { kind: "ready" as const, estimates: depthEstimates(), stale: false };
  const able = { gate: null, question: "Why?", toolsOn: 5, estimate: ready, depth: "deep_dive" as const };

  it("is nothing when everything is in place", () => {
    expect(startReason(able)).toBeNull();
  });

  it("is the gate first, then the question, then the tools, then the estimate", () => {
    expect(startReason({ ...able, gate: VIEWER_START_REASON, question: "" })).toBe(VIEWER_START_REASON);
    expect(startReason({ ...able, question: "   " })).toBe(NO_QUESTION_REASON);
    expect(startReason({ ...able, toolsOn: 0 })).toBe(NO_TOOLS_REASON);
    expect(startReason({ ...able, estimate: { kind: "no-tools" } })).toBe(NO_TOOLS_REASON);
    expect(startReason({ ...able, estimate: { kind: "pending" } })).toBe(ESTIMATE_PENDING_REASON);
    expect(startReason({ ...able, estimate: { kind: "failed", reason: "x" } })).toBe(ESTIMATE_FAILED_REASON);
  });

  it("is the routing answer when no researcher is routed", () => {
    const unrouted = { kind: "ready" as const, estimates: depthEstimates(true, { researcher: null }), stale: false };

    expect(startReason({ ...able, estimate: unrouted })).toBe(NO_RESEARCHER_REASON);
  });
});

describe("the gate", () => {
  const member = { ok: true as const, value: { startRole: "member" as const } };
  const admin = { ok: true as const, value: { startRole: "admin" as const } };
  const unread = { ok: false as const, reason: "The setting could not be read." };

  it("stops a viewer whatever the workspace says", () => {
    expect(startGate(false, false, member)).toBe(VIEWER_START_REASON);
    expect(startGate(false, false, admin)).toBe(VIEWER_START_REASON);
  });

  it("stops a member only where the workspace lets admins alone start", () => {
    expect(startGate(true, false, member)).toBeNull();
    expect(startGate(true, false, admin)).toBe(ADMIN_ONLY_START_REASON);
    expect(startGate(true, true, admin)).toBeNull();
  });

  it("leaves the decision to the service when the setting could not be read", () => {
    expect(startGate(true, false, unread)).toBeNull();
  });
});

describe("a run's line", () => {
  it("reads the status, the sources and the spend so far", () => {
    expect(progressWords(progress({ sources: 12, spendCents: 140 }))).toBe("running · 12 sources · $1.40");
    expect(progressWords(progress({ sources: 1, spendCents: 5 }))).toBe("running · 1 source · $0.05");
  });

  it("omits the spend entirely when the service has none to report — never $0.00", () => {
    expect(progressWords(progress({ sources: 12, spendCents: null }))).toBe("running · 12 sources");
    expect(progressWords(progress({ sources: 12, spendCents: null }))).not.toMatch(/\$/);
  });

  it("formats a measured spend to the cent", () => {
    expect(formatSpend(140)).toBe("$1.40");
    expect(formatSpend(0)).toBe("$0.00");
    expect(formatSpend(590)).toBe("$5.90");
  });

  it("says each status in the investigations card's words", () => {
    expect(statusWords(progress({ status: "queued" }))).toBe("queued");
    expect(statusWords(progress({ status: "running" }))).toBe("running");
    expect(statusWords(progress({ status: "running", cancelRequested: true }))).toBe("cancelling");
    expect(statusWords(progress({ status: "brief_ready" }))).toBe("✓ brief ready");
    expect(statusWords(progress({ status: "issues_filed" }))).toBe("✓ issues filed");
    expect(statusWords(progress({ status: "failed" }))).toBe("failed");
    expect(statusWords(progress({ status: "cancelled" }))).toBe("cancelled");
  });

  it("names the round while the run is in flight and knows one", () => {
    expect(roundWords(progress({ iteration: 2, iterations: 4 }))).toBe("round 2 of 4");
    expect(roundWords(progress({ iteration: null }))).toBeNull();
    expect(roundWords(progress({ status: "brief_ready", iteration: 4 }))).toBeNull();
  });

  it("knows which statuses can still change, and which left a brief", () => {
    expect(inFlight("queued")).toBe(true);
    expect(inFlight("running")).toBe(true);
    expect(inFlight("cancelled")).toBe(false);
    expect(hasBrief("brief_ready")).toBe(true);
    expect(hasBrief("issues_filed")).toBe(true);
    expect(hasBrief("failed")).toBe(false);
  });
});

describe("the run the card follows", () => {
  it("is built from the start's answer, estimate line included", () => {
    const run = runOf(startedInvestigation());

    expect(run).toEqual({
      id: "5eed0084-0000-4000-8000-000000000128",
      displayId: "RS-128",
      progress: progress({ status: "queued", iteration: null }),
      estimateLabel: SEEDED_LABEL,
      mayCancel: true,
      failure: null,
    });
  });

  it("takes a detail's progress, permission and failure, and keeps its estimate line", () => {
    const run = runOf(startedInvestigation());
    const failed = investigationDetail({
      status: "failed",
      progress: progress({ status: "failed", sources: 3 }),
      mayCancel: false,
      failure: { reason: "synthesis_failure", detail: "The gateway is not available." },
    });

    expect(runFromDetail(run, failed)).toEqual({
      ...run,
      progress: failed.progress,
      mayCancel: false,
      failure: failed.failure,
    });
  });
});
