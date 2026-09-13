/**
 * Every decision the add-source flow and the configure dialog make, as functions with inputs
 * and outputs ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * The dialogs (`app/sources/add-source.tsx`, `app/sources/configure-source.tsx`) hold state,
 * read, and draw; this module decides. Framework-free and pure, the way
 * `app/providers/catalog.ts` is, so every acceptance criterion that is a *judgement* is a unit
 * test on a small value rather than an assertion about rendered text.
 *
 * ---------------------------------------------------------------------------
 * ### The two rules this module exists to keep
 *
 * **The tiles derive from the registry.** {@link catalogTiles} takes what
 * `GET /api/v1/sources/catalog` answered and draws one tile per entry, in the service's order,
 * with nothing added — `app/catalog-tiles.ts`'s rule, shared with the add-provider dialog. A
 * kind this module has never heard of gets a tile and a form exactly as GitHub does, which is
 * what *"the provider form renders from provider-declared config schema"* means on this side.
 *
 * **The `coming soon` tiles are honest, and they are labelled v2.** The issue is explicit:
 * *"Jira / Linear / GitLab as coming-soon tiles (honest v2 labelling — the tiles must not
 * imply working integrations)"*. {@link COMING_SOON} is that promise written down once, with
 * the v2 ticket each comes from — T.2, T.3 and T.4 — and {@link catalogTiles} retires an
 * announcement the moment the registry answers its kind, so the day a provider lands its tile
 * flips from *soon* to live with no change here.
 *
 * ---------------------------------------------------------------------------
 * ### What the form sends, and what it does with a refusal
 *
 * {@link configOf} assembles `config` from the fields: a string trimmed, a `list` split one
 * entry per line by the form primitive's own rule, and an **empty optional field left out**
 * rather than sent as `""`. {@link addFailure} turns the service's refusal into the sentence
 * the dialog prints and the fields it highlights — a schema violation under the field it
 * names, a taken name under the name.
 */

import type {
  TicketSource,
  TicketSourceCatalogEntry,
  TicketSourceConfigSubmission,
  TicketSourceFormField,
} from "@/app/api/sources";
import {
  type Announcement,
  type CatalogTile as GenericTile,
  catalogTiles as genericTiles,
} from "@/app/catalog-tiles";
import { listEntries } from "@/app/ui";

import {
  type ApiRefusal,
  CONFIG_INVALID_CODE,
  FORBIDDEN_CODE,
  KIND_UNSUPPORTED_CODE,
  NAME_TAKEN_CODE,
  VALIDATION_FAILED_CODE,
} from "./refusals";
import { labelOf } from "./view";

/**
 * The codes and the two sentences both this module and the Server Actions branch on are
 * `app/sources/refusals.ts`'s; re-exported so the dialogs and their suites keep one import.
 */
export {
  type ApiRefusal,
  CATALOG_UNAVAILABLE,
  CONFIG_INVALID_CODE,
  CREDENTIALS_UNSUPPORTED,
  CREDENTIALS_UNSUPPORTED_CODE,
  FORBIDDEN_CODE,
  KIND_UNSUPPORTED_CODE,
  NAME_TAKEN_CODE,
  NOT_FOUND_CODE,
  VALIDATION_FAILED_CODE,
} from "./refusals";

/* ------------------------------------------------------------------------------ the tiles */

/** The version the promised trackers arrive in. On every announced tile, in words. */
export const V2_LABEL = "v2";

/**
 * The three trackers the issue names as coming soon, and the v2 ticket that delivers each.
 *
 * Their spellings are `ticket_sources.kind`'s own, so the retirement rule fires the moment a
 * provider registers under one. Q.2's issue names the three tickets — #156, #157, #158 — as
 * the ones it blocks.
 */
export const COMING_SOON: readonly Announcement[] = [
  { kind: "jira", label: "Jira", source: "T.2 (#156)" },
  { kind: "linear", label: "Linear", source: "T.3 (#157)" },
  { kind: "gitlab", label: "GitLab", source: "T.4 (#158)" },
];

/** One tile in the picker — live, or promised. */
export type CatalogTile = GenericTile<TicketSourceCatalogEntry>;

/**
 * The tiles to draw: one per live entry, in the service's order, then one per announcement
 * whose kind is not among them.
 *
 * @param entries What the catalog answered.
 * @param announcements What is promised. Defaults to {@link COMING_SOON}.
 * @returns The tiles.
 */
export function catalogTiles(
  entries: readonly TicketSourceCatalogEntry[],
  announcements: readonly Announcement[] = COMING_SOON,
): CatalogTile[] {
  return genericTiles(entries, labelOf, announcements);
}

/**
 * What a promised tile says under its label — *Arrives in v2 with T.2 (#156)*.
 *
 * @param source Where the kind comes from.
 * @returns The sentence.
 */
export function arrivesNote(source: string): string {
  return `Arrives in ${V2_LABEL} with ${source}`;
}

/* ------------------------------------------------------------------------------- the form */

/** The form's own field for the row's heading — not the provider's, so not in `config`. */
export const NAME_FIELD = "displayName";

/** The longest name the service stores — V030's own bound. */
export const NAME_MAX_LENGTH = 128;

/**
 * The credential's field on the configure dialog's second form — the schema's own secret
 * field's name is what a submitted value is keyed by, but the form needs one name before it
 * knows which entry it is drawing.
 */
export const SECRET_FIELD = "secret";

/**
 * Assemble a submission from the form's fields.
 *
 * @param fields The entry's fields.
 * @param valueOf What the form holds for a name.
 * @returns The settings, keyed by field name: a string trimmed, a list split one entry per
 *   line, and an untouched optional field left out.
 */
export function configOf(
  fields: readonly TicketSourceFormField[],
  valueOf: (name: string) => string,
): TicketSourceConfigSubmission {
  const config: Record<string, string | string[]> = {};

  for (const field of fields) {
    const raw = valueOf(field.name);

    if (field.widget === "list") {
      const entries = listEntries(raw);

      if (entries.length > 0 || field.required) config[field.name] = entries;

      continue;
    }

    const value = raw.trim();

    if (value.length > 0 || field.required) config[field.name] = value;
  }

  return config;
}

/**
 * The fields an *edit* draws: the entry's, minus the credential, each starting at what the
 * row holds.
 *
 * The secret is not among them because the service judges an edit against the schema
 * without it — a credential changes through its own write-only form — and a list starts at
 * its entries one per line, which is what the form primitive reads back.
 *
 * @param entry The catalog entry for the source's kind.
 * @param source The source.
 * @returns The fields, with defaults.
 */
export function storedFields(
  entry: TicketSourceCatalogEntry,
  source: Pick<TicketSource, "config">,
): TicketSourceFormField[] {
  return entry.fields
    .filter((field) => field.widget !== "secret")
    .map((field) => ({ ...field, defaultValue: defaultOf(source.config[field.name]) }));
}

/**
 * The credential field of an entry, if its provider declares one.
 *
 * @param entry The catalog entry.
 * @returns The field, or null.
 */
export function secretFieldOf(entry: TicketSourceCatalogEntry): TicketSourceFormField | null {
  return entry.fields.find((field) => field.widget === "secret") ?? null;
}

/**
 * A stored value as a control's starting value.
 *
 * @param value What the row holds.
 * @returns A string as itself, a list one entry per line, and null for anything else.
 */
function defaultOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join("\n");
  }

  return null;
}

/* ------------------------------------------------------------------------- the refusal */

/** What a refused submission turns into: the sentence, and the fields it is about. */
export interface AddFailure {
  /** The sentence under the form. */
  readonly message: string;
  /** What is wrong with which fields, keyed by name — the form's own field included. */
  readonly fields: Readonly<Record<string, readonly string[]>>;
}

/** Every refusal ends on this: nothing was written. */
export const NOTHING_STORED = "Nothing was stored.";

export const CONFIG_INVALID = `Some settings do not satisfy the provider's schema — see below. ${NOTHING_STORED}`;
export const VALIDATION_FAILED = `Some fields need attention — see below. ${NOTHING_STORED}`;
export const NAME_TAKEN = `This workspace already has a source with that name. ${NOTHING_STORED}`;
export const ADD_READ_ONLY = "Adding a ticket source is for workspace owners and admins.";
export const KIND_UNSUPPORTED = `This build has no provider for that kind any more — reopen the catalog. ${NOTHING_STORED}`;
export const ADD_FAILURE = `The source could not be added. ${NOTHING_STORED} Try again in a moment.`;

/**
 * The sentences a field-keyed detail carries, as a list.
 *
 * @param value One entry of `details` or `details.fields`.
 * @returns Its strings, empty for anything that is not one or a list of them.
 */
function sentences(value: unknown): readonly string[] {
  if (typeof value === "string") return value.length === 0 ? [] : [value];
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/**
 * A field-keyed detail, as the form's error map.
 *
 * @param value `details.fields` on a schema refusal, or `details` itself on a validation one.
 * @returns Field name to its sentences, with empty entries dropped.
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
 * Turn the service's refusal into what the dialog prints.
 *
 * @param refusal The envelope.
 * @returns The sentence and the fields it is about.
 */
export function addFailure(refusal: ApiRefusal): AddFailure {
  const { code, details } = refusal;

  if (code === CONFIG_INVALID_CODE) {
    return { message: CONFIG_INVALID, fields: fieldSentences(details.fields) };
  }

  if (code === VALIDATION_FAILED_CODE) {
    return { message: VALIDATION_FAILED, fields: fieldSentences(details) };
  }

  if (code === NAME_TAKEN_CODE) {
    return { message: NAME_TAKEN, fields: { [NAME_FIELD]: [NAME_TAKEN] } };
  }

  if (code === FORBIDDEN_CODE) return { message: ADD_READ_ONLY, fields: {} };
  if (code === KIND_UNSUPPORTED_CODE) return { message: KIND_UNSUPPORTED, fields: {} };

  return { message: refusal.message.length === 0 ? ADD_FAILURE : refusal.message, fields: {} };
}

/* ---------------------------------------------------------------------------- what to say */

export const ADD_DIALOG_TITLE = "Add a ticket source";

export const ADD_DIALOG_NOTE =
  "Pick a tracker. The form that follows is the provider's own; test the connection once " +
  "the source is added, then sync it to see its tickets.";

export const CATALOG_LOADING = "Reading the catalog…";

export const CATALOG_EMPTY = "This build has no ticket-source providers to offer.";

export const CATALOG_LIST_LABEL = "Tracker kinds";

export const BACK_TO_CATALOG = "Back to catalog";

export const NAME_LABEL = "Name";

export const NAME_HINT = "How this source is listed — GitHub · acme-robotics, say.";

export const ADD = "Add source";

export const ADDING = "Storing…";

export const CANCEL = "Cancel";

export const ADDED_TITLE = "Source added";

/**
 * What the done step says.
 *
 * @param displayName The name the source was stored under.
 * @returns The sentence.
 */
export function addedNote(displayName: string): string {
  return (
    `"${displayName}" is added and active. Test the connection from its row, then sync it — ` +
    "its tickets appear in the backlog when the first sync lands."
  );
}

export const DONE = "Done";

/* -------------------------------------------------------------------- the configure dialog */

export const CONFIGURE_DIALOG_TITLE = "Configure source";

/** Why **Configure** is inert when the catalog could not be read: there is no form to draw. */
export const CONFIGURE_NO_CATALOG =
  "The source catalog could not be read, so the provider's form cannot be drawn. Retry above.";

export const SETTINGS_HEADING = "Settings";

export const SETTINGS_NOTE =
  "The provider's own fields. Saving replaces the settings whole; the credential is unchanged.";

export const SAVE = "Save settings";

export const SAVING = "Saving…";

export const SAVED = "Settings saved.";

export const CREDENTIAL_HEADING = "Credential";

/**
 * What the credential form says over a stored credential.
 *
 * @param mask The row's `credentialMask`.
 * @returns The sentence.
 */
export function credentialNote(mask: string | null): string {
  return mask === null
    ? "No credential is stored. Store one so the provider can reach the tracker."
    : `A credential is stored (${mask}). Storing a new one replaces it; the old one is never shown.`;
}

export const STORE_CREDENTIAL = "Store credential";

export const STORING = "Storing…";

/**
 * What the credential form says after a store.
 *
 * @param mask The masked echo the service answered — `••••` and the last four characters.
 * @returns The sentence.
 */
export function credentialStored(mask: string | null): string {
  return mask === null ? "Credential stored." : `Credential stored (${mask}).`;
}

export const CLOSE = "Close";

/** What either configure form says when the request could not run. */
export const CONFIGURE_FAILED = "The change could not be made. Try again in a moment.";
