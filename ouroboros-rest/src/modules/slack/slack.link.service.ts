/**
 * Linking a Slack identity to a member (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535), decision **C4**).
 *
 * ```
 * /ouro link, or any unlinked interaction
 *   ─▶ a token: 32 random bytes, stored only as its SHA-256, on a pending link, for 15 minutes
 *   ─▶ a deep link on the UI origin, shown to that Slack user alone
 *   ─▶ the app authenticates the session
 *   ─▶ the confirmation screen names the Slack identity and the account
 *   ─▶ the button ─▶ pending → linked (the token is spent) ─▶ audit chat.identity_linked
 * /ouro unlink ─▶ linked → revoked (the row is kept) ─▶ audit chat.identity_unlinked
 * ```
 *
 * **Identity is established deliberately.** The link proves somebody with access to that Slack
 * identity asked; the session proves who is at the browser; the button is the act of joining
 * the two. An email match between the Slack profile and the account is offered as a suggestion
 * on the screen and is recorded as how the link was verified — it cannot complete a link.
 *
 * **Single use is the database's.** Confirming is one conditional update (`pending`, this hash,
 * unexpired) that clears the hash: of two presses, one finds a row.
 */

import { createHash, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { CHAT_IDENTITY_LINKED_EVENT, CHAT_IDENTITY_UNLINKED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { AppConfigService } from "../config/config.service";
import { DatabaseService } from "../db/db.service";
import type { ChatConnectionPublic, ChatIdentityLink } from "../db/schema";
import { SLACK_PATH_PREFIX } from "./slack.app";
import { SLACK_API, type SlackApi } from "./slack.client";
import { SlackInstallService } from "./slack.install.service";
import {
  type SlackLinkPage,
  type SlackLinkSubject,
  linkConfirmPage,
  linkProblemPage,
  linkSignInPage,
  linkedPage,
} from "./slack.pages";
import { SlackRepository, violates } from "./slack.repository";

/** What a link token starts with — recognisable in a log, and never a credential by itself. */
export const LINK_TOKEN_PREFIX = "ouro_lnk_";

/** How long a link works. */
export const LINK_TTL_MS = 15 * 60 * 1000;

/** The shape of a token this service issued. Anything else is refused without a lookup. */
const LINK_TOKEN = /^ouro_lnk_[A-Za-z0-9_-]{43}$/;

/** The signed-in person a request carries. */
export interface LinkSession {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
}

/** What asking for a link produced. */
export type LinkOffer =
  { readonly kind: "link"; readonly url: string } | { readonly kind: "already_linked" };

/**
 * The hash a token is stored and looked up by.
 *
 * @param token - The token.
 * @returns SHA-256, lower-case hex — what V132's `link_token_hash` holds.
 */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The path a link opens, on the UI origin.
 *
 * @param token - The token.
 * @returns `/api/v1/slack/link/<token>`.
 */
export function linkPath(token: string): string {
  return `${SLACK_PATH_PREFIX}link/${token}`;
}

@Injectable()
export class SlackLinkService {
  /**
   * @param config - The UI origin the link is built on.
   * @param slack - Reads the Slack profile for the display name and the email assist.
   * @param repository - Identity links and membership.
   * @param installs - Unseals the bot token, and notes a revoked connection.
   * @param audit - The audit plane.
   * @param database - For the workspace's name on the confirmation screen.
   */
  constructor(
    private readonly config: AppConfigService,
    @Inject(SLACK_API) private readonly slack: SlackApi,
    private readonly repository: SlackRepository,
    private readonly installs: SlackInstallService,
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Issue a link for a Slack user — or say they are already linked.
   *
   * Asking again replaces the earlier link: only the newest one works.
   *
   * @param connection - The Slack connection the request came through.
   * @param platformUserId - The Slack user asking.
   * @returns The deep link, or `already_linked`.
   */
  async offer(connection: ChatConnectionPublic, platformUserId: string): Promise<LinkOffer> {
    const token = `${LINK_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const profile = await this.profile(connection, platformUserId);

    const opened = await this.repository.openHandshake({
      organizationId: connection.organization_id,
      connectionId: connection.id,
      platformUserId,
      displayName: profile?.displayName ?? null,
      tokenHash: hashLinkToken(token),
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    });

    return opened
      ? { kind: "link", url: `${this.uiUrl()}${linkPath(token)}` }
      : { kind: "already_linked" };
  }

  /**
   * The page a link opens. Nothing is linked by opening it.
   *
   * @param token - The token from the link.
   * @param session - The signed-in person, if any.
   * @returns The confirmation screen, a sign-in, or a designed refusal.
   */
  async page(token: string, session: LinkSession | undefined): Promise<SlackLinkPage> {
    const found = await this.resolve(token, session, false);

    return found.kind === "page" ? found.page : linkConfirmPage(found.subject);
  }

  /**
   * Confirm a link: bind the Slack identity to the signed-in member, once.
   *
   * @param token - The token from the link.
   * @param session - The signed-in person, if any.
   * @returns The receipt, or why nothing was linked.
   */
  async confirm(token: string, session: LinkSession | undefined): Promise<SlackLinkPage> {
    const found = await this.resolve(token, session, true);

    if (found.kind === "page") {
      return found.page;
    }

    const at = new Date();
    const verifiedVia = found.subject.emailMatches ? "email_match_confirmed" : "oauth_session";
    let linked: ChatIdentityLink | undefined;

    try {
      linked = await this.repository.completeHandshake(
        hashLinkToken(token),
        found.memberId,
        verifiedVia,
        at,
      );
    } catch (error) {
      if (violates(error, "chat_identity_links_member_key")) {
        return linkProblemPage("member_already_linked");
      }
      throw error;
    }

    // Spent or expired between the page and the press: the other press, or the clock, won.
    if (linked === undefined) {
      return linkProblemPage("unknown");
    }

    await this.audit.record({
      organizationId: linked.organization_id,
      actorId: found.userId,
      action: CHAT_IDENTITY_LINKED_EVENT,
      subjectType: "chat_identity_link",
      subjectId: linked.id,
      at,
      detail: {
        connectionId: linked.connection_id,
        platformUserId: linked.platform_user_id,
        verifiedVia,
      },
    });

    return linkedPage(found.subject);
  }

  /**
   * Unlink a Slack user. Their link is revoked and kept.
   *
   * @param connection - The Slack connection the request came through.
   * @param platformUserId - The Slack user asking.
   * @returns `true` when a linked identity was revoked; `false` when they had none.
   */
  async unlink(connection: ChatConnectionPublic, platformUserId: string): Promise<boolean> {
    const current = await this.repository.liveLink(connection.id, platformUserId);

    if (current?.state !== "linked") {
      return false;
    }

    const at = new Date();
    const revoked = await this.repository.revokeLink(
      connection.id,
      platformUserId,
      current.user_id,
      at,
    );

    if (revoked === undefined) {
      return false;
    }

    await this.audit.record({
      organizationId: revoked.organization_id,
      actorId: current.user_id,
      action: CHAT_IDENTITY_UNLINKED_EVENT,
      subjectType: "chat_identity_link",
      subjectId: revoked.id,
      at,
      detail: { connectionId: revoked.connection_id, platformUserId: revoked.platform_user_id },
    });

    return true;
  }

  /**
   * Work out what a token and a session add up to.
   *
   * @param token - The token from the link.
   * @param session - The signed-in person, if any.
   * @param posting - Whether this is the confirming POST — an anonymous one is refused `401`.
   * @returns The subject to confirm, with the member it would bind, or the page to show instead.
   */
  private async resolve(
    token: string,
    session: LinkSession | undefined,
    posting: boolean,
  ): Promise<
    | { kind: "page"; page: SlackLinkPage }
    | { kind: "subject"; subject: SlackLinkSubject; memberId: string; userId: string }
  > {
    // A malformed token is not looked up: it cannot name a handshake.
    const handshake = LINK_TOKEN.test(token)
      ? await this.repository.handshake(hashLinkToken(token))
      : undefined;

    if (handshake === undefined) {
      return { kind: "page", page: linkProblemPage("unknown") };
    }
    if (handshake.expires_at === null || handshake.expires_at.getTime() <= Date.now()) {
      return { kind: "page", page: linkProblemPage("expired") };
    }

    const connection = await this.repository.connection(handshake.connection_id);

    if (connection === undefined || connection.status !== "active") {
      return { kind: "page", page: linkProblemPage("not_connected") };
    }

    const identity = {
      slackWorkspace: connection.workspace_name,
      slackName: handshake.display_name_cache,
      slackUserId: handshake.platform_user_id,
    };

    if (session === undefined) {
      return {
        kind: "page",
        page: linkSignInPage({
          subject: identity,
          signInUrl: `${this.uiUrl()}/login?next=${encodeURIComponent(linkPath(token))}`,
          refused: posting,
        }),
      };
    }

    const member = await this.repository.member(connection.organization_id, session.userId);

    if (member === undefined) {
      return { kind: "page", page: linkProblemPage("not_member") };
    }

    const workspace = await this.database.db
      .selectFrom("organization")
      .select("name")
      .where("id", "=", connection.organization_id)
      .executeTakeFirst();
    const profile = await this.profile(connection, handshake.platform_user_id);

    return {
      kind: "subject",
      memberId: member.id,
      userId: session.userId,
      subject: {
        ...identity,
        workspace: workspace?.name ?? connection.workspace_name,
        accountName: session.name,
        accountEmail: session.email,
        emailMatches:
          profile?.email != null &&
          profile.email.trim().toLowerCase() === session.email.trim().toLowerCase(),
      },
    };
  }

  /**
   * A Slack user's profile, best effort.
   *
   * @param connection - The connection to ask through.
   * @param platformUserId - The Slack user.
   * @returns Their display name and email, or `undefined` when Slack could not be asked — the
   *   flow then shows the user id alone and offers no email suggestion.
   */
  private async profile(
    connection: ChatConnectionPublic,
    platformUserId: string,
  ): Promise<{ displayName: string; email: string | null } | undefined> {
    const botToken = await this.installs.botToken(connection.id);

    if (botToken === undefined) {
      return undefined;
    }

    const answer = await this.slack.userProfile(botToken, platformUserId);

    if (!answer.ok) {
      await this.installs.noteFailure(connection, answer.error, "users.info");

      return undefined;
    }

    return answer.user;
  }

  /** @returns The UI origin, with no trailing slash. */
  private uiUrl(): string {
    return this.config.uiUrl.replace(/\/+$/, "");
  }
}
