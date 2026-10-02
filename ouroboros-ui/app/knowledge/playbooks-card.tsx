"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Playbook, PlaybookLaunchReceipt, PlaybookList } from "@/app/api/playbooks";
import type { Reading } from "@/app/api/reading";
import type { SkillList } from "@/app/api/skills";
import { playbookAnchor } from "@/app/paths";
import { Card, CardHead, Chip, EmptyState } from "@/app/ui";

import { KnowledgeUnread } from "./knowledge-unread";
import { NewPlaybook } from "./new-playbook";
import {
  NO_PLAYBOOKS_NOTE,
  NO_PLAYBOOKS_TITLE,
  PLAYBOOKS_UNREAD_TITLE,
  QUEUED_NOTE_DETAIL,
  RUN_COUNT_NOTE,
  filterLine,
  pinLabel,
  queuedNote,
  receiptToast,
  recipesChip,
  runCountLabel,
} from "./playbooks";
import { RunOnIssue } from "./run-on-issue";
import type { KnowledgeToast } from "./toast";
import { PLAYBOOKS_REGION_ID, PLAYBOOKS_TITLE } from "./view";

import "./knowledge.css";

/**
 * Mockup 14's *Playbooks* card (BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)):
 * the head with `3 recipes`, a row per playbook with its name, its counted `run 9×`, its
 * description and **Run on issue… ▾**, and the dashed **+ New playbook from a past run…** tile.
 *
 * The decisions are `app/knowledge/playbooks.ts`'s; what is here is state and wiring:
 *
 * - **Run on issue… ▾** is the row's picker (`run-on-issue.tsx`). A launch's receipt is kept
 *   on the row — *#485 queued*, beside the count it does not yet move — and leaves the page's
 *   toast; the page re-reads behind it, so the count is the service's on the next paint.
 * - **+ New playbook** (`new-playbook.tsx`) hands the new row up; it joins the card at once.
 *
 * A viewer's **Run on issue… ▾** and a member's **+ New playbook** are inert with their reasons.
 * The gates that enforce are the service's.
 */

/** What the card is told. */
export interface PlaybooksCardProps {
  /** Every playbook, or why they could not be read. */
  readonly playbooks: Reading<PlaybookList>;
  /** The workspace's skills, or why not — what names an override's slug in the create dialog. */
  readonly skills: Reading<SkillList>;
  /** The instant the page was read, ISO 8601. */
  readonly readAt: string;
  /** Whether this reader is an `owner`, an `admin` or a `member` — who may run a playbook. */
  readonly mayLaunch: boolean;
  /** Whether this reader is an `owner` or an `admin` — who may create one. */
  readonly mayAdminister: boolean;
  /** Called with the toast a launch or a create leaves. */
  readonly onToast: (toast: KnowledgeToast) => void;
}

/**
 * The card.
 *
 * @param props See {@link PlaybooksCardProps}.
 * @returns The card, with its rows — or, in their place, why there are none.
 */
export function PlaybooksCard({ playbooks, skills, readAt, mayLaunch, mayAdminister, onToast }: PlaybooksCardProps) {
  const router = useRouter();

  const [added, setAdded] = useState<readonly Playbook[]>([]);
  const [receipts, setReceipts] = useState<Readonly<Record<string, readonly PlaybookLaunchReceipt[]>>>({});

  const list = playbooks.ok ? playbooks.value : null;
  // The rows as drawn: what was created here, then the page's, by name as the service lists them.
  const drawn =
    list === null
      ? null
      : [...added.filter((one) => !list.items.some((item) => item.id === one.id)), ...list.items].sort((a, b) =>
          a.name.localeCompare(b.name),
        );

  /**
   * Take a launch's receipt in: the row says so, the toast is the page's.
   *
   * @param playbook The playbook that ran.
   * @param receipt What the service answered.
   */
  function launched(playbook: Playbook, receipt: PlaybookLaunchReceipt): void {
    setReceipts((current) => ({ ...current, [playbook.id]: [...(current[playbook.id] ?? []), receipt] }));
    onToast(receiptToast(receipt, playbook));
    router.refresh();
  }

  /**
   * Take a new playbook in: the row joins the card, the toast is the page's.
   *
   * @param playbook The new playbook.
   * @param toast What to say about it.
   */
  function created(playbook: Playbook, toast: KnowledgeToast): void {
    setAdded((current) => [playbook, ...current]);
    onToast(toast);
    router.refresh();
  }

  const tile = (primary: boolean) => (
    <NewPlaybook
      existing={drawn}
      mayAdminister={mayAdminister}
      onCreated={created}
      primary={primary}
      readAt={readAt}
      skills={skills}
    />
  );

  return (
    <Card aria-labelledby={`${PLAYBOOKS_REGION_ID}-title`} as="section">
      <CardHead
        beside={drawn !== null && <Chip>{recipesChip(drawn.length)}</Chip>}
        title={PLAYBOOKS_TITLE}
        titleId={`${PLAYBOOKS_REGION_ID}-title`}
      />

      {drawn === null ? (
        <KnowledgeUnread reason={playbooks.ok ? undefined : playbooks.reason} title={PLAYBOOKS_UNREAD_TITLE} />
      ) : drawn.length === 0 ? (
        <EmptyState note={NO_PLAYBOOKS_NOTE} title={NO_PLAYBOOKS_TITLE} variant="flush">
          {tile(true)}
        </EmptyState>
      ) : (
        <>
          <ul className="knowledge-playbooks__list">
            {drawn.map((playbook) => {
              const queued = queuedNote(receipts[playbook.id] ?? []);

              return (
                <li className="knowledge-playbooks__row" id={playbookAnchor(playbook.id)} key={playbook.id}>
                  <div className="knowledge-playbooks__body">
                    <p className="knowledge-playbooks__name">
                      {playbook.name}
                      <span className="knowledge-playbooks__runs" title={RUN_COUNT_NOTE}>
                        {runCountLabel(playbook.runCount)}
                        <span className="sr-only"> — {RUN_COUNT_NOTE}</span>
                      </span>
                      {queued !== null && (
                        <span className="knowledge-playbooks__queued" title={QUEUED_NOTE_DETAIL}>
                          · {queued}
                          <span className="sr-only"> — {QUEUED_NOTE_DETAIL}</span>
                        </span>
                      )}
                    </p>
                    <p className="knowledge-playbooks__desc">{playbook.description}</p>
                    <p className="knowledge-playbooks__filter">
                      {pinLabel(playbook.workflow)} · {filterLine(playbook)}
                    </p>
                  </div>
                  <RunOnIssue
                    mayLaunch={mayLaunch}
                    onLaunched={(receipt) => { launched(playbook, receipt); }}
                    playbook={playbook}
                  />
                </li>
              );
            })}
          </ul>
          {tile(false)}
        </>
      )}

    </Card>
  );
}
