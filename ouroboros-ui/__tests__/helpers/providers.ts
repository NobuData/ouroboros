import type {
  ModelAlias,
  ModelPull,
  ProviderModel,
  ProviderModels,
  UnlistedModel,
  ProviderCapabilities,
  ProviderCatalog,
  ProviderCatalogEntry,
  ProviderConnection,
  ProviderConnectionPage,
  ProviderFormField,
  ProviderMonthlySpend,
  ProviderMonthlySpendRow,
} from "@/app/api/providers";
import type { Reading } from "@/app/api/reading";
import type { ProvidersReadings } from "@/app/providers/data";

import { seededProviders } from "./models";

/**
 * The add-provider flow's fixtures — the catalog as `GET /api/v1/providers/catalog` serves
 * it, and the connections the duplicate warning compares against.
 *
 * **The five entries are `ouroboros-rest`'s own card shapes**, field for field: what
 * `card.shapes.fixture.ts` holds each adapter's `configSchema()` to, run through
 * `provider.forms.ts`'s `toFormFields`, is what the service answers — so a dialog driven by
 * these is driven by what it will meet in a development stack, not by five plausible objects.
 * `openapi.yaml` § `/api/v1/providers/catalog` carries three of them as its example.
 *
 * {@link fakeEntry} is the sixth, and it is the proof the ticket asks for: a kind no UI file
 * names, with a form that includes the one widget none of the five declares — a `select`, the
 * shape AF.3's Bedrock region will take. A dialog that draws it draws anything — and, since
 * AE.2 (#228), so does a card: {@link fakeConnection} is a connection of that kind, and the
 * card suite renders it with the five seeded cards and zero card-code changes.
 *
 * The five cards themselves are {@link seededCards}, `R__dev_seed_providers.sql` row for row,
 * with the month {@link seededSpend} and the models {@link seededModels} that seed writes.
 */

/** Every optional keyword, explicitly unset — the shape the service answers. */
const NOTHING_SET: Omit<ProviderFormField, "name" | "label" | "widget" | "required"> = {
  help: null,
  placeholder: null,
  defaultValue: null,
  choices: null,
  minLength: null,
  maxLength: null,
  pattern: null,
};

/**
 * One field, optional and with nothing else set unless this case says so.
 *
 * @param over The field's name, label and widget, plus whatever the case is about.
 * @returns The field as the contract serves it.
 */
export function formField(
  over: Pick<ProviderFormField, "name" | "label" | "widget"> & Partial<ProviderFormField>,
): ProviderFormField {
  return { required: false, ...NOTHING_SET, ...over };
}

/**
 * An adapter's four flags, defaulting to what every cloud adapter answers.
 *
 * @param over What this kind is about — `pull` for Ollama, `entitlements` for Copilot.
 * @returns The flags, all four present.
 */
export function capabilities(over: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return { discovery: true, pull: false, entitlements: false, invocation: false, ...over };
}

/** Mockup 07's Anthropic card: a masked key row and nothing else. */
export function anthropicEntry(): ProviderCatalogEntry {
  return {
    kind: "anthropic",
    title: "Connect Anthropic",
    capabilities: capabilities(),
    fields: [
      formField({
        name: "apiKey",
        label: "API key",
        widget: "secret",
        required: true,
        placeholder: "sk-ant-api03-…",
        minLength: 1,
      }),
    ],
  };
}

/** The vLLM card: a Base URL field and an optional key row. */
export function openaiCompatibleEntry(): ProviderCatalogEntry {
  return {
    kind: "openai_compatible",
    title: "Connect an OpenAI-compatible endpoint",
    capabilities: capabilities(),
    fields: [
      formField({
        name: "baseUrl",
        label: "Base URL",
        widget: "url",
        required: true,
        help: "The OpenAI-compatible root — vLLM, LM Studio, llama.cpp, TGI.",
        placeholder: "http://10.0.4.20:8000/v1",
        minLength: 1,
      }),
      formField({
        name: "apiKey",
        label: "API key",
        widget: "secret",
        placeholder: "API key — optional, no auth configured",
      }),
    ],
  };
}

/** The Ollama card: a Host field and no key row. */
export function ollamaEntry(): ProviderCatalogEntry {
  return {
    kind: "ollama",
    title: "Connect an Ollama host",
    capabilities: capabilities({ pull: true }),
    fields: [
      formField({
        name: "baseUrl",
        label: "Host",
        widget: "url",
        required: true,
        help: "Where the daemon is listening. No credential — it is your own machine.",
        placeholder: "http://ken-station.local:11434",
        minLength: 1,
      }),
    ],
  };
}

/** The Copilot card: a masked token row, org-billed. */
export function copilotEntry(): ProviderCatalogEntry {
  return {
    kind: "copilot",
    title: "Connect GitHub Copilot",
    capabilities: capabilities({ discovery: false, entitlements: true }),
    fields: [
      formField({
        name: "token",
        label: "GitHub token",
        widget: "secret",
        required: true,
        help: "Billed to the organization. Seats are read back when the token is tested.",
        placeholder: "ghu_…",
        minLength: 1,
      }),
    ],
  };
}

/** The Cursor card: a masked key row. */
export function cursorEntry(): ProviderCatalogEntry {
  return {
    kind: "cursor",
    title: "Connect Cursor",
    capabilities: capabilities({ discovery: false }),
    fields: [
      formField({
        name: "apiKey",
        label: "API key",
        widget: "secret",
        required: true,
        placeholder: "key_…",
        minLength: 1,
      }),
    ],
  };
}

/** The conformance kit's fake, registered under `custom`, declaring the select no card does. */
export const FAKE_TITLE = "Connect a test provider";

/** The fake's choices — the shape of a Bedrock region, before Bedrock exists. */
export const FAKE_REGIONS = ["us-east-1", "eu-west-1"] as const;

/**
 * The fake adapter's entry — the one no UI file names.
 *
 * @returns An address, a region to choose, and an optional key.
 */
export function fakeEntry(): ProviderCatalogEntry {
  return {
    kind: "custom",
    title: FAKE_TITLE,
    capabilities: capabilities(),
    fields: [
      formField({
        name: "baseUrl",
        label: "Base URL",
        widget: "url",
        required: true,
        help: "Where the provider is. Never called — this adapter answers from memory.",
        placeholder: "https://provider.example/v1",
        minLength: 1,
      }),
      formField({
        name: "region",
        label: "Region",
        widget: "select",
        required: true,
        help: "Where the provider is served from.",
        choices: [...FAKE_REGIONS],
        defaultValue: FAKE_REGIONS[0],
      }),
      formField({
        name: "apiKey",
        label: "API key",
        widget: "secret",
        placeholder: "API key — optional, no auth configured",
      }),
    ],
  };
}

/**
 * The five live kinds, in V015's order — the order the service lists them.
 *
 * @returns The entries.
 */
export function seededCatalog(): ProviderCatalogEntry[] {
  return [anthropicEntry(), openaiCompatibleEntry(), ollamaEntry(), copilotEntry(), cursorEntry()];
}

/**
 * The catalog body, as the service serves it.
 *
 * @param kinds The entries. Defaults to {@link seededCatalog}.
 * @returns The `ProviderCatalog` payload.
 */
export function catalogPayload(kinds: readonly ProviderCatalogEntry[] = seededCatalog()): ProviderCatalog {
  return { kinds: [...kinds] };
}

/** The seed's owner, as `addedByName` spells them — the card's *Added by Ken*. */
export const ADDER = "Ken Suenobu";

/** The instant every card suite reads the page at — the seed's *last used 3m ago* is from here. */
export const READ_AT = "2026-08-23T10:00:12.004Z";

/**
 * One connection, defaulting to the seed's Anthropic one.
 *
 * @param over What this case is about.
 * @returns The connection as the contract serves it.
 */
export function connection(over: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: "5eed000c-0000-4000-8000-000000000001",
    kind: "anthropic",
    displayName: "Anthropic Claude",
    baseUrl: null,
    capabilityNote: "api.anthropic.com · primary coding lane",
    status: "active",
    enabled: true,
    monthlyCapCents: 60_000,
    mask: "••••Xq4A",
    addedBy: "5eed0003-0000-4000-8000-000000000001",
    addedByName: ADDER,
    lastCheckedAt: "2026-08-23T09:59:41.882Z",
    lastUsedAt: "2026-08-23T09:57:12.004Z",
    createdAt: "2026-06-12T16:20:00.000Z",
    updatedAt: "2026-08-23T09:59:41.882Z",
    ...over,
  };
}

/** The seed's vLLM endpoint. */
export const SEEDED_VLLM_URL = "http://10.0.4.20:8000/v1";

/** The seed's Ollama host. */
export const SEEDED_OLLAMA_URL = "http://ken-station.local:11434";

/**
 * Three of the seed's connections: one at a fixed endpoint, two at addresses.
 *
 * @returns The connections, in the listing's own order.
 */
export function seededConnections(): ProviderConnection[] {
  return [
    connection(),
    connection({
      id: "5eed000c-0000-4000-8000-000000000005",
      kind: "ollama",
      displayName: "Ollama · workstation",
      baseUrl: SEEDED_OLLAMA_URL,
      capabilityNote: "zero-cost lane — used for docs & commit messages",
      monthlyCapCents: null,
      mask: null,
      lastUsedAt: null,
    }),
    connection({
      id: "5eed000c-0000-4000-8000-000000000004",
      kind: "openai_compatible",
      displayName: "vLLM · lab cluster",
      baseUrl: SEEDED_VLLM_URL,
      capabilityNote: "self-hosted · A100 ×2",
      monthlyCapCents: null,
      mask: null,
    }),
  ];
}

/**
 * The listing body, as the service serves it.
 *
 * @param items The connections. Defaults to {@link seededConnections}.
 * @returns The `ProviderConnectionPage` payload.
 */
export function connectionPage(
  items: readonly ProviderConnection[] = seededConnections(),
): ProviderConnectionPage {
  return { items: [...items], total: items.length, limit: 100, offset: 0 };
}

/* ------------------------------------------------------------------------------ the cards */

/**
 * The five seeded cards, in the listing's order — by display name — with the seed's own
 * columns: caps, notes, addresses, masks, and last-used instants measured from {@link READ_AT}.
 *
 * @returns Mockup 07's five connections.
 */
export function seededCards(): ProviderConnection[] {
  return [
    // last used 3m ago
    connection({ lastUsedAt: "2026-08-23T09:57:12.004Z" }),
    connection({
      id: "5eed000c-0000-4000-8000-000000000002",
      kind: "cursor",
      displayName: "Cursor",
      capabilityNote: "api.cursor.com · used for second-opinion reviews",
      monthlyCapCents: 12_000,
      mask: "••••9f2e",
      // last used 26m ago
      lastUsedAt: "2026-08-23T09:34:12.004Z",
      createdAt: "2026-07-02T10:05:00.000Z",
    }),
    connection({
      id: "5eed000c-0000-4000-8000-000000000003",
      kind: "copilot",
      displayName: "GitHub Copilot",
      capabilityNote: "billed through GitHub org acme-robotics",
      status: "error",
      monthlyCapCents: 9_500,
      mask: "••••7Kd2",
      // last used 1h 12m ago
      lastUsedAt: "2026-08-23T08:48:12.004Z",
      createdAt: "2026-06-18T09:40:00.000Z",
    }),
    connection({
      id: "5eed000c-0000-4000-8000-000000000005",
      kind: "ollama",
      displayName: "Ollama · workstation",
      baseUrl: SEEDED_OLLAMA_URL,
      capabilityNote: "zero-cost lane — used for docs & commit messages",
      monthlyCapCents: null,
      mask: null,
      // last used 41s ago
      lastUsedAt: "2026-08-23T09:59:31.004Z",
      createdAt: "2026-05-14T08:55:00.000Z",
    }),
    connection({
      id: "5eed000c-0000-4000-8000-000000000004",
      kind: "openai_compatible",
      displayName: "OpenAI-compatible · local vLLM",
      baseUrl: SEEDED_VLLM_URL,
      capabilityNote: "self-hosted · A100 ×2",
      monthlyCapCents: null,
      mask: null,
      // last used 9m ago
      lastUsedAt: "2026-08-23T09:51:12.004Z",
      createdAt: "2026-05-30T14:12:00.000Z",
    }),
  ];
}

/** The id the fake adapter's connection carries — a sixth card no file names. */
export const FAKE_CONNECTION_ID = "5eed000c-0000-4000-8000-000000000006";

/**
 * A connection of the fake adapter's kind — the sixth card, and the schema-driven proof.
 *
 * @param over What this case is about.
 * @returns A `custom` connection at the fake's address, with its optional key stored.
 */
export function fakeConnection(over: Partial<ProviderConnection> = {}): ProviderConnection {
  return connection({
    id: FAKE_CONNECTION_ID,
    kind: "custom",
    displayName: "Fake provider · conformance kit",
    baseUrl: "https://fake.invalid/v1",
    capabilityNote: null,
    status: "unknown",
    monthlyCapCents: null,
    mask: "••••cret",
    lastUsedAt: null,
    lastCheckedAt: null,
    createdAt: "2026-08-20T08:00:00.000Z",
    ...over,
  });
}

/** The Anthropic connection two seeded aliases resolve through — the delete-guard case. */
export const SEEDED_ANTHROPIC_ID = "5eed000c-0000-4000-8000-000000000001";

/**
 * One registry alias, defaulting to one that resolves through the seeded Anthropic card.
 *
 * @param over What this case is about — its name, and which connection it points at.
 * @returns The alias as `GET /api/v1/registry/aliases` serves it.
 */
export function modelAlias(over: Partial<ModelAlias> = {}): ModelAlias {
  return {
    id: "a11a5000-0000-4000-8000-000000000001",
    alias: "coder-max",
    enabled: true,
    connection: { id: SEEDED_ANTHROPIC_ID, kind: "anthropic", displayName: "Anthropic Claude" },
    modelId: "claude-fable-5",
    params: {},
    restrictions: {},
    notes: null,
    references: [],
    updatedBy: null,
    createdAt: "2026-06-12T09:00:00.000Z",
    updatedAt: "2026-06-12T09:00:00.000Z",
    ...over,
  };
}

/**
 * The seeded aliases — two resolving through the Anthropic card, so its delete is guarded and
 * its switch-off asks; the same two names `provider-connections.integration-spec.ts` asserts.
 *
 * @returns The aliases, sorted by name the way the service serves them.
 */
export function seededAliases(): ModelAlias[] {
  return [
    modelAlias({ id: "a11a5000-0000-4000-8000-000000000001", alias: "coder-max" }),
    modelAlias({
      id: "a11a5000-0000-4000-8000-000000000002",
      alias: "local-docs",
      modelId: "claude-haiku-4-5",
    }),
  ];
}

/**
 * One month row, defaulting to the seed's Anthropic figure — `$412.80`.
 *
 * @param over What this case is about.
 * @returns The row as the contract serves it.
 */
export function spendRow(over: Partial<ProviderMonthlySpendRow> = {}): ProviderMonthlySpendRow {
  return {
    kind: "anthropic",
    local: false,
    spendCents: 41_280,
    tokens: 24_000_000,
    pricedCalls: 15,
    unpricedCalls: 0,
    ...over,
  };
}

/**
 * The seeded month — `tests/seed.sql`'s meters: `$412.80`, `$64.10`, `$76.00`, vLLM priced at
 * nothing, and Ollama's 2.1M unpriced tokens.
 *
 * @returns The payload.
 */
export function seededSpend(): ProviderMonthlySpend {
  return {
    month: { since: "2026-08-01T00:00:00.000Z", until: READ_AT },
    providers: [
      spendRow(),
      spendRow({ kind: "copilot", spendCents: 7_600, tokens: 5_000_000, pricedCalls: 6 }),
      spendRow({ kind: "cursor", spendCents: 6_410, tokens: 4_400_000, pricedCalls: 3 }),
      spendRow({
        kind: "ollama",
        local: true,
        spendCents: null,
        tokens: 2_100_000,
        pricedCalls: 0,
        unpricedCalls: 5,
      }),
      spendRow({
        kind: "openai_compatible",
        local: true,
        spendCents: 0,
        tokens: 2_600_000,
        pricedCalls: 12,
      }),
    ],
  };
}

/**
 * One discovered model, as `GET /api/v1/providers/{id}/models` answers it.
 *
 * @param over What this case is about.
 * @returns The model, defaulting to a cloud one with no size.
 */
export function providerModel(over: Partial<ProviderModel> = {}): ProviderModel {
  return {
    modelId: "claude-fable-5",
    display: "claude-fable-5",
    sizeBytes: null,
    meta: {},
    discoveredAt: READ_AT,
    ...over,
  };
}

/**
 * One connection's catalog, as the service answers it.
 *
 * @param connectionId The connection.
 * @param models Its models.
 * @param unlisted The aliases the catalog stranded, if any.
 * @returns The catalog.
 */
export function providerModels(
  connectionId: string,
  models: readonly ProviderModel[],
  unlisted: readonly UnlistedModel[] = [],
): ProviderModels {
  return {
    connectionId,
    discoveredAt: models.length === 0 ? null : READ_AT,
    models: [...models],
    unlisted: [...unlisted],
  };
}

/**
 * The Anthropic card's four chips, each carrying the seed's `priority` tier.
 *
 * @returns The models.
 */
export function anthropicModels(): ProviderModel[] {
  return ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"].map((id) =>
    providerModel({
      modelId: id,
      display: id,
      meta: { context_tokens: id === "claude-haiku-4-5" ? 200_000 : 1_000_000, tier: "priority" },
    }),
  );
}

/** The seeded Ollama card's three detected models, with the sizes `/api/tags` reports. */
export function ollamaModels(): ProviderModel[] {
  return [
    providerModel({ modelId: "qwen3-coder:32b", display: "qwen3-coder:32b", sizeBytes: 18_997_469_184 }),
    providerModel({ modelId: "llama4:scout", display: "llama4:scout", sizeBytes: 62_970_741_760 }),
    providerModel({ modelId: "phi4:14b", display: "phi4:14b", sizeBytes: 9_053_116_800 }),
  ];
}

/** The seeded Ollama connection's id. */
export const SEEDED_OLLAMA_ID = "5eed000c-0000-4000-8000-000000000005";

/** The seeded vLLM connection's id. */
export const SEEDED_VLLM_ID = "5eed000c-0000-4000-8000-000000000004";

/**
 * Every seeded card's catalog, by connection id — the eleven `provider_models` rows.
 *
 * @returns The map the reader hands the screen.
 */
export function seededModels(): Map<string, Reading<ProviderModels>> {
  const ok = (id: string, models: readonly ProviderModel[]): [string, Reading<ProviderModels>] => [
    id,
    { ok: true, value: providerModels(id, models) },
  ];

  return new Map([
    ok(SEEDED_ANTHROPIC_ID, anthropicModels()),
    ok("5eed000c-0000-4000-8000-000000000002", [
      providerModel({ modelId: "composer-2", display: "cursor/composer-2" }),
    ]),
    ok("5eed000c-0000-4000-8000-000000000003", [
      providerModel({ modelId: "gpt-5-codex", display: "copilot/gpt-5-codex" }),
    ]),
    ok(SEEDED_VLLM_ID, [
      providerModel({ modelId: "llama-4-maverick", display: "local/llama-4-maverick" }),
      providerModel({ modelId: "deepseek-v3.2", display: "local/deepseek-v3.2" }),
    ]),
    ok(SEEDED_OLLAMA_ID, ollamaModels()),
  ]);
}

/**
 * One tracked pull, as the service answers it.
 *
 * @param over What this case is about.
 * @returns The record, defaulting to a transfer at 61%.
 */
export function pullRecord(over: Partial<ModelPull> = {}): ModelPull {
  return {
    connectionId: SEEDED_OLLAMA_ID,
    modelId: "llama4:scout",
    state: "running",
    status: "downloading",
    completedBytes: 38_412_152_474,
    totalBytes: 62_970_741_760,
    percent: 61,
    queuedAt: "2026-08-23T09:58:00.000Z",
    startedAt: "2026-08-23T09:58:00.200Z",
    finishedAt: null,
    errorClass: null,
    detail: null,
    ...over,
  };
}

/**
 * The pulls the reader hands the screen — none, which is the seeded workspace's state.
 *
 * @returns The map, one entry per pulling connection.
 */
export function seededPulls(): Map<string, Reading<readonly ModelPull[]>> {
  return new Map([[SEEDED_OLLAMA_ID, { ok: true, value: [] }]]);
}

/**
 * What the reader hands the screen, for the seeded workspace read cleanly.
 *
 * @param over What this case is about.
 * @returns The readings.
 */
export function readings(over: Partial<ProvidersReadings> = {}): ProvidersReadings {
  return {
    connections: { ok: true, value: seededCards() },
    catalog: { ok: true, value: seededCatalog() },
    health: { ok: true, value: seededProviders() },
    spend: { ok: true, value: seededSpend() },
    aliases: { ok: true, value: seededAliases() },
    models: seededModels(),
    pulls: seededPulls(),
    now: READ_AT,
    ...over,
  };
}
