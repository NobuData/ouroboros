/**
 * Mockup 06 as `resolve()`'s inputs — the workspace Y.4's seed writes, as values.
 *
 * Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)). Every matrix test in
 * `resolve.spec.ts` starts from this and changes one thing, which is what makes a failure
 * readable: the diff between the case that passes and the case that does not is the variable
 * under test rather than fifty lines of hand-built rows.
 *
 * The values are the seed's, deliberately and to the letter — the same seven aliases on the
 * same five connections, `implement-primary`'s three hops with their two operator notes, the
 * `$2.50` cap as `250`, and the three escalation rules with the `"then"` documents V018's
 * generated column derives the card's sentences from. A fixture that invented its own
 * workspace would prove `resolve()` handles the workspace the fixture invented.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { ProviderConnectionKind } from "../db/schema";
import type { ProviderHealthSnapshot } from "../provider-health/snapshot";
import type { AliasSpec, ChainHopSpec, ResolutionInput, RouteSpec, RuleSpec } from "./inputs";

/** The five connections mockup 06's health strip draws, by the ids the seed gives them. */
export const CONNECTIONS = {
  anthropic: "c0000000-0000-4000-8000-000000000001",
  copilot: "c0000000-0000-4000-8000-000000000002",
  cursor: "c0000000-0000-4000-8000-000000000003",
  ollama: "c0000000-0000-4000-8000-000000000004",
  vllm: "c0000000-0000-4000-8000-000000000005",
} as const;

/**
 * One alias, bound to one connection.
 *
 * @param alias - The name routes use.
 * @param modelId - What it resolves to.
 * @param connectionId - Which connection.
 * @param kind - That connection's kind.
 * @param displayName - What the inspector prints for it.
 * @param baseUrl - Where it is, or null.
 * @returns The alias.
 */
function bound(
  alias: string,
  modelId: string,
  connectionId: string,
  kind: ProviderConnectionKind,
  displayName: string,
  baseUrl: string | null,
): AliasSpec {
  return {
    alias,
    modelId,
    params: {},
    binding: { connectionId, kind, displayName, baseUrl },
  };
}

/** The seven aliases Y.4 seeds — six the matrix uses, and the vote the security rule names. */
export const ALIASES: readonly AliasSpec[] = [
  bound("coder-fallback", "gpt-5-codex", CONNECTIONS.copilot, "copilot", "GitHub Copilot", null),
  bound(
    "coder-max",
    "claude-fable-5",
    CONNECTIONS.anthropic,
    "anthropic",
    "Anthropic Claude",
    null,
  ),
  bound(
    "coder-std",
    "claude-sonnet-5",
    CONNECTIONS.anthropic,
    "anthropic",
    "Anthropic Claude",
    null,
  ),
  bound(
    "local-docs",
    "qwen3-coder:32b",
    CONNECTIONS.ollama,
    "ollama",
    "Ollama · workstation",
    "http://workstation.local:11434",
  ),
  bound(
    "local-free",
    "llama-4-maverick",
    CONNECTIONS.vllm,
    "openai_compatible",
    "OpenAI-compatible · local vLLM",
    "http://vllm.local:8001/v1",
  ),
  bound("second-opinion", "composer-2", CONNECTIONS.cursor, "cursor", "Cursor", null),
  bound("sizer", "claude-haiku-4-5", CONNECTIONS.anthropic, "anthropic", "Anthropic Claude", null),
];

/**
 * One alias by name, from {@link ALIASES}.
 *
 * @param alias - The name.
 * @returns The alias. Throws rather than returning undefined: a fixture asking for a name it
 *   does not have is a broken test, and a silent undefined would surface three assertions
 *   later as an unrelated failure.
 */
export function aliasNamed(alias: string): AliasSpec {
  const found = ALIASES.find((candidate) => candidate.alias === alias);

  if (found === undefined) {
    throw new Error(`the routing fixture has no alias named ${alias}`);
  }

  return found;
}

/** `implement-primary`'s three hops, with the two notes the mockup's inspector prints. */
export const IMPLEMENT_HOPS: readonly ChainHopSpec[] = [
  { position: 1, note: null, target: aliasNamed("coder-max") },
  { position: 2, note: "Fallback on 5xx / timeouts", target: aliasNamed("coder-fallback") },
  {
    position: 3,
    note: "Offline mode — keeps the loop turning without a network",
    target: aliasNamed("local-docs"),
  },
];

/** `implement-primary` with the mockup's policies: local on, no floor, `$2.50`. */
export const IMPLEMENT_ROUTE: RouteSpec = {
  taskKind: "implement",
  tag: "implement-primary",
  allowLocalFallback: true,
  floorHopIndex: null,
  maxCostCents: 250,
};

/** `review-primary`'s two hops — the route the `security label` rule adds a vote to. */
export const REVIEW_HOPS: readonly ChainHopSpec[] = [
  { position: 1, note: null, target: aliasNamed("coder-max") },
  { position: 2, note: null, target: aliasNamed("coder-std") },
];

/** `review-primary`, with no cost cap — the seed caps only `implement`. */
export const REVIEW_ROUTE: RouteSpec = {
  taskKind: "review",
  tag: "review-primary",
  allowLocalFallback: true,
  floorHopIndex: null,
  maxCostCents: null,
};

/**
 * `docs-primary`'s two hops — the one seeded chain whose **primary** is a local provider.
 *
 * Which is what makes it the honest test of *Allow fallback to local models*: the switch's
 * label says *fallback*, and the ticket's step 4 says *local hops*, and the two readings only
 * differ on a chain like this one.
 */
export const DOCS_HOPS: readonly ChainHopSpec[] = [
  { position: 1, note: null, target: aliasNamed("local-docs") },
  { position: 2, note: null, target: aliasNamed("sizer") },
];

/** `docs-primary`, with no cost cap. */
export const DOCS_ROUTE: RouteSpec = {
  taskKind: "docs",
  tag: "docs-primary",
  allowLocalFallback: true,
  floorHopIndex: null,
  maxCostCents: null,
};

/** The three rules the card shows as `3 active`, with the sentences V018 generates for them. */
export const RULES: readonly RuleSpec[] = [
  {
    id: "5eed0013-0000-4000-8000-000000000001",
    sortOrder: 1,
    display: "effort ≥ L → implement uses coder-max (max thinking)",
    when: { effort_gte: "l" },
    then: {
      use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } },
    },
  },
  {
    id: "5eed0013-0000-4000-8000-000000000002",
    sortOrder: 2,
    display: "security label → review adds second-opinion vote",
    when: { label: "security" },
    then: { add_vote: { task_kind: "review", alias: "second-opinion" } },
  },
  {
    id: "5eed0013-0000-4000-8000-000000000003",
    sortOrder: 3,
    display: "docs-only diff → everything routes local",
    when: { diff_kind: "docs_only" },
    then: { route_local: {} },
  },
];

/**
 * One health snapshot.
 *
 * @param connectionId - Which connection.
 * @param status - Its state.
 * @param measured - What the last check found, if anything.
 * @returns The snapshot, in the shape Z.3 publishes.
 */
export function snapshot(
  connectionId: string,
  status: ProviderHealthSnapshot["status"],
  measured: { latencyMs?: number; detail?: string } = {},
): ProviderHealthSnapshot {
  return {
    connectionId,
    kind: "anthropic",
    displayName: "fixture",
    baseUrl: null,
    status,
    checkedAt: new Date("2026-08-23T10:00:00.000Z"),
    measured: {
      check: "reachability",
      latencyMs: measured.latencyMs ?? null,
      models: null,
      detail: measured.detail ?? null,
    },
  };
}

/**
 * The health the seed writes: Anthropic at 42ms, Copilot up with elevated latency, Cursor
 * unchecked, both local providers reachable and unmeasured.
 *
 * The `kind` and `displayName` on a snapshot are deliberately not the connection's real ones —
 * `resolve()` reads a snapshot for its **status, latency and detail** and takes every
 * identifying fact from the chain's own binding, and a fixture whose snapshots agreed with the
 * bindings could not tell a resolver that read the wrong one.
 */
export const HEALTH: readonly ProviderHealthSnapshot[] = [
  snapshot(CONNECTIONS.anthropic, "active", { latencyMs: 42 }),
  snapshot(CONNECTIONS.copilot, "active", { detail: "elevated latency" }),
  snapshot(CONNECTIONS.cursor, "unknown"),
  snapshot(CONNECTIONS.ollama, "active"),
  snapshot(CONNECTIONS.vllm, "active"),
];

/**
 * The mockup's own resolution input — `implement`, everything healthy, no context.
 *
 * @param overrides - What this case changes.
 * @returns The input.
 */
export function resolutionInput(overrides: Partial<ResolutionInput> = {}): ResolutionInput {
  return {
    route: IMPLEMENT_ROUTE,
    hops: IMPLEMENT_HOPS,
    aliases: ALIASES,
    rules: RULES,
    health: HEALTH,
    context: {},
    ...overrides,
  };
}

/**
 * The same input with one route policy changed.
 *
 * @param policy - The policies to override.
 * @param overrides - Anything else this case changes.
 * @returns The input.
 */
export function routedWith(
  policy: Partial<RouteSpec>,
  overrides: Partial<ResolutionInput> = {},
): ResolutionInput {
  // The policy is applied *after* the overrides rather than beside them, so a case that
  // combines this with a whole input — `routedWith({floorHopIndex: 2}, withHealth({…}))` — gets
  // both. Spreading them together would let the override's own `route` silently discard the
  // policy the case is about, and the test would pass for the wrong reason.
  const base = resolutionInput(overrides);

  return { ...base, route: { ...base.route, ...policy } };
}

/**
 * The same input with a different health matrix.
 *
 * @param statuses - The status to give each named connection. Anything not named keeps the
 *   seed's snapshot, so a case states only what it is about.
 * @param overrides - Anything else this case changes.
 * @returns The input.
 */
export function withHealth(
  statuses: Partial<Record<keyof typeof CONNECTIONS, ProviderHealthSnapshot["status"]>>,
  overrides: Partial<ResolutionInput> = {},
): ResolutionInput {
  const byId = new Map<string, ProviderHealthSnapshot["status"]>(
    Object.entries(statuses).map(([name, status]) => [
      CONNECTIONS[name as keyof typeof CONNECTIONS],
      status,
    ]),
  );

  return resolutionInput({
    health: HEALTH.map((existing) => {
      const status = byId.get(existing.connectionId);

      return status === undefined ? existing : { ...existing, status };
    }),
    ...overrides,
  });
}
