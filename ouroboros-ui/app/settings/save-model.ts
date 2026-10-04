/**
 * The settings page's save model, as functions with inputs and outputs
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491), decision **S7**).
 *
 * A page that mixes instant-apply switches with a Save button is the worst of both: the reader
 * cannot tell which control is which — and on this page one of the switches pauses every loop in
 * the workspace. So the rule is explicit. **Field edits accumulate into a dirty state, keyed by
 * section, and Save changes commits them one section at a time; a control with an immediate
 * consequence is not a field, and cannot become one.** This module is that rule; the React face
 * is `app/settings/save-provider.tsx`, and the two are separate for the reason
 * `app/models/chain.ts` and its editor are: the bookkeeping is the part with the interesting
 * bugs, and it should be testable as itself.
 *
 * ### What is held, and what is derived
 *
 * The state holds **differences**: per section, the fields whose value is not the one the
 * server holds — and nothing for a field nobody touched. An edit that lands back on the saved
 * value is dropped rather than stored, so the count on the button is a count of fields a save
 * would actually write: a name retyped as it was is not a change. Everything else is one line
 * over that — the count, which sections are dirty, what a section would send.
 *
 * The saved values (a section's **baseline**) are not held here. They are the server's, handed
 * to each card as a prop, and every function below that needs one is given it.
 *
 * ### A save is validated whole and committed in order
 *
 * {@link validateSave} checks every dirty section before anything is sent, so a mistake the
 * browser can see costs no request and commits nothing anywhere. {@link commitSave} then writes
 * the sections in page order, each in **one** request that takes all of its changes or none
 * (the section's `commit`), and **stops at the first refusal**: the refused section keeps its
 * edits with the field errors the service gave, and the sections after it are not sent. A
 * section that already landed stays landed — it was a complete, valid change of its own — and
 * leaves the dirty state, so the count that remains is exactly what is still unsaved.
 *
 * ### A landed edit is shown until the server's copy arrives
 *
 * The moment a section's write succeeds, its edits stop being *unsaved* — but the card's
 * baseline is still the page's last read, and dropping the edits there would flash the old
 * values until the refresh lands. So they move to {@link SaveState.landed}, which still draws
 * and no longer counts. It is an overlay for the length of the save and its re-read, and no
 * longer: once the page has been re-read the baseline is the truth, whatever it says — a
 * service that trims a name answers with the trimmed one — so {@link dropLanded} discards the
 * overlay then, and {@link rebaseSection} discards a section's the moment a new baseline arrives.
 *
 * ### The Danger zone is not here, by construction
 *
 * {@link BatchSectionId} leaves out every section whose controls act at once
 * (`app/settings/view.ts`'s `saves: "immediate"`), and {@link assertBatchSection} refuses one
 * that arrives past the type. There is no way to put *pause all loops* behind a Save button.
 *
 * Framework-free and pure, apart from {@link commitSave}'s awaiting of the writes it is handed.
 */

import { SETTINGS_SECTIONS, type SettingsSectionId, settingsSection } from "./view";

/* ------------------------------------------------------------------ the shapes */

/** The sections whose fields may be unsaved: every one that does not act at once. */
export type BatchSectionId = Exclude<SettingsSectionId, "appearance" | "danger">;

/** A section's fields, by name. What a value is belongs to the card that owns the field. */
export type SectionValues = Readonly<Record<string, unknown>>;

/** What is wrong with a section's fields, by field name. Absent means nothing is. */
export type FieldErrors = Readonly<Record<string, string>>;

/** One thing per batch section, for the sections that have it. */
type PerSection<T> = Readonly<Partial<Record<BatchSectionId, T>>>;

/** The page's dirty state. */
export interface SaveState {
  /** The unsaved fields of each section — only those that differ from what is saved. */
  readonly edits: PerSection<SectionValues>;
  /** Fields a save has written that the page's read has not caught up with yet. Not unsaved. */
  readonly landed: PerSection<SectionValues>;
  /** What the last save found wrong with each section's fields. */
  readonly errors: PerSection<FieldErrors>;
  /** Why the last save did not land for each section it was refused for. */
  readonly refusals: PerSection<string>;
}

/** A page with nothing unsaved. */
export const CLEAN: SaveState = { edits: {}, landed: {}, errors: {}, refusals: {} };

/** The batch sections, in the order the page draws them — the order a save commits in. */
export const BATCH_SECTIONS: readonly BatchSectionId[] = SETTINGS_SECTIONS.filter(
  (section) => section.saves === "batch",
).map((section) => section.id as BatchSectionId);

/**
 * Whether a section's fields may join the dirty state.
 *
 * @param id Any section.
 * @returns `true` for a section that saves as a batch, narrowing the type.
 */
export function isBatchSection(id: SettingsSectionId): id is BatchSectionId {
  return settingsSection(id).saves === "batch";
}

/**
 * Refuse a section whose controls act at once.
 *
 * The type already leaves them out; this is for the caller that reached past it. It throws
 * rather than ignoring, because a field quietly excluded from **Save changes** would be an
 * edit the reader believes is pending and is not.
 *
 * @param id The section a card is trying to keep unsaved fields in.
 * @throws {Error} When the section is not a batch section.
 */
export function assertBatchSection(id: SettingsSectionId): asserts id is BatchSectionId {
  if (isBatchSection(id)) return;

  throw new Error(
    `The "${settingsSection(id).title}" section's controls act immediately, each behind its ` +
      "own confirmation — they cannot be fields saved by Save changes.",
  );
}

/* ------------------------------------------------------------------ equality */

/**
 * Whether two field values are the same value.
 *
 * Structural, because a field may hold more than a string — a list of globs, a rule's terms —
 * and an array rebuilt with the same entries is not a change. Plain data only: primitives,
 * arrays and plain objects, which is what a value that will be sent as JSON is.
 *
 * @param a One value.
 * @param b The other.
 * @returns `true` when they are equal by value.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }

  const left = Object.entries(a);
  const right = b as Readonly<Record<string, unknown>>;

  return (
    left.length === Object.keys(right).length &&
    left.every(([key, value]) => key in right && sameValue(value, right[key]))
  );
}

/* ------------------------------------------------------------------ small tools */

/**
 * One section's entry replaced — or removed, when the entry would be empty.
 *
 * @param all The per-section record.
 * @param section The section to change.
 * @param entry Its new entry, or `undefined` to remove it.
 * @returns A new record. An empty object counts as absent, so *has an entry* always means *has
 *   something in it*.
 */
function withSection<T extends object | string>(
  all: PerSection<T>,
  section: BatchSectionId,
  entry: T | undefined,
): PerSection<T> {
  const rest = Object.fromEntries(
    Object.entries(all).filter(([id]) => id !== section),
  ) as PerSection<T>;

  if (entry === undefined) return rest;
  if (typeof entry === "object" && Object.keys(entry).length === 0) return rest;

  return { ...rest, [section]: entry };
}

/**
 * A record without one of its keys.
 *
 * @param record The record.
 * @param key The key to leave out.
 * @returns A new record; the same entries when the key was not there.
 */
function without<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

/* ------------------------------------------------------------------ editing */

/**
 * Set one field of one section.
 *
 * The edit is stored only if it differs from the saved value; one that lands back on it removes
 * the entry, so nothing is unsaved that a save would not write. Whatever the last save said
 * about this field was about the value it was sent, so its error leaves with the edit — and so
 * does the section's refusal, which was about a batch this edit has just made a different one.
 *
 * @param state The dirty state.
 * @param section The section the field belongs to.
 * @param field The field's name.
 * @param value The value the reader has set.
 * @param baseline The section's saved values, as the page last read them.
 * @returns The next state.
 */
export function editField(
  state: SaveState,
  section: BatchSectionId,
  field: string,
  value: unknown,
  baseline: SectionValues,
): SaveState {
  assertBatchSection(section);

  const saved = savedValue(state, section, field, baseline);
  const edits = state.edits[section] ?? {};
  const next = sameValue(value, saved) ? without(edits, field) : { ...edits, [field]: value };

  return {
    ...state,
    edits: withSection(state.edits, section, next),
    errors: withSection(state.errors, section, without(state.errors[section] ?? {}, field)),
    refusals: withSection(state.refusals, section, undefined),
  };
}

/**
 * What a field is saved as: the value a landed write gave it, or the page's last read.
 *
 * @param state The dirty state.
 * @param section The section.
 * @param field The field's name.
 * @param baseline The section's saved values.
 * @returns The saved value.
 */
function savedValue(
  state: SaveState,
  section: BatchSectionId,
  field: string,
  baseline: SectionValues,
): unknown {
  const landed = state.landed[section];

  return landed !== undefined && field in landed ? landed[field] : baseline[field];
}

/**
 * A section as it currently stands: what is saved, under what has landed, under what is unsaved.
 *
 * @param state The dirty state.
 * @param section The section.
 * @param baseline The section's saved values.
 * @returns Every field's current value — what the card draws and what a validation checks.
 */
export function sectionDraft(
  state: SaveState,
  section: BatchSectionId,
  baseline: SectionValues,
): SectionValues {
  return { ...baseline, ...state.landed[section], ...state.edits[section] };
}

/**
 * How many of a section's fields are unsaved.
 *
 * @param state The dirty state.
 * @param section The section.
 * @returns The count — `0` for a section nobody touched.
 */
export function sectionPending(state: SaveState, section: BatchSectionId): number {
  return Object.keys(state.edits[section] ?? {}).length;
}

/**
 * How many fields are unsaved on the whole page — the number on **Save changes**.
 *
 * @param state The dirty state.
 * @returns The count.
 */
export function pendingCount(state: SaveState): number {
  return BATCH_SECTIONS.reduce((total, section) => total + sectionPending(state, section), 0);
}

/**
 * The sections holding unsaved fields, in the order a save commits them.
 *
 * @param state The dirty state.
 * @returns Their ids, in page order.
 */
export function dirtySections(state: SaveState): readonly BatchSectionId[] {
  return BATCH_SECTIONS.filter((section) => sectionPending(state, section) > 0);
}

/**
 * Drop every unsaved field, and everything the last save said about them.
 *
 * What has landed is kept: it is saved, and is only waiting for the page's read to say so.
 *
 * @param state The dirty state.
 * @returns The state with nothing unsaved.
 */
export function discardEdits(state: SaveState): SaveState {
  return { ...CLEAN, landed: state.landed };
}

/**
 * Drop the overlay of landed values: the page has been re-read, and its baseline is the truth.
 *
 * @param state The dirty state.
 * @returns The same state when nothing had landed; otherwise the state without the overlay.
 */
export function dropLanded(state: SaveState): SaveState {
  return Object.keys(state.landed).length === 0 ? state : { ...state, landed: {} };
}

/**
 * Take a new baseline for a section — the page re-read it.
 *
 * What had landed is in the baseline now, so it is dropped. An unsaved field that the new
 * baseline already equals is no longer a change and is dropped too; the rest stay unsaved,
 * over the new values — and when none is left, so is nothing the last save said about them.
 *
 * @param state The dirty state.
 * @param section The section that was re-read.
 * @param baseline Its new saved values.
 * @returns The next state.
 */
export function rebaseSection(
  state: SaveState,
  section: BatchSectionId,
  baseline: SectionValues,
): SaveState {
  // Nothing held for the section: the same state, so a re-read of a clean card renders nothing.
  if (state.edits[section] === undefined && state.landed[section] === undefined) return state;

  const edits = Object.fromEntries(
    Object.entries(state.edits[section] ?? {}).filter(
      ([field, value]) => !sameValue(value, baseline[field]),
    ),
  );

  // Nothing left unsaved: whatever the last save said was about edits that are gone.
  if (Object.keys(edits).length === 0) return forgetSection(state, section);

  return {
    ...state,
    edits: withSection(state.edits, section, edits),
    landed: withSection(state.landed, section, undefined),
  };
}

/**
 * Forget a section altogether — its card left the page.
 *
 * @param state The dirty state.
 * @param section The section.
 * @returns The state with nothing held for it.
 */
export function forgetSection(state: SaveState, section: BatchSectionId): SaveState {
  return {
    edits: withSection(state.edits, section, undefined),
    landed: withSection(state.landed, section, undefined),
    errors: withSection(state.errors, section, undefined),
    refusals: withSection(state.refusals, section, undefined),
  };
}

/* ------------------------------------------------------------------ what a save does to it */

/**
 * A section's write succeeded: its edits are saved.
 *
 * @param state The dirty state.
 * @param section The section that landed.
 * @returns The state with the section's edits moved to {@link SaveState.landed} and nothing
 *   said against it.
 */
export function landSection(state: SaveState, section: BatchSectionId): SaveState {
  return {
    edits: withSection(state.edits, section, undefined),
    landed: withSection(state.landed, section, {
      ...state.landed[section],
      ...state.edits[section],
    }),
    errors: withSection(state.errors, section, undefined),
    refusals: withSection(state.refusals, section, undefined),
  };
}

/**
 * A section was not saved: route what was wrong to its fields, and keep its edits.
 *
 * @param state The dirty state.
 * @param section The section that was refused, by the browser's validation or the service.
 * @param refusal Why, and which fields.
 * @returns The state with the errors on the section's fields and the reason on the section.
 */
export function refuseSection(
  state: SaveState,
  section: BatchSectionId,
  refusal: SectionRefusal,
): SaveState {
  return {
    ...state,
    errors: withSection(state.errors, section, refusal.fields),
    refusals: withSection(state.refusals, section, refusal.reason),
  };
}

/* ------------------------------------------------------------------ saving */

/** Why a section was not saved. */
export interface SectionRefusal {
  /** One sentence for the section as a whole. */
  readonly reason: string;
  /** What was wrong with which fields. Empty when the refusal names none. */
  readonly fields: FieldErrors;
}

/** What a section's write answers. */
export type SectionCommitResult =
  /** Every change in the section was written. */
  | { readonly ok: true }
  /** None of it was. `fields` routes what was wrong back to the inputs. */
  | { readonly ok: false; readonly reason: string; readonly fields?: FieldErrors };

/**
 * What a card gives the save model for its section.
 *
 * `commit` is the atomicity: it is called once per save with *all* of the section's changes,
 * and it must write all of them or none — one request to an operation that validates before it
 * writes, which is what every `PATCH` under `/api/v1/settings` is.
 */
export interface SectionCommitter {
  /** The section's saved values, as the page last read them. */
  readonly baseline: SectionValues;
  /**
   * Check the section before anything is sent.
   *
   * @param draft Every field as it stands.
   * @param changes Only the unsaved ones.
   * @returns An error per field that is wrong; empty when the section may be sent.
   */
  readonly validate?: (draft: SectionValues, changes: SectionValues) => FieldErrors;
  /**
   * Write the section.
   *
   * @param changes Only the unsaved fields.
   * @param draft Every field as it stands, for a write that sends the whole section.
   * @returns Whether it landed; when not, why and which fields.
   */
  readonly commit: (changes: SectionValues, draft: SectionValues) => Promise<SectionCommitResult>;
}

/** The committers of the sections currently on the page. */
export type Committers = ReadonlyMap<BatchSectionId, SectionCommitter>;

/** The sentence for a section the browser's own validation stopped. */
export const INVALID_REASON = "Some fields need attention.";

/**
 * The sentence for a section holding edits with no card on the page to write them.
 *
 * It should not happen — a card that leaves takes its edits with it — which is why it is said
 * rather than skipped: a save that wrote nothing must never report *saved*.
 */
export const NO_COMMITTER = "This section is not on the page to be saved. Reload and try again.";

/** A section the browser's validation refused, and what it found. */
export interface InvalidSection {
  readonly section: BatchSectionId;
  /** What was wrong with which fields. Never empty. */
  readonly fields: FieldErrors;
}

/**
 * Check every dirty section before anything is sent.
 *
 * All of them rather than the first, so a reader with mistakes in two sections is told about
 * both in one pass — and so that *anything invalid* means *nothing sent*.
 *
 * @param state The dirty state.
 * @param committers The sections on the page.
 * @returns The sections that may not be sent, in page order. Empty when the save may proceed.
 */
export function validateSave(state: SaveState, committers: Committers): readonly InvalidSection[] {
  return dirtySections(state).flatMap((section) => {
    const committer = committers.get(section);
    if (committer?.validate === undefined) return [];

    const fields = committer.validate(
      sectionDraft(state, section, committer.baseline),
      state.edits[section] ?? {},
    );

    return Object.keys(fields).length === 0 ? [] : [{ section, fields }];
  });
}

/** How a save ended. */
export type SaveOutcome =
  /** Every dirty section was written. */
  | { readonly kind: "saved"; readonly landed: readonly BatchSectionId[] }
  /** The browser's validation stopped it. Nothing was sent. */
  | { readonly kind: "invalid"; readonly invalid: readonly InvalidSection[] }
  /** The service refused a section. Those before it landed; those after it were not sent. */
  | {
      readonly kind: "refused";
      readonly landed: readonly BatchSectionId[];
      readonly section: BatchSectionId;
      readonly refusal: SectionRefusal;
      readonly unsent: readonly BatchSectionId[];
    };

/**
 * Save the page: validate everything, then write the dirty sections in order, stopping at the
 * first one the service refuses.
 *
 * @param state The dirty state at the moment **Save changes** was pressed.
 * @param committers The sections on the page.
 * @returns How it ended. A dirty section with no committer is a refusal ({@link NO_COMMITTER}),
 *   never a silent skip: the save stops there, as it does for any section that was not written.
 */
export async function commitSave(state: SaveState, committers: Committers): Promise<SaveOutcome> {
  const invalid = validateSave(state, committers);
  if (invalid.length > 0) return { kind: "invalid", invalid };

  const plan = dirtySections(state);
  const landed: BatchSectionId[] = [];

  for (const [index, section] of plan.entries()) {
    const committer = committers.get(section);

    const result: SectionCommitResult =
      committer === undefined
        ? { ok: false, reason: NO_COMMITTER }
        : await committer.commit(
            state.edits[section] ?? {},
            sectionDraft(state, section, committer.baseline),
          );

    if (!result.ok) {
      return {
        kind: "refused",
        landed,
        section,
        refusal: { reason: result.reason, fields: result.fields ?? {} },
        unsent: plan.slice(index + 1),
      };
    }

    landed.push(section);
  }

  return { kind: "saved", landed };
}

/**
 * Apply a save's outcome to the dirty state.
 *
 * @param state The dirty state the save was taken from.
 * @param outcome How the save ended.
 * @returns The next state: landed sections saved, refused ones carrying their errors.
 */
export function applyOutcome(state: SaveState, outcome: SaveOutcome): SaveState {
  if (outcome.kind === "invalid") {
    return outcome.invalid.reduce(
      (next, { section, fields }) => refuseSection(next, section, { reason: INVALID_REASON, fields }),
      state,
    );
  }

  const landed = outcome.landed.reduce(landSection, state);

  return outcome.kind === "saved"
    ? landed
    : refuseSection(landed, outcome.section, outcome.refusal);
}

/* ------------------------------------------------------------------ what the page says */

/** The head's primary action. */
export const SAVE_LABEL = "Save changes";

/** What it says while a save is in flight. */
export const SAVING_LABEL = "Saving…";

/** The dirty bar's other action. */
export const DISCARD_LABEL = "Discard";

/** Why **Save changes** is inert on a page with nothing unsaved. */
export const NOTHING_TO_SAVE = "No setting has been changed, so there is nothing to save.";

/** What is announced when every dirty section was written. */
export const SAVED_NOTICE = "Settings saved.";

/** What a section's write is reported as when it failed without an answer from the service. */
export const SAVE_INTERRUPTED =
  "The save did not complete. Whether this section changed is not known — reload to see what is saved.";

/**
 * The button's label — `Save changes (3)` while fields are unsaved, `Save changes` otherwise.
 *
 * @param pending How many fields are unsaved.
 * @returns The label.
 */
export function saveLabel(pending: number): string {
  return pending > 0 ? `${SAVE_LABEL} (${String(pending)})` : SAVE_LABEL;
}

/**
 * The dirty bar's sentence — `1 unsaved change`, `3 unsaved changes`.
 *
 * @param pending How many fields are unsaved. Positive.
 * @returns The sentence.
 */
export function dirtyLabel(pending: number): string {
  return `${String(pending)} unsaved ${pending === 1 ? "change" : "changes"}`;
}

/** What a field is called in the summary of a refusal: a label per field name, per section. */
export type FieldLabels = ReadonlyMap<BatchSectionId, Readonly<Record<string, string>>>;

/**
 * One section's refusal as a sentence naming the fields — `Workspace: Tenant domain — already
 * in use by another workspace.`
 *
 * @param section The section.
 * @param refusal Why it was not saved.
 * @param labels What its fields are called. A field with no label is named by its key.
 * @returns The sentence.
 */
function refusalSentence(
  section: BatchSectionId,
  refusal: SectionRefusal,
  labels: FieldLabels,
): string {
  const title = settingsSection(section).title;
  const fields = Object.entries(refusal.fields);
  if (fields.length === 0) return `${title}: ${refusal.reason}`;

  const named = fields
    .map(([field, error]) => `${labels.get(section)?.[field] ?? field} — ${error}`)
    .join("; ");

  return `${title}: ${named}`;
}

/**
 * What the page says about a save that did not fully land — which section, which field, and
 * what was and was not written.
 *
 * @param outcome How the save ended.
 * @param labels What each section's fields are called.
 * @returns The sentence, or `null` for a save that landed whole.
 */
export function failureSummary(outcome: SaveOutcome, labels: FieldLabels): string | null {
  if (outcome.kind === "saved") return null;

  if (outcome.kind === "invalid") {
    const sentences = outcome.invalid.map(({ section, fields }) =>
      refusalSentence(section, { reason: INVALID_REASON, fields }, labels),
    );

    return `Nothing was saved. ${sentences.join(" ")}`;
  }

  const parts = [`Not saved — ${refusalSentence(outcome.section, outcome.refusal, labels)}`];

  if (outcome.landed.length > 0) {
    parts.push(`Saved: ${sectionTitles(outcome.landed)}.`);
  }
  if (outcome.unsent.length > 0) {
    parts.push(`Not sent: ${sectionTitles(outcome.unsent)}.`);
  }

  return parts.join(" ");
}

/**
 * Section titles as a list in a sentence.
 *
 * @param sections The sections.
 * @returns Their titles, comma-separated.
 */
function sectionTitles(sections: readonly BatchSectionId[]): string {
  return sections.map((section) => settingsSection(section).title).join(", ");
}

/**
 * The first field a refusal names — where focus goes, so the reader is taken to the input the
 * error is about.
 *
 * @param outcome How the save ended.
 * @returns The section and the field, or `null` when nothing was refused or no field was named.
 */
export function firstRefusedField(
  outcome: SaveOutcome,
): { readonly section: BatchSectionId; readonly field: string } | null {
  if (outcome.kind === "saved") return null;

  const refused =
    outcome.kind === "invalid"
      ? outcome.invalid.map(({ section, fields }) => ({ section, fields }))
      : [{ section: outcome.section, fields: outcome.refusal.fields }];

  for (const { section, fields } of refused) {
    const field = Object.keys(fields)[0];
    if (field !== undefined) return { section, field };
  }

  return null;
}

/**
 * The id a field's control carries — `settings-workspace-field-domain`.
 *
 * One spelling, so the card that draws the input and the save model that moves focus to it
 * after a refusal mean the same element. The `field` in the middle keeps it apart from the
 * section's own ids (`app/settings/view.ts`'s `sectionTitleId`), whatever a field is called.
 *
 * @param section The section the field belongs to.
 * @param field The field's name.
 * @returns The id.
 */
export function fieldId(section: BatchSectionId, field: string): string {
  return `settings-${section}-field-${field}`;
}
