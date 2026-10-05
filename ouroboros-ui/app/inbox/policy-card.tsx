"use client";

import Link from "next/link";
import { useId } from "react";

import type { InboxPolicyCard } from "@/app/api/inbox";
import { POLICIES_PATH } from "@/app/paths";
import { Button, Card, CardHead } from "@/app/ui";

import { sitePath } from "./card-view";
import { InfoTip } from "./info-tip";
import {
  EDIT_POLICIES_LABEL,
  NO_POLICY_ROWS,
  POLICY_EDIT_LABEL,
  POLICY_LEADS_TO,
  POLICY_MARK,
  POLICY_SOURCE_LABEL,
  POLICY_TITLE,
} from "./side-view";

/**
 * **What Needs A Human** (BO.4, [#469](https://github.com/NobuData/ouroboros/issues/469), mockup
 * 16, decision X7) — the rules that send a decision to a person, composed live by BN.4 (#464)
 * from the configs that enforce them.
 *
 * **There is no list of rules in this component.** A hard-coded five would keep claiming
 * `refactor label → human review` after somebody removed the policy; every row here is one the
 * service found something enforcing, in the service's words:
 *
 * - `rule → outcome`, in mono, as the mockup sets it;
 * - an ⓘ naming **what enforces it** — reachable by keyboard, not only by hover;
 * - an **edit →** link to the surface that owns it (the service says where);
 * - the rule's own detail — the protected globs — when it has one.
 *
 * A rule nothing enforces is **absent**, not greyed out: a greyed rule still reads as a rule the
 * workspace has. That is why *spend > $2.50/run* is not here while AF.4 (#237) does not exist.
 * The caption is the service's too, because *"Everything else merges itself when gates are
 * green"* stops being true the moment dry-run is on.
 *
 * @param props.card The card, as served; `null` while it could not be read.
 * @param props.failure Why it could not be read, or `null`.
 * @returns The card.
 */
export function PolicyCard({ card, failure }: Readonly<{ card: InboxPolicyCard | null; failure: string | null }>) {
  const title = useId();

  return (
    <Card aria-labelledby={title} as="section">
      <CardHead
        className="inbox-side__head"
        title={POLICY_TITLE}
        titleId={title}
        trailing={
          <Button href={POLICIES_PATH} size="sm" tone="ghost">
            {EDIT_POLICIES_LABEL} →
          </Button>
        }
      />
      {card === null ? (
        failure !== null && <p className="inbox-rules__quiet">{failure}</p>
      ) : (
        <>
          {card.rows.length === 0 ? (
            <p className="inbox-rules__quiet">{NO_POLICY_ROWS}</p>
          ) : (
            <ul className="inbox-rules">
              {card.rows.map((row) => {
                const edit = sitePath(row.editHref);

                return (
                  <li className="inbox-rules__row" key={row.id}>
                    <InfoTip
                      // The control ends the row's trailing cluster, so the three wrap together and
                      // the note opens right under them.
                      frame={(control) => (
                        <span className="inbox-rules__line">
                          <span aria-hidden className="inbox-rules__tick">
                            {POLICY_MARK}
                          </span>
                          <span className="inbox-rules__rule">{row.rule}</span>
                          <span className="inbox-rules__trail">
                            <span className="inbox-rules__outcome">
                              <span aria-hidden className="inbox-rules__arrow">
                                →
                              </span>
                              <span className="sr-only"> {POLICY_LEADS_TO}</span> {row.outcome}
                            </span>
                            {edit !== null && (
                              <Link
                                aria-label={`${POLICY_EDIT_LABEL}: ${row.rule}`}
                                className="inbox-rules__edit"
                                href={edit}
                              >
                                {POLICY_EDIT_LABEL} →
                              </Link>
                            )}
                            {control}
                          </span>
                        </span>
                      )}
                      label={`${POLICY_SOURCE_LABEL}: ${row.rule}`}
                    >
                      {row.source}
                    </InfoTip>
                    {row.detail !== null && <p className="inbox-rules__detail">{row.detail}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="inbox-rules__caption">{card.caption}</p>
        </>
      )}
    </Card>
  );
}
