"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { EnabledRepo } from "@/app/api/enablement";
import type { Fact, FactList } from "@/app/api/facts";
import type { Reading } from "@/app/api/reading";
import { Button, Card, CardHead, Chip, EmptyState, TextField, cx } from "@/app/ui";

import { AddFact } from "./add-fact";
import {
  DECIDING,
  EXPIRED_USED_NOTE,
  EXPIRE_CANCEL,
  EXPIRE_REASON_HINT,
  EXPIRE_REASON_LABEL,
  EXPIRE_REASON_MAX,
  EXPIRE_REASON_REQUIRED,
  EXPIRE_SUBMIT,
  FACTS_FOOT,
  FACTS_UNREAD_TITLE,
  type FactVerb,
  NO_FACTS_NOTE,
  NO_FACTS_TITLE,
  RELEARNED_NOTE,
  REVIEW_ALL,
  REVIEW_ALL_REASON,
  USED_NOTE,
  VERB_LABEL,
  VIEWER_REASON,
  actionName,
  announcement,
  awaitingChip,
  codeSpans,
  provenanceLinks,
  sourceLine,
  staleChip,
  staleLine,
  statusChip,
  transitionFailure,
  usedLabel,
  verbsFor,
} from "./facts";
import { decideFact } from "./facts-actions";
import type { KnowledgeToast } from "./toast";
import { FACTS_REGION_ID, FACTS_TITLE, type TicketLink } from "./view";

import "./knowledge.css";

/**
 * Mockup 14's *Learned by the loop* card (BG.3,
 * [#419](https://github.com/NobuData/ouroboros/issues/419)): the head with the awaiting count,
 * **Review all →** and **+ Add fact**; a row per fact with its text, its provenance and its
 * status cluster; the foot.
 *
 * The decisions are `app/knowledge/facts.ts`'s; what is here is state and wiring:
 *
 * - **Every action is a real call, and the row takes what the service answered.** Confirm,
 *   Reject and Re-confirm are one press; Expire opens a reason field in the row, since the
 *   contract requires one; Re-learn inserts the **new** proposal at the top and says so under the
 *   expired row, which stays expired. The head's counts follow the rows, so a confirm decrements
 *   *awaiting review* in place. A refusal lands in the row as an alert.
 * - **Status changes are announced**: one live region at the card's foot reads *Confirmed: …*
 *   after each transition, so assistive technology hears what the eye sees move.
 * - **The page re-reads behind every write**, so the counts, the tickets and the stamps are the
 *   service's on the next paint.
 *
 * Read-only for a viewer: the actions keep their place, inert with the reason. The gates that
 * enforce are the service's.
 */

/** What the card is told. */
export interface FactsCardProps {
  /** Every fact and every status's count, or why they could not be read. */
  readonly facts: Reading<FactList>;
  /** The tickets the facts cite, resolved to their tracker pages, by id. */
  readonly tickets: Readonly<Record<string, TicketLink>>;
  /** The enabled repositories, or why not — the add dialog's *Applies to* choices. */
  readonly repos: Reading<readonly EnabledRepo[]>;
  /** The instant the page was read, ISO 8601 — what every relative age is measured from. */
  readonly readAt: string;
  /** Whether this reader is an `owner`, an `admin` or a `member` — the roles that decide. */
  readonly mayDecide: boolean;
  /** Called with the toast a proposal leaves. */
  readonly onToast: (toast: KnowledgeToast) => void;
}

/** One row's transient state. */
interface RowState {
  /** The fact as the service last answered, replacing the page's read until it re-reads. */
  readonly fact?: Fact;
  /** A refused action's sentence, cleared by the next press. */
  readonly failure?: string;
  /** The sentence under a re-learned row. */
  readonly note?: string;
  /** Whether the expire form is open, and its reason so far. */
  readonly expiring?: string;
}

/**
 * The card.
 *
 * @param props See {@link FactsCardProps}.
 * @returns The card, with its rows — or, in their place, why there are none.
 */
export function FactsCard({ facts, tickets, repos, readAt, mayDecide, onToast }: FactsCardProps) {
  const router = useRouter();
  const ids = useId();
  const now = new Date(readAt);

  const [rows, setRows] = useState<Readonly<Record<string, RowState>>>({});
  const [added, setAdded] = useState<readonly Fact[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [announced, setAnnounced] = useState("");
  const [, startTransition] = useTransition();

  /**
   * Hold one row's transient state.
   *
   * @param id The fact.
   * @param patch What changed.
   */
  function patchRow(id: string, patch: RowState): void {
    setRows((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  /**
   * Press one verb on one fact.
   *
   * @param fact The row's fact.
   * @param verb The verb.
   * @param reason The expire reason, when the verb is `expire`.
   */
  function decide(fact: Fact, verb: FactVerb, reason?: string): void {
    if (busy !== null) return;

    setBusy(fact.id);
    patchRow(fact.id, { failure: undefined });

    startTransition(async () => {
      const outcome = await decideFact(fact.id, verb, reason);

      if (!outcome.ok) {
        patchRow(fact.id, { failure: transitionFailure(outcome.refusal) });
        setBusy(null);
        return;
      }

      if (verb === "relearn") {
        // The expired fact stays as it is; the new proposal joins the top of the card.
        setAdded((current) => [outcome.value, ...current]);
        patchRow(fact.id, { note: RELEARNED_NOTE });
      } else {
        patchRow(fact.id, { fact: outcome.value, expiring: undefined });
      }

      setAnnounced(announcement(verb, outcome.value));
      setBusy(null);
      router.refresh();
    });
  }

  /**
   * Take a manual proposal in: the row joins the top, the toast is the page's.
   *
   * @param fact The new proposal.
   * @param toast What to say about it.
   */
  function proposed(fact: Fact, toast: KnowledgeToast): void {
    setAdded((current) => [fact, ...current]);
    setAnnounced(announcement("relearn", fact).replace(/^Re-learned as a new proposal/, "Proposed"));
    onToast(toast);
    router.refresh();
  }

  const list = facts.ok ? facts.value : null;
  // The rows as drawn: what was added here, then the page's, each replaced by its last write.
  // A row added here that the page has since read is drawn once, from the page.
  const drawn =
    list === null
      ? []
      : [...added.filter((fact) => !list.items.some((one) => one.id === fact.id)), ...list.items].map(
          (fact) => rows[fact.id]?.fact ?? fact,
        );
  const counts = list === null ? null : countsOf(list, drawn);
  const awaiting = counts === null ? null : awaitingChip(counts);
  const stale = counts === null ? null : staleChip(counts);

  return (
    <Card aria-labelledby={`${FACTS_REGION_ID}-title`} as="section">
      <CardHead
        beside={
          <>
            {awaiting !== null && <Chip tone={awaiting.tone}>{awaiting.text}</Chip>}
            {stale !== null && <Chip tone={stale.tone}>{stale.text}</Chip>}
          </>
        }
        title={FACTS_TITLE}
        titleId={`${FACTS_REGION_ID}-title`}
        trailing={
          <span className="knowledge-facts__head-actions">
            <AddFact mayDecide={mayDecide} onProposed={proposed} repos={repos} />
            <Button reason={REVIEW_ALL_REASON} size="sm" tone="ghost">
              {REVIEW_ALL}
            </Button>
          </span>
        }
      />

      {list === null ? (
        <EmptyState note={facts.ok ? undefined : facts.reason} title={FACTS_UNREAD_TITLE} variant="flush" />
      ) : drawn.length === 0 ? (
        <EmptyState note={NO_FACTS_NOTE} title={NO_FACTS_TITLE} variant="flush" />
      ) : (
        <ul className="knowledge-facts__list">
          {drawn.map((fact) => (
            <FactRow
              busy={busy === fact.id}
              fact={fact}
              ids={ids}
              key={fact.id}
              mayDecide={mayDecide}
              now={now}
              onDecide={(verb, reason) => { decide(fact, verb, reason); }}
              onExpiring={(reason) => { patchRow(fact.id, { expiring: reason }); }}
              state={rows[fact.id] ?? {}}
              tickets={tickets}
            />
          ))}
        </ul>
      )}

      <p className="knowledge-facts__foot">{FACTS_FOOT}</p>
      {/* One live region for the card: what the last transition did, for a reader who cannot see the row move. */}
      <p aria-live="polite" className="sr-only">
        {announced}
      </p>
    </Card>
  );
}

/**
 * The counts as the rows now stand — the service's, moved by what was written here since the
 * page was read, so the head's *awaiting review* decrements with a confirm in place.
 *
 * @param list The list as read.
 * @param drawn The rows as drawn.
 * @returns The counts.
 */
function countsOf(list: FactList, drawn: readonly Fact[]): FactList["counts"] {
  const counts = { ...list.counts };

  for (const fact of list.items) counts[fact.status] -= 1;
  for (const fact of drawn) counts[fact.status] += 1;

  return counts;
}

/**
 * One row: the text with its code spans, the source line with its links, the stale line, and the
 * status cluster with its actions.
 *
 * @param props.fact The fact as drawn.
 * @param props.state The row's transient state.
 * @param props.tickets The resolved tickets.
 * @param props.now The instant the page was read.
 * @param props.ids The card's id prefix.
 * @param props.mayDecide Whether the reader may press the actions.
 * @param props.busy Whether this row's call is in flight.
 * @param props.onDecide Called with the verb pressed, and the expire reason for `expire`.
 * @param props.onExpiring Called as the expire reason is typed; `undefined` closes the field.
 * @returns The row.
 */
function FactRow({
  fact,
  state,
  tickets,
  now,
  ids,
  mayDecide,
  busy,
  onDecide,
  onExpiring,
}: Readonly<{
  fact: Fact;
  state: RowState;
  tickets: Readonly<Record<string, TicketLink>>;
  now: Date;
  ids: string;
  mayDecide: boolean;
  busy: boolean;
  onDecide: (verb: FactVerb, reason?: string) => void;
  onExpiring: (reason: string | undefined) => void;
}>) {
  const chip = statusChip(fact.status);
  const links = provenanceLinks(fact, tickets);
  const stale = staleLine(fact, now);
  const failureId = `${ids}-${fact.id}-refused`;
  const expiring = state.expiring;
  const reason = mayDecide ? undefined : VIEWER_REASON;
  const inFlight = busy ? DECIDING : undefined;

  /**
   * Press one verb: an expire opens its reason field first.
   *
   * @param verb The verb.
   */
  function press(verb: FactVerb): void {
    if (verb === "expire") {
      onExpiring(expiring ?? "");
      return;
    }

    onDecide(verb);
  }

  return (
    <li
      className={cx(
        "knowledge-facts__row",
        fact.status === "expired" && "knowledge-facts__row--expired",
        fact.status === "rejected" && "knowledge-facts__row--rejected",
      )}
    >
      <div className="knowledge-facts__body">
        <p className="knowledge-facts__text">
          {codeSpans(fact.text).map((part, index) =>
            part.kind === "code" ? <code key={index}>{part.value}</code> : <span key={index}>{part.value}</span>,
          )}
        </p>
        <p className="knowledge-facts__src">
          <span>{sourceLine(fact, now)}</span>
          {links.map((link, index) => (
            <span className="knowledge-facts__ref" key={index}>
              {" · "}
              {link.href === null ? (
                link.label
              ) : (
                <a
                  className="knowledge-facts__link"
                  href={link.href}
                  rel={link.external ? "noreferrer" : undefined}
                  target={link.external ? "_blank" : undefined}
                >
                  {link.label} ↗
                </a>
              )}
            </span>
          ))}
        </p>
        {stale !== null && <p className="knowledge-facts__stale">{stale}</p>}
        {state.note !== undefined && (
          <p className="knowledge-facts__note" role="status">
            {state.note}
          </p>
        )}
        {expiring !== undefined && (
          <form
            className="knowledge-facts__expire"
            onSubmit={(event) => {
              event.preventDefault();
              if (expiring.trim() !== "") onDecide("expire", expiring.trim());
            }}
          >
            <TextField
              autoComplete="off"
              autoFocus
              hint={EXPIRE_REASON_HINT}
              id={`${ids}-${fact.id}-expire`}
              label={EXPIRE_REASON_LABEL}
              maxLength={EXPIRE_REASON_MAX}
              name="reason"
              onChange={(event) => { onExpiring(event.currentTarget.value); }}
              required
              value={expiring}
            />
            <div className="knowledge-facts__expire-actions">
              <Button reason={inFlight ?? (expiring.trim() === "" ? EXPIRE_REASON_REQUIRED : undefined)} size="sm" tone="danger" type="submit">
                {EXPIRE_SUBMIT}
              </Button>
              <Button onClick={() => { onExpiring(undefined); }} size="sm" tone="ghost" type="button">
                {EXPIRE_CANCEL}
              </Button>
            </div>
          </form>
        )}
        {state.failure !== undefined && (
          <p className="knowledge-facts__refusal" id={failureId} role="alert">
            {state.failure}
          </p>
        )}
      </div>

      <div className="knowledge-facts__status">
        <Chip tone={chip.tone}>{chip.text}</Chip>
        {(fact.status === "confirmed" || fact.status === "stale") && (
          <span className="knowledge-facts__used" title={USED_NOTE}>
            {usedLabel(fact.usedCount)}
            <span className="sr-only"> — {USED_NOTE}</span>
          </span>
        )}
        {fact.status === "expired" && fact.expiry !== null && (
          <span className="knowledge-facts__used" title={EXPIRED_USED_NOTE}>
            <span className="sr-only">{usedLabel(fact.expiry.previousUseCount)} — {EXPIRED_USED_NOTE}</span>
          </span>
        )}
        {verbsFor(fact.status).map((verb, index) => (
          <Button
            aria-describedby={state.failure === undefined ? undefined : failureId}
            aria-label={actionName(verb, fact)}
            key={verb}
            onClick={() => { press(verb); }}
            reason={inFlight ?? reason}
            size="sm"
            tone={index === 0 && fact.status !== "expired" ? "primary" : "ghost"}
          >
            {VERB_LABEL[verb]}
          </Button>
        ))}
      </div>
    </li>
  );
}
