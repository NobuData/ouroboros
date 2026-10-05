/**
 * `DecisionMailService` — the email channel (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463),
 * decision **X5**): instant mails for `err` items, and each person's daily digest, every actionable
 * row carrying single-use action tokens.
 *
 * ```
 * lifecycle filed | refreshed (err) ─▶ members who may press an answer · instant on · kind unmuted
 *     ─▶ claim (item, person, attempt) ─▶ mint a token per action they may press ─▶ send ─▶ settle
 * tick ─▶ failed instants retried (item still asking, < MAX_SEND_ATTEMPTS)
 *      ─▶ each digest subscriber whose slot is due (digest.schedule.ts)
 *           ─▶ claim (person, slot, attempt) ─▶ open cards by severity then age + the day's
 *              resolved summary, tokens per row ─▶ send ─▶ settle
 * ```
 *
 * **Why only `err` is instant.** The inbox must not become a mailing list: an instant mail is for
 * the item blocking a loop, everything else waits for the digest.
 *
 * **Tokens are minted per mail.** V096's mint supersedes the person's live token for the same item
 * and action, so the newest mail's links work and an older mail's say they were replaced — never
 * two live links for one answer.
 *
 * **A deployment with no mail server sends nothing**, and the channel truth says so
 * (`email: available`). A send failure is a settled `failed` claim, retried by the tick; it never
 * reaches the emitter that filed the item.
 */

import { createHash } from "node:crypto";

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { holdsRole } from "../../decisions/decision.actions";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import {
  DecisionLifecycle,
  type DecisionLifecycleEvent,
  type DecisionLifecycleListener,
} from "../../decisions/decision.lifecycle";
import type { PublishedDecisionKind } from "../../decisions/decision.types";
import { formatDuration, refsOf, resolvedSummary, utcDay } from "../../decisions/inbox.compose";
import { InboxRepository, type InboxItemRow } from "../../decisions/inbox.repository";
import { describeForLog } from "../../errors/failure";
import { MAILER, type Mailer } from "../../mail/mailer";
import { effectiveCanApproveLoops } from "../../tenancy/capabilities";
import { answerUrl, inboxItemUrl, inboxUrl } from "../channel.links";
import { dueDigestSlot } from "../notifications/digest.schedule";
import { PreferencesRepository } from "../notifications/preferences.repository";
import { effectivePreferences, mailsKind } from "../notifications/preferences.service";
import { ActionTokenService } from "../tokens/action-token.service";
import {
  composeDigestMail,
  composeInstantMail,
  digestOrder,
  ORG_DIGEST_FOOTER,
  type ComposedMail,
  type MailActionLink,
  type MailCard,
} from "./decision-mail.compose";
import {
  DecisionMailRepository,
  type MailClaim,
  type MailRecipient,
} from "./decision-mail.repository";

/** How many times one mail is tried. */
export const MAX_SEND_ATTEMPTS = 3;

/** How long a claim may stay unsettled before it is taken for dead: five minutes. */
export const MAIL_CLAIM_LEASE_MS = 5 * 60 * 1000;

/** What one pass of the tick did. */
export interface MailPassReport {
  readonly instantSent: number;
  readonly digestSent: number;
  readonly failed: number;
}

/** What one send did. */
type SendResult = "sent" | "failed" | "skipped";

/**
 * The `Message-ID` every attempt at one mail carries, so a receiver collapses a duplicate.
 *
 * @param parts - What identifies the mail — kind, workspace, subject, person.
 * @param mailFrom - The sending address, whose domain the id is under.
 * @returns The header value, angle brackets included.
 */
export function decisionMessageId(parts: readonly string[], mailFrom: string): string {
  const digest = createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 32);

  return `<decision.${digest}@${mailFrom.slice(mailFrom.lastIndexOf("@") + 1) || "ouroboros"}>`;
}

@Injectable()
export class DecisionMailService
  implements DecisionLifecycleListener, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DecisionMailService.name);

  /** Unregisters the listener. */
  private unregister?: () => void;

  /**
   * @param repository - Recipients, claims and the day's resolutions.
   * @param preferences - The last digest slot sent, for the gap rule.
   * @param inbox - The asking items and one item, as the queue reads them.
   * @param registry - The kinds, pinned, and their rendering.
   * @param tokens - Mints the links.
   * @param lifecycle - Where filed and refreshed are heard.
   * @param mailer - This deployment's mailer.
   * @param config - `OURO_UI_URL` and `OURO_MAIL_FROM`.
   */
  constructor(
    private readonly repository: DecisionMailRepository,
    private readonly preferences: PreferencesRepository,
    private readonly inbox: InboxRepository,
    private readonly registry: DecisionKindRegistry,
    private readonly tokens: ActionTokenService,
    private readonly lifecycle: DecisionLifecycle,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: AppConfigService,
  ) {}

  /** Start hearing the lifecycle. */
  onModuleInit(): void {
    this.unregister = this.lifecycle.add(this);
  }

  /** Stop hearing it. */
  onModuleDestroy(): void {
    this.unregister?.();
  }

  /**
   * The current instant — a method so a spec can pin it.
   *
   * @returns Now.
   */
  now(): Date {
    return new Date();
  }

  /**
   * Hear one change: a filed or refreshed item may need an instant mail.
   *
   * @param event - What happened.
   */
  decisionChanged(event: DecisionLifecycleEvent): void {
    if (event.type === "filed" || event.type === "refreshed") {
      void this.itemAsked(event.organizationId, event.itemId).catch((error: unknown) => {
        this.logger.error(
          `Instant mail for decision ${event.itemId} failed.`,
          describeForLog(error),
        );
      });
    }
  }

  /**
   * Mail an asking `err` item to everyone who may answer it and wants instant mail — once per
   * person, however often the item is refreshed.
   *
   * @param organizationId - The workspace.
   * @param itemId - The item.
   * @returns How many mails left.
   */
  async itemAsked(organizationId: string, itemId: string): Promise<number> {
    if (this.mailer.transport === "none") {
      return 0;
    }

    const item = await this.inbox.item(organizationId, itemId);

    if (item?.severity !== "err" || !asking(item, this.now())) {
      return 0;
    }

    const kind = await this.registry.pinnedKind(item.kindId, item.kindVersion);
    let sent = 0;

    for (const recipient of await this.repository.recipients(organizationId)) {
      if ((await this.sendInstant(organizationId, item, kind, recipient, 1)) === "sent") {
        sent += 1;
      }
    }

    return sent;
  }

  /**
   * One tick: fail abandoned claims, retry failed instants, send due digests.
   *
   * @returns What it did.
   */
  async pass(): Promise<MailPassReport> {
    if (this.mailer.transport === "none") {
      return { instantSent: 0, digestSent: 0, failed: 0 };
    }

    await this.repository.failAbandoned(MAIL_CLAIM_LEASE_MS);

    let instantSent = 0;
    let digestSent = 0;
    let failed = 0;

    for (const retry of await this.repository.instantRetries(MAX_SEND_ATTEMPTS)) {
      const item = await this.inbox.item(retry.organizationId, retry.itemId);
      const [recipient] = await this.repository.recipients(retry.organizationId, retry.userId);

      if (item === undefined || recipient === undefined) {
        continue;
      }

      const kind = await this.registry.pinnedKind(item.kindId, item.kindVersion);
      const result = await this.sendInstant(
        retry.organizationId,
        item,
        kind,
        recipient,
        retry.attempt,
      );

      instantSent += result === "sent" ? 1 : 0;
      failed += result === "failed" ? 1 : 0;
    }

    const now = this.now();

    for (const subscriber of await this.repository.digestSubscribers()) {
      try {
        const result = await this.digestFor(subscriber.organizationId, subscriber.userId, now);

        digestSent += result === "sent" ? 1 : 0;
        failed += result === "failed" ? 1 : 0;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `The decision digest for a member of ${subscriber.organizationId} failed.`,
          describeForLog(error),
        );
      }
    }

    return { instantSent, digestSent, failed };
  }

  /**
   * Send one person's digest if their slot is due and not yet sent.
   *
   * @param organizationId - The workspace.
   * @param userId - The person.
   * @param now - The instant the slot is judged at.
   * @returns What happened.
   */
  async digestFor(organizationId: string, userId: string, now: Date): Promise<SendResult> {
    const [recipient] = await this.repository.recipients(organizationId, userId);
    const preferences = effectivePreferences(recipient?.preferences);

    if (recipient === undefined || !preferences.digestEnabled) {
      return "skipped";
    }

    const lastSent = await this.preferences.lastDigestSlot(organizationId, userId);
    const slot = dueDigestSlot(now, preferences.digestTime, lastSent);

    if (slot === undefined) {
      return "skipped";
    }

    const attempts = await this.repository.slotAttempts(organizationId, userId, slot);

    if (attempts.sent || attempts.inFlight || attempts.attempts >= MAX_SEND_ATTEMPTS) {
      return "skipped";
    }

    const claim = this.claimOf(recipient, organizationId, attempts.attempts + 1, [
      "digest",
      organizationId,
      String(slot.getTime()),
      userId,
    ]);
    const sendId = await this.repository.claimDigest(claim, slot);

    if (sendId === undefined) {
      return "skipped";
    }

    return this.deliver(sendId, recipient, claim.messageId, () =>
      this.digestMail(organizationId, recipient, slot),
    );
  }

  /**
   * One instant mail to one person, if they should get it.
   *
   * @param organizationId - The item's workspace.
   * @param item - The item.
   * @param kind - Its pinned kind.
   * @param recipient - The person.
   * @param attempt - Which attempt this is.
   * @returns What happened.
   */
  private async sendInstant(
    organizationId: string,
    item: InboxItemRow,
    kind: PublishedDecisionKind,
    recipient: MailRecipient,
    attempt: number,
  ): Promise<SendResult> {
    const preferences = effectivePreferences(recipient.preferences);

    if (
      preferences.instantSeverity === "off" ||
      !mailsKind(preferences, item.kindId) ||
      answerable(kind, recipient).length === 0
    ) {
      return "skipped";
    }

    const claim = this.claimOf(recipient, organizationId, attempt, [
      "instant",
      item.id,
      recipient.userId,
    ]);
    const sendId = await this.repository.claimInstant(claim, item.id);

    if (sendId === undefined) {
      return "skipped";
    }

    return this.deliver(sendId, recipient, claim.messageId, async () => {
      const workspace = await this.repository.workspaceName(claim.organizationId);
      const card = await this.card(claim.organizationId, item, kind, recipient, this.now());

      return composeInstantMail(workspace, card);
    });
  }

  /**
   * Compose and send one claimed mail, and settle the claim.
   *
   * @param sendId - The claim.
   * @param recipient - The person.
   * @param messageId - The header every attempt carries.
   * @param compose - Builds the mail (minting its tokens) — only once the claim is held.
   * @returns `sent` or `failed`.
   */
  private async deliver(
    sendId: string,
    recipient: MailRecipient,
    messageId: string,
    compose: () => Promise<ComposedMail>,
  ): Promise<SendResult> {
    try {
      const mail = await compose();

      await this.mailer.send({ to: recipient.email, messageId, ...mail });
      await this.repository.settle(sendId);

      return "sent";
    } catch (error) {
      await this.repository.settle(sendId, error instanceof Error ? error.message : String(error));

      return "failed";
    }
  }

  /**
   * The digest's mail for one person.
   *
   * @param organizationId - The workspace.
   * @param recipient - The person.
   * @param slot - The slot it is for.
   * @returns The mail.
   */
  private async digestMail(
    organizationId: string,
    recipient: MailRecipient,
    slot: Date,
  ): Promise<ComposedMail> {
    const preferences = effectivePreferences(recipient.preferences);
    const now = this.now();
    const open = digestOrder(
      (await this.inbox.open(organizationId, now)).filter((item) =>
        mailsKind(preferences, item.kindId),
      ),
    );
    const cards: MailCard[] = [];

    for (const item of open) {
      const kind = await this.registry.pinnedKind(item.kindId, item.kindVersion);

      cards.push(await this.card(organizationId, item, kind, recipient, now));
    }

    return composeDigestMail({
      workspace: await this.repository.workspaceName(organizationId),
      day: utcDay(slot),
      open: cards,
      resolved: await this.resolvedLines(organizationId, slot),
      inboxUrl: inboxUrl(this.config.uiUrl),
    });
  }

  /**
   * The daily digest as an org notification route sends it (BR.4,
   * [#488](https://github.com/NobuData/ouroboros/issues/488)): every open decision of the
   * workspace and the last day's resolved summary, **read-only**. The route mails addresses rather
   * than people, so no card carries an action link (no token is minted — a token is a person's),
   * no person's muted kinds apply, and the footer says where the routing is changed. Composes
   * only; the route sender claims, sends and settles.
   *
   * @param organizationId - The workspace.
   * @param slot - The route's scheduled instant.
   * @returns The mail — the same for every routed address.
   */
  async orgDigestMail(organizationId: string, slot: Date): Promise<ComposedMail> {
    const now = this.now();
    const cards: MailCard[] = [];

    for (const item of digestOrder(await this.inbox.open(organizationId, now))) {
      const kind = await this.registry.pinnedKind(item.kindId, item.kindVersion);

      cards.push(await this.card(organizationId, item, kind, null, now));
    }

    return composeDigestMail({
      workspace: await this.repository.workspaceName(organizationId),
      day: utcDay(slot),
      open: cards,
      resolved: await this.resolvedLines(organizationId, slot),
      inboxUrl: inboxUrl(this.config.uiUrl),
      footer: ORG_DIGEST_FOOTER,
    });
  }

  /**
   * The last day's resolved lines a digest closes with.
   *
   * @param organizationId - The workspace.
   * @param slot - The digest's slot; the day before it is summarised.
   * @returns One line per resolved item — `Split #490 into 6 tickets — approved`.
   */
  private async resolvedLines(organizationId: string, slot: Date): Promise<string[]> {
    const resolved: string[] = [];

    for (const row of await this.repository.resolvedBefore(organizationId, slot)) {
      const kind = await this.registry.pinnedKind(row.kindId, row.kindVersion);

      resolved.push(
        resolvedSummary(
          row.kindId,
          row.payload,
          refsOf(row.refs),
          this.registry.render(kind, row.payload).question,
          row,
        ),
      );
    }

    return resolved;
  }

  /**
   * One card, with a freshly minted token per action the person may press.
   *
   * @param organizationId - The workspace.
   * @param item - The item.
   * @param kind - Its pinned kind.
   * @param recipient - The person, or `null` for an org route's read-only card: no person, so no
   *   action may be pressed from it and no token is minted.
   * @param now - For how long it has waited.
   * @returns The card.
   */
  private async card(
    organizationId: string,
    item: InboxItemRow,
    kind: PublishedDecisionKind,
    recipient: MailRecipient | null,
    now: Date,
  ): Promise<MailCard> {
    const prose = this.registry.render(kind, item.payload);
    const actions: MailActionLink[] = [];
    // A read-only card (an org route's) has nobody to mint for, so it carries no action.
    if (recipient !== null) {
      for (const action of answerable(kind, recipient)) {
        const token = await this.tokens.mint(
          organizationId,
          item.id,
          action.id,
          recipient.userId,
          "email",
        );

        actions.push({
          label: action.label,
          consequence: action.consequence_text,
          url: answerUrl(this.config.uiUrl, token),
          primary: action.style === "primary",
          requiresConfirm: kind.mergeClass,
        });
      }
    }

    return {
      severity: item.severity,
      question: prose.question,
      why: prose.why,
      refs: refsOf(item.refs),
      waited: formatDuration((now.getTime() - item.createdAt.getTime()) / 1000),
      actions,
      inboxUrl: inboxItemUrl(this.config.uiUrl, item.id),
    };
  }

  /**
   * A claim for one person.
   *
   * @param recipient - The person.
   * @param organizationId - The workspace.
   * @param attempt - Which attempt.
   * @param identity - What identifies the mail, for its `Message-ID`.
   * @returns The claim.
   */
  private claimOf(
    recipient: MailRecipient,
    organizationId: string,
    attempt: number,
    identity: readonly string[],
  ): MailClaim {
    return {
      organizationId,
      userId: recipient.userId,
      recipient: recipient.email,
      attempt,
      messageId: decisionMessageId(identity, this.config.mailFrom ?? ""),
    };
  }
}

/**
 * Whether an item is still asking.
 *
 * @param item - The item.
 * @param now - The instant a snooze is judged at.
 * @returns True for an open item, or a snoozed one whose snooze has elapsed.
 */
function asking(item: InboxItemRow, now: Date): boolean {
  return (
    item.status === "open" ||
    (item.status === "snoozed" && item.snoozedUntil !== null && item.snoozedUntil <= now)
  );
}

/**
 * The answering actions a person may press — what a mail mints tokens for.
 *
 * @param kind - The item's pinned kind.
 * @param recipient - The person.
 * @returns The actions, in declared order; links (`navigate.*`) and non-answers left out.
 */
export function answerable(kind: PublishedDecisionKind, recipient: MailRecipient) {
  const viewer = {
    roles: recipient.roles,
    canApproveLoops: effectiveCanApproveLoops(recipient.roles, recipient.explicitCanApproveLoops),
  };

  return kind.actions.filter(
    (action) =>
      kind.resolutionSemantics.answered_by.includes(action.id) &&
      !action.handler_binding.startsWith("navigate.") &&
      holdsRole(action.required_role, viewer),
  );
}
