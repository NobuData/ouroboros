"use client";

import { useRouter } from "next/navigation";
import { useId, useOptimistic, useState, useTransition } from "react";

import type { EscalationRule } from "@/app/api/routing";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Card, CardHead, EmptyState, Tag, Toggle, cx } from "@/app/ui";

import { removeRule, setRuleEnabled } from "./rule-actions";
import { RuleBuilder } from "./rule-builder";
import {
  CANCEL,
  DELETE_NOTE,
  DELETE_RULE,
  DELETE_TITLE,
  NO_RULES_NOTE,
  NO_RULES_TITLE,
  RULES_TITLE,
  RULE_OFF,
  activeCountLabel,
  activeRuleCount,
  deleteRuleLabel,
  ruleSegments,
  ruleSwitchLabel,
} from "./rules";

import "./models.css";

/**
 * Mockup 06's **ESCALATION RULES** card ([#204](https://github.com/NobuData/ouroboros/issues/204)):
 * one row per rule — the server's sentence, its switch — the `N active` count, and the
 * **+ Add rule** builder.
 *
 * Every sentence is the database's generated `display`, rendered through
 * `app/models/rules.ts`'s `ruleSegments` — which decides only which characters of it are
 * violet — and never composed here. That is what makes *the card and the matrix's escalation
 * column always agree* a property of the schema: both print one string because there is one.
 *
 * ### The one Client Component this card needs, and what it holds
 *
 * A switch is a press, and a press that waited for a round trip before moving would be the
 * one control on this page that felt broken. So each row's switch is optimistic, on the
 * pattern `app/dashboard/auto-merge-switch.tsx` argues for at length: `useOptimistic` scopes
 * the pressed position to the transition that made it, so a write that did not land needs no
 * rollback, a write that landed on a different value is drawn from the fresh read, and a
 * change nobody made here arrives as a changed prop. `router.refresh()` inside the transition
 * is what makes the card's `N active` follow the **read** rather than the press — the count
 * is a fact about the server's rules, not about this browser's switches.
 *
 * ### A member sees no switch, no builder and no delete — absent, not disabled
 *
 * The ticket is explicit, and it is the opposite of the dashboard's read-only switch. The
 * difference is what the card is *for*: the pulse switch is a setting whose position a member
 * needs to see, and a disabled control is how a position is shown to somebody who may not
 * move it. A rule's position is already in the sentence's treatment and in the count, so a
 * member is shown the rules and, for a suspended one, the word *off* — and nothing that looks
 * like a control they cannot use. The role gate that decides is the service's, and
 * `app/models/rule-actions.ts` says what happens to a member who reaches a write anyway.
 */

/** The id the card's `aria-labelledby` points at. */
const RULES_TITLE_ID = "models-rules-title";

/** What the card takes. */
export interface RulesCardProps {
  /** Every rule, enabled and disabled alike, in evaluation order — the matrix's own list. */
  readonly rules: readonly EscalationRule[];
  /** The workspace's task kinds, in the matrix's order — what the builder may name. */
  readonly taskKinds: readonly string[];
  /**
   * Whether this reader may change rules — `app/api/membership.ts`'s `mayAdminister`,
   * decided at the gate.
   *
   * A boolean rather than the role itself, because the card asks one question of it and a
   * card holding a role would be a second place deciding what a role may do.
   */
  readonly mayAdminister: boolean;
}

/**
 * The card.
 *
 * @param props See {@link RulesCardProps}.
 * @returns The card: the rows, or the empty state, and the builder for a role that may add.
 */
export function RulesCard({ rules, taskKinds, mayAdminister }: RulesCardProps) {
  return (
    <Card aria-labelledby={RULES_TITLE_ID} as="section" fill>
      <CardHead
        beside={<Tag>{activeCountLabel(activeRuleCount(rules))}</Tag>}
        title={RULES_TITLE}
        titleId={RULES_TITLE_ID}
      />

      {rules.length === 0 ? (
        <EmptyState fill note={NO_RULES_NOTE} title={NO_RULES_TITLE} />
      ) : (
        <ul className="models-rules">
          {rules.map((rule) => (
            <RuleRow key={rule.id} mayAdminister={mayAdminister} rule={rule} />
          ))}
        </ul>
      )}

      {mayAdminister && <RuleBuilder taskKinds={taskKinds} />}
    </Card>
  );
}

/**
 * The sentence, with the alias in the model hue.
 *
 * The segments concatenate to `display` exactly; the only thing this adds is a class on the
 * run `ruleSegments` decided was the alias.
 *
 * @param props.rule The rule.
 * @returns The sentence.
 */
function RuleSentence({ rule }: Readonly<{ rule: EscalationRule }>) {
  return (
    <span className="models-rules__sentence">
      {ruleSegments(rule).map((segment, index) =>
        segment.alias ? (
          <span className="models-rules__alias" key={index}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * One row: the sentence, and — for a role that may — its switch and its delete.
 *
 * @param props.rule The rule.
 * @param props.mayAdminister Whether to draw the controls at all.
 * @returns The row.
 */
function RuleRow({
  rule,
  mayAdminister,
}: Readonly<{ rule: EscalationRule; mayAdminister: boolean }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // What this browser draws while it waits to be told. Between transitions it is the prop
  // itself, which is what makes the server the only lasting authority on this switch.
  const [checked, setChecked] = useOptimistic(rule.enabled);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();

  /**
   * Move the switch, then ask the server to say where it stands.
   *
   * A press while a write is in flight is ignored rather than queued: the second press would
   * race the first one's refresh, and a switch that ends up in the position of whichever
   * request answered last is worse than one that waits half a second.
   */
  function press(): void {
    if (pending) return;

    const next = !checked;

    setFailure(null);

    startTransition(async () => {
      setChecked(next);

      const result = await setRuleEnabled(rule.id, next);

      if (!result.ok) {
        setFailure(result.reason);
        return;
      }

      router.refresh();
    });
  }

  /** Remove the rule, once the confirmation has been answered. */
  function destroy(): void {
    setConfirming(false);
    if (pending) return;

    setFailure(null);

    startTransition(async () => {
      const result = await removeRule(rule.id);

      if (!result.ok) {
        setFailure(result.reason);
        return;
      }

      // The row leaves with the fresh read rather than being hidden here, so what the card
      // shows is what the server holds and nothing else.
      router.refresh();
    });
  }

  return (
    <li className={cx("models-rules__row", !checked && "models-rules__row--off")}>
      <div className="models-rules__line">
        <RuleSentence rule={rule} />

        {mayAdminister ? (
          <span className="models-rules__controls">
            <Toggle
              checked={checked}
              describedBy={failure === null ? undefined : noteId}
              label={ruleSwitchLabel(rule)}
              onClick={press}
            />
            <Button
              aria-label={deleteRuleLabel(rule)}
              onClick={() => setConfirming(true)}
              size="sm"
              tone="ghost"
            >
              Delete
            </Button>
          </span>
        ) : (
          // A member has no switch to read the position from, so a suspended rule says so in
          // a word. An applied one says nothing: three rows announcing *on* would drown the
          // one that is not.
          !rule.enabled && <Tag className="models-rules__off">{RULE_OFF}</Tag>
        )}
      </div>

      {failure !== null && (
        // An `alert`: the reader pressed something and it did not take, and the element is
        // rendered only when there is something to say, so it is announced on the press that
        // produced it rather than sitting empty.
        <p className="models-rules__note" id={noteId} role="alert">
          {failure}
        </p>
      )}

      {mayAdminister && (
        <ShellOverlay label={DELETE_TITLE} onClose={() => setConfirming(false)} open={confirming}>
          <h2 className="shell-overlay__title">{DELETE_TITLE}</h2>
          <p className="models-builder__sentence">{rule.display}</p>
          <p className="shell-overlay__note">{DELETE_NOTE}</p>
          <div className="models-builder__actions">
            <Button onClick={destroy} tone="danger" type="button">
              {DELETE_RULE}
            </Button>
            <Button onClick={() => setConfirming(false)} tone="ghost" type="button">
              {CANCEL}
            </Button>
          </div>
        </ShellOverlay>
      )}
    </li>
  );
}
