/**
 * A routing workspace in PostgreSQL — the bench Z.6's three suites are run on.
 *
 * Z.6 ([#199](https://github.com/NobuData/ouroboros/issues/199)). `routing.fixture.ts` is the
 * same workspace as **values**, for the pure matrix in `resolve.spec.ts`; this is the same
 * workspace as **rows**, because everything Z.6 has to answer for is a claim about what
 * PostgreSQL holds: a floor measured against a stored `position`, a chain a deferred
 * constraint accepted, a sentence a generated column derived, a filter on `organization_id`
 * that somebody could forget to write.
 *
 * ---------------------------------------------------------------------------
 * **It exists because three suites needed the same twenty statements.**
 *
 * `routing.integration-spec.ts` and `management.integration-spec.ts` each grew their own
 * private copy of *insert a connection, an alias, a kind, a route and its chain* — which was
 * right when there were two of them and each wanted a different workspace. Z.6 adds three more
 * suites that want **one** workspace, the same one, because the isolation census and the
 * resolution matrix are only comparable if they are asking about identical rows. So the
 * statements move here, and the existing two suites are left alone: rewriting a passing suite
 * to import a fixture it does not need is a change with no test behind it.
 *
 * ---------------------------------------------------------------------------
 * **Rows are written with SQL, never through the API under test.**
 *
 * `registry.integration-spec.ts`'s rule, and Z.6 needs it more than most: two of these suites
 * exist to find out whether the write surface is correct, and arranging their fixtures through
 * that surface would make the arrangement and the assertion the same code. The one exception
 * is deliberate and marked — {@link addRule} writes `escalation_rules` directly so that a rule
 * can be given a `sort_order` and a `"then"` a suite chooses, including ones the API's
 * validation would refuse to accept from a client but the database will hold.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { ApiHarness, Person, Workspace } from "../../testing/harness.fixture";
import {
  SCHEMA_NAME,
  type EscalationThen,
  type EscalationWhen,
  type ProviderConnectionKind,
  type ProviderConnectionStatus,
  type RouteRevisionDiff,
} from "../db/schema";

/**
 * The five connections the bench stands on — two cloud, two local, and one nothing binds.
 *
 * Named by their kind rather than by a vendor, because what every test below actually varies
 * is *cloud or local* and *reachable or not*: `isLocalProvider` reads the kind, and the floor,
 * the local switch and a `route_local` rule are all decided on it.
 */
export const BENCH_CONNECTIONS: readonly {
  readonly key: string;
  readonly kind: ProviderConnectionKind;
  readonly displayName: string;
  readonly baseUrl: string | null;
}[] = [
  { key: "anthropic", kind: "anthropic", displayName: "Anthropic Claude", baseUrl: null },
  { key: "copilot", kind: "copilot", displayName: "GitHub Copilot", baseUrl: null },
  { key: "ollama", kind: "ollama", displayName: "Ollama", baseUrl: "http://127.0.0.1:11434" },
  {
    key: "vllm",
    kind: "openai_compatible",
    displayName: "vLLM local",
    baseUrl: "http://127.0.0.1:8000",
  },
];

/**
 * The six aliases, and where each one runs.
 *
 * `second-opinion` is what the `add_vote` rule casts with, `local-fast` is deliberately **not
 * in any chain** so a `use_alias` rule has something to prepend, and `retired` is V019's
 * unbound state — a row a workspace keeps and no route can use.
 */
export const BENCH_ALIASES: readonly {
  readonly alias: string;
  readonly connection: string | null;
  readonly modelId: string;
}[] = [
  { alias: "coder-max", connection: "anthropic", modelId: "claude-fable-5" },
  { alias: "coder-fallback", connection: "copilot", modelId: "gpt-5-codex" },
  { alias: "local-docs", connection: "ollama", modelId: "qwen3-coder:32b" },
  { alias: "local-fast", connection: "vllm", modelId: "llama-4-maverick" },
  { alias: "second-opinion", connection: "anthropic", modelId: "claude-sonnet-5" },
  { alias: "retired", connection: null, modelId: "gpt-4o" },
];

/**
 * The kinds the matrix draws, and the chain each routed one carries.
 *
 * `implement` is the route every matrix case is resolved against, and its three hops are one
 * cloud primary, one cloud fallback and one local floor — which is the smallest chain in which
 * *drop the cloud providers*, *turn local off* and *fail below fallback 2* are three different
 * outcomes rather than the same one. `review` is routed by nothing on purpose: V016 permits a
 * kind with no route, and the matrix draws it as an empty cell.
 */
export const BENCH_KINDS: readonly {
  readonly name: string;
  readonly sortOrder: number;
  readonly tag: string | null;
  readonly hops: readonly { readonly alias: string; readonly note: string | null }[];
}[] = [
  {
    name: "implement",
    sortOrder: 1,
    tag: "implement-primary",
    hops: [
      { alias: "coder-max", note: "Primary" },
      { alias: "coder-fallback", note: "Fallback on 5xx / timeouts" },
      { alias: "local-docs", note: null },
    ],
  },
  {
    name: "docs",
    sortOrder: 2,
    tag: "docs-local",
    hops: [{ alias: "local-docs", note: null }],
  },
  { name: "review", sortOrder: 3, tag: null, hops: [] },
];

/** The `implement` route's cost cap, in cents — the inspector's `$2.50`. */
export const BENCH_MAX_COST_CENTS = 250;

/** A seeded workspace, with the ids a suite needs to address its rows by. */
export interface RoutingBench {
  /** The workspace — `organization."id"`. */
  readonly id: string;
  /** Its slug, which is what `TENANT_HEADER` carries. */
  readonly slug: string;
  /** Who owns it, already signed in. */
  readonly owner: Person;
  /** Connection ids by {@link BENCH_CONNECTIONS} key. */
  readonly connections: Readonly<Record<string, string>>;
  /** Alias ids by name. */
  readonly aliases: Readonly<Record<string, string>>;
  /** Route ids by task kind, for the kinds that have one. */
  readonly routes: Readonly<Record<string, string>>;
}

/**
 * Seed one workspace with the whole bench.
 *
 * @param api - The harness, for its pool.
 * @param owner - Who owns it. Already signed in; the caller decides whether two benches share
 *   an owner, which is what makes *the same person in two workspaces* arrangeable.
 * @param slug - The workspace's slug, when a suite wants a predictable one.
 * @returns The workspace and every id in it.
 */
export async function seedRoutingBench(
  api: ApiHarness,
  owner: Person,
  slug?: string,
): Promise<RoutingBench> {
  const workspace: Workspace = await api.workspace(owner, slug);

  const connections: Record<string, string> = {};

  for (const spec of BENCH_CONNECTIONS) {
    connections[spec.key] = await insertConnection(api, workspace.id, spec);
  }

  const aliases: Record<string, string> = {};

  for (const spec of BENCH_ALIASES) {
    aliases[spec.alias] = await insertAlias(
      api,
      workspace.id,
      spec.alias,
      spec.connection === null ? null : connections[spec.connection],
      spec.modelId,
    );
  }

  const routes: Record<string, string> = {};

  for (const kind of BENCH_KINDS) {
    const kindId = await insertKind(api, workspace.id, kind.name, kind.sortOrder);

    if (kind.tag !== null) {
      routes[kind.name] = await insertRoute(
        api,
        workspace.id,
        kindId,
        kind.tag,
        kind.hops.map((hop) => ({ aliasId: aliases[hop.alias], note: hop.note })),
      );
    }
  }

  return { id: workspace.id, slug: workspace.slug, owner, connections, aliases, routes };
}

/**
 * Insert one provider connection, unchecked.
 *
 * Its `status` is `unknown` and its `health` is empty, which is what V015 requires of a row
 * nothing has looked at — and what decision **M8** says a resolution must not read as *down*.
 * {@link setHealth} is how a suite says something has looked.
 *
 * @param api - The harness, for its pool.
 * @param organizationId - The workspace.
 * @param spec - Which connection, from {@link BENCH_CONNECTIONS}.
 * @returns The connection's id.
 */
async function insertConnection(
  api: ApiHarness,
  organizationId: string,
  spec: (typeof BENCH_CONNECTIONS)[number],
): Promise<string> {
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.provider_connections
       (organization_id, kind, display_name, base_url, status)
     values ($1, $2, $3, $4, 'unknown') returning id`,
    [organizationId, spec.kind, spec.displayName, spec.baseUrl],
  );

  return rows[0].id;
}

/**
 * Insert one alias.
 *
 * @param api - The harness, for its pool.
 * @param organizationId - The workspace.
 * @param alias - The name routes use.
 * @param connectionId - Where it runs, or null for V019's unbound state — which V015 requires
 *   to be disabled, so the two move together.
 * @param modelId - The raw provider model string, which decision **M1** keeps in this column
 *   and nowhere else.
 * @returns The alias's id.
 */
async function insertAlias(
  api: ApiHarness,
  organizationId: string,
  alias: string,
  connectionId: string | null,
  modelId: string,
): Promise<string> {
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.model_aliases
       (organization_id, alias, provider_connection_id, model_id, enabled)
     values ($1, $2, $3, $4, $5) returning id`,
    [organizationId, alias, connectionId, modelId, connectionId !== null],
  );

  return rows[0].id;
}

/**
 * Insert one task kind.
 *
 * @param api - The harness, for its pool.
 * @param organizationId - The workspace.
 * @param name - The kind's name.
 * @param sortOrder - Where the matrix draws it.
 * @returns The kind's id.
 */
async function insertKind(
  api: ApiHarness,
  organizationId: string,
  name: string,
  sortOrder: number,
): Promise<string> {
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.task_kinds (organization_id, name, description, sort_order)
     values ($1, $2, $3, $4) returning id`,
    [organizationId, name, `Everything ${name} needs`, sortOrder],
  );

  return rows[0].id;
}

/**
 * Insert a route and its chain, in one transaction.
 *
 * V016's `route_chain_intact()` is a **deferred** constraint trigger: a route committed with
 * no hops is refused at commit, and a chain is therefore written — or rewritten — as one unit
 * of work. This is what using that deferral looks like, and it is the same shape
 * `management.repository.ts` uses, which is why a fixture that got it wrong would be a
 * misleading green rather than a slow one.
 *
 * @param api - The harness, for its pool.
 * @param organizationId - The workspace.
 * @param taskKindId - The kind this route answers for.
 * @param tag - The route's tag.
 * @param hops - The chain, primary first. Positions are assigned from the array's order, so a
 *   caller cannot produce a sparse chain by hand.
 * @returns The route's id.
 */
async function insertRoute(
  api: ApiHarness,
  organizationId: string,
  taskKindId: string,
  tag: string,
  hops: readonly { aliasId: string; note: string | null }[],
): Promise<string> {
  const client = await api.sql.connect();

  try {
    await client.query("begin");

    const { rows } = await client.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.routes
         (organization_id, task_kind_id, tag, max_cost_cents_per_run)
       values ($1, $2, $3, $4) returning id`,
      [organizationId, taskKindId, tag, BENCH_MAX_COST_CENTS],
    );

    for (const [offset, hop] of hops.entries()) {
      await client.query(
        `insert into ${SCHEMA_NAME}.route_hops
           (organization_id, route_id, position, model_alias_id, note)
         values ($1, $2, $3, $4, $5)`,
        [organizationId, rows[0].id, offset + 1, hop.aliasId, hop.note],
      );
    }

    await client.query("commit");

    return rows[0].id;
  } catch (failure) {
    await client.query("rollback");
    throw failure;
  } finally {
    client.release();
  }
}

/**
 * Say what a check found on one connection — or that nothing has checked it.
 *
 * The **only** way a suite states a provider's health, because it is the only way the
 * application reads one: `routing.repository.ts` deliberately does not select
 * `provider_connections.status` alongside the chain, so a resolution's view of a provider is
 * this column and nothing else.
 *
 * V015 is enforced here rather than worked around: a status of `unknown` writes an empty
 * `health` and a null `last_checked_at`, because a measurement is a measurement *at a time*
 * and `{"latency_ms": 0}` on a provider nothing ever called renders `0ms` — an excellent
 * latency for a machine that is off.
 *
 * @param api - The harness, for its pool.
 * @param connectionId - Which connection.
 * @param status - What it is. `unknown` means nothing has looked.
 * @param measured - What the check measured, for a status that is a conclusion from one.
 * @returns When the row is written.
 */
export async function setHealth(
  api: ApiHarness,
  connectionId: string,
  status: ProviderConnectionStatus,
  measured: { latencyMs?: number; detail?: string } = {},
): Promise<void> {
  const checked = status !== "unknown";
  const health: Record<string, unknown> = checked ? { check: "reachability" } : {};

  if (checked && measured.latencyMs !== undefined) {
    health.latency_ms = measured.latencyMs;
  }

  if (checked && measured.detail !== undefined) {
    health.detail = measured.detail;
  }

  await api.sql.query(
    `update ${SCHEMA_NAME}.provider_connections
        set status = $2, last_checked_at = $3, health = $4::jsonb
      where id = $1`,
    [connectionId, status, checked ? new Date() : null, JSON.stringify(health)],
  );
}

/**
 * Set one route's three policy columns — mockup 06's three inspector controls.
 *
 * @param api - The harness, for its pool.
 * @param routeId - Which route.
 * @param policy - The floor (null for the switch being off), the local switch, and the cap in
 *   cents (null for no cap).
 * @returns When the row is written.
 */
export async function setPolicy(
  api: ApiHarness,
  routeId: string,
  policy: {
    floorHopIndex: number | null;
    allowLocalFallback: boolean;
    maxCostCentsPerRun: number | null;
  },
): Promise<void> {
  await api.sql.query(
    `update ${SCHEMA_NAME}.routes
        set floor_hop_index = $2, allow_local_fallback = $3, max_cost_cents_per_run = $4
      where id = $1`,
    [routeId, policy.floorHopIndex, policy.allowLocalFallback, policy.maxCostCentsPerRun],
  );
}

/**
 * Write one escalation rule, straight to the table.
 *
 * The fixture's one deliberate write around the API. `display` is **not** supplied and cannot
 * be: the column is `generated always … stored`, so the sentence every assertion below reads
 * is one PostgreSQL derived from the structure — which is the whole of decision **M5**, and is
 * only demonstrable if the fixture never writes one.
 *
 * @param api - The harness, for its pool.
 * @param organizationId - The workspace.
 * @param rule - The predicate, the route modification, where it evaluates, and its switch.
 * @returns The rule's id.
 */
export async function addRule(
  api: ApiHarness,
  organizationId: string,
  rule: {
    when: EscalationWhen;
    then: EscalationThen;
    sortOrder?: number;
    enabled?: boolean;
  },
): Promise<string> {
  const { rows } = await api.sql.query<{ id: string }>(
    `insert into ${SCHEMA_NAME}.escalation_rules
       (organization_id, enabled, sort_order, "when", "then")
     values ($1, $2, $3, $4::jsonb, $5::jsonb) returning id`,
    [
      organizationId,
      rule.enabled ?? true,
      rule.sortOrder ?? 1,
      JSON.stringify(rule.when),
      JSON.stringify(rule.then),
    ],
  );

  return rows[0].id;
}

/**
 * Remove every escalation rule in a workspace.
 *
 * How the matrix moves from one rules case to the next. A delete rather than a disable,
 * because *no rules at all* and *rules that are switched off* are two states this bench has to
 * be able to be in, and only one of them is the absence of rows.
 *
 * @param api - The harness, for its pool.
 * @param organizationId - The workspace.
 * @returns When they are gone.
 */
export async function clearRules(api: ApiHarness, organizationId: string): Promise<void> {
  await api.sql.query(`delete from ${SCHEMA_NAME}.escalation_rules where organization_id = $1`, [
    organizationId,
  ]);
}

/**
 * A route's chain, straight from the table — what a refusal must not have moved.
 *
 * @param api - The harness, for its pool.
 * @param organizationId - The workspace.
 * @param taskKind - Which route.
 * @returns The chain as `position`, alias and note, in `position` order.
 */
export async function storedChain(
  api: ApiHarness,
  organizationId: string,
  taskKind: string,
): Promise<{ position: number; alias: string; note: string | null }[]> {
  const { rows } = await api.sql.query<{ position: number; alias: string; note: string | null }>(
    `select h.position, a.alias, h.note
       from ${SCHEMA_NAME}.route_hops h
       join ${SCHEMA_NAME}.model_aliases a on a.id = h.model_alias_id
       join ${SCHEMA_NAME}.routes r on r.id = h.route_id
       join ${SCHEMA_NAME}.task_kinds k on k.id = r.task_kind_id
      where h.organization_id = $1 and k.name = $2
      order by h.position`,
    [organizationId, taskKind],
  );

  return rows;
}

/**
 * A workspace's route revisions, newest first.
 *
 * @param api - The harness, for its pool.
 * @param organizationId - The workspace.
 * @returns The rows, as the audit log (#26) will read them.
 */
export async function revisionsOf(
  api: ApiHarness,
  organizationId: string,
): Promise<{ id: string; actor: string | null; diff: RouteRevisionDiff }[]> {
  const { rows } = await api.sql.query<{
    id: string;
    actor: string | null;
    diff: RouteRevisionDiff;
  }>(
    `select id, actor, diff from ${SCHEMA_NAME}.route_revisions
      where organization_id = $1 order by created_at desc, id desc`,
    [organizationId],
  );

  return rows;
}
