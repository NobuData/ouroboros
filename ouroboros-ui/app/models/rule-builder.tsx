"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useId, useState, useTransition } from "react";

import { ShellOverlay } from "@/app/shell/overlay";
import { Button, SelectField, TextField } from "@/app/ui";

import { addRule, readRuleTargets } from "./rule-actions";
import {
  ACTIONS,
  ACTION_LABELS,
  ADD_RULE,
  BUILDER_NOTE,
  BUILDER_TITLE,
  CANCEL,
  DIFF_KINDS,
  DIFF_KIND_LABELS,
  EFFORT_LABELS,
  EFFORT_LEVELS,
  PREDICATES,
  PREDICATE_LABELS,
  type RuleDraft,
  type RuleTargetsReading,
  SAVE_RULE,
  TARGETS_LOADING,
  THINKING_CHOICES,
  THINKING_LABELS,
  composeRule,
  initialDraft,
  needsTarget,
  withAliases,
} from "./rules";

import "./models.css";

/**
 * Mockup 06's **+ Add rule** — the button, and the builder dialog it opens
 * ([#204](https://github.com/NobuData/ouroboros/issues/204)).
 *
 * The dialog composes a rule from selects and nothing else: a predicate and its operand, an
 * action, and the target the action names. There is no text box for the sentence, because
 * the sentence is the server's — V018 derives it from the structure when the rule is written,
 * and the card prints what comes back. The one typed value is a GitHub label name, which is
 * an *operand* the grammar takes from outside the product's vocabulary, not a sentence.
 *
 * Every decision about what the selects offer and what a draft becomes is
 * `app/models/rules.ts`'s; this file holds the draft, reads the registry, and sends.
 *
 * ### The registry is read when the dialog opens, in the press that opens it
 *
 * The alias select needs every alias the workspace has, unbound ones included, and that list
 * is not on the page. It is read here rather than with the matrix for the reason
 * `app/models/rule-actions.ts` gives, and the read starts **in the same press** that opens
 * the dialog rather than in an effect, so the dialog's first paint is already the *Reading
 * the registry…* state — the pattern `app/providers/audit-trail.tsx` established for the
 * audit sheet.
 *
 * ### The submit control is inert with a reason, never disabled after the fact
 *
 * `composeRule` is total over the selects, so the only ways a draft can fail to be a rule are
 * a blank label and a workspace with nothing to name — and both are a `reason` on the
 * button, which is how a control is switched off in this product: with the sentence that
 * says what is missing. A press that reaches the server and is refused stays in the dialog
 * with the server's sentence, and the draft as it was.
 */

/** What the builder takes. */
export interface RuleBuilderProps {
  /**
   * The workspace's task kinds, in the matrix's order — the target select's options.
   *
   * Handed down rather than read, because the page already holds them: they are the rows of
   * the matrix beside this card, and a second read would be a second opinion about which
   * kinds the workspace has.
   */
  readonly taskKinds: readonly string[];
}

/**
 * One option's value, checked against the list the select was built from.
 *
 * A `<select>` can emit only its options' values, so this is belt to the braces — but the
 * draft's fields are unions, and a cast at every `onChange` would be five places a string
 * is promised to be something it might not be.
 *
 * @param list The values the select offers.
 * @param value What the event carried.
 * @param fallback What to hold when the value is not in the list.
 * @returns The value, typed, or the fallback.
 */
function pick<T extends string>(list: readonly T[], value: string, fallback: T): T {
  return (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * The button and its dialog.
 *
 * @param props See {@link RuleBuilderProps}.
 * @returns The **+ Add rule** button, and the dialog when it is open.
 */
export function RuleBuilder({ taskKinds }: RuleBuilderProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // `null` while the registry is on its way — the state the dialog opens in.
  const [targets, setTargets] = useState<RuleTargetsReading | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(() => initialDraft(taskKinds));
  const [failure, setFailure] = useState<string | null>(null);
  const id = useId();

  const aliases = targets?.ok ? targets.aliases.map((target) => target.alias) : [];
  const composed = composeRule(draft, taskKinds, aliases);

  /** Open the dialog with a fresh draft, and start the read it needs. */
  function begin(): void {
    setDraft(initialDraft(taskKinds));
    setTargets(null);
    setFailure(null);
    setOpen(true);

    startTransition(async () => {
      const reading = await readRuleTargets();

      setTargets(reading);
      if (reading.ok) {
        setDraft((current) => withAliases(current, reading.aliases.map((target) => target.alias)));
      }
    });
  }

  /** Close without writing. The draft is discarded: the next open starts from the seed. */
  function close(): void {
    setOpen(false);
  }

  /** Send the composed rule, and close on success. */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    // The button carries a reason while the draft is not a rule and does not submit, so this
    // is reached only with a rule to send — but a form can be submitted from a field, so it
    // is checked again here rather than assumed.
    if (pending || !composed.ok) return;

    const { rule } = composed;

    setFailure(null);

    startTransition(async () => {
      const result = await addRule(rule);

      if (!result.ok) {
        setFailure(result.reason);
        return;
      }

      setOpen(false);
      // The route re-reads the matrix, and the new row arrives with the sentence the server
      // wrote for it — the only sentence this card will ever print for the rule.
      router.refresh();
    });
  }

  /**
   * Why the submit control cannot act, or `undefined` when it can.
   *
   * The registry's state comes first: a draft naming an alias cannot be judged until the
   * list is here, and a reader should see *reading* rather than *no aliases* while it is.
   */
  function saveReason(): string | undefined {
    if (needsTarget(draft.action) && targets === null) return TARGETS_LOADING;
    if (needsTarget(draft.action) && targets !== null && !targets.ok) return targets.reason;

    return composed.ok ? undefined : composed.reason;
  }

  return (
    <>
      <Button className="models-rules__add" onClick={begin} size="sm" tone="ghost">
        {ADD_RULE}
      </Button>

      <ShellOverlay label={BUILDER_TITLE} onClose={close} open={open}>
        <h2 className="shell-overlay__title">{BUILDER_TITLE}</h2>
        <p className="shell-overlay__note">{BUILDER_NOTE}</p>

        <form className="models-builder" onSubmit={submit}>
          <fieldset className="models-builder__group">
            <legend className="models-builder__legend">When</legend>

            <SelectField
              id={`${id}-predicate`}
              label="Condition"
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setDraft({
                  ...draft,
                  predicate: pick(PREDICATES, event.target.value, draft.predicate),
                })
              }
              value={draft.predicate}
            >
              {PREDICATES.map((predicate) => (
                <option key={predicate} value={predicate}>
                  {PREDICATE_LABELS[predicate]}
                </option>
              ))}
            </SelectField>

            {draft.predicate === "effort_gte" && (
              <SelectField
                id={`${id}-effort`}
                label="Effort"
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setDraft({ ...draft, effort: pick(EFFORT_LEVELS, event.target.value, draft.effort) })
                }
                value={draft.effort}
              >
                {EFFORT_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {EFFORT_LABELS[level]}
                  </option>
                ))}
              </SelectField>
            )}

            {draft.predicate === "label" && (
              <TextField
                hint="As GitHub spells it — compared whole and case-sensitively."
                id={`${id}-label`}
                label="Label"
                maxLength={100}
                mono
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setDraft({ ...draft, label: event.target.value })
                }
                value={draft.label}
              />
            )}

            {draft.predicate === "diff_kind" && (
              <SelectField
                id={`${id}-diff`}
                label="Diff"
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setDraft({ ...draft, diffKind: pick(DIFF_KINDS, event.target.value, draft.diffKind) })
                }
                value={draft.diffKind}
              >
                {DIFF_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {DIFF_KIND_LABELS[kind]}
                  </option>
                ))}
              </SelectField>
            )}
          </fieldset>

          <fieldset className="models-builder__group">
            <legend className="models-builder__legend">Then</legend>

            <SelectField
              id={`${id}-action`}
              label="Action"
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setDraft({ ...draft, action: pick(ACTIONS, event.target.value, draft.action) })
              }
              value={draft.action}
            >
              {ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {ACTION_LABELS[action]}
                </option>
              ))}
            </SelectField>

            {needsTarget(draft.action) && (
              <>
                <SelectField
                  id={`${id}-kind`}
                  label="Task kind"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setDraft({ ...draft, taskKind: event.target.value })
                  }
                  value={draft.taskKind}
                >
                  {taskKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </SelectField>

                {targets === null ? (
                  <p className="shell-overlay__note" role="status">
                    {TARGETS_LOADING}
                  </p>
                ) : targets.ok ? (
                  <SelectField
                    id={`${id}-alias`}
                    label="Alias"
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setDraft({ ...draft, alias: event.target.value })
                    }
                    value={draft.alias}
                  >
                    {targets.aliases.map((target) => (
                      // The alias and what it currently means, so a rule is composed against
                      // the same resolution line the matrix prints for the alias.
                      <option key={target.alias} value={target.alias}>
                        {target.alias} — {target.resolution}
                      </option>
                    ))}
                  </SelectField>
                ) : (
                  <p className="models-builder__failure" role="alert">
                    {targets.reason}
                  </p>
                )}
              </>
            )}

            {draft.action === "use_alias" && (
              <SelectField
                id={`${id}-thinking`}
                label="Thinking"
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setDraft({
                    ...draft,
                    thinking: pick(THINKING_CHOICES, event.target.value, draft.thinking),
                  })
                }
                value={draft.thinking}
              >
                {THINKING_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {THINKING_LABELS[choice]}
                  </option>
                ))}
              </SelectField>
            )}
          </fieldset>

          {failure !== null && (
            <p className="models-builder__failure" role="alert">
              {failure}
            </p>
          )}

          <div className="models-builder__actions">
            <Button reason={saveReason()} tone="primary" type="submit">
              {SAVE_RULE}
            </Button>
            <Button onClick={close} tone="ghost" type="button">
              {CANCEL}
            </Button>
          </div>
        </form>
      </ShellOverlay>
    </>
  );
}
