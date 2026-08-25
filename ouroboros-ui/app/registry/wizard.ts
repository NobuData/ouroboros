/**
 * Every decision the **import wizard** makes, and every sentence it says
 * (CI.4, [#594](https://github.com/NobuData/ouroboros/issues/594)), over CH.4's annotated
 * candidates ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * **Framework-free and pure**, like `app/registry/table.ts` and `app/registry/create.ts`
 * beside it: nothing here imports React, `next/*` or the server-only client. The wizard is
 * `app/registry/import-wizard.tsx` and its server hops are `app/registry/import-actions.ts`.
 *
 * ---------------------------------------------------------------------------
 * ### Bulk import needs review, not automation
 *
 * Forty discovered models must not become forty machine-named aliases — decision **R7**, and
 * the page's own caption promises the registry will not be a list of names nothing routes to.
 * But naming forty by hand is not it either. So the wizard's job is to put **discovery's truth
 * and the operator's vocabulary side by side**: the service suggests a name per row and the
 * row's box is editable, the price and the capability headline are visible before the choice
 * is made, and a model that already has an alias arrives marked and unticked.
 *
 * Everything on a row is the service's except the name, which is the operator's. That split is
 * why {@link candidateRows} copies rather than composes: the price string is CH.3's, the
 * capability facts are CH.2's, and the only thing this module renders itself is the headline
 * that joins them ({@link capabilitySummary}) — a sentence about which no database has an
 * opinion.
 *
 * ### Nothing is created until every row is acceptable
 *
 * `POST /registry/import` is one transaction: all of them or none of them, and a batch with
 * anything wrong in it is a `422` describing **every** offending item with nothing created.
 * That is only useful if the UI puts each message back on the row it belongs to, which is what
 * {@link importItemErrors} does — the service keys `details.items` by an item's **position in
 * the request**, so the order the body was built in is carried alongside it and used to look
 * each row up again.
 *
 * The same errors are anticipated in the browser ({@link rowProblems}) so the ordinary
 * collision — two rows edited to the same name — is caught before a round trip. The service is
 * still what decides; both routes end with a sentence on the row, which is the property that
 * matters.
 *
 * ### An empty wizard explains itself
 *
 * `candidates` empty and `empty` non-null is one state, not two, and the contract guarantees
 * it: *no models discovered — test the connection in Providers*. A wizard that opened onto
 * nothing and said nothing would be indistinguishable from one that failed to load, which is
 * the specific confusion this state exists to prevent.
 */

import type {
  ImportCandidate,
  ImportModelAliases,
  ImportResult,
  ModelCapabilitySummary,
} from "@/app/api/registry";
import type { ErrorEnvelope } from "@/app/api/errors";
import { compactNumber } from "@/app/format";
import { PROVIDERS_PATH } from "@/app/paths";

import { NAME_PATTERN, NAME_SHAPE, NOTHING_CREATED } from "./create";
import { EM_DASH, priceProvenance } from "./table";

/* ------------------------------------------------------------------ the candidate row */

/**
 * One row of the wizard's candidate table — everything drawn, already decided.
 *
 * `name` is the one mutable field and the one the operator owns; every other field is a copy
 * of what CH.4 served. A row is keyed by `modelId` throughout, because that is what the item
 * sends and what a `422` is ultimately about — an index would be a second identity for one
 * row, and the whole difficulty of an itemised refusal is keeping *one* identity straight.
 */
export interface CandidateRow {
  /** The provider's model id — the React key, and what an item carries. */
  readonly modelId: string;
  /** What the row prints for the model. */
  readonly display: string;
  /**
   * The name to create it under: the service's suggestion, or whatever was typed over it.
   *
   * `""` when no suggestion could be made — honest rather than empty, and the row arrives with
   * a cell for somebody to fill in.
   */
  readonly name: string;
  /** Whether the row is ticked. */
  readonly selected: boolean;
  /**
   * The alias that already resolves to this model on this connection, or `null`.
   *
   * The row is still offered rather than hidden: an operator re-running an import is owed the
   * sight of what is already named, which is also what makes re-entry after an import show the
   * new aliases as already-aliased.
   */
  readonly aliased: string | null;
  /** CH.3's rendered price — `$10 · $50`, `seat-based`, `$0`, `—`. Never re-derived. */
  readonly price: string;
  /** The price's provenance, for the hover, or `null` where there is no price to audit. */
  readonly provenance: string | null;
  /** The capability headline — `thinking · 1.0M ctx · 64.0k out`, or `—`. */
  readonly capabilities: string;
}

/**
 * The wizard's rows, as the table opens on them.
 *
 * The order is the service's — by model id — and the initial tick is the service's too
 * (`selected`), which is false for an already-aliased model and for one no name could be
 * suggested for. Neither is re-decided here: *should this row start ticked* is a question CH.4
 * answers against the workspace's aliases, and a second opinion computed from a subset of the
 * same facts is how two surfaces come to disagree.
 *
 * @param candidates The connection's candidates, as served.
 * @returns One row per candidate, in the order given.
 */
export function candidateRows(candidates: readonly ImportCandidate[]): readonly CandidateRow[] {
  return candidates.map((candidate) => ({
    modelId: candidate.modelId,
    display: candidate.display,
    name: candidate.suggestedName ?? "",
    selected: candidate.selected,
    aliased: candidate.alias?.alias ?? null,
    price: candidate.price.display,
    provenance: priceProvenance(candidate.price),
    capabilities: capabilitySummary(candidate.capabilities),
  }));
}

/**
 * The capability headline for one row — the facts a list row has space for.
 *
 * *Thinking* is a word rather than a count because that is the fact an operator scans for; the
 * two window sizes are compacted with the product's own {@link compactNumber}, one decimal
 * place and all, so a column of them does not shuffle between `1M` and `1.0M` as the models
 * differ. A model with nothing to say takes the em-dash the table already uses for *there is
 * nothing here* — including the honest cases where `reason` explains the absence, because a
 * row is not the place for that sentence and the dialog's parameter section is.
 *
 * @param capabilities What CH.2's merged schema projected for this model.
 * @returns The headline, or the em-dash.
 */
export function capabilitySummary(capabilities: ModelCapabilitySummary): string {
  const parts: string[] = [];

  if (capabilities.thinking) parts.push(THINKING);
  if (capabilities.contextTokens !== null) {
    parts.push(`${compactNumber(capabilities.contextTokens)} ${CONTEXT_UNIT}`);
  }
  if (capabilities.maxOutputTokens !== null) {
    parts.push(`${compactNumber(capabilities.maxOutputTokens)} ${OUTPUT_UNIT}`);
  }

  return parts.length === 0 ? EM_DASH : parts.join(" · ");
}

/** How a thinking model is named in a candidate row's headline. */
export const THINKING = "thinking";

/** What a context window is labelled in a headline — the mockup's own abbreviation. */
export const CONTEXT_UNIT = "ctx";

/** …and the largest single answer. */
export const OUTPUT_UNIT = "out";

/* ------------------------------------------------------------------ the selection */

/**
 * Whether a row may be ticked at all.
 *
 * An already-aliased model is the one thing an operator did not ask for when they opened the
 * wizard — the service would skip it anyway, reported rather than silently — so the row is
 * shown, marked, and left out of the selection. A row with no name is *selectable*; it simply
 * cannot be submitted until it has one, which is a different sentence and a different fix.
 *
 * @param row The row.
 * @returns Whether ticking it is offered.
 */
export function selectable(row: CandidateRow): boolean {
  return row.aliased === null;
}

/**
 * Whether **select all** would tick a row.
 *
 * The server's own rule for `selected`, applied to the row as it now stands: not already
 * aliased, and with a name to create it under. A reader who typed a name into a row that had
 * none is therefore included, and a reader who cleared one is not — which is what keeps
 * *select all* a request that can be submitted rather than a way of generating row errors.
 *
 * @param row The row.
 * @returns Whether **select all** ticks it.
 */
export function selectableWithName(row: CandidateRow): boolean {
  return selectable(row) && row.name.trim() !== "";
}

/**
 * The rows after **select all** or **select none**.
 *
 * @param rows The rows as they stand.
 * @param select Whether to tick or to clear.
 * @returns The rows, with the ticks moved. An already-aliased row is never ticked, whichever
 *   way this is called.
 */
export function selectAll(
  rows: readonly CandidateRow[],
  select: boolean,
): readonly CandidateRow[] {
  return rows.map((row) => ({ ...row, selected: select && selectableWithName(row) }));
}

/**
 * Whether the **select all** control shows as ticked.
 *
 * True only when there is something it could have ticked and every one of them is ticked, so
 * an empty selection and a table with nothing tickable in it are both *unticked* rather than
 * *all done*.
 *
 * @param rows The rows.
 * @returns Whether the control is on.
 */
export function allSelected(rows: readonly CandidateRow[]): boolean {
  const eligible = rows.filter(selectableWithName);

  return eligible.length > 0 && eligible.every((row) => row.selected);
}

/**
 * The rows that will be created — the ticked ones, in the table's own order.
 *
 * @param rows The rows.
 * @returns The ticked rows.
 */
export function chosen(rows: readonly CandidateRow[]): readonly CandidateRow[] {
  return rows.filter((row) => row.selected);
}

/* ------------------------------------------------------------------ what is wrong, per row */

/** What is wrong with one ticked row's name. */
export type RowProblem =
  /** Ticked with nothing in the name box. */
  | "unnamed"
  /** Ticked with a name that is not lower-case kebab. */
  | "shape"
  /** Ticked with a name this workspace already has. */
  | "taken"
  /** Ticked with a name another ticked row is also asking for. */
  | "duplicate";

/**
 * What each ticked row's name is wrong about, keyed by model id.
 *
 * Only ticked rows are judged: a row nobody is importing may hold whatever it holds, and
 * marking an untouched suggestion as a duplicate of a row the operator did tick would be
 * telling them off for the service's own suggestion.
 *
 * The order within a row is the same judgement `create.ts` makes — shape before uniqueness,
 * because a malformed name is not taken by anybody — and *taken by the workspace* is checked
 * before *repeated in the batch*, because the first is a fact that will not change by editing
 * another row.
 *
 * @param rows The rows as they stand.
 * @param existing Every alias name this workspace has, as the table read them.
 * @returns One entry per offending row. Empty when the batch is submittable.
 */
export function rowProblems(
  rows: readonly CandidateRow[],
  existing: readonly string[],
): Readonly<Record<string, RowProblem>> {
  const problems: Record<string, RowProblem> = {};
  const seen = new Map<string, number>();

  for (const row of chosen(rows)) {
    const name = row.name.trim();

    seen.set(name, (seen.get(name) ?? 0) + 1);
  }

  for (const row of chosen(rows)) {
    const name = row.name.trim();

    if (name === "") problems[row.modelId] = "unnamed";
    else if (!NAME_PATTERN.test(name)) problems[row.modelId] = "shape";
    else if (existing.includes(name)) problems[row.modelId] = "taken";
    else if ((seen.get(name) ?? 0) > 1) problems[row.modelId] = "duplicate";
  }

  return problems;
}

/**
 * The sentence a row problem draws under its name box.
 *
 * @param problem What {@link rowProblems} found.
 * @returns The sentence.
 */
export function rowError(problem: RowProblem): string {
  return ROW_ERRORS[problem];
}

/** What each row problem says. Total over the union, so a fifth is a build error here. */
const ROW_ERRORS: Readonly<Record<RowProblem, string>> = {
  unnamed: "Give this model a name, or untick it.",
  shape: NAME_SHAPE,
  taken: "This workspace already has an alias by that name.",
  duplicate: "Another ticked row is asking for this name too.",
};

/* ------------------------------------------------------------------ what gets sent */

/** The body to send, and the order it was built in — which is what an itemised `422` is keyed by. */
export interface ImportRequest {
  /** The body. */
  readonly body: ImportModelAliases;
  /** The model id at each position in `body.items`, so a refusal's index finds its row again. */
  readonly order: readonly string[];
}

/**
 * The batch, from the rows the operator ticked.
 *
 * **No `params`.** An untouched item sends `{}`, which is what the contract documents and what
 * the create dialog's own form produces for a form nobody filled in; per-model tuning is one
 * alias's business and belongs in the inspector, not in a table of forty rows. **No
 * `enabled`** either — there is no such field: an import is bound to a connection the operator
 * just chose and ticked by hand, so it arrives on, and creating forty aliases that then had to
 * be switched on one at a time would make the wizard a way of generating work.
 *
 * @param connectionId The connection every item binds to.
 * @param rows The rows as they stand; the ticked ones are taken, in the table's order.
 * @returns The body and the order behind it.
 */
export function importRequest(
  connectionId: string,
  rows: readonly CandidateRow[],
): ImportRequest {
  const items = chosen(rows).map((row) => ({ modelId: row.modelId, alias: row.name.trim() }));

  return {
    body: { connectionId, items },
    order: items.map((item) => item.modelId),
  };
}

/* ------------------------------------------------------------------ what a refusal says */

/** What the wizard draws for a refused import: one sentence, and the rows it is about. */
export interface ImportFailure {
  /** The sentence above the table. */
  readonly message: string;
  /** What is wrong with which rows, keyed by model id. */
  readonly rows: Readonly<Record<string, readonly string[]>>;
}

/** The `code` for a batch that cannot be created, and **was not**. */
export const IMPORT_INVALID_CODE = "model_import_invalid";

/** The `code` for a body whose own shape is wrong. */
export const VALIDATION_FAILED_CODE = "validation_failed";

/** The `code` for a role that may not create aliases. */
export const FORBIDDEN_CODE = "forbidden";

/** The `code` for a connection this workspace does not have. */
export const CONNECTION_GONE_CODE = "provider_connection_not_found";

/** What a refused batch says above the table. The clause that matters is the second one. */
export const IMPORT_INVALID = `Some of those rows cannot be created. ${NOTHING_CREATED}`;

/** What a batch whose own shape was wrong says. */
export const IMPORT_MALFORMED = `That import could not be sent as it stands. ${NOTHING_CREATED}`;

/** What a member who reached the write anyway is told. */
export const IMPORT_READ_ONLY =
  `Importing aliases is for workspace owners and admins. ${NOTHING_CREATED}`;

/** What an import against a connection that has since gone is told. */
export const IMPORT_CONNECTION_GONE =
  `That provider connection is no longer in this workspace. ${NOTHING_CREATED}`;

/** What a refusal this module has no sentence for is told, with the service's own beside it. */
export const IMPORT_FAILED = `The import could not be completed. ${NOTHING_CREATED}`;

/**
 * The service's refusal, as the wizard draws it.
 *
 * @param refusal The service's envelope, as `import-actions.ts` handed it back.
 * @param order The model id at each position of the request that was refused.
 * @returns The sentence, and the messages keyed by model id.
 */
export function importFailure(refusal: ErrorEnvelope, order: readonly string[]): ImportFailure {
  const { code } = refusal;

  if (code === IMPORT_INVALID_CODE) {
    return { message: IMPORT_INVALID, rows: importItemErrors(refusal.details, order) };
  }

  if (code === VALIDATION_FAILED_CODE) return { message: IMPORT_MALFORMED, rows: {} };
  if (code === FORBIDDEN_CODE) return { message: IMPORT_READ_ONLY, rows: {} };
  if (code === CONNECTION_GONE_CODE) return { message: IMPORT_CONNECTION_GONE, rows: {} };

  return { message: `${IMPORT_FAILED} ${refusal.message}`, rows: {} };
}

/**
 * An itemised `422`, mapped back onto the rows that produced it.
 *
 * `details.items` is keyed by an item's **position in the request** — `{"1": {"alias": ["…"]}}`
 * — and each entry is that item's field messages. The positions are turned back into model ids
 * through the order the body was built in, so the wizard can put every sentence on the row it
 * belongs to; a position with no row behind it is dropped rather than guessed at, because a
 * message drawn on the wrong row is worse than one drawn nowhere and the failure's own
 * sentence is what catches the remainder.
 *
 * The field the message came from — `alias`, `modelId`, a `params.<name>` path — is deliberately
 * **not** kept: the wizard has one editable cell per row, so every message it can act on ends
 * up under that cell either way, and a row that reported which of its four fields was at fault
 * would be reporting a distinction the row cannot draw.
 *
 * @param details The refusal's `details`.
 * @param order The model id at each position of the request.
 * @returns The sentences keyed by model id.
 */
export function importItemErrors(
  details: Readonly<Record<string, unknown>>,
  order: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  const items = details.items;

  if (typeof items !== "object" || items === null || Array.isArray(items)) return {};

  const errors: Record<string, readonly string[]> = {};

  for (const [position, fields] of Object.entries(items as Record<string, unknown>)) {
    const modelId = order[Number(position)];

    if (modelId === undefined) continue;

    const sentences = sentencesOf(fields);

    if (sentences.length > 0) errors[modelId] = sentences;
  }

  return errors;
}

/**
 * Every sentence in one item's field messages, in the order the fields arrived.
 *
 * @param fields The item's entry — an object of field paths to messages.
 * @returns The sentences, possibly none.
 */
function sentencesOf(fields: unknown): readonly string[] {
  if (typeof fields !== "object" || fields === null) return [];

  const sentences: string[] = [];

  for (const value of Object.values(fields as Record<string, unknown>)) {
    if (typeof value === "string") sentences.push(value);
    else if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === "string") sentences.push(entry);
    }
  }

  return sentences;
}

/* ------------------------------------------------------------------ what happened */

/**
 * What an import did, in one sentence.
 *
 * Both halves are named even when one of them is zero, because the zero is the interesting
 * number: *0 aliases created · 3 already named* is the honest report of a re-run, and a wizard
 * that said only *done* would leave an operator wondering whether it had worked.
 *
 * @param result What the service answered.
 * @returns The sentence.
 */
export function importSummary(result: ImportResult): string {
  const created = `${result.created.length} alias${result.created.length === 1 ? "" : "es"} created`;

  return result.skipped.length === 0
    ? `${created}.`
    : `${created} · ${result.skipped.length} already named, and passed over.`;
}

/**
 * The preview's own line — what pressing **Create** will do.
 *
 * @param count How many rows are ticked.
 * @returns The sentence, singular where the count is one.
 */
export function previewSummary(count: number): string {
  return count === 1
    ? "1 alias will be created, switched on and bound to this connection:"
    : `${count} aliases will be created, switched on and bound to this connection:`;
}

/* ------------------------------------------------------------------ what the wizard says */

/**
 * The wizard's heading, which names the connection it is scoped to.
 *
 * The connection is in the title rather than in a step somebody has to walk back to, because
 * it was chosen in the menu that opened this and is the one thing about the wizard that cannot
 * be changed from inside it.
 *
 * @param connection The connection's display name.
 * @returns The heading.
 */
export function wizardTitle(connection: string): string {
  return `Import from ${connection}`;
}

/** The wizard's steps, in order — the connection is step one and arrives already settled. */
export const IMPORT_STEPS = ["Connection", "Models", "Review"] as const;

/** Which step the wizard is on. An index into {@link IMPORT_STEPS}. */
export type StepIndex = 0 | 1 | 2;

/** How one step is drawn relative to where the reader is. */
export type StepState = "done" | "current" | "todo";

/**
 * How one step stands.
 *
 * @param index The step.
 * @param current Where the reader is.
 * @returns Its state.
 */
export function stepState(index: number, current: StepIndex): StepState {
  if (index < current) return "done";

  return index === current ? "current" : "todo";
}

/** The step list's accessible name. */
export const STEPS_LABEL = "Import steps";

/** The note under the heading, on the step where the models are chosen. */
export const CHOOSE_NOTE =
  "Everything this connection has reported. Tick what to add, and edit any name before it is " +
  "created — these are the names routes will point at.";

/** The candidate table's accessible name. */
export const CANDIDATES_CAPTION = "Discovered models, their prices, and the name each will take";

/** The **select all** control's accessible name. */
export const SELECT_ALL_LABEL = "Select every model that is not already named";

/** The per-row tick's accessible name. */
export function rowSelectLabel(modelId: string): string {
  return `Import ${modelId}`;
}

/** The per-row name box's accessible name. */
export function rowNameLabel(modelId: string): string {
  return `Alias for ${modelId}`;
}

/** The column headings, in the order the table draws them. */
export const COLUMN_IMPORT = "Import";

/** …the model id. */
export const COLUMN_MODEL = "Model";

/** …the editable name. */
export const COLUMN_ALIAS = "Alias";

/** …CH.3's price preview. */
export const COLUMN_PRICE = "$ per 1M in·out";

/** …and CH.2's capability headline. */
export const COLUMN_CAPABILITIES = "Capabilities";

/**
 * How a row that already has an alias is marked.
 *
 * @param alias The alias that already names the model.
 * @returns The mark — the issue's own `(aliased: coder-max)`, as a sentence.
 */
export function aliasedMark(alias: string): string {
  return `aliased: ${alias}`;
}

/** What the wizard says while the candidates are on their way. */
export const CANDIDATES_LOADING = "Reading what this connection has…";

/** What it says when that read was refused, before the service's own sentence. */
export const CANDIDATES_FAILED = "This connection's models could not be read just now.";

/** The empty state's title — the honest version, when discovery has reported nothing. */
export const EMPTY_TITLE = "No models discovered";

/** Where the empty state's link goes. Spelled from `app/paths.ts`, never typed out. */
export const EMPTY_HREF = PROVIDERS_PATH;

/** …and what it says. The state is fixed on the Providers page, where discovery is run. */
export const EMPTY_LINK = "Test the connection in Providers →";

/** Why the wizard cannot move on while nothing is ticked. */
export const NOTHING_CHOSEN = "Tick at least one model to import.";

/** Why it cannot move on while a ticked row's name is wrong. */
export const FIX_ROWS = "Fix the names marked below first — nothing is created until they are all resolved.";

/** The control that moves from the candidates to the review. */
export const REVIEW_NEXT = "Review";

/** The control that goes back to the candidates. */
export const REVIEW_BACK = "Back to models";

/** The review's list, named for a screen reader. */
export const PREVIEW_LABEL = "Aliases this import will create";

/** The control that writes. */
export const IMPORT_SUBMIT = "Create aliases";

/** …and what it says while the write is in flight. */
export const IMPORTING = "Creating the aliases…";

/** The done step's title. */
export const IMPORTED_TITLE = "Import complete";

/** The list of what was skipped, named for a screen reader. */
export const SKIPPED_LABEL = "Models that already had an alias";

/**
 * One skipped row's line — the model, and the alias that already named it.
 *
 * @param modelId The model.
 * @param alias The alias that already names it.
 * @returns The line.
 */
export function skippedLine(modelId: string, alias: string): string {
  return `${modelId} — already named ${alias}`;
}

/** The done step's control, which closes and re-reads the table behind it. */
export const IMPORT_DONE = "Done";

/** Every way out of the wizard without writing anything. */
export const IMPORT_CANCEL = "Cancel";
