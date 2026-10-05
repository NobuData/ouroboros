"use client";

import { type FocusEvent, type ReactNode, useEffect, useId, useState } from "react";

import type { GlobPreview } from "@/app/globs/glob";
import { Button, Tag, Toggle, cx } from "@/app/ui";

import { POLICIES_READ_ONLY, TERMS_NOT_EDITABLE, switchLabel } from "./card-view";
import {
  type AutoMergeTerms,
  type CoreRuleId,
  type DryRunTerms,
  type HumanReviewTerms,
  type PolicyDrafts,
  type PolicyRule,
  type ProtectedPathsTerms,
  RULE_NAMES,
  RULE_REASONS,
  type SpendGuardTerms,
  composeRule,
  ruleChips,
} from "./document";
import {
  AutoMergeEditor,
  DryRunEditor,
  type EditorControl,
  HumanReviewEditor,
  ProtectedPathsEditor,
  SpendGuardEditor,
  controlId,
} from "./rule-editors";

import "./policy-rules.css";

/**
 * One rule of the Autonomy policies card — mockup 17's `.policy-row`
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)): the switch, what the rule
 * is, why it exists, and its terms chips.
 *
 * ### The chips are the document's, and they are the way in
 *
 * Every chip is drawn by `ruleChips` from the rule **as the document would hold it for the
 * draft** (`composeRule`) — never from a constant — so the row states the saved policy when
 * nothing is edited and the pending one the moment something is. For a reader who may edit,
 * each chip is a button that opens the rule's condition editor under the terms and puts focus
 * on the control for the chip pressed: `effort ≤ M` lands on the effort select, `$2.50/run` on
 * the per-run amount.
 *
 * ### Three readers, nothing dead
 *
 * - **May not edit** (a member or viewer): the switch is a read-only indicator in its real
 *   state, with the reason; the chips are static terms; there is no editor.
 * - **May edit, and the editor can represent the conditions**: switch, chip buttons, editor.
 * - **May edit, but the conditions are of a shape the editor cannot represent** (`terms: null`):
 *   the chips are static and a note says the conditions stay exactly as published; the switch
 *   still turns the rule on and off.
 *
 * While a save is in flight (`editable` false for a reader who may edit) every control stays
 * drawn and is inert.
 */

/** What a row takes. */
export interface RuleRowProps<Id extends CoreRuleId> {
  /** Which rule. */
  readonly id: Id;
  /** The rule as the card is editing it. */
  readonly draft: PolicyDrafts[Id];
  /** The rule as the working document holds it. */
  readonly saved: PolicyRule;
  /** Whether the reader's role allows editing. */
  readonly mayEdit: boolean;
  /** Whether edits are accepted now: `mayEdit`, and no save in flight. */
  readonly editable: boolean;
  /** Whether the rule has unsaved edits. */
  readonly dirty: boolean;
  /** What the last save found wrong with this rule. */
  readonly error?: string;
  /** The switch's id — where the save model moves focus on a refusal. */
  readonly switchId: string;
  /** Called with the rule's next draft. */
  readonly onChange: (draft: PolicyDrafts[Id]) => void;
  /** What a list of globs matches, asked of the service. */
  readonly previewPaths: (globs: readonly string[]) => Promise<GlobPreview>;
}

/** The marker on a rule with unsaved edits — in words, since a hue alone says nothing. */
export const EDITED_MARK = "edited";

/** The button that closes a rule's editor. */
export const DONE = "Done";

/** The way into the editor of a rule that has no chip to press. */
export const ADD_CONDITION = "Add a path pattern";

/** Why a switch is inert while a save is in flight. */
export const SAVING_REASON = "Saving…";

/**
 * A chip's accessible name as a button.
 *
 * @param chip The chip's text.
 * @param ruleName The rule's name.
 * @returns `effort ≤ M — edit the conditions of Auto-merge when all gates green`.
 */
export function chipButtonLabel(chip: string, ruleName: string): string {
  return `${chip} — edit the conditions of ${ruleName}`;
}

/**
 * A rule's editor region, as its accessible name.
 *
 * @param ruleName The rule's name.
 * @returns `Conditions of Spend guard`.
 */
export function editorLabel(ruleName: string): string {
  return `Conditions of ${ruleName}`;
}

/**
 * The editor control a chip leads to, read from the chip's own text — so it holds whatever
 * order the document lists its terms in.
 *
 * @param id The rule.
 * @param chip The chip's text.
 * @returns The control.
 */
export function controlOfChip(id: CoreRuleId, chip: string): EditorControl {
  switch (id) {
    case "auto_merge":
    case "human_review":
      return /^(?:OR )?effort /.test(chip) ? "effort" : "label";
    case "protected_paths":
      return "globs";
    case "spend_guard":
      return chip.startsWith("monthly cap") ? "monthly" : "per-run";
    case "dry_run_new_repos":
      return "loops";
  }
}

/** Which chip opened the editor, and the control it stands for — a new value per press, so a second chip moves focus again. */
interface OpenEditor {
  readonly chip: number;
  readonly control: EditorControl;
}

/**
 * The row.
 *
 * @param props See {@link RuleRowProps}.
 * @returns The row, with its editor under the terms while one is open.
 * @typeParam Id The rule.
 */
export function RuleRow<Id extends CoreRuleId>({
  id,
  draft,
  saved,
  mayEdit,
  editable,
  dirty,
  error,
  switchId,
  onChange,
  previewPaths,
}: RuleRowProps<Id>) {
  const base = useId();
  const panelId = `${base}-editor`;
  const name = RULE_NAMES[id];
  const chips = ruleChips(id, composeRule(id, draft, saved));
  const structured = mayEdit && draft.terms !== null;

  const [open, setOpen] = useState<OpenEditor | null>(null);
  const shown = structured ? open : null;

  // Once the editor is in the document, take the reader to the control their chip stands for.
  useEffect(() => {
    if (shown === null) return;

    const control = controlId(base, shown.control);
    // The shared glob editor derives its add field's id from the one it is given.
    const target =
      document.getElementById(control) ??
      document.getElementById(`${control}-add`) ??
      document.getElementById(panelId);
    target?.focus();
  }, [shown, base, panelId]);

  /**
   * Replace the draft's terms, keeping its switch.
   *
   * @param terms The next terms.
   */
  function setTerms(terms: NonNullable<PolicyDrafts[Id]["terms"]>): void {
    if (!editable) return;

    onChange({ ...draft, terms } as PolicyDrafts[Id]);
  }

  /**
   * A chip was pressed: open the editor on its control, or close it when it is the chip that
   * opened it.
   *
   * @param chip The chip's index.
   * @param text The chip's text.
   */
  function press(chip: number, text: string): void {
    setOpen(shown?.chip === chip ? null : { chip, control: controlOfChip(id, text) });
  }

  /**
   * Focus sent to the switch's seat (the save model's refusal) goes on to the switch itself.
   *
   * @param event The focus event.
   */
  function forwardFocus(event: FocusEvent<HTMLSpanElement>): void {
    if (event.target === event.currentTarget) event.currentTarget.querySelector("button")?.focus();
  }

  return (
    <div
      aria-label={name}
      className={cx("policy-rule", dirty && "policy-rule--dirty")}
      role="group"
    >
      <span className="policy-rule__switch" id={switchId} onFocus={forwardFocus} tabIndex={-1}>
        <Toggle
          checked={draft.enabled}
          label={switchLabel(id, draft.enabled)}
          onClick={() => {
            onChange({ ...draft, enabled: !draft.enabled } as PolicyDrafts[Id]);
          }}
          reason={!mayEdit ? POLICIES_READ_ONLY : !editable ? SAVING_REASON : undefined}
        />
      </span>

      <div className="policy-rule__body">
        <p className="policy-rule__what">
          {name} {dirty && <Tag className="policy-rule__edited">{EDITED_MARK}</Tag>}
        </p>
        <p className="policy-rule__why">{RULE_REASONS[id]}</p>

        <div className="policy-rule__terms">
          {chips.map((chip, index) =>
            structured ? (
              <button
                aria-controls={panelId}
                aria-expanded={shown !== null}
                aria-label={chipButtonLabel(chip, name)}
                className={cx("policy-rule__term", shown?.chip === index && "policy-rule__term--open")}
                // Chips carry no id of their own: two globs may abbreviate to one text.
                key={`${String(index)}:${chip}`}
                onClick={() => {
                  press(index, chip);
                }}
                type="button"
              >
                {chip}
              </button>
            ) : (
              <Tag key={`${String(index)}:${chip}`}>{chip}</Tag>
            ),
          )}
          {structured && chips.length === 0 && (
            <button
              aria-controls={panelId}
              aria-expanded={shown !== null}
              className={cx("policy-rule__term", "policy-rule__term--add")}
              onClick={() => {
                press(-1, "");
              }}
              type="button"
            >
              {ADD_CONDITION}
            </button>
          )}
        </div>

        {mayEdit && draft.terms === null && (
          <p className="policy-rule__note" role="note">
            {TERMS_NOT_EDITABLE}
          </p>
        )}

        {error !== undefined && (
          <p className="policy-rule__error" role="alert">
            {error}
          </p>
        )}

        {shown !== null && (
          <div
            aria-label={editorLabel(name)}
            className="policy-rule__editor"
            id={panelId}
            role="group"
            tabIndex={-1}
          >
            {editorOf(id, draft.terms, {
              idBase: base,
              readOnly: !editable,
              setTerms: setTerms as (terms: unknown) => void,
              previewPaths,
            })}
            <div className="policy-rule__editor-actions">
              <Button
                onClick={() => {
                  setOpen(null);
                }}
                size="sm"
                tone="ghost"
              >
                {DONE}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The editor for a rule's terms.
 *
 * @param id The rule.
 * @param terms Its terms — never `null` here; the row opens no editor for a rule without them.
 * @param wiring The id prefix, whether the controls are inert, where the next terms go, and the
 *   glob preview.
 * @returns The editor.
 */
function editorOf(
  id: CoreRuleId,
  terms: unknown,
  wiring: {
    readonly idBase: string;
    readonly readOnly: boolean;
    readonly setTerms: (terms: unknown) => void;
    readonly previewPaths: (globs: readonly string[]) => Promise<GlobPreview>;
  },
): ReactNode {
  const { idBase, readOnly, setTerms, previewPaths } = wiring;
  const shared = { idBase, readOnly, onChange: setTerms };

  switch (id) {
    case "auto_merge":
      return <AutoMergeEditor {...shared} terms={terms as AutoMergeTerms} />;
    case "human_review":
      return <HumanReviewEditor {...shared} terms={terms as HumanReviewTerms} />;
    case "protected_paths":
      return (
        <ProtectedPathsEditor
          {...shared}
          previewPaths={previewPaths}
          terms={terms as ProtectedPathsTerms}
        />
      );
    case "spend_guard":
      return <SpendGuardEditor {...shared} terms={terms as SpendGuardTerms} />;
    case "dry_run_new_repos":
      return <DryRunEditor {...shared} terms={terms as DryRunTerms} />;
  }
}
