/**
 * Every decision the **+ New alias** dialog makes, and every sentence it says
 * (CI.4, [#594](https://github.com/NobuData/ouroboros/issues/594)).
 *
 * **Framework-free and pure**, like `app/registry/table.ts` and `app/registry/view.ts` beside
 * it: nothing here imports React, `next/*` or the server-only client. The dialog is
 * `app/registry/new-alias.tsx`, its server hops are `app/registry/create-actions.ts`, and its
 * parameter section is `app/registry/params.ts`.
 *
 * ---------------------------------------------------------------------------
 * ### The dialog exists to make one state reachable
 *
 * *Creating an alias before the key exists is a real workflow.* Somebody plans to use
 * `gpt-5.2-preview`, wants the name reserved and visible, and does not have the key yet —
 * mockup 21's `gpt5-experiments` row is that person's row, and the schema has always allowed
 * it (decision **R2**). A create dialog that demanded a provider would make a state the
 * database supports unreachable through the product, which is the particular kind of bug
 * nobody files: the feature is there and no one can get to it.
 *
 * So the dialog has a **mode**, and the mode is not a fork in the client — CH.1's
 * `POST /registry/aliases` takes both shapes in one body, with the connection absent for the
 * second ({@link createBody}). What the toggle changes is which fields are asked for, and what
 * the dialog promises about the row that appears.
 *
 * ### The uniqueness check is live, and it is not the authority
 *
 * A name already taken is a designed `422` (`model_alias_name_taken`) and there is no
 * *is-this-free* endpoint — nor should there be, because an answer to that question is stale
 * the moment it is given. What {@link nameProblem} does instead is check the name against the
 * table the reader is already looking at, as they type, so the ordinary collision is caught
 * before a round trip; the service is what decides, and {@link createFailure} puts its refusal
 * back on the same field. Both routes end with a sentence under the name box, which is the
 * property that matters — a reader never learns about a taken name from somewhere else.
 *
 * ### Nothing is created until the whole body is acceptable
 *
 * One `POST`, one alias: there is no partial state to report and no cleanup to describe.
 * A refusal leaves the dialog open with every value where the reader left it, the offending
 * field marked, and nothing stored — which is what the sentence under the form says out loud.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { PROVIDERS_PATH } from "@/app/paths";

/* ------------------------------------------------------------------ the two modes */

/**
 * Which of the two paths a name enters the registry by.
 *
 * A union of two literals rather than a boolean, because `bound: false` reads as *a failure to
 * bind* and this is a choice somebody made: the second mode is the point of the ticket.
 */
export type CreateMode =
  /** Bind it now: a connection, a model from that connection, and the model's parameters. */
  | "now"
  /** Bind it later: a model id, and a name held open until a provider is connected. */
  | "later";

/** The mode a dialog opens on — the ordinary case, and the one the mockup's table is full of. */
export const DEFAULT_MODE: CreateMode = "now";

/* ------------------------------------------------------------------ the name */

/**
 * How a name may be spelled — `ouroboros-rest`'s `ALIAS_NAME_PATTERN`, restated.
 *
 * Lower-case kebab, which V015 argues is a **correctness** rule rather than a style one:
 * uniqueness is enforced on the stored text, so admitting `Coder-Max` beside `coder-max` would
 * give one name two resolutions. Restating it here is what makes the refusal immediate; the
 * column's `CHECK` is what makes it true.
 */
export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** V015's ceiling on a name, restated for the input's `maxLength`. */
export const MAX_NAME_LENGTH = 64;

/** The contract's ceiling on a model id, restated for the input's `maxLength`. */
export const MAX_MODEL_ID_LENGTH = 200;

/** What is wrong with the name in the box, or that nothing is. */
export type NameProblem =
  /** Nothing has been typed yet. Not an error to shout about — the submit is simply not ready. */
  | "empty"
  /** Typed, and not lower-case kebab. */
  | "shape"
  /** Typed, well-formed, and already the name of an alias in this workspace. */
  | "taken"
  /** Typed, well-formed, and free as far as this page can see. */
  | null;

/**
 * What is wrong with a name, as the reader types it.
 *
 * The order is the judgement: shape before uniqueness, because *"that is not a valid name"*
 * and *"that name is taken"* are different problems and a malformed name is not taken by
 * anybody. Comparison is exact rather than case-insensitive — the pattern has already refused
 * everything a fold would have caught, so a case-insensitive compare here could only ever
 * refuse a name the service would accept.
 *
 * @param name What is in the box, trimmed by the caller or not — this trims.
 * @param existing Every alias name this workspace has, as the table read them.
 * @returns The problem, or `null` when there is none.
 */
export function nameProblem(name: string, existing: readonly string[]): NameProblem {
  const trimmed = name.trim();

  if (trimmed === "") return "empty";
  if (!NAME_PATTERN.test(trimmed) || trimmed.length > MAX_NAME_LENGTH) return "shape";

  return existing.includes(trimmed) ? "taken" : null;
}

/**
 * The sentence under the name box for a problem, or nothing for the two states that are not
 * worth a line.
 *
 * `empty` says nothing deliberately: a dialog that opened already telling the reader off for
 * not having typed anything is a dialog that shouts first and asks second. The submit is inert
 * with its own reason instead.
 *
 * @param problem What {@link nameProblem} found.
 * @returns The sentence, or `undefined` when there is none to draw.
 */
export function nameError(problem: NameProblem): string | undefined {
  if (problem === "shape") return NAME_SHAPE;
  if (problem === "taken") return NAME_TAKEN;

  return undefined;
}

/** What a name that is not lower-case kebab is told — the service's own message, restated. */
export const NAME_SHAPE =
  "Use lower-case letters, digits and single hyphens, like coder-max.";

/** What a name this workspace already has is told. */
export const NAME_TAKEN =
  "This workspace already has an alias by that name. Aliases are unique per workspace.";

/* ------------------------------------------------------------------ what gets sent */

/** What the dialog holds when the reader presses **Create alias**. */
export interface CreateDraft {
  /** The name, as typed. Trimmed on the way out. */
  readonly alias: string;
  /** Which mode the toggle is on. */
  readonly mode: CreateMode;
  /** The chosen connection, or `null` — always `null` in the *bind later* mode. */
  readonly connectionId: string | null;
  /** The model id: chosen from the live list, or typed. Trimmed on the way out. */
  readonly modelId: string;
  /** The parameters the form produced — `{}` for a form nobody touched. */
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

/**
 * The body CH.1 is sent — one shape for both modes.
 *
 * **`connectionId` is omitted rather than sent as `null` in the *bind later* mode.** The
 * contract accepts either, and omitting it is what makes the request say *this alias has no
 * provider* rather than *set this alias's provider to nothing*; the two are the same write and
 * only one of them reads as a decision.
 *
 * **Parameters go only with a binding.** Every param is refused for an unbound alias, because
 * nothing knows what the model supports — so a mode switch that left a filled-in `thinking`
 * behind would turn a change of mind into a `422`. The draft's params are dropped rather than
 * carried.
 *
 * `enabled` is never sent: the contract's default is on for a bound alias and forced off for
 * an unbound one, which is exactly the behaviour the two modes promise, and a client that
 * restated it would be a second place for the rule to drift.
 *
 * @param draft What the dialog holds.
 * @returns The body to POST.
 */
export function createBody(draft: CreateDraft): {
  alias: string;
  modelId: string;
  connectionId?: string;
  params?: Record<string, string | number | boolean>;
} {
  const alias = draft.alias.trim();
  const modelId = draft.modelId.trim();

  if (draft.mode === "later" || draft.connectionId === null) return { alias, modelId };

  const params = { ...draft.params };

  return Object.keys(params).length === 0
    ? { alias, modelId, connectionId: draft.connectionId }
    : { alias, modelId, connectionId: draft.connectionId, params };
}

/**
 * Why **Create alias** cannot be pressed yet, or `undefined` when it can.
 *
 * Every reason is about something the reader can fix in the dialog, and they are checked in
 * the order the form is filled in, so the control never points past a blank field at a later
 * one.
 *
 * @param draft What the dialog holds.
 * @param problem What {@link nameProblem} makes of the name.
 * @returns The sentence, or `undefined` when the form is ready.
 */
export function submitReason(draft: CreateDraft, problem: NameProblem): string | undefined {
  if (problem !== null) return NEEDS_NAME;
  if (draft.mode === "now" && draft.connectionId === null) return NEEDS_PROVIDER;
  if (draft.modelId.trim() === "") return NEEDS_MODEL;

  return undefined;
}

/** Why the submit is inert while the name is missing or wrong. */
export const NEEDS_NAME = "Give the alias a name first — it has to be free and lower-case kebab.";

/** Why the submit is inert while *bind now* has no connection chosen. */
export const NEEDS_PROVIDER = "Choose the provider this alias resolves through.";

/** Why the submit is inert while there is no model. */
export const NEEDS_MODEL = "Name the model this alias resolves to.";

/* ------------------------------------------------------------------ what a refusal says */

/** What the dialog draws for a refused create: one sentence, and the fields it is about. */
export interface CreateFailure {
  /** The sentence under the form. */
  readonly message: string;
  /** What is wrong with the name box, if the refusal was about it. */
  readonly alias?: string;
  /** What is wrong with the provider select, if it was about that. */
  readonly connectionId?: string;
  /** What is wrong with the model field, if it was about that. */
  readonly modelId?: string;
  /** What is wrong with which parameter controls, keyed by the field's `name`. */
  readonly params: Readonly<Record<string, readonly string[]>>;
}

/** The `code` for a name this workspace already has. */
export const NAME_TAKEN_CODE = "model_alias_name_taken";

/** The `code` for a param or restriction the bound model cannot honour. */
export const PARAMS_INVALID_CODE = "model_alias_params_invalid";

/** The `code` for a body whose own shape is wrong. */
export const VALIDATION_FAILED_CODE = "validation_failed";

/** The `code` for a role that may read the registry and not write to it. */
export const FORBIDDEN_CODE = "forbidden";

/** The `code` for a connection this workspace does not have — a list gone stale under a reader. */
export const CONNECTION_GONE_CODE = "provider_connection_not_found";

/** The clause every refusal ends on, because it is the fact a reader most needs. */
export const NOTHING_CREATED = "Nothing was created.";

/** What a refused create says when the body's own shape was wrong. */
export const CREATE_INVALID = `That could not be saved as it stands. ${NOTHING_CREATED}`;

/** What a refused create says when a parameter the model cannot honour was sent. */
export const CREATE_PARAMS_INVALID =
  `This model does not accept one of those parameters. ${NOTHING_CREATED}`;

/** What a member who reached the write anyway is told. */
export const CREATE_READ_ONLY =
  `Creating an alias is for workspace owners and admins. ${NOTHING_CREATED}`;

/** What a create against a connection that has since gone is told. */
export const CONNECTION_GONE =
  `That provider connection is no longer in this workspace. ${NOTHING_CREATED}`;

/** What a refusal this module has no sentence for is told, with the service's own beside it. */
export const CREATE_FAILED = `The alias could not be created. ${NOTHING_CREATED}`;

/**
 * The service's refusal, as the dialog draws it.
 *
 * Each code is mapped to a sentence *and* to the field it is about, because the two together
 * are what makes a refusal actionable: a line under the form says what happened, and a line
 * under the box says where. A code with no field — a role refusal, a vanished connection —
 * gets the sentence alone, which is honest: there is nothing in the form to correct.
 *
 * @param refusal The service's envelope, as `create-actions.ts` handed it back — the
 *   contract's own `{code, message, details}` (`app/api/errors.ts`), rather than a shape this
 *   page invented for it.
 * @param paramErrors The parameter messages this refusal carried, already keyed by field name
 *   — `app/registry/params.ts`'s `paramFieldErrors`, passed in rather than computed here so
 *   this module stays free of the schema's shape.
 * @returns What to draw.
 */
export function createFailure(
  refusal: ErrorEnvelope,
  paramErrors: Readonly<Record<string, readonly string[]>> = {},
): CreateFailure {
  const { code, details } = refusal;

  if (code === NAME_TAKEN_CODE) {
    return { message: `${NAME_TAKEN} ${NOTHING_CREATED}`, alias: NAME_TAKEN, params: {} };
  }

  if (code === PARAMS_INVALID_CODE) {
    return { message: CREATE_PARAMS_INVALID, params: paramErrors };
  }

  if (code === VALIDATION_FAILED_CODE) {
    return {
      message: CREATE_INVALID,
      alias: fieldSentence(details.alias),
      connectionId: fieldSentence(details.connectionId),
      modelId: fieldSentence(details.modelId),
      params: paramErrors,
    };
  }

  if (code === FORBIDDEN_CODE) return { message: CREATE_READ_ONLY, params: {} };

  if (code === CONNECTION_GONE_CODE) {
    return { message: CONNECTION_GONE, connectionId: CONNECTION_GONE, params: {} };
  }

  // An unrecognised code still carries the service's own sentence, which is written for a
  // caller rather than for a reader — so it goes *after* the product's line rather than
  // instead of it, and the reader is told what state the workspace is in either way.
  return { message: `${CREATE_FAILED} ${refusal.message}`, params: {} };
}

/**
 * One field's messages from a `validation_failed`, as the one line the field draws.
 *
 * @param value Whatever `details` carried under that field's key.
 * @returns The sentence, or `undefined` when the refusal said nothing about this field —
 *   which is what keeps `aria-invalid` off a box that is fine.
 */
function fieldSentence(value: unknown): string | undefined {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    const sentences = value.filter((entry): entry is string => typeof entry === "string");

    return sentences.length === 0 ? undefined : sentences.join(" ");
  }

  return undefined;
}

/* ------------------------------------------------------------------ what the dialog says */

/** The dialog's heading, and its accessible name. */
export const CREATE_TITLE = "New alias";

/**
 * The note under the heading — what an alias *is*, in the one place somebody is about to make
 * one.
 *
 * The page's subline makes the same argument at length; this is the short form, because a
 * reader who has already pressed the button does not need to be sold the idea again.
 */
export const CREATE_NOTE =
  "A name routes and workflows point at. Bind it to a provider's model now, or reserve the " +
  "name and bind it when the key arrives.";

/** The name field's label — the mockup's inspector calls the same field this. */
export const NAME_LABEL = "Alias";

/** …and its hint, the mockup's own, verbatim. */
export const NAME_HINT = "unique · referenced by routes, workflows, and /ouro commands";

/**
 * The mode toggle's legend.
 *
 * *Provider binding* rather than *Provider*: the select below it is already called **Provider**,
 * and two controls on one form with the same name is a form a screen reader reads as one
 * question asked twice.
 */
export const MODE_LEGEND = "Provider binding";

/** The *bind now* choice. */
export const MODE_NOW_LABEL = "Bind now";

/** …and what it means, in the one line beside it. */
export const MODE_NOW_HINT = "Choose a connected provider and one of its models.";

/** The *bind later* choice. */
export const MODE_LATER_LABEL = "Bind later";

/** …and what it means. */
export const MODE_LATER_HINT = "Reserve the name now; no provider yet.";

/** The provider select's label. */
export const PROVIDER_LABEL = "Provider";

/** …and its hint, the mockup's own, which points at where connections come from. */
export const PROVIDER_HINT = "from Providers & keys";

/** The blank option a provider select opens on, so nothing is chosen by accident. */
export const PROVIDER_PLACEHOLDER = "Choose a provider…";

/** What the provider select says when this workspace has connected nothing. */
export const NO_PROVIDERS_YET =
  "No provider is connected yet, so there is nothing to bind to. Reserve the name with " +
  "Bind later, or connect a provider first.";

/** The model select's label. */
export const MODEL_LABEL = "Model";

/** …and its hint, the mockup's own, verbatim. */
export const MODEL_HINT = "listed live from the provider";

/** The blank option the model select opens on. */
export const MODEL_PLACEHOLDER = "Choose a model…";

/**
 * What the model field says when discovery has reported nothing on the chosen connection.
 *
 * An empty select is not a failure — the contract is explicit that an alias may still be
 * created by typing the model, and the create answers with a `model_not_discovered` warning
 * rather than a refusal. So the select is replaced by a box, and this says why it is a box.
 */
export const MODEL_NOT_DISCOVERED =
  "Nothing has been discovered on this connection yet — type the model id as the provider " +
  "spells it, or test the connection in Providers & keys first.";

/** The model field's label in the *bind later* mode, where there is no provider to list from. */
export const MODEL_ID_LABEL = "Model id";

/** …and its hint: the vendor's spelling, unfolded, because that is what the column stores. */
export const MODEL_ID_HINT = "as the provider spells it — gpt-5.2-preview, qwen3-coder:32b";

/**
 * The *bind later* notice — the ticket's own sentence, and the honest half of the promise.
 *
 * The row this creates is mockup 21's orphan: dimmed, switch off, `✗ no key — connect a
 * provider`. Saying so *before* the create is what makes that row read as a state somebody
 * chose rather than as something that went wrong.
 */
export const UNBOUND_NOTICE =
  "This alias will stay disabled until a provider is connected — it will appear in the table " +
  "with no provider and no key.";

/** The link out of the unbound notice, to the page that fixes the state it describes. */
export const UNBOUND_LINK = "Providers & keys →";

/** Where that link goes. Spelled from `app/paths.ts`, never typed out. */
export const UNBOUND_HREF = PROVIDERS_PATH;

/** The parameter section's heading, when the chosen model has parameters. */
export const PARAMS_TITLE = "Parameters";

/** What the parameter section says while its schema is on its way. */
export const PARAMS_LOADING = "Reading what this model can be tuned with…";

/** What it says when that read was refused — a form that cannot be drawn, not a create that failed. */
export const PARAMS_UNREADABLE =
  "The model's parameters could not be read just now. The alias can still be created without " +
  "them, and they can be set afterwards.";

/** What the model select says while the connection's models are on their way. */
export const MODELS_LOADING = "Listing this provider's models…";

/** What it says when that read was refused. */
export const MODELS_UNREADABLE =
  "This provider's models could not be listed just now — type the model id instead.";

/** The dialog's primary control. */
export const CREATE_SUBMIT = "Create alias";

/** …and what it says while the write is in flight. */
export const CREATING = "Creating the alias…";

/** The way out without writing anything. */
export const CREATE_CANCEL = "Cancel";
