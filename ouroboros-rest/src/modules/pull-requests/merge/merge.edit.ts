/**
 * What an edit of a merge plan changes — the pure half of `PATCH …/merge-plan`.
 *
 * AY.7 ([#369](https://github.com/NobuData/ouroboros/issues/369)), over V058's plan
 * ([#355](https://github.com/NobuData/ouroboros/issues/355)). The Merge plan card edits four things
 * — the commit message, the three action toggles and the epic the third one annotates — and each
 * persists on its own, so an edit names only what it changes:
 *
 * ```
 * sent                          the plan afterwards
 * {closeTicket: false}          close_ticket off, everything else as it was
 * {epicId: "…0001"}             the epic chosen, the toggle as it was
 * {epicId: null}                no epic, and back-annotate OFF — there is nothing left to annotate
 * {backAnnotateEpic: true}      on — refused when the plan names no epic
 * {epicId: null,                refused: the edit contradicts itself
 *  backAnnotateEpic: true}
 * ```
 *
 * **Absent is not null.** An absent field is left alone; `null` clears the epic, the only field
 * that can be cleared. The two are told apart with `!== undefined`: this service targets ES2023,
 * so a DTO instance carries every declared field whether or not the request named it.
 *
 * **Strategy and delete-branch are not here.** They are the pinned policy's, drawn as a tag, and
 * the route's DTO refuses them as unknown fields.
 *
 * Pure, and it imports nothing: the repository names {@link MergePlanChanges} in its own
 * statements, so this file knows a plan only by the five fields it edits.
 */

/** The fields of a plan an edit may change. */
export interface MergePlanFields {
  /** The merge commit's message. */
  readonly commitMessage: string;
  /** Close the canonical ticket on merge. */
  readonly closeTicket: boolean;
  /** Comment the evidence summary on the host PR. */
  readonly commentEvidence: boolean;
  /** Back-annotate the roadmap epic in `epicId`. */
  readonly backAnnotateEpic: boolean;
  /** The epic to back-annotate, or null. */
  readonly epicId: string | null;
}

/** What an edit sends: any of the fields, each absent when it is to be left alone. */
export type MergePlanEdit = { readonly [Field in keyof MergePlanFields]?: MergePlanFields[Field] };

/** The fields an edit actually changes — what is written, and what the audit row lists. */
export type MergePlanChanges = Partial<MergePlanFields>;

/** Every editable field, in the order the card draws them. */
export const EDITABLE_FIELDS = [
  "commitMessage",
  "closeTicket",
  "commentEvidence",
  "backAnnotateEpic",
  "epicId",
] as const satisfies readonly (keyof MergePlanFields)[];

/**
 * The plan's editable fields after an edit.
 *
 * @param current - The plan as stored.
 * @param edit - What was sent.
 * @returns The five fields as they would be written. Clearing the epic switches back-annotate off
 *   unless the edit itself asks for it on — a contradiction {@link needsEpic} then reports.
 */
export function editedFields(current: MergePlanFields, edit: MergePlanEdit): MergePlanFields {
  const epicId = edit.epicId === undefined ? current.epicId : edit.epicId;
  const cleared = edit.epicId === null && current.epicId !== null;

  return {
    commitMessage: edit.commitMessage ?? current.commitMessage,
    closeTicket: edit.closeTicket ?? current.closeTicket,
    commentEvidence: edit.commentEvidence ?? current.commentEvidence,
    backAnnotateEpic: edit.backAnnotateEpic ?? (cleared ? false : current.backAnnotateEpic),
    epicId,
  };
}

/**
 * What differs between the plan as stored and as edited.
 *
 * @param current - The plan as stored.
 * @param next - {@link editedFields}' answer.
 * @returns Only the fields whose value changed — empty when the edit changes nothing.
 */
export function changedFields(current: MergePlanFields, next: MergePlanFields): MergePlanChanges {
  const changes: { -readonly [Field in keyof MergePlanFields]?: MergePlanFields[Field] } = {};

  if (next.commitMessage !== current.commitMessage) changes.commitMessage = next.commitMessage;
  if (next.closeTicket !== current.closeTicket) changes.closeTicket = next.closeTicket;
  if (next.commentEvidence !== current.commentEvidence) {
    changes.commentEvidence = next.commentEvidence;
  }
  if (next.backAnnotateEpic !== current.backAnnotateEpic) {
    changes.backAnnotateEpic = next.backAnnotateEpic;
  }
  if (next.epicId !== current.epicId) changes.epicId = next.epicId;

  return changes;
}

/**
 * Whether an edit changes nothing.
 *
 * @param changes - {@link changedFields}' answer.
 * @returns `true` when no field differs.
 */
export function changesNothing(changes: MergePlanChanges): boolean {
  return EDITABLE_FIELDS.every((field) => changes[field] === undefined);
}

/**
 * Whether the edited plan would back-annotate an epic it does not name — V058's
 * `pr_merge_plans_back_annotate_has_epic`, asked before the write.
 *
 * @param next - {@link editedFields}' answer.
 * @returns `true` when back-annotate is on with no epic.
 */
export function needsEpic(next: MergePlanFields): boolean {
  return next.backAnnotateEpic && next.epicId === null;
}

/**
 * A stored plan's editable fields.
 *
 * @param plan - The plan — anything carrying the five fields, a stored plan above all.
 * @returns The five fields, and nothing else the plan carries.
 */
export function fieldsOf(plan: MergePlanFields): MergePlanFields {
  return {
    commitMessage: plan.commitMessage,
    closeTicket: plan.closeTicket,
    commentEvidence: plan.commentEvidence,
    backAnnotateEpic: plan.backAnnotateEpic,
    epicId: plan.epicId,
  };
}
