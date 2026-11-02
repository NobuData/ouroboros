"use client";

import Link from "next/link";
import { useId, useState } from "react";

import type { LoopReadiness, LoopReadinessCheck } from "@/app/api/loop";
import { Card, CardHead, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  DISABLED_LINE,
  DISABLED_LINK,
  DISABLED_TITLE,
  DRY_RUN_LINE,
  ESTIMATE_LABEL,
  LIVE_EXECUTION_ADMIN_DOCS,
  PASSED_TOGGLE_HIDE,
  PASSED_TOGGLE_SHOW,
  READINESS_PENDING,
  READINESS_ROWS_LABEL,
  READINESS_TITLE,
  STATE_GLYPHS,
  STATE_NAMES,
  UNKNOWN_NOTE,
  dryRunHolds,
  estimateLine,
  executionDisabled,
  headLine,
  passedLine,
  readinessGroups,
} from "./readiness-view";

/** Each state's row class — literal, so the style suite sees every one rendered. */
const ROW_CLASS: Readonly<Record<LoopReadinessCheck["state"], string>> = {
  pass: "readiness-row readiness-row--pass",
  fail: "readiness-row readiness-row--fail",
  unknown: "readiness-row readiness-row--unknown",
};

/** Props of {@link ReadinessCard}. */
export interface ReadinessCardProps {
  /** The preflight, or null while it has not been heard. */
  readonly readiness: LoopReadiness | null;
  /** Why it could not be heard, or null. */
  readonly failure: string | null;
}

/**
 * A fix link — a product path in this tab, a documentation URL in a new one.
 *
 * @param props.fix The check's fix.
 * @returns The link.
 */
function FixLink({ fix }: Readonly<{ fix: NonNullable<LoopReadinessCheck["fix"]> }>) {
  return /^https?:\/\//.test(fix.href) ? (
    <a className="readiness-row__fix" href={fix.href} rel="noreferrer" target="_blank">
      {fix.label} →
    </a>
  ) : (
    <Link className="readiness-row__fix" href={fix.href}>
      {fix.label} →
    </Link>
  );
}

/**
 * One check: its mark, its reason, what `unknown` means, and its fix.
 *
 * @param props.check The check.
 * @returns The row.
 */
function CheckRow({ check }: Readonly<{ check: LoopReadinessCheck }>) {
  return (
    <li className={ROW_CLASS[check.state]}>
      <span aria-label={STATE_NAMES[check.state]} className="readiness-row__mark" role="img">
        {STATE_GLYPHS[check.state]}
      </span>
      <span className="readiness-row__body">
        <span className="readiness-row__reason">{check.reason}</span>
        {check.state === "unknown" && <span className="readiness-row__note">{UNKNOWN_NOTE}</span>}
      </span>
      {check.fix !== null && <FixLink fix={check.fix} />}
    </li>
  );
}

/**
 * Step 4's readiness card (DK.2, [#1319](https://github.com/NobuData/ouroboros/issues/1319)) —
 * DK.1's preflight (#1318) as the wizard draws it: the passing checks collapsed behind a toggle,
 * every failing check expanded with its fix link, every `unknown` explained, the dry-run line, and
 * the estimate labelled as one. With live execution off it leads with the execution-disabled
 * design — the configuration is saved, the switch is an administrator's, and the administration
 * page is linked — and drops the deployment row it restates.
 *
 * The primary action sits in the wizard's action bar, disabled with this card's first failing
 * reason (`firstBlockingReason`) until every check passes.
 *
 * @param props See {@link ReadinessCardProps}.
 * @returns The card.
 */
export function ReadinessCard({ readiness, failure }: ReadinessCardProps) {
  const titleId = useId();
  const [showPassed, setShowPassed] = useState(false);

  if (readiness === null) {
    return (
      <Card aria-labelledby={titleId} as="section" className="readiness-card">
        <CardHead title={READINESS_TITLE} titleId={titleId} />
        <p className="readiness-card__line" role={failure === null ? "status" : "alert"}>
          {failure ?? READINESS_PENDING}
        </p>
      </Card>
    );
  }

  const disabled = executionDisabled(readiness);
  const { passed, blocking } = readinessGroups(readiness);
  const shownBlocking = disabled ? blocking.filter((check) => check.id !== "deployment") : blocking;
  const estimate = estimateLine(readiness.estimate);

  return (
    <Card aria-labelledby={titleId} as="section" className="readiness-card">
      <CardHead title={READINESS_TITLE} titleId={titleId} />
      <p className="readiness-card__head">{headLine(readiness)}</p>

      {disabled && (
        <div className="readiness-card__disabled" role="note">
          <p className="readiness-card__disabled-title">{DISABLED_TITLE}</p>
          <p className="readiness-card__line">{DISABLED_LINE}</p>
          <a className="readiness-card__admin" href={LIVE_EXECUTION_ADMIN_DOCS} rel="noreferrer" target="_blank">
            {DISABLED_LINK}
          </a>
        </div>
      )}

      <ul aria-label={READINESS_ROWS_LABEL} className="readiness-card__rows">
        {passed.length > 0 && (
          <li className="readiness-card__passed">
            <span className="readiness-card__passed-line">{passedLine(passed.length)}</span>
            <button
              aria-expanded={showPassed}
              className="readiness-card__toggle"
              onClick={() => setShowPassed((open) => !open)}
              type="button"
            >
              {showPassed ? PASSED_TOGGLE_HIDE : PASSED_TOGGLE_SHOW}
            </button>
            {showPassed && (
              <ul className={cx("readiness-card__rows", "readiness-card__rows--passed")}>
                {passed.map((check) => (
                  <CheckRow check={check} key={check.id} />
                ))}
              </ul>
            )}
          </li>
        )}
        {shownBlocking.map((check) => (
          <CheckRow check={check} key={check.id} />
        ))}
      </ul>

      {dryRunHolds(readiness) && <p className="readiness-card__safety">{DRY_RUN_LINE}</p>}
      {estimate !== null && (
        <p className="readiness-card__estimate">
          <Tag>{ESTIMATE_LABEL}</Tag> {estimate}
        </p>
      )}
    </Card>
  );
}
