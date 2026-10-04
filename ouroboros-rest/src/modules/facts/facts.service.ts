/**
 * The fact lifecycle (BF.2, [#411](https://github.com/NobuData/ouroboros/issues/411); decisions
 * **K3** and **K4**) — mockup 14's *"Learned by the loop"* card's actions.
 *
 * **Propose** is how a fact is born, for a person (`POST /facts`) and for the automatic proposers
 * alike: {@link FactsService.propose} is the entry point BF.3's deterministic proposers (#412) call
 * with their own `proposer` and typed provenance, and no actor. BF.4's import (#413) writes the same
 * `FactsRepository.insert` inside its own apply transaction, so a whole import is atomic; its rows
 * are `proposed` all the same. **Confirm** and **Reject** decide a proposal; **Re-confirm** returns a stale fact to
 * `confirmed`; **Expire** ends a confirmed or stale fact with a reason and freezes its use count;
 * **Re-learn** proposes a **new** fact linked to an expired one, which is never resurrected.
 *
 * **The machine is checked here first, with a stated reason** (`facts.lifecycle.ts`), and the
 * database is the backstop: V071's triggers refuse the same edges for every writer, and a race
 * that slips past the check (two people confirming at once) lands on the named constraint and is
 * answered the same way. Every write locks the fact's row first.
 *
 * **Every transition is audited, with its actor.** V071's `fact_transitions_record()` trigger
 * appends the audit row from `status_changed_by` / `status_reason`, which the repository writes
 * in the same statement as the status — so there is no transition without an audit row, and the
 * application role cannot write one that no transition made.
 *
 * **Manual expire of a confirmed fact is two edges.** V071 has no `confirmed → expired`; the
 * service moves `confirmed → stale → expired` in one transaction, both steps naming the person and
 * the reason, so the audit reads honestly and the service's machine stays the database's.
 */

import { Injectable, Optional } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, Fact, FactProposer, FactStatus } from "../db/schema";
import { violatesConstraint } from "../tenancy/constraints";
import { FactReviewEmitter } from "./fact-review.emitter";
import { anchorValueProblem } from "./facts.anchors";
import type { CreateAnchorBody, ProposeFactBody } from "./facts.dto";
import {
  anchorExists,
  anchorInvalid,
  anchorNotFound,
  FACT_CONSTRAINTS,
  factChanged,
  factFrozen,
  factNotFound,
  provenanceUnresolved,
  transitionRefused,
} from "./facts.errors";
import { TERMINAL_FACT_STATUSES, transitionRefusal } from "./facts.lifecycle";
import { FactsRepository, type NewAnchorInput } from "./facts.repository";
import {
  factDetail,
  factResource,
  needsYouFeed,
  provenanceOf,
  statusCounts,
  type FactDetail,
  type FactList,
  type FactNeedsYou,
  type FactProvenance,
} from "./facts.resources";

/** The provenance line a fact written by hand carries when the person gave none. */
export const MANUAL_PROVENANCE_LINE = "added by hand";

/** The provenance line of a re-learn proposal. */
export const RELEARN_PROVENANCE_LINE = "re-learned after expiry";

/** What {@link FactsService.propose} accepts — a person's proposal or an automatic proposer's. */
export interface ProposeFactInput {
  readonly text: string;
  /** `owner/name`, or null for the whole workspace. */
  readonly repoRef: string | null;
  readonly proposer: FactProposer;
  readonly provenance: FactProvenance;
  /** Why it can expire; none is valid and is never swept. */
  readonly anchors?: readonly NewAnchorInput[];
}

@Injectable()
export class FactsService {
  /**
   * @param repo - The statements.
   * @param database - For transactions.
   * @param reviews - The Needs-You emitter (#461): a proposal files a `fact_review` card and a
   *   decision settles it. Absent in a context without the inbox.
   */
  constructor(
    private readonly repo: FactsRepository,
    private readonly database: DatabaseService,
    @Optional() private readonly reviews?: FactReviewEmitter,
  ) {}

  /**
   * The learned-facts card.
   *
   * @param organizationId - The workspace.
   * @param status - One status, or every fact when absent.
   * @returns The facts, newest first, and every status's count.
   */
  async list(organizationId: string, status?: FactStatus): Promise<FactList> {
    const [records, counted] = await Promise.all([
      this.repo.records(organizationId, { status }),
      this.repo.counts(organizationId),
    ]);

    return { items: records.map(factResource), counts: statusCounts(counted) };
  }

  /**
   * One fact and its whole audit history.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @returns The detail.
   * @throws `404 fact_not_found` — absent, or another workspace's.
   */
  async get(organizationId: string, factId: string): Promise<FactDetail> {
    const [record] = await this.repo.records(organizationId, { ids: [factId] });

    if (record === undefined) {
      throw factNotFound(factId);
    }

    return factDetail(record);
  }

  /**
   * The needs-you feed: every fact waiting on a person — proposals awaiting review and confirmed
   * facts the sweep flagged stale — as `fact_review` items.
   *
   * @param organizationId - The workspace.
   * @returns The feed and its count.
   */
  async needsYou(organizationId: string): Promise<FactNeedsYou> {
    const [proposed, stale] = await Promise.all([
      this.repo.records(organizationId, { status: "proposed" }),
      this.repo.records(organizationId, { status: "stale" }),
    ]);

    return needsYouFeed([...proposed, ...stale].map(factResource));
  }

  /**
   * `POST /facts` — a person writes a fact down. It is born `proposed`, like every fact.
   *
   * @param organizationId - The workspace.
   * @param body - The text, repository, provenance and anchors.
   * @param actorId - The person.
   * @returns The new fact.
   */
  async proposeManual(
    organizationId: string,
    body: ProposeFactBody,
    actorId: string,
  ): Promise<FactDetail> {
    return this.propose(
      organizationId,
      {
        text: body.text.trim(),
        repoRef: body.repoRef ?? null,
        proposer: "manual",
        provenance: {
          line: body.provenanceLine?.trim() ?? MANUAL_PROVENANCE_LINE,
          refs: (body.refs ?? []).map((ref) => ({ kind: ref.kind, id: ref.id.toLowerCase() })),
        },
        anchors: body.anchors,
      },
      actorId,
    );
  }

  /**
   * Propose a fact — the entry point for people and for the automatic proposers (BF.3 #412).
   * Never confirms: *"and you approve"* is the only way to `confirmed` (K3).
   *
   * @param organizationId - The workspace.
   * @param input - The fact, its provenance and anchors.
   * @param actorId - The person, or null for an automatic proposer.
   * @returns The new fact.
   * @throws `422 fact_anchor_invalid`, `409 fact_anchor_exists`, `422 fact_provenance_unresolved`.
   */
  async propose(
    organizationId: string,
    input: ProposeFactInput,
    actorId: string | null,
  ): Promise<FactDetail> {
    const anchors = normalizeAnchors(input.anchors ?? []);

    const id = await this.write(null, () =>
      this.database.transaction(async (trx) => {
        const factId = await this.repo.insert(
          organizationId,
          {
            repoRef: input.repoRef,
            text: input.text,
            proposer: input.proposer,
            provenance: input.provenance,
            actorId,
            relearnedFromFactId: null,
          },
          trx,
        );
        await this.repo.insertAnchors(factId, anchors, trx);
        return factId;
      }),
    );

    // Born proposed, so it waits on a person: file its inbox card (#461). Never throws.
    await this.reviews?.review(organizationId, [id]);

    return this.get(organizationId, id);
  }

  /**
   * **Confirm** — a proposal becomes true, and is injected from now on.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @param actorId - The person confirming — *"confirmed by Ken"*.
   * @param reason - An optional note.
   * @returns The fact.
   * @throws `409 fact_transition_refused` unless the fact is `proposed`.
   */
  async confirm(
    organizationId: string,
    factId: string,
    actorId: string,
    reason?: string,
  ): Promise<FactDetail> {
    return this.decide(organizationId, factId, "proposed", "confirmed", actorId, reason);
  }

  /**
   * **Reject** — a proposal is not true. Final.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @param actorId - The person rejecting.
   * @param reason - An optional note.
   * @returns The fact.
   * @throws `409 fact_transition_refused` unless the fact is `proposed`.
   */
  async reject(
    organizationId: string,
    factId: string,
    actorId: string,
    reason?: string,
  ): Promise<FactDetail> {
    return this.decide(organizationId, factId, "proposed", "rejected", actorId, reason);
  }

  /**
   * **Re-confirm** — a person looked at a stale fact and it still holds.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @param actorId - The person re-confirming; the confirmation stamp becomes theirs.
   * @param reason - An optional note.
   * @returns The fact, `confirmed` again.
   * @throws `409 fact_transition_refused` unless the fact is `stale`.
   */
  async reconfirm(
    organizationId: string,
    factId: string,
    actorId: string,
    reason?: string,
  ): Promise<FactDetail> {
    return this.decide(organizationId, factId, "stale", "confirmed", actorId, reason);
  }

  /**
   * **Expire** — a confirmed or stale fact stopped being true. The reason is required, and the
   * use count is snapshotted in the same statement and frozen from then on (`was used 31×`).
   *
   * From `confirmed` this is two audited edges in one transaction — `confirmed → stale` then
   * `stale → expired`, both naming the person and the reason — because V071 has no direct edge.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @param actorId - The person expiring it.
   * @param reason - Why — *"Zephyr 4.1 migration"*.
   * @returns The fact, `expired`.
   * @throws `409 fact_transition_refused` for a proposal, a rejection or an expired fact.
   */
  async expire(
    organizationId: string,
    factId: string,
    actorId: string,
    reason: string,
  ): Promise<FactDetail> {
    const why = reason.trim();

    await this.write(factId, () =>
      this.database.transaction(async (trx) => {
        const fact = await this.locked(organizationId, factId, trx);

        if (fact.status === "confirmed") {
          await this.repo.move(fact.id, { to: "stale", actorId, reason: why }, trx);
        } else {
          refuseUnless(fact, "expired");
        }

        await this.repo.move(
          fact.id,
          { to: "expired", actorId, reason: why, expiredReason: why },
          trx,
        );
      }),
    );

    await this.reviews?.settled(organizationId);

    return this.get(organizationId, factId);
  }

  /**
   * **Re-learn** — propose a **new** fact linked to an expired one. The expired fact, its reason
   * and its frozen count stay exactly as they were; the lineage records that this was learned,
   * expired, and learned again. Anchors are not copied: the old ones are why it expired.
   *
   * @param organizationId - The workspace.
   * @param factId - The expired fact.
   * @param actorId - The person re-learning it.
   * @param text - The new proposal's text; the expired fact's when absent.
   * @returns The **new** proposal.
   * @throws `409 fact_transition_refused` unless the fact is `expired`.
   */
  async relearn(
    organizationId: string,
    factId: string,
    actorId: string,
    text?: string,
  ): Promise<FactDetail> {
    const id = await this.write(factId, () =>
      this.database.transaction(async (trx) => {
        const fact = await this.locked(organizationId, factId, trx);

        if (fact.status !== "expired") {
          throw transitionRefused(
            fact.id,
            fact.status,
            "proposed",
            "Only an expired fact can be re-learned; this one is " + fact.status + ".",
          );
        }

        return this.repo.insert(
          organizationId,
          {
            repoRef: fact.repo_ref,
            text: text?.trim() ?? fact.text,
            proposer: "manual",
            provenance: {
              line: RELEARN_PROVENANCE_LINE,
              refs: provenanceOf(fact.provenance).refs,
            },
            actorId,
            relearnedFromFactId: fact.id,
          },
          trx,
        );
      }),
    );

    // The re-learned proposal waits on a person like any other (#461).
    await this.reviews?.review(organizationId, [id]);

    return this.get(organizationId, id);
  }

  /**
   * Add an anchor — a reason the fact can expire.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @param body - The anchor.
   * @returns The fact.
   * @throws `409 fact_frozen` on a rejected or expired fact, `409 fact_anchor_exists`,
   *   `422 fact_anchor_invalid`.
   */
  async addAnchor(
    organizationId: string,
    factId: string,
    body: CreateAnchorBody,
  ): Promise<FactDetail> {
    const [anchor] = normalizeAnchors([body]);

    await this.write(
      factId,
      () =>
        this.database.transaction(async (trx) => {
          const fact = await this.locked(organizationId, factId, trx);

          refuseFrozen(fact);
          await this.repo.insertAnchors(fact.id, [anchor], trx);
        }),
      anchor,
    );

    return this.get(organizationId, factId);
  }

  /**
   * Remove an anchor. A fact left with none is valid, and is never swept — the resource says so.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @param anchorId - The anchor.
   * @returns The fact.
   * @throws `409 fact_frozen` on a rejected or expired fact, `404 fact_anchor_not_found`.
   */
  async removeAnchor(
    organizationId: string,
    factId: string,
    anchorId: string,
  ): Promise<FactDetail> {
    await this.database.transaction(async (trx) => {
      const fact = await this.locked(organizationId, factId, trx);

      refuseFrozen(fact);

      if (!(await this.repo.deleteAnchor(fact.id, anchorId, trx))) {
        throw anchorNotFound(factId, anchorId);
      }
    });

    return this.get(organizationId, factId);
  }

  /**
   * One human decision along a single edge.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @param from - The status the action applies to.
   * @param to - Where it moves.
   * @param actorId - The person.
   * @param reason - An optional note.
   * @returns The fact.
   */
  private async decide(
    organizationId: string,
    factId: string,
    from: FactStatus,
    to: FactStatus,
    actorId: string,
    reason: string | undefined,
  ): Promise<FactDetail> {
    await this.write(factId, () =>
      this.database.transaction(async (trx) => {
        const fact = await this.locked(organizationId, factId, trx);

        if (fact.status !== from) {
          throw transitionRefused(
            fact.id,
            fact.status,
            to,
            transitionRefusal(fact.status, to) ?? actionMismatch(fact.status, from, to),
          );
        }

        await this.repo.move(
          fact.id,
          {
            to,
            actorId,
            reason: reason?.trim() ?? null,
            stampConfirmation: to === "confirmed",
          },
          trx,
        );
      }),
    );

    // Decided here, so the inbox card asking about it is settled (#461). Never throws.
    await this.reviews?.settled(organizationId);

    return this.get(organizationId, factId);
  }

  /**
   * Lock a fact of this workspace.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @param trx - The transaction.
   * @returns The locked row.
   * @throws `404 fact_not_found`.
   */
  private async locked(
    organizationId: string,
    factId: string,
    trx: Transaction<Database>,
  ): Promise<Fact> {
    const fact = await this.repo.lock(organizationId, factId, trx);

    if (fact === undefined) {
      throw factNotFound(factId);
    }

    return fact;
  }

  /**
   * Run a write, answering V071's named refusals as this module's errors.
   *
   * @param factId - The fact written, or null for a new proposal.
   * @param work - The write.
   * @param anchor - The anchor being added, when there is one.
   * @returns What it resolved to.
   */
  private async write<T>(
    factId: string | null,
    work: () => Promise<T>,
    anchor?: NewAnchorInput,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (violatesConstraint(error, FACT_CONSTRAINTS.provenanceResolves)) {
        throw provenanceUnresolved();
      }
      if (anchor !== undefined && violatesConstraint(error, FACT_CONSTRAINTS.anchorUnique)) {
        throw anchorExists(factId ?? "", anchor.kind, anchor.value);
      }
      if (
        factId !== null &&
        (violatesConstraint(error, FACT_CONSTRAINTS.legalTransition) ||
          violatesConstraint(error, FACT_CONSTRAINTS.relearnFromExpired))
      ) {
        // The row lock makes this unreachable in one database; kept as the backstop's answer.
        throw factChanged(factId);
      }
      throw error;
    }
  }
}

/**
 * Trim and check anchors before they reach V071's CHECKs.
 *
 * @param anchors - As sent.
 * @returns Them, trimmed, duplicates within the request removed.
 * @throws `422 fact_anchor_invalid`.
 */
export function normalizeAnchors(anchors: readonly NewAnchorInput[]): NewAnchorInput[] {
  const seen = new Set<string>();
  const normalized: NewAnchorInput[] = [];

  for (const anchor of anchors) {
    const value = anchor.value.trim();
    const problem = anchorValueProblem(anchor.kind, value);

    if (problem !== null) {
      throw anchorInvalid(anchor.kind, anchor.value, problem);
    }

    const key = `${anchor.kind}:${value}`;

    if (!seen.has(key)) {
      seen.add(key);
      normalized.push({ kind: anchor.kind, value });
    }
  }

  return normalized;
}

/**
 * Refuse unless `fact.status → to` is legal.
 *
 * @param fact - The locked fact.
 * @param to - Where it would move.
 * @throws `409 fact_transition_refused`.
 */
function refuseUnless(fact: Fact, to: FactStatus): void {
  const refusal = transitionRefusal(fact.status, to);

  if (refusal !== null) {
    throw transitionRefused(fact.id, fact.status, to, refusal);
  }
}

/**
 * Refuse an anchor change on a fact nothing changes any more.
 *
 * @param fact - The locked fact.
 * @throws `409 fact_frozen` for a rejected or expired fact.
 */
function refuseFrozen(fact: Fact): void {
  if (TERMINAL_FACT_STATUSES.includes(fact.status)) {
    throw factFrozen(fact.id, fact.status);
  }
}

/**
 * The stated reason for a legal edge asked for through the wrong action — *Confirm* on a stale
 * fact is legal in the machine, but it is *Re-confirm*'s.
 *
 * @param status - The fact's status.
 * @param from - The status the action applies to.
 * @param to - Where it moves.
 * @returns The reason.
 */
function actionMismatch(status: FactStatus, from: FactStatus, to: FactStatus): string {
  return from === "stale"
    ? `Only a stale fact can be re-confirmed; this one is ${status}.`
    : status === "stale" && to === "confirmed"
      ? "This fact is stale; re-confirm it instead."
      : `This action applies to a ${from} fact; this one is ${status}.`;
}
