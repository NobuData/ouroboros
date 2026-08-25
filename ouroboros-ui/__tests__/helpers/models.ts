import type {
  EscalationRule,
  ProviderHealth,
  ProviderHealthStrip,
  RouteHop,
  RoutingMatrix,
  RoutingTaskKind,
} from "@/app/api/routing";
import type { ModelsReadings } from "@/app/models/view";

/**
 * The routing page's fixtures — the seeded workspace's health strip, as
 * `GET /api/v1/routing/providers` actually serves it.
 *
 * **These are the dev seed's five connections read through the service's own composition
 * rules**, not five plausible-looking objects: `R__dev_seed_providers.sql` writes the rows,
 * `provider-health/resources.ts` composes `meta` from them, and mockup 06's strip is what
 * comes out. That is what makes "the seeded strip matches the mockup" a claim a test in this
 * module can make at all — a fixture invented here would prove that the page renders
 * *something*, which is not the acceptance criterion.
 *
 * The four facts each row carries and where they come from:
 *
 * | Chip | Seeded row | `meta` the service composes |
 * |---|---|---|
 * | Anthropic Claude | `active`, `{"latency_ms": 42}` | `42ms` |
 * | Cursor | `active`, `{}` — nothing was measured | `null` |
 * | GitHub Copilot | `error`, `{"detail": "elevated latency"}` | `elevated latency` |
 * | OpenAI-compatible · local vLLM | `active`, `{"detail": "vLLM local"}`, a host | `10.0.4.20 · vLLM local` |
 * | Ollama · workstation | `active`, `{"models": 3, "detail": "workstation"}`, a host | `ken-station.local · 3 models · workstation` |
 *
 * The two local rows carry **no latency**, deliberately and not by omission: Z.3's
 * `ProviderCheck.reportsLatency` discards a loopback measurement, because an unvarying `0ms`
 * printed beside Anthropic's real `42ms` teaches a reader to ignore both.
 *
 * **Two of these lines are not the mockup's, and the difference is upstream of this module.**
 * Mockup 06 draws `Ollama ● workstation · 3 models` and `OpenAI-compatible ● vLLM local`;
 * `chipMeta` (`provider-health/resources.ts`) prepends the connection's *host* — which the
 * seed sets to `ken-station.local` and `10.0.4.20` — so the served lines carry it. Z.3's own
 * unit specs use a row whose host happens to be `workstation` and therefore come out matching
 * the mockup; the dev seed's rows do not. The strip renders `meta` as served rather than
 * recomposing it, because the whole point of the contract serving a composed line is that the
 * strip and the route inspector cannot draw two different sentences from one row — so these
 * fixtures record what the product actually shows, and the divergence is written up in
 * `docs/ROADMAP_MOCKUP_06_MODEL_ROUTING.md` for Y.4 to settle.
 *
 * `checkedAt` is a fixed instant rather than a window off the clock: these fixtures back
 * assertions about a rendered timestamp, and a stamp that moved with the test run would make
 * those assertions unwritable.
 */

/** When every seeded check in these fixtures finished. Fixed, so a rendered stamp is too. */
export const CHECKED_AT = "2026-08-24T09:58:12.004Z";

/** {@link CHECKED_AT} as the strip's hover prints it. */
export const CHECKED_STAMP = "2026-08-24 09:58 UTC";

/**
 * One chip, defaulting to a healthy provider that nothing measured anything about.
 *
 * @param overrides What this case is about.
 * @returns The chip as the contract serves it.
 */
export function provider(overrides: Partial<ProviderHealth> = {}): ProviderHealth {
  return {
    id: "5eed000c-0000-4000-8000-000000000001",
    kind: "anthropic",
    displayName: "Anthropic Claude",
    status: "active",
    check: null,
    checkedAt: CHECKED_AT,
    host: null,
    latencyMs: null,
    models: null,
    detail: null,
    meta: null,
    ...overrides,
  };
}

/**
 * The seeded workspace's five chips, in the order the service sends them (by display name).
 *
 * @returns The strip mockup 06 draws.
 */
export function seededProviders(): ProviderHealth[] {
  return [
    provider({
      check: "key_validation",
      latencyMs: 42,
      meta: "42ms",
    }),
    provider({
      id: "5eed000c-0000-4000-8000-000000000002",
      kind: "cursor",
      displayName: "Cursor",
    }),
    provider({
      id: "5eed000c-0000-4000-8000-000000000003",
      kind: "copilot",
      displayName: "GitHub Copilot",
      status: "error",
      detail: "elevated latency",
      meta: "elevated latency",
    }),
    provider({
      id: "5eed000c-0000-4000-8000-000000000004",
      kind: "openai_compatible",
      displayName: "OpenAI-compatible · local vLLM",
      check: "reachability",
      host: "10.0.4.20",
      detail: "vLLM local",
      meta: "10.0.4.20 · vLLM local",
    }),
    provider({
      id: "5eed000c-0000-4000-8000-000000000005",
      kind: "ollama",
      displayName: "Ollama · workstation",
      check: "reachability",
      host: "ken-station.local",
      models: 3,
      detail: "workstation",
      meta: "ken-station.local · 3 models · workstation",
    }),
  ];
}

/**
 * A connection nothing has ever looked at — the state every row starts in (decision M8).
 *
 * @param overrides What this case is about.
 * @returns The chip, with no check, no timestamp and nothing measured.
 */
export function unknownProvider(overrides: Partial<ProviderHealth> = {}): ProviderHealth {
  return provider({
    id: "5eed000c-0000-4000-8000-0000000000ff",
    kind: "custom",
    displayName: "Fresh connection",
    status: "unknown",
    checkedAt: null,
    ...overrides,
  });
}

/** The strip payload, as the endpoint wraps it. */
export function stripPayload(
  providers: readonly ProviderHealth[] = seededProviders(),
): ProviderHealthStrip {
  return { providers: [...providers] };
}

/**
 * What the reader hands the screen, for a workspace whose strip read cleanly.
 *
 * @param overrides What this case is about.
 * @returns The readings.
 */
export function readings(overrides: Partial<ModelsReadings> = {}): ModelsReadings {
  return {
    providers: { ok: true, value: seededProviders() },
    matrix: { ok: true, value: seededMatrix() },
    pending: 0,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ the routing matrix */

/**
 * The routing matrix's fixtures — the seeded workspace's eight rows and three rules, as
 * `GET /api/v1/routing` serves them (#195, #198, drawn by #201).
 *
 * **These are `R__dev_seed_routing.sql`'s rows, not eight plausible-looking objects.** The
 * eight kinds and their descriptions, the eight routes and their tags, the seventeen hops and
 * the aliases they name, the three rules' `when`/`then` documents and the sentences V018
 * generates from them, and the two numerics the 370 seeded calls average and take the median
 * of — every one is transcribed from that file. That is what makes *the seeded matrix matches
 * the mockup row for row* a claim a test in this module can make at all.
 *
 * **Three divergences from mockup 06, every one of them upstream of this module:**
 *
 * | The mockup draws | The product shows | Why |
 * |---|---|---|
 * | `claude-fable-5 · Anthropic` | `claude-fable-5 · Anthropic Claude` | The resolution line prints the connection's `displayName`, and #221 seeds the longer names. The same divergence the health strip's `meta` lines carry, for the same reason: the service composes the fact, and a client that shortened it would be a second opinion about what a provider is called. |
 * | the `effort ≥ L` summary on `plan` | it on `implement` | The rule's `then` names `implement`. Y.3 (#191) settled the mockup's inconsistency in the schema's favour, and `R__dev_seed_routing.sql` records it. |
 * | `$0.12` · `8.4s` on `analyze` (the issue's sketch) | `$0.04` · `3.1s` | The mockup's own HTML is the source, and the seed's sequences are built to reproduce it exactly: `avg(cost_cents)` is each kind's centre, and `percentile_cont(0.5)` lands on the row at it. |
 *
 * `spend` is the **empty** shape here, deliberately. AA.2 renders none of it — the card is
 * AA.5's ([#204](https://github.com/NobuData/ouroboros/issues/204)) — and its figures are
 * aggregates over a ledger this file cannot compute, because `token_usage` is written by three
 * seeds rather than by `R__dev_seed_routing.sql` alone. A plausible total invented here would
 * be the one number in these fixtures nobody measured, on a page whose whole subject is not
 * printing those. AA.5 fills it from the ledger.
 */

/**
 * The four seeded connections the eight chains reach, as a route hop carries them (#221's
 * rows).
 *
 * Cursor is the fifth and is absent here on purpose: the only alias bound to it is
 * `second-opinion`, which no chain contains — it is the alias the *security label* rule adds a
 * vote from, and votes are the inspector's business rather than the matrix's.
 */
const CONNECTIONS = {
  anthropic: {
    id: "5eed000c-0000-4000-8000-000000000001",
    kind: "anthropic",
    displayName: "Anthropic Claude",
    baseUrl: null,
  },
  copilot: {
    id: "5eed000c-0000-4000-8000-000000000003",
    kind: "copilot",
    displayName: "GitHub Copilot",
    baseUrl: null,
  },
  vllm: {
    id: "5eed000c-0000-4000-8000-000000000004",
    kind: "openai_compatible",
    displayName: "OpenAI-compatible · local vLLM",
    baseUrl: "http://10.0.4.20:8000/v1",
  },
  ollama: {
    id: "5eed000c-0000-4000-8000-000000000005",
    kind: "ollama",
    displayName: "Ollama · workstation",
    baseUrl: "http://ken-station.local:11434",
  },
} satisfies Record<string, NonNullable<RouteHop["provider"]>>;

/**
 * The six aliases the eight chains name, and what each resolves to.
 *
 * Two of the workspace's eight are absent: `second-opinion`, which no chain contains, and
 * `gpt5-experiments`, which is bound to no provider and which nothing routes through.
 */
const ALIASES = {
  "coder-max": { modelId: "claude-fable-5", provider: CONNECTIONS.anthropic },
  "coder-std": { modelId: "claude-sonnet-5", provider: CONNECTIONS.anthropic },
  sizer: { modelId: "claude-haiku-4-5", provider: CONNECTIONS.anthropic },
  "coder-fallback": { modelId: "gpt-5-codex", provider: CONNECTIONS.copilot },
  "local-docs": { modelId: "qwen3-coder:32b", provider: CONNECTIONS.ollama },
  "local-free": { modelId: "llama-4-maverick", provider: CONNECTIONS.vllm },
} satisfies Record<string, { modelId: string; provider: NonNullable<RouteHop["provider"]> }>;

/** Which alias a chain names at each position. */
type Chain = readonly (keyof typeof ALIASES)[];

/**
 * One hop of a chain.
 *
 * @param alias Which alias it names.
 * @param position Where it sits; 1 is the primary.
 * @param note The operator's sentence for it, where the seed writes one.
 * @returns The hop, as the contract serves it.
 */
function hop(alias: keyof typeof ALIASES, position: number, note: string | null = null): RouteHop {
  return { position, alias, note, ...ALIASES[alias] };
}

/** When every seeded route in these fixtures was last saved. Fixed, so a rendered stamp is. */
export const SAVED_AT = "2026-08-20T11:04:00.000Z";

/**
 * One seeded row: the kind, its description, and the route behind it.
 *
 * @param spec Everything that differs between the eight rows — the kind's name and grey line,
 *   its route's tag and chain, its cap, and the two figures the ledger produced for it.
 * @returns The row, as `GET /api/v1/routing` serves it.
 */
function seededKind(spec: {
  sortOrder: number;
  name: string;
  description: string;
  tag: string;
  chain: Chain;
  notes?: Readonly<Record<number, string>>;
  maxCostCentsPerRun?: number;
  costCents: number;
  latencyMs: number;
  calls: number;
}): RoutingTaskKind {
  return {
    name: spec.name,
    description: spec.description,
    sortOrder: spec.sortOrder,
    route: {
      id: `5eed0011-0000-4000-8000-${String(spec.sortOrder).padStart(12, "0")}`,
      taskKind: spec.name,
      tag: spec.tag,
      // On everywhere, and no floor anywhere: the mockup's two switches as the seed sets them.
      allowLocalFallback: true,
      floorHopIndex: null,
      maxCostCentsPerRun: spec.maxCostCentsPerRun ?? null,
      hops: spec.chain.map((alias, index) =>
        hop(alias, index + 1, spec.notes?.[index + 1] ?? null),
      ),
      stats: {
        costCentsPerRunAvg: spec.costCents,
        latencyP50Ms: spec.latencyMs,
        // Every seeded call carries a price and a latency, which is what makes a `0` on the
        // two local kinds believable rather than ambiguous: priced, at nothing.
        pricedCalls: spec.calls,
        unpricedCalls: 0,
        timedCalls: spec.calls,
      },
      updatedAt: SAVED_AT,
      updatedBy: "Ken Suenobu",
    },
  };
}

/**
 * The eight rows, in the order the matrix draws them — the loop's own order of operations.
 *
 * @returns The seeded task kinds.
 */
export function seededTaskKinds(): RoutingTaskKind[] {
  return [
    seededKind({
      sortOrder: 1,
      name: "analyze",
      description: "Read the issue, map the affected code paths",
      tag: "analyze-primary",
      chain: ["coder-std", "local-docs"],
      costCents: 4,
      latencyMs: 3100,
      calls: 25,
    }),
    seededKind({
      sortOrder: 2,
      name: "estimate",
      description: "Size effort XS–XL before queueing",
      tag: "estimate-primary",
      chain: ["sizer", "local-free"],
      costCents: 1,
      latencyMs: 1200,
      calls: 25,
    }),
    seededKind({
      sortOrder: 3,
      name: "plan",
      description: "Decompose into steps, pick a workflow",
      tag: "plan-primary",
      chain: ["coder-max", "coder-std"],
      costCents: 31,
      latencyMs: 9800,
      calls: 15,
    }),
    seededKind({
      sortOrder: 4,
      name: "implement",
      description: "Write the change, run tests, iterate to green",
      tag: "implement-primary",
      // The one three-hop chain, and the one route with a cost cap — the route the mockup
      // opens in its inspector.
      chain: ["coder-max", "coder-fallback", "local-docs"],
      notes: {
        2: "Fallback on 5xx / timeouts",
        3: "Offline mode — keeps the loop turning without a network",
      },
      maxCostCentsPerRun: 250,
      costCents: 87,
      latencyMs: 41000,
      calls: 15,
    }),
    seededKind({
      sortOrder: 5,
      name: "test-gen",
      description: "Generate unit and regression tests for the diff",
      // Not `test-gen-primary`: the tag is the route's own value, which is why nothing
      // composes one from the kind.
      tag: "testgen-primary",
      chain: ["coder-fallback", "coder-std"],
      costCents: 12,
      latencyMs: 17400,
      calls: 15,
    }),
    seededKind({
      sortOrder: 6,
      name: "review",
      description: "Self-review the PR against the acceptance criteria",
      tag: "review-primary",
      chain: ["coder-max", "coder-std"],
      costCents: 22,
      latencyMs: 12600,
      calls: 15,
    }),
    seededKind({
      sortOrder: 7,
      name: "docs",
      description: "Update READMEs, changelogs, operator manual",
      tag: "docs-primary",
      chain: ["local-docs", "sizer"],
      // Zero, and not a null: fifteen calls that were priced, at nothing.
      costCents: 0,
      latencyMs: 6300,
      calls: 15,
    }),
    seededKind({
      sortOrder: 8,
      name: "commit-msg",
      description: "Conventional-commit message from the staged diff",
      tag: "commitmsg-primary",
      chain: ["local-free", "sizer"],
      costCents: 0,
      latencyMs: 800,
      calls: 245,
    }),
  ];
}

/**
 * The three escalation rules — the card's `3 active`.
 *
 * `display` is transcribed from V018's generated column rather than composed here, because
 * that is the whole point of the field: the card, the matrix's escalation column and a
 * resolution explanation print one string because there is one.
 *
 * @returns The rules, in evaluation order.
 */
export function seededRules(): EscalationRule[] {
  return [
    {
      id: "5eed0013-0000-4000-8000-000000000001",
      enabled: true,
      sortOrder: 1,
      when: { effort_gte: "l" },
      then: {
        use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } },
      },
      display: "effort ≥ L → implement uses coder-max (max thinking)",
    },
    {
      id: "5eed0013-0000-4000-8000-000000000002",
      enabled: true,
      sortOrder: 2,
      when: { label: "security" },
      then: { add_vote: { task_kind: "review", alias: "second-opinion" } },
      display: "security label → review adds second-opinion vote",
    },
    {
      // The one rule that names no task kind. It modifies every one of them, which is why it
      // belongs to the rules card rather than to eight copies of one matrix cell.
      id: "5eed0013-0000-4000-8000-000000000003",
      enabled: true,
      sortOrder: 3,
      when: { diff_kind: "docs_only" },
      then: { route_local: {} },
      display: "docs-only diff → everything routes local",
    },
  ];
}

/**
 * The spend card's shape, empty — see this section's note on why it is not the seed's.
 *
 * @returns A structurally complete `RoutingSpend` carrying no figure anybody measured.
 */
export function emptySpend(): RoutingMatrix["spend"] {
  return {
    window: { days: 30, since: "2026-07-25T09:58:12.004Z", until: CHECKED_AT },
    providers: [],
    totalSpendCents: null,
    tokens: 0,
    localTokens: 0,
    localTokenShare: null,
    unpricedCalls: 0,
  };
}

/**
 * The seeded workspace's matrix, as the endpoint answers it.
 *
 * @param overrides What this case is about.
 * @returns The payload.
 */
export function seededMatrix(overrides: Partial<RoutingMatrix> = {}): RoutingMatrix {
  return {
    taskKinds: seededTaskKinds(),
    rules: seededRules(),
    spend: emptySpend(),
    ...overrides,
  };
}

/**
 * The same eight rows for a workspace that has **run nothing** — decision M7's fixture.
 *
 * Every route survives; only the ledger is empty, which is exactly the state a workspace is in
 * between configuring its routes and running its first loop. Both numerics are `null` and all
 * three counts are zero, because *no call was priced* and *no call was timed* are the facts
 * behind the two em-dashes.
 *
 * @returns The payload, with nothing measured.
 */
export function unmeasuredMatrix(): RoutingMatrix {
  return seededMatrix({
    taskKinds: seededTaskKinds().map((kind) => ({
      ...kind,
      route:
        kind.route === null
          ? null
          : {
              ...kind.route,
              stats: {
                costCentsPerRunAvg: null,
                latencyP50Ms: null,
                pricedCalls: 0,
                unpricedCalls: 0,
                timedCalls: 0,
              },
            },
    })),
  });
}

/**
 * A workspace whose routing foundations have not been seeded at all.
 *
 * Empty arrays rather than a failure: *nobody has configured this* and *nobody could read
 * this* are different facts, and the page says something different for each.
 *
 * @returns The payload, with nothing in it.
 */
export function emptyMatrix(): RoutingMatrix {
  return { taskKinds: [], rules: [], spend: emptySpend() };
}
