import type {
  ProviderCatalog,
  ProviderCatalogEntry,
  ProviderConnection,
  ProviderConnectionPage,
  ProviderFormField,
} from "@/app/api/providers";

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
 * shape AF.3's Bedrock region will take. A dialog that draws it draws anything.
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

/** Mockup 07's Anthropic card: a masked key row and nothing else. */
export function anthropicEntry(): ProviderCatalogEntry {
  return {
    kind: "anthropic",
    title: "Connect Anthropic",
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
