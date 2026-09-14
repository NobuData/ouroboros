import type { ResolutionSnapshotHopDocument } from "../db/schema";
import { toSnapshotResource } from "./resolutions.resources";
import type { ResolutionSnapshotRow } from "./resolutions.rows";

/**
 * The stored snapshot, as the API speaks it
 * ([#589](https://github.com/NobuData/ouroboros/issues/589)).
 *
 * The row below is run #482's as `R__dev_seed_routing.sql` writes it — three hops of
 * `implement-primary`, Copilot dropped — so the assertions are about the fixture the chain card
 * and the run console will actually render, not about a row invented to be convenient.
 */

/** When run #482's resolution was made. */
const RESOLVED_AT = new Date("2026-09-13T10:08:00.000Z");

/** Run #482's three hops, in V024's spelling. */
const CHAIN: ResolutionSnapshotHopDocument[] = [
  {
    index: 1,
    position: 1,
    alias: "coder-max",
    model_id: "claude-fable-5",
    params: { thinking: "max", token_budget: 400000 },
    provider: {
      kind: "anthropic",
      display_name: "Anthropic Claude",
      key_suffix: "Xq4A",
      status: "active",
      latency_ms: 42,
      detail: null,
    },
    note: null,
    decision: "kept",
    code: "provider_healthy",
    explanation: "Primary · healthy · 42ms",
    duration_ms: 42,
  },
  {
    index: 2,
    position: 2,
    alias: "coder-fallback",
    model_id: "gpt-5-codex",
    params: {},
    provider: {
      kind: "copilot",
      display_name: "GitHub Copilot",
      key_suffix: null,
      status: "error",
      latency_ms: null,
      detail: "elevated latency",
    },
    note: "Fallback on 5xx / timeouts",
    decision: "dropped",
    code: "provider_error",
    explanation: "Fallback 1 dropped — GitHub Copilot is unreachable (elevated latency).",
    duration_ms: null,
  },
  {
    index: 3,
    alias: "local-docs",
    model_id: "qwen3-coder:32b",
    provider: { kind: "ollama", display_name: "Ollama · workstation", status: "active" },
    decision: "kept",
    code: "provider_healthy",
    explanation: "Fallback 2 · healthy",
  },
];

/** Run #482's snapshot row. */
const ROW: ResolutionSnapshotRow = {
  id: "5eed0017-0000-4000-8000-000000000001",
  run_id: "5eed0005-0000-4000-8000-000000000482",
  issue_number: 482,
  shape_version: 1,
  task_kind: "implement",
  route_tag: "implement-primary",
  outcome: "resolved",
  duration_ms: 42,
  chain: CHAIN,
  rules: [],
  resolved_at: RESOLVED_AT,
};

describe("a stored resolution snapshot", () => {
  it("carries the run, the kind, the route, the outcome and the timing", () => {
    expect(toSnapshotResource(ROW)).toMatchObject({
      shapeVersion: 1,
      id: ROW.id,
      run: { id: ROW.run_id, issueNumber: 482 },
      taskKind: "implement",
      routeTag: "implement-primary",
      outcome: "resolved",
      durationMs: 42,
      rules: [],
      resolvedAt: "2026-09-13T10:08:00.000Z",
    });
  });

  it("names the hop that resolved, which is the card's line", () => {
    const snapshot = toSnapshotResource(ROW);
    const hop = snapshot.chain.find((candidate) => candidate.index === snapshot.resolvedHopIndex);

    expect(snapshot.resolvedHopIndex).toBe(1);
    expect(hop).toEqual({
      index: 1,
      position: 1,
      alias: "coder-max",
      modelId: "claude-fable-5",
      params: { thinking: "max", token_budget: 400000 },
      provider: {
        kind: "anthropic",
        displayName: "Anthropic Claude",
        keySuffix: "Xq4A",
        status: "active",
        latencyMs: 42,
        detail: null,
      },
      note: null,
      decision: "kept",
      code: "provider_healthy",
      explanation: "Primary · healthy · 42ms",
      durationMs: 42,
    });
  });

  it("keeps the dropped hop the run console draws, with its sentence", () => {
    const [, fallback] = toSnapshotResource(ROW).chain;

    expect(fallback).toMatchObject({
      alias: "coder-fallback",
      decision: "dropped",
      explanation: "Fallback 1 dropped — GitHub Copilot is unreachable (elevated latency).",
      durationMs: null,
    });
  });

  it("presents every optional member the stored grammar omitted as null", () => {
    // One test for *not known* — `=== null` — rather than two, `undefined` and `null`.
    const [, , local] = toSnapshotResource(ROW).chain;

    expect(local).toEqual({
      index: 3,
      position: null,
      alias: "local-docs",
      modelId: "qwen3-coder:32b",
      params: {},
      provider: {
        kind: "ollama",
        displayName: "Ollama · workstation",
        keySuffix: null,
        status: "active",
        latencyMs: null,
        detail: null,
      },
      note: null,
      decision: "kept",
      code: "provider_healthy",
      explanation: "Fallback 2 · healthy",
      durationMs: null,
    });
  });

  it("names no resolved hop for a run the resolution refused", () => {
    const failed = toSnapshotResource({
      ...ROW,
      outcome: "fail_run",
      chain: CHAIN.map((hop) => ({ ...hop, decision: "dropped", duration_ms: null })),
    });

    expect(failed.resolvedHopIndex).toBeNull();
    expect(failed.chain).toHaveLength(3);
  });

  it("keeps an unbound hop's provider null", () => {
    const unbound = toSnapshotResource({
      ...ROW,
      chain: [{ ...CHAIN[1], provider: null, code: "alias_unbound" }, CHAIN[0]],
    });

    expect(unbound.chain[0].provider).toBeNull();
  });

  it("carries a rule with its optional members null when not stored", () => {
    const withRule = toSnapshotResource({
      ...ROW,
      rules: [
        {
          id: "5eed0013-0000-4000-8000-000000000001",
          display: "effort ≥ L → implement uses coder-max (max thinking)",
          applied: false,
          code: "not_this_task_kind",
        },
      ],
    });

    expect(withRule.rules).toEqual([
      {
        id: "5eed0013-0000-4000-8000-000000000001",
        sortOrder: null,
        display: "effort ≥ L → implement uses coder-max (max thinking)",
        applied: false,
        code: "not_this_task_kind",
        explanation: null,
      },
    ]);
  });
});
