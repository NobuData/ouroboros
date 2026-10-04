/**
 * `InboxQueueService` — everything the Needs-You page reads, and snooze (BN.4,
 * [#464](https://github.com/NobuData/ouroboros/issues/464)).
 *
 * ```
 * queue      wake elapsed snoozes → open items newest first, prose rendered at the pinned version,
 *            facts and refs alongside, actions resolved against the viewer (disabled with a
 *            reason) → the snoozed items apart → the head (count, noun, estimate from this week's
 *            per-kind medians — X8)
 * resolved   one UTC day's answers: resolver class, policy ref, channel, the composed line; the
 *            previous day with any history and the next day, for paging
 * stats      this UTC week's decision_metrics_weekly row — `—`, never 0, on a cold workspace
 * snooze     one item, or Snooze all as one V095 event; un-snooze one or all; every write audited
 * ```
 *
 * **Snooze is honest arithmetic** (X6): a snoozed item leaves the queue and the pill
 * (`InboxFeedService` counts the same way) but never the metrics, and its `created_at` — its age —
 * is never touched. Prose is rendered here so the card stays a renderer (X1).
 */

import { Injectable } from "@nestjs/common";

import {
  DECISION_SNOOZED_ALL_EVENT,
  DECISION_SNOOZED_EVENT,
  DECISION_UNSNOOZED_EVENT,
} from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import type {
  DecisionChannel,
  DecisionItemStatus,
  DecisionSeverity,
  OrganizationRole,
} from "../db/schema";
import { ConflictError, NotFoundError } from "../errors/error.envelope";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { effectiveCanApproveLoops } from "../tenancy/capabilities";
import { DecisionKindRegistry } from "./decision-kind.registry";
import type { DecisionRef } from "./decision.types";
import {
  NO_FIGURE,
  estimateSeconds,
  formatDuration,
  inboxActions,
  inboxHead,
  refsOf,
  resolvedSummary,
  utcDay,
  utcWeek,
  type InboxAction,
  type InboxHead,
} from "./inbox.compose";
import { InboxRepository, type InboxItemRow } from "./inbox.repository";

/** The roles that may snooze for everyone (a snooze hides an item from the whole workspace). */
export const SNOOZING_ROLES: readonly OrganizationRole[] = ["owner", "admin", "member"];

/** The longest a snooze may last, in minutes — a week, the longest a kind waits. */
export const MAX_SNOOZE_MINUTES = 10080;

/** Who is looking. */
export interface InboxViewer {
  /** `"user".id`, or null for a caller with no person (a service account). */
  readonly userId: string | null;
  readonly roles: readonly OrganizationRole[];
}

/** One asking item, as the card renders it. */
export interface InboxItemResource {
  readonly id: string;
  readonly kindId: string;
  readonly kindVersion: number;
  readonly severity: DecisionSeverity;
  readonly status: DecisionItemStatus;
  readonly question: string;
  readonly why: string;
  readonly tags: readonly string[];
  /** The facts the prose was composed from. */
  readonly facts: Readonly<Record<string, unknown>>;
  readonly refs: readonly DecisionRef[];
  /** Merge-class: a channel deep link must land on session confirmation (X5). */
  readonly mergeClass: boolean;
  readonly actions: readonly InboxAction[];
  readonly createdAt: string;
  /** Seconds since it was asked — counted through any snooze. */
  readonly ageSeconds: number;
  readonly snooze: { readonly allowed: boolean };
}

/** One snoozed item. */
export interface InboxSnoozedResource {
  readonly id: string;
  readonly kindId: string;
  readonly severity: DecisionSeverity;
  readonly question: string;
  readonly refs: readonly DecisionRef[];
  readonly createdAt: string;
  readonly ageSeconds: number;
  readonly snoozedUntil: string;
  readonly snoozedBy: string | null;
  readonly reason: string | null;
}

/** `GET /api/v1/inbox`. */
export interface InboxQueueResource {
  readonly head: InboxHead;
  readonly items: readonly InboxItemResource[];
  readonly snoozed: readonly InboxSnoozedResource[];
  readonly asOf: string;
}

/** One resolved row. */
export interface InboxResolvedRowResource {
  readonly itemId: string;
  readonly kindId: string;
  /** `Split #490 into 6 tickets — approved`. */
  readonly summary: string;
  readonly actionId: string;
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  readonly actor: { readonly id: string; readonly name: string } | null;
  readonly channel: DecisionChannel;
  readonly note: string | null;
  readonly outcome: Record<string, unknown>;
  readonly resolvedAt: string;
  readonly answerLatencySeconds: number;
  readonly loopWaitSeconds: number | null;
}

/** `GET /api/v1/inbox/resolved`. */
export interface InboxResolvedResource {
  readonly day: string;
  readonly count: number;
  readonly rows: readonly InboxResolvedRowResource[];
  /** The latest earlier day with any answer, or null. */
  readonly previousDay: string | null;
  /** The day after, or null when `day` is today. */
  readonly nextDay: string | null;
}

/** `GET /api/v1/inbox/stats`. */
export interface InboxStatsResource {
  readonly week: string;
  readonly decisions: number | null;
  readonly medianAnswerSeconds: number | null;
  readonly maxLoopWaitSeconds: number | null;
  readonly policyResolutions: number | null;
  readonly autoAcceptShare: number | null;
  /** As the card prints them — `11`, `41s`, `6m` — or `—`. */
  readonly display: {
    readonly decisions: string;
    readonly medianAnswer: string;
    readonly maxLoopWait: string;
  };
}

/** What a snooze did. */
export interface InboxSnoozeResource {
  readonly snoozed: readonly string[];
  readonly until: string | null;
  readonly eventId: string | null;
}

/** What an un-snooze did. */
export interface InboxUnsnoozeResource {
  readonly unsnoozed: readonly string[];
}

/**
 * Seconds between two instants, never negative.
 *
 * @param from - The earlier.
 * @param to - The later.
 * @returns Whole seconds.
 */
function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

@Injectable()
export class InboxQueueService {
  /**
   * @param repository - The page's statements.
   * @param registry - The kinds, pinned, and their rendering.
   * @param capabilities - `can_approve_loops`, for `approver` actions.
   * @param audit - Where every snooze is recorded.
   */
  constructor(
    private readonly repository: InboxRepository,
    private readonly registry: DecisionKindRegistry,
    private readonly capabilities: CapabilityRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * The current instant — a method so a spec can pin it.
   *
   * @returns Now.
   */
  now(): Date {
    return new Date();
  }

  /**
   * The queue: asking items, the snoozed ones, and the head.
   *
   * @param organizationId - The workspace.
   * @param viewer - Who is looking — their actions are resolved against them.
   * @returns The page's main read.
   */
  async queue(organizationId: string, viewer: InboxViewer): Promise<InboxQueueResource> {
    await this.repository.wake(organizationId);

    const now = this.now();
    const [open, snoozed, week] = [
      await this.repository.open(organizationId, now),
      await this.repository.snoozed(organizationId, now),
      await this.repository.week(organizationId, utcWeek(now)),
    ];
    const canApproveLoops = effectiveCanApproveLoops(
      viewer.roles,
      viewer.userId === null
        ? false
        : await this.capabilities.explicitFor(organizationId, viewer.userId),
    );
    const maySnooze = viewer.roles.some((role) => SNOOZING_ROLES.includes(role));
    const items: InboxItemResource[] = [];

    for (const row of open) {
      const kind = await this.registry.pinnedKind(row.kindId, row.kindVersion);
      const prose = this.registry.render(kind, row.payload);

      items.push({
        id: row.id,
        kindId: row.kindId,
        kindVersion: row.kindVersion,
        severity: row.severity,
        status: row.status,
        question: prose.question,
        why: prose.why,
        tags: prose.tags,
        facts: row.payload,
        refs: refsOf(row.refs),
        mergeClass: kind.mergeClass,
        actions: inboxActions(
          this.registry.actionsFor(kind, { roles: viewer.roles, canApproveLoops }),
        ),
        createdAt: row.createdAt.toISOString(),
        ageSeconds: secondsBetween(row.createdAt, now),
        snooze: { allowed: maySnooze },
      });
    }

    const hidden: InboxSnoozedResource[] = [];

    for (const row of snoozed) {
      hidden.push(await this.snoozedResource(row, now));
    }

    const estimate = estimateSeconds(
      open.map((row) => row.kindId),
      week?.perKind ?? {},
      week?.medianAnswerSeconds ?? null,
    );

    return {
      head: inboxHead(items.length, estimate),
      items,
      snoozed: hidden,
      asOf: now.toISOString(),
    };
  }

  /**
   * One UTC day's answers.
   *
   * @param organizationId - The workspace.
   * @param day - `YYYY-MM-DD`, or undefined for today (UTC).
   * @returns The rows and the paging.
   */
  async resolved(organizationId: string, day: string | undefined): Promise<InboxResolvedResource> {
    const today = utcDay(this.now());
    const asked = day ?? today;
    const rows = await this.repository.resolved(organizationId, asked);
    const lines: InboxResolvedRowResource[] = [];

    for (const row of rows) {
      const kind = await this.registry.pinnedKind(row.kindId, row.kindVersion);
      const refs = refsOf(row.refs);

      lines.push({
        itemId: row.itemId,
        kindId: row.kindId,
        summary: resolvedSummary(
          row.kindId,
          row.payload,
          refs,
          this.registry.render(kind, row.payload).question,
          {
            resolver: row.resolver,
            policy: row.policy,
            actionId: row.actionId,
          },
        ),
        actionId: row.actionId,
        resolver: row.resolver,
        policy: row.policy,
        actor:
          row.actorId === null || row.actorName === null
            ? null
            : { id: row.actorId, name: row.actorName },
        channel: row.channel,
        note: row.note,
        outcome: row.outcome,
        resolvedAt: row.resolvedAt.toISOString(),
        answerLatencySeconds: row.answerLatencySeconds,
        loopWaitSeconds: row.loopWaitSeconds,
      });
    }

    const next = new Date(`${asked}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);

    return {
      day: asked,
      count: lines.length,
      rows: lines,
      previousDay: await this.repository.previousDay(organizationId, asked),
      nextDay: asked >= today ? null : utcDay(next),
    };
  }

  /**
   * This UTC week's stat card.
   *
   * @param organizationId - The workspace.
   * @returns The figures, null and `—` where nothing was answered.
   */
  async stats(organizationId: string): Promise<InboxStatsResource> {
    const week = utcWeek(this.now());
    const row = await this.repository.week(organizationId, week);

    return {
      week,
      decisions: row?.decisions ?? null,
      medianAnswerSeconds: row?.medianAnswerSeconds ?? null,
      maxLoopWaitSeconds: row?.maxLoopWaitSeconds ?? null,
      policyResolutions: row?.policyResolutions ?? null,
      autoAcceptShare: row?.autoAcceptShare ?? null,
      display: {
        decisions: row === undefined ? NO_FIGURE : String(row.decisions),
        medianAnswer: formatDuration(row?.medianAnswerSeconds ?? null),
        maxLoopWait: formatDuration(row?.maxLoopWaitSeconds ?? null),
      },
    };
  }

  /**
   * Snooze one item.
   *
   * @param organizationId - The workspace.
   * @param itemId - The item.
   * @param actorId - Who, or null for a caller with no person.
   * @param minutes - For how long.
   * @param reason - Why, optional.
   * @returns The item and when it wakes.
   * @throws {NotFoundError} `decision_item_not_found`.
   * @throws {ConflictError} `decision_item_not_open` for an answered or expired item.
   */
  async snooze(
    organizationId: string,
    itemId: string,
    actorId: string | null,
    minutes: number,
    reason: string | null,
  ): Promise<InboxSnoozeResource> {
    const item = await this.askingItem(organizationId, itemId);
    const until = new Date(this.now().getTime() + minutes * 60_000);
    const eventId = await this.repository.snooze(item.id, until, actorId, reason);

    await this.audit.record({
      organizationId,
      actorId,
      action: DECISION_SNOOZED_EVENT,
      subjectType: "decision_item",
      subjectId: item.id,
      at: new Date(),
      detail: { kind: item.kindId, until: until.toISOString(), event: eventId },
    });

    return { snoozed: [item.id], until: until.toISOString(), eventId };
  }

  /**
   * *Snooze all* — every open item, as one event.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who, or null.
   * @param minutes - For how long.
   * @param reason - Why, optional.
   * @returns The items caught; empty, with no event, when nothing was open.
   */
  async snoozeAll(
    organizationId: string,
    actorId: string | null,
    minutes: number,
    reason: string | null,
  ): Promise<InboxSnoozeResource> {
    const until = new Date(this.now().getTime() + minutes * 60_000);
    const { eventId, items } = await this.repository.snoozeAll(
      organizationId,
      until,
      actorId,
      reason,
    );

    if (eventId !== null) {
      await this.audit.record({
        organizationId,
        actorId,
        action: DECISION_SNOOZED_ALL_EVENT,
        subjectType: "decision_item",
        subjectId: null,
        at: new Date(),
        detail: { until: until.toISOString(), count: items.length, event: eventId },
      });
    }

    return { snoozed: items, until: eventId === null ? null : until.toISOString(), eventId };
  }

  /**
   * Bring snoozed items back now.
   *
   * @param organizationId - The workspace.
   * @param itemId - One item, or null for every snoozed item.
   * @param actorId - Who, or null.
   * @returns The items re-opened.
   * @throws {NotFoundError} `decision_item_not_found` for an item the workspace does not have.
   */
  async unsnooze(
    organizationId: string,
    itemId: string | null,
    actorId: string | null,
  ): Promise<InboxUnsnoozeResource> {
    if (itemId !== null && (await this.repository.item(organizationId, itemId)) === undefined) {
      throw itemNotFound(itemId);
    }

    const unsnoozed = await this.repository.unsnooze(organizationId, itemId);

    if (unsnoozed.length > 0) {
      await this.audit.record({
        organizationId,
        actorId,
        action: DECISION_UNSNOOZED_EVENT,
        subjectType: "decision_item",
        subjectId: itemId,
        at: new Date(),
        detail: { count: unsnoozed.length },
      });
    }

    return { unsnoozed };
  }

  /**
   * An item that is still asking.
   *
   * @param organizationId - The workspace.
   * @param itemId - The item.
   * @returns It.
   * @throws {NotFoundError} When the workspace has no such item.
   * @throws {ConflictError} When it is answered or expired.
   */
  private async askingItem(organizationId: string, itemId: string): Promise<InboxItemRow> {
    const item = await this.repository.item(organizationId, itemId);

    if (item === undefined) {
      throw itemNotFound(itemId);
    }

    if (item.status !== "open" && item.status !== "snoozed") {
      throw new ConflictError(
        "decision_item_not_open",
        `This decision is ${item.status}, so it cannot be snoozed.`,
        { itemId, status: item.status },
      );
    }

    return item;
  }

  /**
   * A snoozed item, with its question.
   *
   * @param row - The item.
   * @param now - The instant.
   * @returns The resource.
   */
  private async snoozedResource(row: InboxItemRow, now: Date): Promise<InboxSnoozedResource> {
    const kind = await this.registry.pinnedKind(row.kindId, row.kindVersion);

    return {
      id: row.id,
      kindId: row.kindId,
      severity: row.severity,
      question: this.registry.render(kind, row.payload).question,
      refs: refsOf(row.refs),
      createdAt: row.createdAt.toISOString(),
      ageSeconds: secondsBetween(row.createdAt, now),
      snoozedUntil: (row.snoozedUntil ?? now).toISOString(),
      snoozedBy: row.snoozedBy,
      reason: row.snoozeReason,
    };
  }
}

/**
 * No item with this id in the workspace.
 *
 * @param itemId - The id.
 * @returns The error.
 */
function itemNotFound(itemId: string): NotFoundError {
  return new NotFoundError(
    "decision_item_not_found",
    `No decision item ${itemId} exists in this workspace.`,
    {
      itemId,
    },
  );
}
