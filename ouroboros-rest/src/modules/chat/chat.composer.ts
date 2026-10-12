/**
 * What an outbox row says, composed at the moment it is sent (BZ.2,
 * [#536](https://github.com/NobuData/ouroboros/issues/536)).
 *
 * An outbox row holds references — a decision, a run, a digest slot — never text. This service
 * reads the facts those references name *now* and composes the card from them, so a post that
 * waited behind a rate limit says what is true when it finally goes out: a decision answered in
 * the meantime is posted already closed, not posted open and then edited.
 *
 * ```
 * decision_card   kind registry (#457) · the item's facts · its resolution, if any
 * system_line     the same decision's resolution
 * loop_finished   runs · pull_requests · token_usage
 * digest          the Insights page, assembled as the mail assembles it (#440)
 * build_*         the facts the reporting plane put on the row
 * ```
 */

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { refsOf } from "../decisions/inbox.compose";
import { InboxRepository } from "../decisions/inbox.repository";
import type { DecisionRef, PublishedDecisionKind } from "../decisions/decision.types";
import { ActionTokenService } from "../inbox-channels/tokens/action-token.service";
import { DIGEST_RANGE, assembleDigest } from "../insights/digest/digest.assembly";
import { InsightsPageService } from "../insights/page/page.service";
import {
  actionValueMessage,
  encodeActionValue,
  newActionNonce,
  parseActionValue,
} from "./chat.action-payload";
import type { ChatMessageModel } from "./chat.card";
import {
  answers,
  decisionCard,
  decisionSystemLine,
  resolvedDecisionCard,
  type DecisionCardSubject,
} from "./chat.cards.decision";
import {
  buildFailedCard,
  buildGreenCard,
  digestCard,
  loopFinishedCard,
  type BuildFacts,
} from "./chat.cards.events";
import { ChatRepository, type ChatMessageResolution, type ClaimedChatRow } from "./chat.repository";

/** A message ready to render, and what its `chat_messages` row records. */
export interface ComposedChatMessage {
  readonly model: ChatMessageModel;
  /** Ordered typed refs — what the message is about. */
  readonly refs: readonly DecisionRef[];
  /** The figures it prints. */
  readonly facts: Readonly<Record<string, unknown>>;
  /** A decision card's state; null for everything else. */
  readonly state: "open" | "resolved" | null;
  /** A resolved decision card's outcome columns. */
  readonly resolution: ChatMessageResolution | null;
  /** What the message is, for `payload_digest` — stable across renderings of the same thing. */
  readonly digestParts: readonly string[];
}

/** Why a row has nothing to say any more. */
export interface ChatNothingToSay {
  readonly skip: string;
}

@Injectable()
export class ChatComposer {
  /**
   * @param repository - Resolutions and run facts.
   * @param inbox - Decision items.
   * @param registry - The kinds, pinned, and their rendering.
   * @param tokens - Signs a button's value under the workspace's key.
   * @param pages - The Insights page a digest is assembled from.
   * @param config - `OURO_UI_URL`, for the links.
   */
  constructor(
    private readonly repository: ChatRepository,
    private readonly inbox: InboxRepository,
    private readonly registry: DecisionKindRegistry,
    private readonly tokens: ActionTokenService,
    private readonly pages: InsightsPageService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Compose what a row says, from the facts as they are now.
   *
   * @param row - The claimed row.
   * @param now - The instant it is being sent.
   * @returns The message, or why there is nothing to say.
   */
  async compose(row: ClaimedChatRow, now: Date): Promise<ComposedChatMessage | ChatNothingToSay> {
    if (row.messageKind !== "event_card") {
      return this.decision(row, now);
    }

    switch (row.cardKind) {
      case "loop_finished":
        return this.loopFinished(row);
      case "digest":
        return this.digest(row);
      case "build_green":
      case "build_failed":
        return this.build(row);
      default:
        return { skip: `no card is composed for the event family ${row.cardKind}` };
    }
  }

  /**
   * Whether a button value is one this service signed for a workspace — #538's check.
   *
   * @param organizationId - The workspace the press arrived for.
   * @param presented - The value the platform sent back.
   * @returns The decision and action it names, or undefined for anything unsigned or altered.
   */
  async verifiedAction(
    organizationId: string,
    presented: unknown,
  ): Promise<{ itemId: string; actionId: string } | undefined> {
    const value = parseActionValue(presented);

    if (value === undefined) {
      return undefined;
    }

    const genuine = await this.tokens.verifySignature(
      organizationId,
      value.keyRef,
      actionValueMessage(organizationId, value),
      value.mac,
    );

    return genuine ? { itemId: value.itemId, actionId: value.actionId } : undefined;
  }

  /**
   * A decision card, its resolved form, or the line that follows it.
   *
   * @param row - The row.
   * @param now - The instant it is being sent.
   * @returns The message, or why there is none.
   */
  private async decision(
    row: ClaimedChatRow,
    now: Date,
  ): Promise<ComposedChatMessage | ChatNothingToSay> {
    if (row.decisionItemId === null) {
      return { skip: "the row names no decision" };
    }

    const item = await this.inbox.item(row.organizationId, row.decisionItemId);

    if (item === undefined) {
      return { skip: "the decision no longer exists" };
    }

    const kind = await this.registry.pinnedKind(item.kindId, item.kindVersion);
    const refs = refsOf(item.refs);
    const subject: DecisionCardSubject = {
      kind,
      rendered: this.registry.render(kind, item.payload),
      severity: item.severity,
      refs,
      sourceRef: item.sourceRef,
      askedAt: item.createdAt,
    };
    const resolution = await this.repository.resolution(item.id);

    if (row.messageKind === "system_line") {
      if (resolution === undefined) {
        return { skip: "the decision is not resolved" };
      }

      return {
        model: decisionSystemLine(subject, resolution),
        refs,
        facts: {
          action: resolution.actionId,
          ...(resolution.actorName === null ? {} : { answered_by: resolution.actorName }),
        },
        state: null,
        resolution: null,
        digestParts: ["system_line", item.id, resolution.actionId],
      };
    }

    if (resolution !== undefined) {
      return {
        model: resolvedDecisionCard(subject, resolution),
        refs,
        facts: {},
        state: "resolved",
        resolution: {
          outcome: resolution.actionId,
          resolvedBy: resolution.actorId,
          resolvedAt: resolution.resolvedAt,
        },
        digestParts: ["decision_card", item.id, resolution.actionId],
      };
    }

    if (row.operation === "update") {
      return { skip: "the decision is not resolved" };
    }

    if (item.status === "expired") {
      return { skip: "the decision expired unanswered" };
    }

    return {
      model: decisionCard(subject, {
        uiUrl: this.config.uiUrl,
        values: await this.signedValues(row.organizationId, item.id, kind),
        now,
      }),
      refs,
      facts: {},
      state: "open",
      resolution: null,
      digestParts: ["decision_card", item.id],
    };
  }

  /**
   * A signed value for each action that answers a decision.
   *
   * @param organizationId - The workspace.
   * @param itemId - The decision.
   * @param kind - Its kind.
   * @returns Values by action id.
   */
  private async signedValues(
    organizationId: string,
    itemId: string,
    kind: PublishedDecisionKind,
  ): Promise<Map<string, string>> {
    const values = new Map<string, string>();

    for (const action of kind.actions) {
      if (!answers(kind, action)) {
        continue;
      }

      const unsigned = { itemId, actionId: action.id, nonce: newActionNonce() };
      const { keyRef, mac } = await this.tokens.sign(
        organizationId,
        actionValueMessage(organizationId, unsigned),
      );

      values.set(action.id, encodeActionValue({ ...unsigned, keyRef, mac }));
    }

    return values;
  }

  /**
   * A finished loop's card.
   *
   * @param row - The row; its subject names the run.
   * @returns The card, or why there is none.
   */
  private async loopFinished(row: ClaimedChatRow): Promise<ComposedChatMessage | ChatNothingToSay> {
    const runId = row.subject.run_id;

    if (typeof runId !== "string") {
      return { skip: "the row names no run" };
    }

    const facts = await this.repository.loopFinishedFacts(row.organizationId, runId);

    if (facts === undefined) {
      return { skip: "the run no longer exists" };
    }

    const refs: DecisionRef[] = [
      { type: "run", id: facts.runId, label: `loop #${String(facts.loopSeq)}` },
    ];

    if (facts.prId !== null && facts.prNumber !== null) {
      refs.push({ type: "pr", id: facts.prId, label: `PR #${String(facts.prNumber)}` });
    }

    const card = loopFinishedCard(facts, this.config.uiUrl);

    return {
      model: card,
      refs,
      // Only what was printed: an unpriced run records no cost key at all.
      facts: {
        outcome: "merged",
        ...(facts.issueNumber === null ? {} : { issue_number: facts.issueNumber }),
        ...(facts.issueTitle === null ? {} : { issue_title: facts.issueTitle }),
        ...(facts.prNumber === null ? {} : { pr_number: facts.prNumber }),
        ...(facts.checksPassed === null || facts.checksTotal === null
          ? {}
          : { checks_passed: facts.checksPassed, checks_total: facts.checksTotal }),
        ...(facts.cycleSeconds === null ? {} : { cycle_seconds: Math.round(facts.cycleSeconds) }),
        ...(facts.costCents === null || facts.unpricedEvents > 0
          ? {}
          : { cost_cents: Number(facts.costCents) }),
        ...(facts.model === null ? {} : { model: facts.model }),
      },
      state: null,
      resolution: null,
      digestParts: ["loop_finished", facts.runId],
    };
  }

  /**
   * The weekly digest's card.
   *
   * @param row - The row; its subject names the slot.
   * @returns The card, or why there is none.
   */
  private async digest(row: ClaimedChatRow): Promise<ComposedChatMessage | ChatNothingToSay> {
    const slot = typeof row.subject.slot === "string" ? new Date(row.subject.slot) : undefined;

    if (slot === undefined || Number.isNaN(slot.getTime())) {
      return { skip: "the row names no digest slot" };
    }

    const assembly = assembleDigest(
      await this.pages.read(row.organizationId, { range: DIGEST_RANGE, now: slot }),
    );

    return {
      model: digestCard(assembly, this.config.uiUrl),
      refs: [],
      facts: {
        window_from: assembly.window.from,
        window_to: assembly.window.to,
        merged_prs: assembly.head.mergedPrs,
        interventions: assembly.head.interventions,
      },
      state: null,
      resolution: null,
      digestParts: ["digest", slot.toISOString()],
    };
  }

  /**
   * A build card, from the facts the reporting plane put on the row.
   *
   * @param row - The row.
   * @returns The card, or why there is none.
   */
  private build(row: ClaimedChatRow): ComposedChatMessage | ChatNothingToSay {
    const facts = buildFactsOf(row.subject);

    if (facts === undefined) {
      return { skip: "the row carries no build facts" };
    }

    const refs: DecisionRef[] = [
      { type: "run", id: facts.runId, label: `loop #${String(facts.loopSeq)}` },
    ];

    if (facts.prId !== null && facts.prNumber !== null) {
      refs.push({ type: "pr", id: facts.prId, label: `PR #${String(facts.prNumber)}` });
    }

    return {
      model:
        row.cardKind === "build_green"
          ? buildGreenCard(facts, this.config.uiUrl)
          : buildFailedCard(facts, this.config.uiUrl),
      refs,
      facts: { passed: facts.passed, total: facts.total },
      state: null,
      resolution: null,
      digestParts: [row.cardKind, facts.runId, String(facts.buildNumber ?? "")],
    };
  }
}

/**
 * Build facts as a row's subject carries them.
 *
 * @param subject - `chat_outbox.subject`.
 * @returns The facts, or undefined when the subject is not a build's.
 */
export function buildFactsOf(subject: Readonly<Record<string, unknown>>): BuildFacts | undefined {
  const count = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
  const text = (value: unknown): string | null =>
    typeof value === "string" && value !== "" ? value : null;
  const runId = text(subject.run_id);
  const loopSeq = count(subject.loop_seq);
  const passed = count(subject.passed);
  const total = count(subject.total);

  if (runId === null || loopSeq === null || passed === null || total === null || passed > total) {
    return undefined;
  }

  return {
    runId,
    loopSeq,
    buildNumber: count(subject.build_number),
    passed,
    total,
    prNumber: count(subject.pr_number),
    prId: text(subject.pr_id),
    revision: count(subject.revision),
  };
}
