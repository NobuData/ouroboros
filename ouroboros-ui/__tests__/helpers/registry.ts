import type {
  ImportCandidate,
  ImportCandidateList,
  ImportResult,
  ModelAliasReference,
  ModelAliasConnection,
  ModelCapabilitySummary,
  ModelOption,
  ModelOptionList,
  ModelParamFormField,
  ModelParamSchemaResponse,
  ModelParamSection,
  ModelPrice,
  RegistryAlias,
  RegistryBinding,
  RegistryReadModel,
} from "@/app/api/registry";
import type { ProviderConnection } from "@/app/api/providers";
import type { RegistryReadings } from "@/app/registry/view";

import { CHECKED_AT } from "./models";
import { seededCards } from "./providers";

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

/**
 * The seeded connections, in mockup 07's own listing order.
 *
 * `seededCards()` rather than the routing page's health strip: since CI.3
 * ([#593](https://github.com/NobuData/ouroboros/issues/593)) the registry page reads
 * `GET /api/v1/providers`, because the inspector's provider select needs the **mask** and the
 * health payload carries none. The five are the same five connections either way — same ids,
 * same names — and this is the payload that also has what a binding says about them.
 */
const [ANTHROPIC, CURSOR, COPILOT, OLLAMA, VLLM] = seededCards();

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
 * The connections the registry page reads, as `GET /api/v1/providers` serves them.
 *
 * Named here as well as in `providers.ts` so a registry suite says what it means — the page's
 * *connections* read — rather than borrowing mockup 07's word for the same five rows.
 */
export function registryConnections(): ProviderConnection[] {
  return seededCards();
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
    providers: { ok: true, value: registryConnections() },
    aliases: { ok: true, value: seededRegistry() },
    ...over,
  };
}

/* ------------------------------------------------------------------ the CI.4 flows (#594) */

/**
 * The fixtures behind the create dialog and the import wizard — the three reads and the one
 * annotated table CI.4 ([#594](https://github.com/NobuData/ouroboros/issues/594)) is built on.
 *
 * **These are `ouroboros-rest`'s own published examples**, transcribed rather than invented:
 * `openapi.yaml` publishes a worked response for `GET /registry/aliases/model-options`,
 * `GET /registry/param-schema` and `GET /registry/import/{connectionId}/candidates`, and each
 * is the seeded Anthropic connection answering about the models the dev seed gives it. A
 * fixture made up here would prove the wizard renders *something*, which is not the acceptance
 * criterion — the criterion is that importing two models from the seeded Anthropic connection
 * lands both with their suggested names.
 */

/** The seeded Anthropic connection, as every one of these payloads echoes it. */
export const ANTHROPIC_CONNECTION: ModelAliasConnection = {
  id: ANTHROPIC.id,
  kind: ANTHROPIC.kind,
  displayName: ANTHROPIC.displayName,
};

/** When discovery last reported the seeded Anthropic models. Fixed, like every stamp here. */
export const DISCOVERED_AT = "2026-08-25T09:56:00.000Z";

/**
 * One model the select offers.
 *
 * @param modelId The provider's own identifier.
 * @param meta What else discovery reported. Defaults to the published example's.
 * @returns The option as the contract serves it.
 */
export function modelOption(
  modelId: string,
  meta: Record<string, unknown> = { context_tokens: 1_000_000, tier: "priority" },
): ModelOption {
  return { modelId, display: modelId, discoveredAt: DISCOVERED_AT, meta };
}

/**
 * The model select's whole answer for the seeded Anthropic connection.
 *
 * @param models The models. Defaults to the three the seed's discovery reports.
 * @returns The payload. An **empty** list is an honest answer, not a failure — the dialog then
 *   takes the model id as text.
 */
export function modelOptionList(
  models: readonly ModelOption[] = [
    modelOption("claude-fable-5"),
    modelOption("claude-haiku-4-5"),
    modelOption("claude-opus-5"),
  ],
): ModelOptionList {
  return { connection: ANTHROPIC_CONNECTION, models: [...models] };
}

/**
 * One parameter field, in the form the service derives from its own schema.
 *
 * @param over What this case is about.
 * @returns The field, defaulting to the Anthropic adapter's `thinking` select.
 */
export function paramField(over: Partial<ModelParamFormField> = {}): ModelParamFormField {
  return {
    name: "thinking",
    label: "Thinking",
    widget: "select",
    help: "How much the model may deliberate before answering.",
    defaultValue: null,
    choices: ["off", "std", "max"],
    minimum: null,
    maximum: null,
    sources: ["adapter"],
    ...over,
  };
}

/** The Anthropic adapter's token budget — the integer field beside the select. */
export function budgetField(): ModelParamFormField {
  return paramField({
    name: "token_budget",
    label: "Token budget",
    widget: "integer",
    help: "How many tokens the model may spend thinking.",
    choices: null,
    minimum: 1,
    maximum: 400_000,
    sources: ["adapter", "discovery"],
  });
}

/**
 * One section — a schema and the fields it renders as, kept in step with each other.
 *
 * @param fields The fields. An empty list is what an empty `properties` renders as.
 * @param title What the section is headed.
 * @param description Why it is empty, for a section that is.
 * @returns The section as the contract serves it.
 */
export function paramSection(
  fields: readonly ModelParamFormField[],
  title = "Anthropic model parameters",
  description?: string,
): ModelParamSection {
  return {
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      title,
      ...(description === undefined ? {} : { description }),
      properties: Object.fromEntries(
        fields.map((field) => [
          field.name,
          {
            type: field.widget === "select" || field.widget === "text" ? "string" : field.widget === "switch" ? "boolean" : field.widget,
            title: field.label,
            ...(field.help === null ? {} : { description: field.help }),
            ...(field.choices === null ? {} : { enum: field.choices }),
            ...(field.minimum === null ? {} : { minimum: field.minimum }),
            ...(field.maximum === null ? {} : { maximum: field.maximum }),
            "x-ouroboros-sources": field.sources,
          } as ModelParamSchemaResponse["params"]["schema"]["properties"][string],
        ]),
      ),
      additionalProperties: false,
    },
    fields: [...fields],
  };
}

/**
 * What one model can be tuned with.
 *
 * @param over What this case is about — the fields, or the reason there are none.
 * @returns The response as the contract serves it.
 */
export function paramSchemaResponse(
  over: Partial<ModelParamSchemaResponse> = {},
): ModelParamSchemaResponse {
  return {
    modelId: "claude-fable-5",
    connectionId: ANTHROPIC.id,
    params: paramSection([paramField(), budgetField()]),
    restrictions: paramSection(
      [
        paramField({
          name: "batch_ok",
          label: "Batch ok",
          widget: "switch",
          help: "Work routed to this alias may be batched.",
          choices: null,
          sources: ["registry"],
        }),
      ],
      "Registry restrictions",
    ),
    reason: null,
    sources: ["adapter", "discovery", "registry"],
    ...over,
  };
}

/**
 * What CH.2's schema projects onto a candidate row.
 *
 * @param over What this case is about.
 * @returns The summary as the contract serves it.
 */
export function capabilities(
  over: Partial<ModelCapabilitySummary> = {},
): ModelCapabilitySummary {
  return {
    params: ["thinking", "token_budget"],
    thinking: true,
    contextTokens: 1_000_000,
    maxOutputTokens: 64_000,
    reason: null,
    ...over,
  };
}

/**
 * One import candidate.
 *
 * @param over What this case is about — the model, its suggestion, and whether something
 *   already names it.
 * @returns The candidate as the contract serves it.
 */
export function importCandidate(over: Partial<ImportCandidate> = {}): ImportCandidate {
  const modelId = over.modelId ?? "claude-opus-5";

  return {
    modelId,
    display: modelId,
    discoveredAt: DISCOVERED_AT,
    meta: { context_tokens: 1_000_000, tier: "priority" },
    alias: null,
    suggestedName: "opus-5",
    selected: true,
    price: tokenPrice("anthropic", modelId, 1000, 5000, "$10 · $50"),
    capabilities: capabilities(),
    ...over,
  };
}

/**
 * The wizard's whole state for the seeded Anthropic connection — the published example's two
 * rows: one already named `coder-max` and unticked, one free and ticked.
 *
 * @param candidates The candidates. Defaults to those two.
 * @returns The payload. `empty` is non-null **exactly** when the list is, which is the
 *   contract's own invariant and the one the wizard branches on.
 */
export function candidateList(
  candidates: readonly ImportCandidate[] = [
    importCandidate({
      modelId: "claude-fable-5",
      alias: { id: registryAlias().id, alias: "coder-max" },
      suggestedName: "fable-5",
      selected: false,
      price: tokenPrice("anthropic", "claude-fable-5", 1500, 7500, "$15 · $75"),
    }),
    importCandidate(),
  ],
): ImportCandidateList {
  return {
    connection: ANTHROPIC_CONNECTION,
    candidates: [...candidates],
    empty:
      candidates.length > 0
        ? null
        : {
            code: "no_models_discovered",
            message: "Anthropic Claude has reported no models.",
            fix: FIX_PATH,
          },
  };
}

/**
 * What a batch did.
 *
 * @param created The aliases created, by name and model.
 * @param skipped What was passed over, by model and the alias that already named it.
 * @returns The report as the contract serves it.
 */
export function importResult(
  created: readonly { readonly alias: string; readonly modelId: string }[] = [
    { alias: "opus-5", modelId: "claude-opus-5" },
  ],
  skipped: readonly { readonly modelId: string; readonly alias: string }[] = [],
): ImportResult {
  return {
    connection: ANTHROPIC_CONNECTION,
    created: created.map((one, index) => ({
      alias: {
        id: `7c1e0a5e-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        alias: one.alias,
        enabled: true,
        connection: ANTHROPIC_CONNECTION,
        modelId: one.modelId,
        params: {},
        restrictions: {},
        notes: null,
        references: [],
        updatedBy: null,
        createdAt: "2026-08-25T10:14:02.117Z",
        updatedAt: "2026-08-25T10:14:02.117Z",
      },
      revisionId: `b1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    })),
    skipped: skipped.map((one) => ({
      modelId: one.modelId,
      requestedAlias: one.alias,
      alias: { id: registryAlias().id, alias: one.alias },
    })),
  };
}
