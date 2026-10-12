import { useId } from "react";

import type { CopilotPromotion, CopilotReference } from "@/app/api/workflow-copilot";
import { cx } from "@/app/ui";

import {
  BLOCKERS_HEADING,
  DRAFT_TERM,
  DRY_RUN_ONLY_NOTE,
  FLAGS_HEADING,
  GUARDS_HEADING,
  GUARD_ENFORCEMENT_WORDS,
  GUARD_SOURCE_WORDS,
  NO_GUARDS,
  PUBLISHES_TERM,
  PUBLISHING_HEADING,
  referenceLine,
  splitReferences,
} from "./copilot-view";

import "./copilot.css";

/**
 * What a promote publishes, stated in the confirmation before it is confirmed (CE.1,
 * [#565](https://github.com/NobuData/ouroboros/issues/565)).
 *
 * The ticket's reason for this component: *"never auto-merge"* and *"cap spend at $5 a run"* were
 * sentences typed into a chat box, and a publish that did not turn them into something the
 * enforcement planes read would ship the reassurance without the protection. So the confirmation
 * names the version, the draft it comes from, and **each guard with where it is enforced** — the
 * service's own label and its own sentence, printed as served.
 *
 * ### A guard that is not enforced is never drawn as protection
 *
 * A guard whose `enforcement` is `dry_run_only` is recorded and checked in a dry run and holds no
 * real run to anything yet. It is drawn dashed, on the warning hue, with *Not enforced on real
 * runs yet* as its state and a sentence saying what publishing does **not** do. An enforced guard
 * is drawn solid on the ok hue. The difference is said in words in both cases; the hue only
 * repeats it (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.4).
 *
 * ### References, by stage and by name
 *
 * Decision **W7**: the ones the policy blocks on are listed as blockers and the ones it lets
 * through are listed as flags — *published as they are*.
 *
 * No directive of its own: it reads nothing and holds no state beyond an id, and is rendered from
 * the head's Client Component.
 *
 * @param props.promotion The promotion summary, as read.
 * @returns The summary.
 */
export function PromoteSummary({ promotion }: Readonly<{ promotion: CopilotPromotion }>) {
  const ids = useId();
  const { blockers, flags } = splitReferences(promotion.references);

  return (
    <section aria-labelledby={`${ids}-title`} className="copilot-view__summary">
      <h3 className="copilot-view__summary-title" id={`${ids}-title`}>
        {PUBLISHING_HEADING}
      </h3>

      <dl className="copilot-view__facts">
        <div className="copilot-view__fact">
          <dt>{PUBLISHES_TERM}</dt>
          <dd>{promotion.publishes.label}</dd>
        </div>
        <div className="copilot-view__fact">
          <dt>{DRAFT_TERM}</dt>
          <dd>{promotion.draft.label}</dd>
        </div>
      </dl>

      <h4 className="copilot-view__summary-sub" id={`${ids}-guards`}>
        {GUARDS_HEADING}
      </h4>
      {promotion.guards.length === 0 ? (
        <p className="copilot-view__summary-none">{NO_GUARDS}</p>
      ) : (
        <ul aria-labelledby={`${ids}-guards`} className="copilot-view__guards">
          {promotion.guards.map((guard) => (
            <li
              className={cx(
                "copilot-view__guard",
                guard.enforcement === "enforced" ? "copilot-view__guard--enforced" : "copilot-view__guard--unenforced",
              )}
              key={guard.id}
            >
              <span className="copilot-view__guard-name">{guard.label}</span>
              <span className="copilot-view__guard-source">{GUARD_SOURCE_WORDS[guard.source]}</span>
              <span className="copilot-view__guard-state">{GUARD_ENFORCEMENT_WORDS[guard.enforcement]}</span>
              <span className="copilot-view__guard-where">{guard.enforcedBy}</span>
              {guard.enforcement === "dry_run_only" && (
                <span className="copilot-view__guard-warning">{DRY_RUN_ONLY_NOTE}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <References heading={BLOCKERS_HEADING} id={`${ids}-blockers`} references={blockers} />
      <References heading={FLAGS_HEADING} id={`${ids}-flags`} references={flags} />
    </section>
  );
}

/**
 * One list of references under its heading.
 *
 * @param props.heading What the list is.
 * @param props.id The heading's id, which names the list.
 * @param props.references The references, in the service's order.
 * @returns The heading and the list, or nothing for an empty list.
 */
function References({
  heading,
  id,
  references,
}: Readonly<{ heading: string; id: string; references: readonly CopilotReference[] }>) {
  if (references.length === 0) return null;

  return (
    <>
      <h4 className="copilot-view__summary-sub" id={id}>
        {heading}
      </h4>
      <ul aria-labelledby={id} className="copilot-view__refs">
        {references.map((reference, index) => (
          <li key={`${reference.path}-${index}`}>
            <span className="copilot-view__ref">{referenceLine(reference)}</span> — {reference.message}
          </li>
        ))}
      </ul>
    </>
  );
}
