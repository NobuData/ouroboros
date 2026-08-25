/**
 * Every decision the add-provider flow makes, as functions with inputs and outputs
 * ([#231](https://github.com/NobuData/ouroboros/issues/231)).
 *
 * The dialog (`app/providers/add-provider.tsx`) holds state, reads, and draws; this module
 * decides. Framework-free and pure, the way `app/providers/view.ts` and `app/models/rules.ts`
 * are, so every acceptance criterion that is a *judgement* is a unit test on a small value
 * rather than an assertion about rendered text.
 *
 * ---------------------------------------------------------------------------
 * ### The two rules this module exists to keep
 *
 * **The tiles derive from the registry.** {@link catalogTiles} takes what
 * `GET /api/v1/providers/catalog` answered and draws one tile per entry, in the service's
 * order, with nothing added: a kind this module has never heard of — the conformance kit's
 * fake, registered under `custom` — gets a tile and a form exactly as Anthropic does, because
 * there is no list here to be absent from. {@link KIND_LABELS} is *copy* for the kinds the
 * mockup names, with the kind itself as the fallback; it decides nothing.
 *
 * **The `coming soon` tiles are honest, and they retire themselves.** Mockup 07's dashed card
 * promises OpenAI, Google and Bedrock, and none of them ships until AF.3
 * ([#236](https://github.com/NobuData/ouroboros/issues/236)). {@link COMING_SOON} is that
 * promise written down once, with where it comes from — and {@link catalogTiles} drops an
 * announcement the moment the registry answers its kind, so the day AF.3's adapters land the
 * tiles flip from *soon* to live with no change here.
 *
 * ---------------------------------------------------------------------------
 * ### What the form sends, and what it does with a refusal
 *
 * {@link configOf} assembles `config` from the fields: trimmed, and with an **empty optional
 * field left out** rather than sent as `""` — the service stores a capability note in a
 * column whose constraint refuses the empty string, and an optional key that was never typed
 * is not a credential. {@link duplicateOf} is the warning the ticket asks for before a second
 * connection of the same kind at the same endpoint. {@link addFailure} turns the service's
 * refusal into the sentence the dialog prints and the fields it highlights — the provider's
 * own `key rejected (401)` under the key row, a schema violation under the field it names.
 */

import type {
  ProviderCatalogEntry,
  ProviderConnection,
  ProviderConnectionKind,
  ProviderFormField,
} from "@/app/api/providers";

/* ------------------------------------------------------------------------------ the tiles */

/**
 * The tile labels for the kinds mockup 07 names.
 *
 * Copy, not behaviour: the mockup writes *Anthropic* over the `anthropic` card and this is
 * where that spelling lives. A kind not in the map is labelled by its own name, which is what
 * makes an adapter nobody wrote a label for still appear — see this file's header.
 */
export const KIND_LABELS: Readonly<Partial<Record<string, string>>> = {
  anthropic: "Anthropic",
  openai_compatible: "OpenAI-compatible",
  ollama: "Ollama",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
};

/** A kind the catalog promises and this build does not have. */
export interface Announcement {
  /** The kind, as its adapter will register it. What retires the announcement. */
  readonly kind: string;
  /** What the tile says. */
  readonly label: string;
  /** Where it comes from — the issue, named so *soon* is an answer to *when?*. */
  readonly source: string;
}

/**
 * The three kinds mockup 07's dashed card promises, and the ticket that delivers them.
 *
 * Their spellings are the ones AF.3 is expected to register under. If it registers a
 * different one, the announcement stays up beside the live tile until this list is
 * corrected — visible, and a one-line fix — rather than a live tile silently missing.
 */
export const COMING_SOON: readonly Announcement[] = [
  { kind: "openai", label: "OpenAI", source: "AF.3 (#236)" },
  { kind: "google", label: "Google Gemini", source: "AF.3 (#236)" },
  { kind: "bedrock", label: "AWS Bedrock", source: "AF.3 (#236)" },
];

/** What every tile says on its badge while its kind is not live. */
export const COMING_SOON_LABEL = "coming soon";

/** A tile for a kind this build can connect. */
export interface LiveTile {
  readonly live: true;
  readonly kind: ProviderConnectionKind;
  /** The tile's heading. */
  readonly label: string;
  /** Two letters for the monogram box. */
  readonly monogram: string;
  /** What the form will ask for, in a line — so a reader knows what to have ready. */
  readonly needs: string;
  /** The entry, which is the form. */
  readonly entry: ProviderCatalogEntry;
}

/** A tile for a kind that is promised and not here. Draws nothing interactive. */
export interface SoonTile {
  readonly live: false;
  readonly kind: string;
  readonly label: string;
  readonly monogram: string;
  /** Where it comes from. */
  readonly source: string;
}

/** One tile in the catalog. */
export type CatalogTile = LiveTile | SoonTile;

/**
 * The tile label for a kind.
 *
 * @param kind The kind.
 * @returns The mockup's spelling where there is one, and the kind itself otherwise.
 */
export function labelOf(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/**
 * Two letters for a tile's monogram box.
 *
 * Derived from the label rather than chosen per provider — the mockup's `AN`, `CU`, `GH`,
 * `VL`, `OL` are AE.2's ([#228](https://github.com/NobuData/ouroboros/issues/228)) to draw
 * with their tints; a tile in a picker needs only to be tellable from its neighbours.
 *
 * @param label The tile's label.
 * @returns Its first two letters or digits, upper-cased; `?` for a label with none.
 */
export function monogramOf(label: string): string {
  const letters = label.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();

  return letters.length === 0 ? "?" : letters;
}

/** What a tile says a form with no fields would ask for. Unreachable in the dialect; total anyway. */
export const NEEDS_NOTHING = "Nothing to fill in";

/**
 * What a form will ask for, in a line — *Base URL · API key (optional)*.
 *
 * @param fields The entry's fields.
 * @returns The labels joined, each optional one saying so.
 */
export function needsOf(fields: readonly ProviderFormField[]): string {
  if (fields.length === 0) return NEEDS_NOTHING;

  return fields
    .map((field) => (field.required ? field.label : `${field.label} (optional)`))
    .join(" · ");
}

/**
 * The tiles to draw: one per live entry, in the service's order, then one per announcement
 * whose kind is not among them.
 *
 * @param entries What the catalog answered.
 * @param announcements What is promised. Defaults to {@link COMING_SOON}; a parameter so the
 *   retirement rule can be tested without editing the product's list.
 * @returns The tiles.
 */
export function catalogTiles(
  entries: readonly ProviderCatalogEntry[],
  announcements: readonly Announcement[] = COMING_SOON,
): CatalogTile[] {
  const live = new Set<string>(entries.map((entry) => entry.kind));

  return [
    ...entries.map((entry): LiveTile => {
      const label = labelOf(entry.kind);

      return {
        live: true,
        kind: entry.kind,
        label,
        monogram: monogramOf(label),
        needs: needsOf(entry.fields),
        entry,
      };
    }),
    ...announcements
      .filter((announcement) => !live.has(announcement.kind))
      .map(
        (announcement): SoonTile => ({
          live: false,
          kind: announcement.kind,
          label: announcement.label,
          monogram: monogramOf(announcement.label),
          source: announcement.source,
        }),
      ),
  ];
}

/* ------------------------------------------------------------------------------- the form */

/**
 * The field whose value is the connection's address, wherever an adapter declares one.
 *
 * The one reserved name this module knows, and it is the contract's rather than any
 * adapter's: `openapi.yaml` § `ProviderConnectionConfig` reserves `baseUrl` across every kind
 * so a consumer can find the address without knowing which vendor it is looking at. It is
 * read here for one purpose — the duplicate warning compares endpoints — and written nowhere.
 */
export const BASE_URL_FIELD = "baseUrl";

/** The form's own field for the card's heading — not the adapter's, so not in `config`. */
export const NAME_FIELD = "displayName";

/** The contract's ceiling on a heading. */
export const NAME_MAX_LENGTH = 120;

/**
 * The settings to send, from what the form holds.
 *
 * @param fields The entry's fields — which is what says which names to read.
 * @param valueOf What the form holds for a name; `""` for a control left empty.
 * @returns `config`: every value trimmed, and **an empty optional field omitted** rather than
 *   sent as `""`. A required one is kept even when empty — the browser's own `required` stops
 *   that submission first, and if it did not, the service's field error is the honest answer.
 */
export function configOf(
  fields: readonly ProviderFormField[],
  valueOf: (name: string) => string,
): Record<string, string> {
  const config: Record<string, string> = {};

  for (const field of fields) {
    const value = valueOf(field.name).trim();

    if (value.length > 0 || field.required) config[field.name] = value;
  }

  return config;
}

/* ------------------------------------------------------------------------ the duplicate */

/** What the duplicate warning needs to know about a connection that already exists. */
export type ExistingConnection = Pick<
  ProviderConnection,
  "id" | "kind" | "displayName" | "baseUrl"
>;

/**
 * An endpoint, in the form two spellings of the same one agree on.
 *
 * A warning rather than a gate, so this errs towards *the same*: the scheme and host are
 * folded to lower case and trailing slashes dropped, which is what turns
 * `http://Ken-Station.local:11434/` and `http://ken-station.local:11434` into one address. A
 * value that is not a URL at all is compared as typed, trimmed.
 *
 * @param baseUrl The address, or `null` for a provider reached at its fixed endpoint.
 * @returns The key. `""` for `null`, so two fixed-endpoint connections of one kind compare
 *   equal — which they are.
 */
export function endpointKey(baseUrl: string | null): string {
  if (baseUrl === null) return "";

  const trimmed = baseUrl.trim();

  try {
    const url = new URL(trimmed);

    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

/**
 * The key a submission is warned under: its kind and its endpoint.
 *
 * What the dialog remembers once a reader has seen the warning, so a second press of the
 * same form proceeds and a press after the address was changed is judged afresh.
 *
 * @param kind The kind being connected.
 * @param baseUrl The address the form holds, or `null`.
 * @returns The key.
 */
export function duplicateKey(kind: string, baseUrl: string | null): string {
  return `${kind} ${endpointKey(baseUrl)}`;
}

/**
 * A connection this one would duplicate, if there is one.
 *
 * *Same kind and same endpoint* — the ticket's rule. It is legal, and two Ollama daemons on
 * two machines are two connections; but the same daemon twice is usually a mistake, and the
 * moment to say so is before the provider is asked.
 *
 * @param existing What the workspace has.
 * @param kind The kind being connected.
 * @param baseUrl The address the form holds, or `null` for a kind that takes none.
 * @returns The first match, or `null`.
 */
export function duplicateOf(
  existing: readonly ExistingConnection[],
  kind: string,
  baseUrl: string | null,
): ExistingConnection | null {
  const key = duplicateKey(kind, baseUrl);

  return (
    existing.find((connection) => duplicateKey(connection.kind, connection.baseUrl) === key) ??
    null
  );
}

/**
 * What the warning says.
 *
 * @param connection The connection this one would duplicate.
 * @returns The sentence.
 */
export function duplicateWarning(connection: ExistingConnection): string {
  const where =
    connection.baseUrl === null ? `as ${labelOf(connection.kind)}` : `at ${connection.baseUrl}`;

  return (
    `"${connection.displayName}" is already connected ${where}. ` +
    "Connecting it a second time is allowed, but it is usually a mistake."
  );
}

/* ------------------------------------------------------------------------- the refusal */

/** A refusal, as the service's envelope says it and a Server Action can carry it. */
export interface ApiRefusal {
  /** The contract's stable code — what is branched on. */
  readonly code: string;
  /** The service's sentence, written for an API caller. */
  readonly message: string;
  /** Whatever the code carries — field messages, the provider's own detail. */
  readonly details: Readonly<Record<string, unknown>>;
}

/** What the dialog draws for a refused add: one sentence, and the fields it is about. */
export interface AddFailure {
  /** The sentence under the form. */
  readonly message: string;
  /** What is wrong with which fields, keyed by name — the form's own field included. */
  readonly fields: Readonly<Record<string, readonly string[]>>;
}

/** The `code` for a body that does not satisfy the adapter's schema. */
export const CONFIG_INVALID_CODE = "provider_config_invalid";

/** The `code` for a provider that refused the configuration or the credential. */
export const PROVIDER_REFUSED_CODE = "provider_validation_failed";

/** The `code` for a body whose own shape is wrong. */
export const VALIDATION_FAILED_CODE = "validation_failed";

/** The `code` for a role that may not connect a provider. */
export const FORBIDDEN_CODE = "forbidden";

/** The `code` for a kind this build has no adapter for — a catalog gone stale under a reader. */
export const KIND_UNSUPPORTED_CODE = "provider_kind_unsupported";

/** The `code` for a setting this build has no column for. */
export const NOT_STORABLE_CODE = "provider_config_not_storable";

/** The clause every refusal ends on, because it is the fact a reader most needs. */
export const NOTHING_STORED = "Nothing was stored.";

/**
 * What a refused add says when the provider itself refused it.
 *
 * @param detail The adapter's own phrase — *key rejected (401)*.
 * @returns The sentence.
 */
export function providerRefused(detail: string): string {
  return `The provider refused it — ${detail}. ${NOTHING_STORED}`;
}

/** What the provider's refusal reads as when the adapter sent no phrase at all. */
export const REFUSED_WITHOUT_DETAIL = "it did not accept the connection";

/** What a refused add says when the settings do not satisfy the adapter's schema. */
export const CONFIG_INVALID = `Some settings do not satisfy the provider's schema — see below. ${NOTHING_STORED}`;

/** What a refused add says when the body's own shape was wrong. */
export const VALIDATION_FAILED = `Some fields need attention — see below. ${NOTHING_STORED}`;

/** What every opener says to a role that may not connect a provider, and what a refused add says. */
export const ADD_PROVIDER_READ_ONLY = "Connecting a provider is for workspace owners and admins.";

/** What a refused add says when the catalog offered a kind the build no longer has. */
export const KIND_UNSUPPORTED = `This build has no adapter for that kind any more — reopen the catalog. ${NOTHING_STORED}`;

/** What a field the build cannot store says. */
export const NOT_STORABLE = "This build cannot store this setting. Leave it empty.";

/** What a refused add says when nothing more specific can be. */
export const ADD_FAILURE = `The provider could not be connected. ${NOTHING_STORED} Try again in a moment.`;

/**
 * The provider's error classes, and which widget each one is about.
 *
 * The service's `details.errorClass` names a class rather than a field — the adapter does not
 * know what the form called its key row. The form does: the credential is the `secret` widget
 * and the address is the `url` one, so an `auth` refusal is drawn under the key and a
 * `network` one under the address, with no provider named on either side.
 */
const CLASS_WIDGET: Readonly<Partial<Record<string, ProviderFormField["widget"]>>> = {
  auth: "secret",
  network: "url",
  upstream: "url",
  server: "url",
};

/**
 * A list of sentences, read defensively from a `details` value.
 *
 * @param value Whatever the envelope carried under a key.
 * @returns The strings in it, or none — never a throw, because this runs while explaining a
 *   failure and a second failure there would replace the one that matters.
 */
function sentences(value: unknown): readonly string[] {
  if (typeof value === "string") return value.length === 0 ? [] : [value];
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/**
 * A map of field names to sentences, read defensively.
 *
 * @param value Whatever the envelope carried under `details.fields` or as `details` itself.
 * @returns The map, with every value a list of strings and every empty list dropped.
 */
function fieldSentences(value: unknown): Record<string, readonly string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const fields: Record<string, readonly string[]> = {};

  for (const [name, messages] of Object.entries(value)) {
    const list = sentences(messages);

    if (list.length > 0) fields[name] = list;
  }

  return fields;
}

/**
 * What a refused add says, and which fields it is about.
 *
 * @param refusal What the service answered.
 * @param fields The entry's fields, which is how an error class finds its row.
 * @returns The sentence and the highlighted fields. Always something to say: an unrecognised
 *   code answers with the service's own message when it has one and {@link ADD_FAILURE}
 *   otherwise, because a dialog that stayed silent after a refusal would look like a dialog
 *   that hung.
 */
export function addFailure(refusal: ApiRefusal, fields: readonly ProviderFormField[]): AddFailure {
  const { code, details } = refusal;

  if (code === PROVIDER_REFUSED_CODE) {
    const detail =
      typeof details.detail === "string" && details.detail.length > 0
        ? details.detail
        : REFUSED_WITHOUT_DETAIL;
    const widget =
      typeof details.errorClass === "string" ? CLASS_WIDGET[details.errorClass] : undefined;
    const target =
      widget === undefined ? undefined : fields.find((field) => field.widget === widget);

    return {
      message: providerRefused(detail),
      fields: target === undefined ? {} : { [target.name]: [detail] },
    };
  }

  if (code === CONFIG_INVALID_CODE) {
    return { message: CONFIG_INVALID, fields: fieldSentences(details.fields) };
  }

  if (code === VALIDATION_FAILED_CODE) {
    return { message: VALIDATION_FAILED, fields: fieldSentences(details) };
  }

  if (code === FORBIDDEN_CODE) {
    return { message: ADD_PROVIDER_READ_ONLY, fields: {} };
  }

  if (code === KIND_UNSUPPORTED_CODE) {
    return { message: KIND_UNSUPPORTED, fields: {} };
  }

  if (code === NOT_STORABLE_CODE) {
    return {
      message: `${refusal.message} ${NOTHING_STORED}`,
      fields: Object.fromEntries(sentences(details.fields).map((name) => [name, [NOT_STORABLE]])),
    };
  }

  return { message: refusal.message.length === 0 ? ADD_FAILURE : refusal.message, fields: {} };
}

/* ---------------------------------------------------------------------------- what to say */

/** The dialog's accessible name, and its heading on the catalog step. */
export const ADD_DIALOG_TITLE = "Add a provider";

/** The catalog step's subline. */
export const ADD_DIALOG_NOTE =
  "Pick a kind. The form that follows is the adapter's own, and the provider is asked " +
  "whether the details work before anything is stored.";

/** The dashed card's line — mockup 07's promise, made honest about what is live today. */
export const ADD_CARD_NOTE =
  "Connect Anthropic, Ollama, GitHub Copilot, Cursor, or any OpenAI-compatible endpoint. " +
  "OpenAI, Google and Bedrock are on their way.";

/** The dashed card's action. */
export const BROWSE_CATALOG_LABEL = "Browse catalog";

/** What the dialog says while the catalog is on its way. */
export const CATALOG_LOADING = "Reading the catalog…";

/** What the dialog says when the catalog could not be read. */
export const CATALOG_UNAVAILABLE =
  "The catalog could not be read just now. Nothing was changed — try again in a moment.";

/** What the dialog says for a build that registers no adapter at all. */
export const CATALOG_EMPTY = "This build has no provider adapters to offer.";

/** The accessible name of the tile list. */
export const CATALOG_LIST_LABEL = "Provider kinds";

/** The form step's way back. */
export const BACK_TO_CATALOG = "Back to catalog";

/** The heading's label — the card's own heading, which the adapter's schema does not declare. */
export const NAME_LABEL = "Name";

/** …and its hint. */
export const NAME_HINT = "How this connection is listed. Two hosts on two machines are two names.";

/** The submit control. */
export const CONNECT = "Connect";

/** The submit control once a duplicate has been pointed out. */
export const CONNECT_ANYWAY = "Connect anyway";

/** Why the submit control cannot act while the provider is being asked, and the status line. */
export const CONNECTING = "Asking the provider…";

/** The dialog's way out without writing. */
export const CANCEL = "Cancel";

/** The done step's heading. */
export const ADDED_TITLE = "Connected";

/**
 * The done step's line.
 *
 * Honest about what the reader will see next: the card grid is AE.2's
 * ([#228](https://github.com/NobuData/ouroboros/issues/228)) and is not on the page yet, so a
 * dialog that simply closed would leave somebody looking at an empty state wondering whether
 * anything happened. The trail already records it, and says so.
 *
 * @param displayName The heading the connection was given.
 * @returns The sentence.
 */
export function addedNote(displayName: string): string {
  return (
    `"${displayName}" is connected and switched on. Its card arrives with #228; ` +
    "until then the Audit log above records it."
  );
}

/** The done step's control. */
export const DONE = "Done";
