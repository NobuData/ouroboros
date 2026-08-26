/**
 * Every decision the **alias inspector** makes, and every sentence it says
 * (CI.3, [#593](https://github.com/NobuData/ouroboros/issues/593)).
 *
 * **Framework-free and pure**, like `app/registry/table.ts`, `app/registry/view.ts` and
 * `app/registry/create.ts` beside it: nothing here imports React, `next/*` or the server-only
 * client. The card is `app/registry/alias-inspector.tsx`, its server hops are
 * `app/registry/inspector-actions.ts`, and its parameter controls are
 * `app/registry/params.ts` and `app/registry/param-fields.tsx` — the same two the create
 * dialog draws, over the same schema.
 *
 * ---------------------------------------------------------------------------
 * ### Rebinding has to feel unremarkable, and that is a property of the *request*
 *
 * *Point coder-max at Bedrock tomorrow; zero workflow or route edits.* The whole
 * bring-your-own-key argument is that swapping the provider behind a name is a two-second
 * edit with no downstream consequence — so this card must not surround it with warnings, and
 * what it sends must not imply more than happened. {@link updateBody} is where that is made
 * true: the draft is diffed against the row it was prefilled from and **only the difference is
 * sent**, so changing the provider select and pressing Save is a `PATCH` carrying the binding
 * and the parameters that binding governs, and nothing else. No name that did not change, no
 * restrictions nobody touched, no model the reader never looked at — and, above all, nothing
 * about any route, rule or workflow, because none of them is this write's business.
 *
 * ### The field set is not fixed, and this module holds no list of parameters
 *
 * A thinking select belongs on `claude-fable-5` and not on `qwen3-coder:32b`. The controls are
 * CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)) and are drawn by
 * `param-fields.tsx`, which contains no parameter names either; what is here is the *frame*
 * around them — which two sections there are, what a refusal about one of their fields reads
 * as, and how a document is compared with the one it started as.
 *
 * ### Rename fails late unless it explains early
 *
 * A referenced alias cannot be renamed (decision **R5**: workflow documents hold the alias by
 * name, so a rename breaks them exactly as a delete would). Discovering that after typing a
 * new name and pressing Save is the wrong order, so the guard is said twice and both times
 * before the write: {@link renameGuardNote} is a standing line under the field for any
 * referenced alias, and {@link RENAME_BLOCKED} replaces it the moment the box holds a
 * different name. {@link saveReason} then keeps the button inert, so nothing is sent that
 * could only come back refused.
 *
 * ### Remove has a designed blocked state rather than an error
 *
 * The mono why-line — `blocked — 4 routes reference this alias` — is not a toast that appears
 * after a press. It is a permanent, explanatory state of the button ({@link removeWhy}), drawn
 * from the references the row already carries, and it names a **count from real references**
 * rather than a fixed sentence. The service's `409` is what decides, and
 * {@link removeFailure} is what a stale card is told.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import type { ModelAliasReference, UpdateModelAlias } from "@/app/api/registry";
import { MODELS_PATH, PROVIDERS_PATH, ROUTING_MATRIX_HASH, ROUTING_RULES_HASH } from "@/app/paths";

import { type NameProblem, NOTHING_CREATED } from "./create";
import { documentsEqual } from "./params";
import type { ImportSource } from "./view";
import { usedByCell } from "./table";

/* ------------------------------------------------------------------ what the card holds */

/** A `params` or `restrictions` document, as a form produces one. */
export type ParamsDocument = Readonly<Record<string, string | number | boolean>>;

/**
 * What the inspector holds for one alias — and, prefilled from the row, what it is diffed
 * against.
 *
 * **One type for both sides of the comparison**, deliberately: *what the reader has* and *what
 * the service has* are the same five facts, and a shape that described them differently would
 * be a shape in which a field could be compared with the wrong thing. The two documents are
 * already **documents** rather than control values, so both sides have been through
 * `paramsDocument` and a stored value the current schema cannot represent is absent from each
 * — which is what keeps it from reading as a change nobody made.
 */
export interface InspectorDraft {
  /** The name, as typed. Trimmed on the way out. */
  readonly alias: string;
  /** The connection it resolves through, or `null` for an unbound alias. */
  readonly connectionId: string | null;
  /** The model id — chosen from the live list, or typed. Trimmed on the way out. */
  readonly modelId: string;
  /** The per-call parameters. */
  readonly params: ParamsDocument;
  /** The registry's own policy flags. */
  readonly restrictions: ParamsDocument;
}

/**
 * The difference between a draft and the row it was prefilled from — the body a save sends.
 *
 * **Only the fields present are written** (CH.1), so an empty object is a save that would
 * change nothing, which is what {@link isDirty} asks and what keeps **Save alias** inert until
 * there is something to write. A `connectionId` of `null` is a real value and is sent as one:
 * the contract reads it as *unbind*, which is a different request from *say nothing about the
 * binding*.
 *
 * The two documents are **whole**: the contract replaces the stored `params` with what is sent,
 * so what a save carries is exactly the fields the reader could see. A key the current schema
 * does not publish is therefore dropped by a save that touches the parameters at all — which is
 * the right answer, because a parameter with no control is one the bound model cannot honour
 * and the service would refuse on the next write anyway.
 *
 * @param draft What the card holds.
 * @param stored The same five facts as the row has them.
 * @returns The `PATCH` body — possibly empty.
 */
export function updateBody(draft: InspectorDraft, stored: InspectorDraft): UpdateModelAlias {
  const body: UpdateModelAlias = {};
  const alias = draft.alias.trim();
  const modelId = draft.modelId.trim();

  if (alias !== stored.alias) body.alias = alias;
  if (draft.connectionId !== stored.connectionId) body.connectionId = draft.connectionId;
  if (modelId !== stored.modelId) body.modelId = modelId;

  // **A rebind rewrites the parameters, whether or not a control moved.** They are parameters
  // *of the model*, and the field set is replaced whenever the model is: switching to a model
  // with no thinking select must send a document with no `thinking` in it, or the service
  // re-validates the stored one against the new model and refuses a save the reader had every
  // reason to think was a rebind. Restrictions are not swept along, because a restriction is
  // this workspace's policy about the alias rather than a capability of the thing behind it.
  const rebound = body.connectionId !== undefined || body.modelId !== undefined;

  if (rebound || !documentsEqual(draft.params, stored.params)) body.params = { ...draft.params };

  if (!documentsEqual(draft.restrictions, stored.restrictions)) {
    body.restrictions = { ...draft.restrictions };
  }

  return body;
}

/**
 * Whether there is anything to save.
 *
 * Asked of the **body** rather than of the fields, so the two can never disagree: a control
 * typed into and typed back out of produces no field, and a save offered for it would write a
 * revision that changed nothing.
 *
 * @param draft What the card holds.
 * @param stored The same five facts as the row has them.
 * @returns Whether a save would write anything.
 */
export function isDirty(draft: InspectorDraft, stored: InspectorDraft): boolean {
  return Object.keys(updateBody(draft, stored)).length > 0;
}

/* ------------------------------------------------------------------ the name, and its guard */

/**
 * Every alias name in the workspace **except this one**.
 *
 * The live uniqueness check is `create.ts`'s `nameProblem`, which answers *taken* for any name
 * in the list it is given — and the name in this box starts as the alias's own. Passing the
 * whole list would have every inspector open accusing its own alias of being taken.
 *
 * @param names Every alias name this workspace has, as the table read them.
 * @param alias The alias being edited.
 * @returns The other names.
 */
export function otherNames(names: readonly string[], alias: string): readonly string[] {
  return names.filter((name) => name !== alias);
}

/**
 * Whether a rename is refused before it is attempted.
 *
 * Any reference blocks it — the contract does not distinguish, because a workflow document
 * holding the old name is broken by the rename whatever kind of thing holds it.
 *
 * @param references What references the alias, as served.
 * @returns Whether renaming is blocked.
 */
export function renameBlocked(references: readonly ModelAliasReference[]): boolean {
  return references.length > 0;
}

/**
 * The standing line under the alias field for a referenced alias — the issue's own
 * *referenced — rename is blocked while 4 references exist*.
 *
 * Drawn **before the field is touched**, because the point of it is that a reader learns the
 * rule while deciding rather than after typing. It is not an error: nothing is wrong yet, and
 * the field is not marked invalid for holding the name it already has.
 *
 * @param count How many things reference the alias.
 * @returns The line, or `null` for an alias nothing references.
 */
export function renameGuardNote(count: number): string | null {
  if (count === 0) return null;

  return `referenced — rename is blocked while ${count} reference${count === 1 ? "" : "s"} exist${count === 1 ? "s" : ""}`;
}

/**
 * The referrers of an alias, counted by kind and worded — *3 routes and 1 escalation rule*.
 *
 * What {@link RENAME_BLOCKED} and {@link REMOVE_REFERENCED} name as the work list, so a reader
 * is told what to repoint rather than merely that something depends on the name. The order is
 * {@link REFERENCE_KINDS}' — the contract's own — so two aliases with the same referrers are
 * described the same way.
 *
 * @param references What references the alias, as served.
 * @returns The phrase, or `null` when nothing references it.
 */
export function referenceSummary(references: readonly ModelAliasReference[]): string | null {
  const parts = REFERENCE_KINDS.flatMap((kind) => {
    const count = references.filter((reference) => reference.kind === kind).length;
    const noun = REFERENCE_NOUNS[kind];

    return count === 0 ? [] : [`${count} ${count === 1 ? noun.one : noun.many}`];
  });

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] as string;

  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* ------------------------------------------------------------------ the used-by chips */

/** One kind of thing that can reference an alias. */
export type ReferenceKind = ModelAliasReference["kind"];

/**
 * The four kinds, in the order the contract declares them.
 *
 * An array rather than a set, because it is also the order {@link referenceSummary} words them
 * in — and it is total over the union, so a fifth kind added to the service is a build error
 * in {@link REFERENCE_NOUNS} and {@link REFERENCE_HASHES} rather than a chip that links
 * nowhere and is described as nothing.
 */
export const REFERENCE_KINDS: readonly ReferenceKind[] = [
  "route",
  "escalation",
  "workflow",
  "chat_pin",
];

/** What one reference of each kind is called, singular and plural. */
export const REFERENCE_NOUNS: Readonly<
  Record<ReferenceKind, { readonly one: string; readonly many: string }>
> = {
  route: { one: "route", many: "routes" },
  escalation: { one: "escalation rule", many: "escalation rules" },
  workflow: { one: "workflow", many: "workflows" },
  chat_pin: { one: "chat pin", many: "chat pins" },
};

/**
 * Where each kind's chip goes — the fragment on `/models` that holds it, or `null`.
 *
 * `route` and `escalation` are the two live kinds and both live on mockup 06: the routing
 * matrix and the escalation-rules card, whose headings `app/paths.ts` writes down so the link
 * and its target are one string. `workflow` and `chat_pin` are **declared and contribute
 * nothing until their storage exists** (CG.3), so they are `null` — a chip that navigated to a
 * surface this build does not have would be worse than one that does not navigate.
 *
 * The anchor rather than a selection parameter, deliberately: `?route=` names a *task kind*
 * (`app/models/matrix.ts`), and a reference carries the referring row's id and its chip label
 * — neither of which is a kind, and neither of which this page may guess one from.
 */
export const REFERENCE_HASHES: Readonly<Record<ReferenceKind, string | null>> = {
  route: ROUTING_MATRIX_HASH,
  escalation: ROUTING_RULES_HASH,
  workflow: null,
  chat_pin: null,
};

/**
 * Where one **Used by** chip navigates.
 *
 * @param reference The reference, as served.
 * @returns The path with its fragment, or `null` for a kind whose surface does not exist yet —
 *   which the card draws as a plain tag rather than as a link.
 */
export function referenceHref(reference: ModelAliasReference): string | null {
  const hash = REFERENCE_HASHES[reference.kind];

  return hash === null ? null : `${MODELS_PATH}#${hash}`;
}

/** The heading over the chips — mockup 21's `USED BY`, in the product's sentence case. */
export const USED_BY_LABEL = "Used by";

/** …and the list's accessible name, which says what the chips *are*. */
export const USED_BY_LIST_LABEL = "Routes and rules that reference this alias";

/** What stands where the chips would be for an alias nothing references. */
export const USED_BY_EMPTY =
  "Nothing references this alias yet, so it can be renamed and removed freely.";

/* ------------------------------------------------------------------ the provider select */

/**
 * One option of the provider select — mockup 21's `Anthropic — key sk-ant-…Xq4A`.
 *
 * The mask is the service's `••••Xq4A` (#588) rather than the drawing's `sk-ant-…Xq4A`: the
 * characters a key begins with are as much of a secret as the ones it ends with, and the only
 * masked form this product publishes is the one computed inside `ouroboros-rest`. What the
 * mockup is asking for is met either way — *which key is this connection using* — and it is
 * met with a string no page composed.
 *
 * A connection that stores no credential says so instead of showing a blank: an Ollama daemon
 * and an unauthenticated endpoint are legitimate connections, and *no key stored* is a fact
 * about them rather than a failure to read one.
 *
 * @param source The connection, as the page read it.
 * @returns The option's text.
 */
export function providerOption(source: ImportSource): string {
  return source.mask === null ? `${source.name} — ${NO_KEY_STORED}` : `${source.name} — key ${source.mask}`;
}

/** What an option says for a connection with nothing in the vault. */
export const NO_KEY_STORED = "no key stored";

/** The blank option an unbound alias's provider select opens on. */
export const NO_PROVIDER_OPTION = "No provider — bind later";

/**
 * The provider hint's first half — mockup 21 draws *from **Providers & keys***, with the second
 * half a link, which is the one hint on this card that is not a single string.
 *
 * The create dialog says the same sentence as plain text (`create.ts`'s `PROVIDER_HINT`), and
 * these two halves are asserted to compose exactly that: one wording, drawn twice, and the
 * difference is only that one of them navigates.
 */
export const PROVIDER_HINT_LEAD = "from ";

/** …and the half that navigates, to mockup 07. */
export const PROVIDER_HINT_LINK = "Providers & keys";

/** Where it goes. Spelled from `app/paths.ts`, never typed out. */
export const PROVIDER_HINT_HREF = PROVIDERS_PATH;

/**
 * The composed hint, for anything that wants it as one string.
 *
 * Exported so `__tests__/registry/inspector.test.ts` can hold the two halves to the sentence the
 * create dialog already says (`create.ts`'s `PROVIDER_HINT`), which is what keeps the two
 * surfaces one wording rather than two that happen to match today.
 */
export const PROVIDER_HINT_TEXT = `${PROVIDER_HINT_LEAD}${PROVIDER_HINT_LINK}`;


/* ------------------------------------------------------------------ the model select */

/**
 * What the model field says when the held model is not in the connection's live list.
 *
 * A rebind keeps the model id — that is the ordinary case, since `claude-fable-5` on one
 * Anthropic connection is `claude-fable-5` on the next — so the select offers it whether or
 * not the new connection has reported it, and says so rather than dropping it. The service
 * agrees: an undiscovered model is `model_not_discovered`, a **warning** beside a write that
 * happened, not a refusal.
 *
 * @param modelId The held model.
 * @returns The line to draw under the select.
 */
export function unlistedNote(modelId: string): string {
  return `${modelId} is not in this connection's discovered list. It can still be saved — the provider decides.`;
}

/* ------------------------------------------------------------------ the unbound banner */

/**
 * The banner at the top of an unbound alias's card — the way out of the state.
 *
 * Consistent with CI.2's row treatment: the table dims the row and puts **Fix in Providers →**
 * in its health cell, and this says the same thing in the one place a reader who has selected
 * that row is looking. It is the *only* thing the card can offer that alias: there is no
 * provider to show, no model list to read, and no parameters to tune until there is a binding.
 */
export const UNBOUND_BANNER =
  "This alias has no provider, so nothing resolves through it and it cannot be switched on. " +
  "Bind it to a connection below, or connect a provider first.";

/** Where the banner's link goes. Spelled from `app/paths.ts`, never typed out. */
export const UNBOUND_BANNER_HREF = PROVIDERS_PATH;

/* ------------------------------------------------------------------ the parameter sections */

/** The heading over the registry's own policy flags — `review vote only`, `batch ok`. */
export const RESTRICTIONS_TITLE = "Restrictions";

/**
 * …and what they are, in the one line under the heading.
 *
 * They are **always offered**, whatever the model can be tuned with and whether or not the
 * alias is bound at all: a restriction is this workspace's policy about the alias rather than
 * a capability of the thing behind it, so CH.2 answers them in full even for an unbound alias.
 */
export const RESTRICTIONS_NOTE =
  "Registry policy for this alias, whatever the provider supports.";

/* ------------------------------------------------------------------ the foot */

/** The card's primary control, as the mockup labels it. */
export const SAVE_LABEL = "Save alias";

/** …and what it says while the write is in flight. */
export const SAVING = "Saving the alias…";

/** Why it is inert while nothing has been changed. */
export const NOTHING_TO_SAVE = "Nothing has been changed yet.";

/** Why it is inert while the name is missing or malformed. */
export const NEEDS_NAME = "Give the alias a name — it has to be free and lower-case kebab.";

/** Why it is inert while there is no model. */
export const NEEDS_MODEL = "Name the model this alias resolves to.";

/** The second control: *same model, different keys*, one press. */
export const DUPLICATE_LABEL = "Duplicate";

/** …and what it says while the copy is being made. */
export const DUPLICATING = "Copying the alias…";

/** …and what a reader is told about what a copy is, before pressing it. */
export const DUPLICATE_HINT =
  "Copies the binding, the parameters and the restrictions into a new alias, switched off.";

/** The destructive control. */
export const REMOVE_LABEL = "Remove";

/** …and what it says while the delete is in flight. */
export const REMOVING = "Removing the alias…";

/**
 * The mono why-line beside a blocked **Remove** — mockup 21's `blocked — 4 routes reference
 * this alias`.
 *
 * **A permanent state of the button rather than an error after a press.** The count is the
 * row's own references, so an alias two routes name says *2 routes* and one alias one route
 * names says *1 route references this alias* — the verb agrees with the count, because a line
 * that reads as a template is a line a reader stops believing.
 *
 * @param count How many things reference the alias.
 * @returns The line, or `null` when the alias may be removed.
 */
export function removeWhy(count: number): string | null {
  if (count === 0) return null;

  return `blocked — ${usedByCell(count)} ${count === 1 ? "references" : "reference"} this alias`;
}

/** The confirmation's title. */
export function removeTitle(alias: string): string {
  return `Remove ${alias}?`;
}

/**
 * …and its note. A delete this page has already established is unreferenced, so what is left
 * to say is that it does not come back.
 */
export const REMOVE_NOTE =
  "The alias is deleted. Nothing references it, so no route or workflow changes — but the name " +
  "is free again and anything pointing at it later would have to be created afresh.";

/** The confirmation's control. */
export const REMOVE_CONFIRM = "Remove alias";

/** Which of the card's three writes is in flight, or `null` for none. */
export type InspectorWrite = "save" | "duplicate" | "remove";

/**
 * What the card says about itself while one of them is.
 *
 * Total over the union, so a fourth write added to the foot is a build error here rather than a
 * press with no announcement — the line is a `role="status"`, and it is the only thing that
 * tells a reader who cannot see the button dim that anything is happening.
 */
export const WRITE_LABELS: Readonly<Record<InspectorWrite, string>> = {
  save: SAVING,
  duplicate: DUPLICATING,
  remove: REMOVING,
};

/** What every control on this card says to a role that may read it and not write to it. */
export const INSPECTOR_READ_ONLY =
  "Editing an alias is for workspace owners and admins.";

/**
 * Why **Save alias** cannot be pressed, or `undefined` when it can.
 *
 * The order is the judgement, and it is *role, then validity, then the guard, then whether
 * there is anything to do*: each answer is about something the previous question has already
 * ruled out, so a reader is never told about a problem behind one they have.
 *
 * @param draft What the card holds.
 * @param stored The same five facts as the row has them.
 * @param problem What `create.ts`'s `nameProblem` makes of the name, against the *other* names.
 * @param references What references the alias, as served.
 * @param mayAdminister Whether this reader's role may write at all.
 * @returns The sentence, or `undefined` when the card is ready to save.
 */
export function saveReason(
  draft: InspectorDraft,
  stored: InspectorDraft,
  problem: NameProblem,
  references: readonly ModelAliasReference[],
  mayAdminister: boolean,
): string | undefined {
  if (!mayAdminister) return INSPECTOR_READ_ONLY;
  if (problem !== null) return NEEDS_NAME;
  if (draft.alias.trim() !== stored.alias && renameBlocked(references)) return RENAME_BLOCKED;
  if (draft.modelId.trim() === "") return NEEDS_MODEL;

  return isDirty(draft, stored) ? undefined : NOTHING_TO_SAVE;
}

/* ------------------------------------------------------------------ what a refusal says */

/** The clause every refusal on this card ends on, because it is the fact a reader most needs. */
export const NOTHING_SAVED = "Nothing was changed.";

/** What the card draws for a refused save: one sentence, and the fields it is about. */
export interface SaveFailure {
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
  /** …and which restriction controls, likewise. */
  readonly restrictions: Readonly<Record<string, readonly string[]>>;
}

/** The `code` for a rename of an alias something references. */
export const RENAME_BLOCKED_CODE = "model_alias_rename_blocked";

/** The `code` for a name this workspace already has. */
export const NAME_TAKEN_CODE = "model_alias_name_taken";

/** The `code` for a param or a restriction the bound model cannot honour. */
export const PARAMS_INVALID_CODE = "model_alias_params_invalid";

/** The `code` for a body whose own shape is wrong. */
export const VALIDATION_FAILED_CODE = "validation_failed";

/** The `code` for a role that may read the registry and not write to it. */
export const FORBIDDEN_CODE = "forbidden";

/** The `code` for an alias this workspace no longer has. */
export const NOT_FOUND_CODE = "model_alias_not_found";

/** The `code` for an enable the binding does not allow. */
export const UNBOUND_CODE = "model_alias_unbound";

/** The `code` for a delete that routes, rules or workflows refuse. */
export const REFERENCED_CODE = "model_alias_referenced";

/** The `code` for a copy whose suffixed name would pass the 64-character ceiling. */
export const COPY_TOO_LONG_CODE = "model_alias_copy_name_too_long";

/** What a refused rename says, under the name box and under the form alike. */
export const RENAME_BLOCKED =
  "Renaming is blocked while anything references this alias — routes and workflows hold it by " +
  "name. Repoint them first, then rename.";

/** What a name this workspace already has is told. */
export const NAME_TAKEN =
  "This workspace already has an alias by that name. Aliases are unique per workspace.";

/** What a save carrying a parameter the model cannot honour is told. */
export const PARAMS_INVALID =
  `This model does not accept one of those settings. ${NOTHING_SAVED}`;

/** What a save the service could not read is told. */
export const SAVE_INVALID = `That could not be saved as it stands. ${NOTHING_SAVED}`;

/** What a member who reached the write anyway is told. */
export const SAVE_READ_ONLY = `${INSPECTOR_READ_ONLY} ${NOTHING_SAVED}`;

/** What a card whose alias somebody else has removed is told. */
export const ALIAS_GONE = "This alias has been removed. Reload the page.";

/** What an attempt to enable an alias with no binding is told. */
export const SAVE_UNBOUND =
  `An alias with no provider cannot be switched on. Bind it first. ${NOTHING_SAVED}`;

/** What a refusal this module has no sentence for is told, with the service's own beside it. */
export const SAVE_FAILED = `The alias could not be saved. ${NOTHING_SAVED}`;

/**
 * The service's refusal, as the card draws it.
 *
 * Each code is mapped to a sentence *and* to the field it is about, because the two together
 * are what makes a refusal actionable: a line under the form says what happened, and a line
 * under the box says where. A code with no field — a role refusal, a vanished alias — gets the
 * sentence alone, which is honest: there is nothing in the form to correct.
 *
 * @param refusal The service's envelope, as `inspector-actions.ts` handed it back.
 * @param paramErrors The `params.*` messages, already keyed by field name —
 *   `app/registry/params.ts`'s `paramFieldErrors`, passed in rather than computed here so this
 *   module stays free of the schema's shape.
 * @param restrictionErrors The `restrictions.*` messages, likewise.
 * @returns What to draw.
 */
export function saveFailure(
  refusal: ErrorEnvelope,
  paramErrors: Readonly<Record<string, readonly string[]>> = {},
  restrictionErrors: Readonly<Record<string, readonly string[]>> = {},
): SaveFailure {
  const { code, details } = refusal;
  const nothing = { params: {}, restrictions: {} } as const;

  if (code === RENAME_BLOCKED_CODE) {
    return { message: `${RENAME_BLOCKED} ${NOTHING_SAVED}`, alias: RENAME_BLOCKED, ...nothing };
  }

  if (code === NAME_TAKEN_CODE) {
    return { message: `${NAME_TAKEN} ${NOTHING_SAVED}`, alias: NAME_TAKEN, ...nothing };
  }

  if (code === PARAMS_INVALID_CODE) {
    return { message: PARAMS_INVALID, params: paramErrors, restrictions: restrictionErrors };
  }

  if (code === UNBOUND_CODE) {
    return { message: SAVE_UNBOUND, connectionId: SAVE_UNBOUND, ...nothing };
  }

  if (code === VALIDATION_FAILED_CODE) {
    return {
      message: SAVE_INVALID,
      alias: fieldSentence(details.alias),
      connectionId: fieldSentence(details.connectionId),
      modelId: fieldSentence(details.modelId),
      params: paramErrors,
      restrictions: restrictionErrors,
    };
  }

  if (code === FORBIDDEN_CODE) return { message: SAVE_READ_ONLY, ...nothing };
  if (code === NOT_FOUND_CODE) return { message: ALIAS_GONE, ...nothing };

  // An unrecognised code still carries the service's own sentence, which is written for a
  // caller rather than for a reader — so it goes *after* the product's line rather than
  // instead of it, and the reader is told what state the workspace is in either way.
  return { message: `${SAVE_FAILED} ${refusal.message}`, ...nothing };
}

/** What a copy nothing could be named is told, with the name that did not fit. */
export const COPY_TOO_LONG =
  "The copy's name would be longer than the 64 characters an alias may have. Rename this alias " +
  `to something shorter first. ${NOTHING_CREATED}`;

/** What a member who reached the copy anyway is told. */
export const DUPLICATE_READ_ONLY =
  `Duplicating an alias is for workspace owners and admins. ${NOTHING_CREATED}`;

/** What a refusal this module has no sentence for is told. */
export const DUPLICATE_FAILED = `The alias could not be copied. ${NOTHING_CREATED}`;

/**
 * A refused duplicate, as one sentence.
 *
 * One sentence and no field, because there is no form: **Duplicate** is a single press and
 * every way it can fail is about the alias rather than about something the reader typed.
 *
 * @param refusal The service's envelope.
 * @returns The sentence to draw in the foot.
 */
export function duplicateFailure(refusal: ErrorEnvelope): string {
  if (refusal.code === COPY_TOO_LONG_CODE) return COPY_TOO_LONG;
  if (refusal.code === FORBIDDEN_CODE) return DUPLICATE_READ_ONLY;
  if (refusal.code === NOT_FOUND_CODE) return ALIAS_GONE;

  return `${DUPLICATE_FAILED} ${refusal.message}`;
}

/** What a member who reached the delete anyway is told. */
export const REMOVE_READ_ONLY =
  `Removing an alias is for workspace owners and admins. ${NOTHING_SAVED}`;

/** What a refusal this module has no sentence for is told. */
export const REMOVE_FAILED = `The alias could not be removed. ${NOTHING_SAVED}`;

/**
 * What a delete the service refused is told — including the one refusal this card's own
 * blocked foot exists to prevent.
 *
 * A `409` reaching here means the references changed under the reader: the foot was drawn from
 * the row's references and something was repointed at the alias since the page was read. So
 * the sentence names the *service's* count rather than the row's, which is the current one.
 *
 * @param refusal The service's envelope.
 * @returns The sentence to draw in the foot.
 */
export function removeFailure(refusal: ErrorEnvelope): string {
  if (refusal.code === REFERENCED_CODE) {
    const summary = referenceSummary(referencesIn(refusal.details.references));

    return summary === null
      ? `${REMOVE_REFERENCED} ${NOTHING_SAVED}`
      : `${REMOVE_REFERENCED} Repoint the ${summary} that use it first. ${NOTHING_SAVED}`;
  }

  if (refusal.code === FORBIDDEN_CODE) return REMOVE_READ_ONLY;
  if (refusal.code === NOT_FOUND_CODE) return ALIAS_GONE;

  return `${REMOVE_FAILED} ${refusal.message}`;
}

/** The opening clause of a refused delete. */
export const REMOVE_REFERENCED = "Something references this alias, so it was not removed.";

/**
 * A refusal's `details.references`, as references.
 *
 * `details` is `Record<string, unknown>` by the contract's own typing, so what arrives under
 * that key is checked rather than asserted: a service that sent something else produces no
 * summary, and the sentence stands without one.
 *
 * @param value Whatever `details.references` carried.
 * @returns The references it described, possibly none.
 */
function referencesIn(value: unknown): readonly ModelAliasReference[] {
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is ModelAliasReference => {
    if (typeof entry !== "object" || entry === null) return false;

    const kind: unknown = (entry as { kind?: unknown }).kind;

    return typeof kind === "string" && (REFERENCE_KINDS as readonly string[]).includes(kind);
  });
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
