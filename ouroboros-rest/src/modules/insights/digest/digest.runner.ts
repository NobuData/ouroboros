/**
 * The weekly run (BJ.4, [#440](https://github.com/NobuData/ouroboros/issues/440)): find the
 * workspaces whose slot has come due, assemble each one's digest **once**, and mail it to each
 * subscriber.
 *
 * ```
 * tick ─▶ workspaces with a subscriber ─▶ slot due? ─▶ claim the run (unique slot)
 *      ─▶ assemble from the Insights page as of the slot, store it on the run
 *      ─▶ per recipient: claim the attempt (unique) ─▶ send ─▶ settle sent | failed
 *      ─▶ nobody left to mail or retry ─▶ run complete
 * ```
 *
 * **When a slot is due.** The latest weekly slot at or before now, provided it is no more than
 * {@link DIGEST_GRACE_MS} old — a process that was down across its slot still sends when it
 * returns, but a slot from days ago is last week's news — and provided the workspace has no run
 * within {@link DIGEST_MIN_GAP_MS} before it, so moving the schedule mid-week does not send a
 * second digest.
 *
 * **What a retry sends.** The run's stored content. The page is read once, as of the slot, and
 * every attempt — the first or the third, this tick or the next — renders that assembly, so the
 * send audit's window and version describe every mail of the run.
 *
 * **What happens when a send fails.** The attempt is settled `failed` with the reason, and the
 * next tick tries again, up to {@link MAX_SEND_ATTEMPTS}. A claim that was never settled (the
 * sender died) is failed once it is older than {@link CLAIM_LEASE_MS}. The one duplicate this
 * cannot rule out is a mail accepted by the server a moment before a crash: its retry carries
 * the same `Message-ID`.
 */

import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { describeForLog } from "../../errors/failure";
import { MAILER, type Mailer } from "../../mail/mailer";
import { latestWeeklySlot } from "../../scheduling/cadence";
import { InsightsPageService } from "../page/page.service";
import {
  DIGEST_CONTENT_VERSION,
  DIGEST_RANGE,
  assembleDigest,
  type DigestAssembly,
} from "./digest.assembly";
import { insightsUrl, renderDigest, unsubscribeUrl } from "./digest.render";
import {
  DigestRepository,
  type DigestRecipient,
  type DigestRunRow,
  type DigestScheduleRow,
  type RunClaimState,
  type SubscribedWorkspace,
} from "./digest.repository";
import { DEFAULT_DIGEST_SCHEDULE } from "./digest.service";
import { mintUnsubscribeToken } from "./digest.token";

const HOUR_MS = 60 * 60 * 1000;

/** How long after its slot a digest may still be sent: a day. */
export const DIGEST_GRACE_MS = 24 * HOUR_MS;

/** The least time between two runs of one workspace: six days. */
export const DIGEST_MIN_GAP_MS = 6 * 24 * HOUR_MS;

/** How many times a run tries one recipient. */
export const MAX_SEND_ATTEMPTS = 3;

/**
 * How long a claim may stay unsettled before it is taken for dead: five minutes, several times
 * the SMTP transport's longest timeout.
 */
export const CLAIM_LEASE_MS = 5 * 60 * 1000;

/** The longest failure reason the audit keeps. */
const MAX_ERROR_LENGTH = 500;

/** What one workspace's run did in a tick. */
export interface DigestRunOutcome {
  readonly organizationId: string;
  readonly slotAt: Date;
  readonly sent: number;
  readonly failed: number;
  readonly completed: boolean;
}

/** What a tick did. */
export interface DigestReport {
  readonly outcomes: readonly DigestRunOutcome[];
  /** Workspaces whose run could not be attempted, with why. */
  readonly errors: readonly { readonly organizationId: string; readonly error: string }[];
}

/**
 * The slot a workspace's run is due for, if any.
 *
 * @param now - The current instant.
 * @param state - The workspace's schedule and latest run.
 * @returns The slot, or undefined when nothing is due.
 */
export function dueSlot(now: Date, state: RunClaimState): Date | undefined {
  const schedule: DigestScheduleRow = state.schedule ?? DEFAULT_DIGEST_SCHEDULE;
  const slot = latestWeeklySlot(now, schedule.weeklyDay, schedule.weeklyTime);

  if (now.getTime() - slot.getTime() > DIGEST_GRACE_MS) {
    return undefined;
  }

  const latest = state.latestSlotAt?.getTime();

  // The slot's own run is found again (to resume it); any other run this close is this week's.
  if (
    latest !== undefined &&
    latest !== slot.getTime() &&
    slot.getTime() - latest < DIGEST_MIN_GAP_MS
  ) {
    return undefined;
  }

  return slot;
}

/**
 * The `Message-ID` every attempt at one recipient in one run carries.
 *
 * @param runId - The run.
 * @param userId - The recipient. Hashed: an internal id has no business in a mail header.
 * @param mailFrom - The sending address, whose domain the id is under.
 * @returns The header value, angle brackets included.
 */
export function digestMessageId(runId: string, userId: string, mailFrom: string): string {
  const recipient = createHash("sha256").update(userId, "utf8").digest("hex").slice(0, 16);

  return `<digest.${runId}.${recipient}@${mailFrom.slice(mailFrom.lastIndexOf("@") + 1)}>`;
}

@Injectable()
export class DigestRunner {
  /** Set when the application is shutting down, so a run stops between recipients. */
  private stopped = false;

  /**
   * @param repository - The digest's storage.
   * @param pages - The Insights page — the only source of the digest's figures.
   * @param mailer - This deployment's mailer.
   * @param config - The origins links are built from, and the sending address.
   */
  constructor(
    private readonly repository: DigestRepository,
    private readonly pages: InsightsPageService,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: AppConfigService,
  ) {}

  /** Stop sending after the recipient in hand. */
  stop(): void {
    this.stopped = true;
  }

  /**
   * One pass over every workspace somebody subscribed to.
   *
   * @param now - The current instant.
   * @returns What each due workspace's run did. Empty when this deployment sends no mail.
   */
  async tick(now: Date = new Date()): Promise<DigestReport> {
    const outcomes: DigestRunOutcome[] = [];
    const errors: { organizationId: string; error: string }[] = [];

    if (this.mailer.transport === "none") {
      return { outcomes, errors };
    }

    for (const workspace of await this.repository.subscribedWorkspaces()) {
      if (this.stopped) {
        break;
      }

      try {
        const outcome = await this.run(workspace, now);

        if (outcome !== undefined) {
          outcomes.push(outcome);
        }
      } catch (error) {
        // One workspace's failure — its page could not be read, say — costs that workspace a
        // tick, not the others theirs.
        errors.push({ organizationId: workspace.organizationId, error: describeForLog(error) });
      }
    }

    return { outcomes, errors };
  }

  /**
   * One workspace's run, if its slot is due.
   *
   * @param workspace - The workspace.
   * @param now - The current instant.
   * @returns What the run did, or undefined when nothing was due.
   */
  private async run(
    workspace: SubscribedWorkspace,
    now: Date,
  ): Promise<DigestRunOutcome | undefined> {
    const { organizationId } = workspace;
    // A first look without the lock, so a tick with nothing due costs one read per workspace.
    const candidate = dueSlot(now, { schedule: workspace.schedule, latestSlotAt: undefined });

    if (
      candidate === undefined ||
      (await this.repository.recipients(organizationId, candidate)).length === 0
    ) {
      return undefined;
    }

    const claimed = await this.repository.claimRun(organizationId, (state) => dueSlot(now, state));

    if (claimed === undefined || claimed.completedAt !== null) {
      return undefined;
    }

    const run = await this.assembled(claimed);
    const assembly = run.content as DigestAssembly;
    // Read again for the claimed slot: the schedule may have moved since the first look.
    const recipients = await this.repository.recipients(organizationId, run.slotAt);

    await this.repository.expireClaims(run.id, CLAIM_LEASE_MS);

    const attempts = await this.repository.sends(run.id);
    let sent = 0;
    let failed = 0;
    let open = false;

    for (const recipient of recipients) {
      if (this.stopped) {
        open = true;
        break;
      }

      const mine = attempts.filter((attempt) => attempt.userId === recipient.userId);

      if (mine.some((attempt) => attempt.status === "sent") || mine.length >= MAX_SEND_ATTEMPTS) {
        continue;
      }

      // Another sender holds a live claim on this recipient: theirs to settle, not ours to race.
      if (mine.some((attempt) => attempt.status === "claimed")) {
        open = true;
        continue;
      }

      const attempt = mine.length + 1;
      const outcome = await this.send(workspace, run, assembly, recipient, attempt);

      if (outcome === "sent") {
        sent += 1;
      } else {
        failed += outcome === "failed" ? 1 : 0;
        // Lost the claim, or failed with attempts left: the run is not finished.
        open = open || outcome === "lost" || attempt < MAX_SEND_ATTEMPTS;
      }
    }

    if (!open) {
      await this.repository.completeRun(run.id);
    }

    return { organizationId, slotAt: run.slotAt, sent, failed, completed: !open };
  }

  /**
   * The run with its content — read from the page and stored if this is the first to assemble.
   *
   * @param run - The claimed run.
   * @returns The run, with content.
   */
  private async assembled(run: DigestRunRow): Promise<DigestRunRow> {
    if (run.content !== null) {
      return run;
    }

    // As of the slot, not of now: a run that starts late still reports the week its slot names.
    const assembly = assembleDigest(
      await this.pages.read(run.organizationId, { range: DIGEST_RANGE, now: run.slotAt }),
    );

    return this.repository.storeContent(run.id, assembly, assembly.window, DIGEST_CONTENT_VERSION);
  }

  /**
   * One attempt at one recipient: claim, send, settle.
   *
   * @param workspace - The workspace.
   * @param run - The run.
   * @param assembly - The run's content.
   * @param recipient - Who.
   * @param attempt - Which attempt this is.
   * @returns `sent`, `failed`, or `lost` when another sender claimed the attempt first.
   */
  private async send(
    workspace: SubscribedWorkspace,
    run: DigestRunRow,
    assembly: DigestAssembly,
    recipient: DigestRecipient,
    attempt: number,
  ): Promise<"sent" | "failed" | "lost"> {
    const { token, hash } = mintUnsubscribeToken();
    const messageId = digestMessageId(run.id, recipient.userId, this.config.mailFrom ?? "");
    const sendId = await this.repository.claimSend({
      organizationId: run.organizationId,
      runId: run.id,
      userId: recipient.userId,
      recipient: recipient.email,
      attempt,
      messageId,
      unsubscribeTokenHash: hash,
    });

    if (sendId === undefined) {
      return "lost";
    }

    const link = unsubscribeUrl(this.config.restUrl, token);
    const rendered = renderDigest(assembly, {
      workspaceName: workspace.name,
      insightsUrl: insightsUrl(this.config.uiUrl),
      unsubscribeUrl: link,
    });

    try {
      await this.mailer.send({
        to: recipient.email,
        ...rendered,
        messageId,
        headers: {
          "List-Unsubscribe": `<${link}>`,
          // RFC 8058's one-click is defined for https links only.
          ...(link.startsWith("https://")
            ? { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
            : {}),
        },
      });
    } catch (error) {
      await this.repository.settleSend(
        sendId,
        (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH) ||
          "The send failed.",
      );

      return "failed";
    }

    await this.repository.settleSend(sendId);

    return "sent";
  }
}
