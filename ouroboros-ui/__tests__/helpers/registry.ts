import type {
  ModelAliasReference,
  ModelPrice,
  RegistryAlias,
  RegistryBinding,
  RegistryReadModel,
} from "@/app/api/registry";
import type { RegistryReadings } from "@/app/registry/view";

import { CHECKED_AT, seededProviders } from "./models";

/**
 * The registry page's fixtures — the seeded workspace's allowed-models table, as
 * `GET /api/v1/registry` actually serves it (#588, consumed by #592).
 *
 * **These are the dev seed's eight aliases read through the service's own composition rules**,
 * not eight plausible-looking objects: `registry-read.integration-spec.ts` in `ouroboros-rest`
 * seeds the same eight rows against a migrated database and asserts every cell below, and
 * that suite's `EXPECTED` table is what this file transcribes. That is what makes "the seeded
 * table matches the mockup" a claim a test in this module can make at all — a fixture
 * invented here would prove that the page renders *something*, which is not the acceptance
 * criterion.
 *
 * **Three cells are not the mockup's, and the difference is upstream of this module.** Mockup
 * 21 draws `coder-max` at `$15 · $75`, `coder-std` at `$3 · $15` and `local-docs` used by two
 * routes with `sizer` by one; the shipped catalog prices `claude-fable-5` at `$10 · $50` and
 * `claude-sonnet-5` at `$2 · $10`, and the seeded matrix's chains give the counts below. The
 * integration suite's header records both divergences and where they are written up; the
 * table renders what the service resolved rather than what the drawing shows, because the
 * whole point of a composed payload is that the table and the inspector cannot print two
 * different prices for one alias.
 *
 * The order is the payload's — **by alias name** — which is not the mockup's drawing order.
 */

/** The snapshot every bundled price in the seed came from. */
export const CATALOG_VERSION = "2026-08-15+litellm.70d51a1";

/** When that snapshot took effect. Fixed, so a rendered provenance is too. */
export const PRICED_AT = "2026-08-15T00:00:00.000Z";

/** Where the two fixable health states point. The path the service publishes. */
export const FIX_PATH = "/models/providers";

/** The orphan row's note, verbatim from the mockup and the service alike. */
export const NO_KEY_NOTE = "no key — connect a provider";

/** The seeded connections' ids, in the order `seededProviders()` lists them. */
const [ANTHROPIC, CURSOR, COPILOT, VLLM, OLLAMA] = seededProviders();

/**
 * One binding.
 *
 * @param provider Which seeded connection, from `seededProviders()`.
 * @param monogram The square's letters, as the service computes them.
 * @param mask The masked credential, or `null` for a provider that stores none.
 * @returns The binding as the contract serves it.
 */
function binding(
  provider: (typeof ANTHROPIC),
  monogram: string,
  mask: string | null,
): RegistryBinding {
  return {
    id: provider.id,
    kind: provider.kind,
    displayName: provider.displayName,
    monogram,
    mask,
  };
}

/**
 * One route reference.
 *
 * @param tag The route's tag — the chip.
 * @param serial Which seeded route, for a stable id.
 * @returns The reference.
 */
function route(tag: string, serial: number): ModelAliasReference {
  return {
    kind: "route",
    refId: `5eed0012-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    label: tag,
    blocking: true,
  };
}

/**
 * One escalation-rule reference.
 *
 * @param label The chip — the rule's predicate, prefixed, as V023 renders it.
 * @param serial Which seeded rule, for a stable id.
 * @returns The reference.
 */
function escalation(label: string, serial: number): ModelAliasReference {
  return {
    kind: "escalation",
    refId: `5eed0013-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    label,
    blocking: true,
  };
}

/**
 * A bundled token price — the shape most of the table is in.
 *
 * @param kind The provider kind the price was looked up for.
 * @param modelId The model.
 * @param input Cents per million input tokens.
 * @param output Cents per million output tokens.
 * @param display The cell, as the service renders it.
 * @returns The price.
 */
export function tokenPrice(
  kind: string,
  modelId: string,
  input: number,
  output: number,
  display: string,
): ModelPrice {
  return {
    connectionKind: kind,
    modelId,
    price: {
      billingMode: "token",
      inputCentsPer1m: input,
      outputCentsPer1m: output,
      provenance: { source: "bundled", catalogVersion: CATALOG_VERSION, effectiveAt: PRICED_AT },
    },
    display,
  };
}

/**
 * A bundled price in one of the three shapes with no rates — `seat`, `usage` or `free`.
 *
 * @param kind The provider kind.
 * @param modelId The model.
 * @param billingMode Which shape.
 * @param display The cell, as the service renders it.
 * @returns The price.
 */
export function flatPrice(
  kind: string,
  modelId: string,
  billingMode: "seat" | "usage" | "free",
  display: string,
): ModelPrice {
  return {
    connectionKind: kind,
    modelId,
    price: {
      billingMode,
      inputCentsPer1m: billingMode === "free" ? 0 : null,
      outputCentsPer1m: billingMode === "free" ? 0 : null,
      provenance: { source: "bundled", catalogVersion: CATALOG_VERSION, effectiveAt: PRICED_AT },
    },
    display,
  };
}

/**
 * The price for a model the catalog does not cover — `null` and `—`, the same fact twice.
 *
 * @param modelId The model.
 * @param kind The provider kind, or `null` for an unbound alias.
 * @returns The price.
 */
export function unpricedPrice(modelId: string, kind: string | null = null): ModelPrice {
  return { connectionKind: kind, modelId, price: null, display: "—" };
}

/**
 * One row, defaulting to the seed's `coder-max` — bound to Anthropic, healthy, priced,
 * referenced four times.
 *
 * @param over What this case is about.
 * @returns The row as the contract serves it.
 */
export function registryAlias(over: Partial<RegistryAlias> = {}): RegistryAlias {
  return {
    id: "a11a5000-0000-4000-8000-000000000002",
    alias: "coder-max",
    enabled: true,
    binding: binding(ANTHROPIC, "AN", "••••Xq4A"),
    modelId: "claude-fable-5",
    params: { thinking: "max", token_budget: 400_000 },
    restrictions: {},
    chips: ["max thinking", "400k budget"],
    notes: null,
    health: { state: "ok", note: null, fix: null, checkedAt: CHECKED_AT },
    price: tokenPrice("anthropic", "claude-fable-5", 1000, 5000, "$10 · $50"),
    usedBy: 4,
    references: [
      route("implement-primary", 7),
      route("plan-primary", 5),
      route("review-primary", 12),
      escalation("escalation:effort≥L", 1),
    ],
    ...over,
  };
}

/**
 * The seeded workspace's eight rows, in the order the service sends them (by alias name).
 *
 * @returns The table mockup 21 draws, cell for cell where the seed agrees with the drawing
 *   and as the service composes it where it does not — see this file's header.
 */
export function seededRegistry(): RegistryAlias[] {
  return [
    registryAlias({
      id: "a11a5000-0000-4000-8000-000000000001",
      alias: "coder-fallback",
      binding: binding(COPILOT, "GH", "••••7hLk"),
      modelId: "gpt-5-codex",
      params: {},
      chips: [],
      // The row the mockup draws amber: the seeded Copilot connection is `error` with
      // `elevated latency`, and #588 derives `degraded` from it. Nothing stores the word.
      health: { state: "degraded", note: "elevated latency", fix: null, checkedAt: CHECKED_AT },
      price: flatPrice("copilot", "gpt-5-codex", "seat", "seat-based"),
      usedBy: 2,
      references: [route("implement-primary", 7), route("commit-msg-primary", 22)],
    }),
    registryAlias(),
    registryAlias({
      id: "a11a5000-0000-4000-8000-000000000003",
      alias: "coder-std",
      modelId: "claude-sonnet-5",
      params: { thinking: "std" },
      chips: ["std thinking"],
      price: tokenPrice("anthropic", "claude-sonnet-5", 200, 1000, "$2 · $10"),
      usedBy: 2,
      references: [route("plan-primary", 5), route("review-primary", 12)],
    }),
    registryAlias({
      id: "a11a5000-0000-4000-8000-000000000004",
      alias: "gpt5-experiments",
      enabled: false,
      binding: null,
      modelId: "gpt-5.2-preview",
      params: {},
      chips: [],
      health: { state: "no_key", note: NO_KEY_NOTE, fix: FIX_PATH, checkedAt: null },
      price: unpricedPrice("gpt-5.2-preview"),
      usedBy: 0,
      references: [],
    }),
    registryAlias({
      id: "a11a5000-0000-4000-8000-000000000005",
      alias: "local-docs",
      binding: binding(OLLAMA, "OL", null),
      modelId: "qwen3-coder:32b",
      params: { context_tokens: 32_000 },
      chips: ["ctx 32k"],
      price: flatPrice("ollama", "qwen3-coder:32b", "free", "$0"),
      usedBy: 2,
      references: [route("implement-primary", 7), route("docs-primary", 17)],
    }),
    registryAlias({
      id: "a11a5000-0000-4000-8000-000000000006",
      alias: "local-free",
      binding: binding(VLLM, "VL", null),
      modelId: "llama-4-maverick",
      params: {},
      restrictions: { batch_ok: true },
      chips: ["batch ok"],
      price: flatPrice("openai_compatible", "llama-4-maverick", "free", "$0"),
      usedBy: 1,
      references: [route("commit-msg-primary", 22)],
    }),
    registryAlias({
      id: "a11a5000-0000-4000-8000-000000000007",
      alias: "second-opinion",
      binding: binding(CURSOR, "CU", "••••2bNd"),
      modelId: "composer-2",
      params: {},
      restrictions: { review_vote_only: true },
      chips: ["review vote only"],
      price: flatPrice("cursor", "composer-2", "usage", "usage-based"),
      usedBy: 1,
      references: [escalation("escalation:security label", 2)],
    }),
    registryAlias({
      id: "a11a5000-0000-4000-8000-000000000008",
      alias: "sizer",
      modelId: "claude-haiku-4-5",
      params: { temperature: 0, max_output_tokens: 8000 },
      chips: ["temp 0", "8k out"],
      price: tokenPrice("anthropic", "claude-haiku-4-5", 100, 500, "$1 · $5"),
      usedBy: 1,
      references: [route("docs-primary", 17)],
    }),
  ];
}

/**
 * The endpoint's envelope around a list of rows.
 *
 * @param aliases The rows. Defaults to the seeded eight.
 * @returns `{aliases}`, as the contract serves it.
 */
export function registryPayload(aliases: readonly RegistryAlias[] = seededRegistry()): RegistryReadModel {
  return { aliases: [...aliases] };
}

/**
 * The page's readings for a workspace whose two reads both came back clean.
 *
 * @param over What this case is about.
 * @returns The readings.
 */
export function registryReadings(over: Partial<RegistryReadings> = {}): RegistryReadings {
  return {
    providers: { ok: true, value: seededProviders() },
    aliases: { ok: true, value: seededRegistry() },
    ...over,
  };
}
