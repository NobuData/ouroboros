/**
 * The org notification routes' sender (BR.4, [#488](https://github.com/NobuData/ouroboros/issues/488)):
 * the daily digest and weekly insights routes, mailed to the route's addresses.
 *
 * ```
 * tick   fail lapsed claims ─▶ for each delivering mailing route:
 *          due slot? ─▶ recipients (config.recipients, else owners and admins)
 *          ─▶ compose once ─▶ per address: claim attempt ─▶ send ─▶ settle
 * ```
 *
 * **Separate from the per-person sends.** BN.3's daily digest (a person's `digest_time`, their
 * mutes, their action links) and #440's weekly digest (a person's opt-in) are untouched: a route
 * is the workspace's own send, at the route's time, to the route's addresses, logged in V103's
 * `notification_route_sends`. A member who is both a subscriber and a route recipient receives
 * both — one is theirs, the other the workspace's.
 *
 * **Only delivering routes are read.** `notification_routes_effective.delivering` is
 * `enabled ∧ ¬locked`, so a disabled route sends nothing and a route bound to a channel with no
 * connection (Slack, PagerDuty) can never send — the lock is not the UI's alone.
 *
 * **Idempotent across replicas.** Every attempt is claimed by a unique key before the mail leaves;
 * a claim another sender holds is theirs to settle. A failed address is retried on later ticks for
 * the same slot, up to {@link MAX_ROUTE_ATTEMPTS}.
 */

import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { describeForLog } from "../errors/failure";
import { MAILER, type Mailer } from "../mail/mailer";
import type { MailingKind } from "./routes.catalog";
import { NotificationRoutesRepository, type MailingRouteRow } from "./routes.repository";
import { dueRouteSlot } from "./routes.schedule";

/** How many times one address is tried for one slot. */
export const MAX_ROUTE_ATTEMPTS = 3;

/** How long a claim may stay unsettled before it is failed and retried. */
export const ROUTE_CLAIM_LEASE_MS = 5 * 60 * 1000;

/** A route's mail, composed once for every address. */
export interface RouteMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Composes one mailing kind's content for a slot. */
export interface RouteComposer {
  /**
   * @param organizationId - The workspace.
   * @param workspaceName - Its name.
   * @param slot - The route's scheduled instant.
   * @returns The mail.
   */
  compose(organizationId: string, workspaceName: string, slot: Date): Promise<RouteMail>;
}

/** The composer per mailing kind — bound by the module to BN.3's and #440's composers. */
export const ROUTE_COMPOSERS = Symbol("ROUTE_COMPOSERS");

/** The composers the sender is given. */
export type RouteComposers = Readonly<Record<MailingKind, RouteComposer>>;

/** What one route's due slot did. */
export interface RouteSendOutcome {
  readonly organizationId: string;
  readonly kind: MailingKind;
  readonly slotAt: Date;
  readonly sent: number;
  readonly failed: number;
}

/** What one tick did. */
export interface RouteSendReport {
  readonly outcomes: RouteSendOutcome[];
  readonly errors: { organizationId: string; kind: MailingKind; error: string }[];
}

/**
 * The `Message-ID` every attempt at one route mail carries, so a receiver collapses a duplicate.
 *
 * @param route - The route.
 * @param slot - The slot.
 * @param recipient - The address.
 * @param mailFrom - The sending address, whose domain the id is under.
 * @returns The header value, angle brackets included.
 */
export function routeMessageId(
  route: Pick<MailingRouteRow, "organizationId" | "kind">,
  slot: Date,
  recipient: string,
  mailFrom: string,
): string {
  const digest = createHash("sha256")
    .update([route.kind, route.organizationId, slot.toISOString(), recipient].join("|"), "utf8")
    .digest("hex")
    .slice(0, 32);

  return `<route.${digest}@${mailFrom.slice(mailFrom.lastIndexOf("@") + 1) || "ouroboros"}>`;
}

@Injectable()
export class OrgRouteSender {
  /**
   * @param routes - The routes and their send log.
   * @param composers - The content per mailing kind.
   * @param mailer - This deployment's mailer.
   * @param config - The sending address.
   */
  constructor(
    private readonly routes: NotificationRoutesRepository,
    @Inject(ROUTE_COMPOSERS) private readonly composers: RouteComposers,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: AppConfigService,
  ) {}

  /**
   * One pass over every delivering mailing route.
   *
   * @param now - The current instant.
   * @returns What each due route did. Empty when this deployment sends no mail.
   */
  async tick(now: Date = new Date()): Promise<RouteSendReport> {
    const report: RouteSendReport = { outcomes: [], errors: [] };

    if (this.mailer.transport === "none") {
      return report;
    }

    await this.routes.expireClaims(ROUTE_CLAIM_LEASE_MS);

    for (const route of await this.routes.mailingRoutes()) {
      try {
        const outcome = await this.send(route, now);

        if (outcome !== undefined) {
          report.outcomes.push(outcome);
        }
      } catch (error) {
        // One route's failure — its content could not be read, say — costs that route a tick.
        report.errors.push({
          organizationId: route.organizationId,
          kind: route.kind,
          error: describeForLog(error),
        });
      }
    }

    return report;
  }

  /**
   * One route's due slot, if any: every address that still needs it.
   *
   * @param route - The route.
   * @param now - The current instant.
   * @returns What it did, or undefined when nothing was due or nobody was left to mail.
   */
  private async send(route: MailingRouteRow, now: Date): Promise<RouteSendOutcome | undefined> {
    const { organizationId, kind } = route;
    const lastSent = await this.routes.lastSentSlot(organizationId, kind);
    const slot = dueRouteSlot(kind, route.config, now, lastSent);

    if (slot === undefined) {
      return undefined;
    }

    const recipients =
      route.config.recipients ?? (await this.routes.administratorAddresses(organizationId));
    const attempts = await this.routes.attempts(organizationId, kind, slot);
    const pending = recipients
      .map((recipient) => ({
        recipient,
        tried: attempts.filter((attempt) => attempt.recipient === recipient),
      }))
      .filter(
        ({ tried }) =>
          tried.length < MAX_ROUTE_ATTEMPTS &&
          !tried.some((attempt) => attempt.status === "sent" || attempt.status === "claimed"),
      );

    if (pending.length === 0) {
      return undefined;
    }

    const mail = await this.composers[kind].compose(organizationId, route.workspaceName, slot);
    let sent = 0;
    let failed = 0;

    for (const { recipient, tried } of pending) {
      const messageId = routeMessageId(route, slot, recipient, this.config.mailFrom ?? "");
      const claimId = await this.routes.claim({
        organizationId,
        kind,
        slotAt: slot,
        recipient,
        attempt: tried.length + 1,
        messageId,
      });

      if (claimId === undefined) {
        // Another sender claimed this attempt first: theirs to settle.
        continue;
      }

      try {
        await this.mailer.send({ to: recipient, messageId, ...mail });
        await this.routes.settle(claimId);
        sent += 1;
      } catch (error) {
        await this.routes.settle(claimId, error instanceof Error ? error.message : String(error));
        failed += 1;
      }
    }

    return { organizationId, kind, slotAt: slot, sent, failed };
  }
}
