/**
 * What happens when Slack calls (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)) — the same for the three HTTPS
 * endpoints and for Socket Mode, which is why it knows nothing about either.
 *
 * ```
 * verified request ─▶ acknowledge now ─▶ work, detached ─▶ reply to its response_url
 * ```
 *
 * **Three seconds decides whether the product looks broken.** Slack fails a slash command or a
 * button press that is not acknowledged in time, so every method here answers at once and does
 * its work afterwards. The acknowledgement is honest: *working on it…*, never a result that has
 * not happened yet. The result arrives as a separate message.
 *
 * **Events arrive more than once.** Slack redelivers on any doubt; `event_id` is remembered
 * (`slack.dedupe.ts`) and a redelivery is acknowledged and dropped.
 *
 * **What is handled here, and what is not yet.**
 *
 * | Arrives | Handled |
 * |---|---|
 * | `url_verification` | the challenge is echoed |
 * | `app_uninstalled`, `tokens_revoked` (bot) | the connection is flipped to `revoked` |
 * | `/ouro link`, `/ouro unlink`, `/ouro help` | here |
 * | any other `/ouro …` | an honest *not available yet* — the registry is BZ.3's (#537) |
 * | a button press by somebody unlinked | read-only: a *link your account* prompt |
 * | a button press by somebody linked | an honest *not available yet* — BZ.4's (#538) |
 *
 * Detached work never rejects: every failure is logged and, where there is somebody to tell,
 * said in a reply.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import type { ChatConnectionPublic } from "../db/schema";
import { LINK_ACTION_PREFIX } from "./slack.blockkit";
import { SLACK_COMMAND } from "./slack.app";
import { SLACK_API, type SlackApi, type SlackReply } from "./slack.client";
import { SeenEvents } from "./slack.dedupe";
import { SlackInstallService } from "./slack.install.service";
import { SlackLinkService } from "./slack.link.service";
import { SlackRepository } from "./slack.repository";

/** What a slash command is acknowledged with — shown only to the person who typed it. */
export const COMMAND_ACK = { response_type: "ephemeral", text: "Working on it…" } as const;

/** The replies this module sends. Fixed sentences, so a test and a reader see the same words. */
export const REPLIES = {
  linkOffer:
    "Link your Slack identity to your Ouroboros account. The link works once, for fifteen minutes, and only for you.",
  linkButton: "Link your account",
  alreadyLinked: "Your Slack identity is already linked. Type `/ouro unlink` to undo it.",
  unlinked:
    "Your Slack identity is unlinked. What you did while it was linked stays in the audit log under your name.",
  notLinked: "Your Slack identity is not linked, so there is nothing to unlink.",
  needsLink:
    "You're not linked — buttons and commands here act with your Ouroboros permissions, so link your account first.",
  notConnected:
    "This Slack workspace is not connected to Ouroboros any more. An owner or admin can connect it again in Settings.",
  commandUnavailable: (command: string): string =>
    `\`${SLACK_COMMAND} ${command}\` is not available yet. Today \`${SLACK_COMMAND} link\`, \`${SLACK_COMMAND} unlink\` and \`${SLACK_COMMAND} help\` work.`,
  actionUnavailable:
    "Answering from Slack is not available yet. Open the item in Ouroboros to answer it.",
  help: `\`${SLACK_COMMAND} link\` links your Slack identity to your Ouroboros account. \`${SLACK_COMMAND} unlink\` undoes it. More commands are coming.`,
  failed: "Something went wrong and nothing was changed. Try again.",
} as const;

/**
 * Whether an interaction is nothing but presses of link buttons (#536).
 *
 * @param payload - The interaction payload.
 * @returns True when it carries actions and every one is a card's link button.
 */
export function opensOnlyLinks(payload: unknown): boolean {
  const actions = (payload as { actions?: unknown } | undefined)?.actions;

  return (
    Array.isArray(actions) &&
    actions.length > 0 &&
    actions.every(
      (action) =>
        typeof action === "object" &&
        action !== null &&
        typeof (action as { action_id?: unknown }).action_id === "string" &&
        (action as { action_id: string }).action_id.startsWith(LINK_ACTION_PREFIX),
    )
  );
}

/**
 * A string field of an untyped object.
 *
 * @param source - A parsed body.
 * @param key - The field.
 * @returns The string, or undefined.
 */
function field(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];

  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * An object field of an untyped object.
 *
 * @param source - A parsed body.
 * @param key - The field.
 * @returns The object, or undefined.
 */
function part(source: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];

  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The subcommand a slash command's text names.
 *
 * @param text - Everything typed after `/ouro`.
 * @returns The first word, lower-cased — `help` when nothing was typed.
 */
export function subcommandOf(text: string | undefined): string {
  const first = (text ?? "").trim().split(/\s+/)[0] ?? "";

  return first === "" ? "help" : first.toLowerCase();
}

/**
 * The payload an interactivity request carries.
 *
 * Slack posts it as a form with one field, `payload`, holding JSON; Socket Mode hands the object
 * over directly.
 *
 * @param body - The parsed form, or the object.
 * @returns The payload object, or undefined when there is none or it is not JSON.
 */
export function interactionPayload(body: unknown): Record<string, unknown> | undefined {
  const raw = field(body, "payload");

  if (raw === undefined) {
    return typeof body === "object" && body !== null && "type" in body ? body : undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class SlackInboundService {
  private readonly logger = new Logger(SlackInboundService.name);

  /** Event ids seen recently — the redelivery guard. */
  private readonly seen = new SeenEvents();

  /** Work started and not yet finished, so a test — and shutdown — can wait for it. */
  private readonly running = new Set<Promise<void>>();

  /**
   * @param slack - Replies to a `response_url`.
   * @param repository - Finds the connection a Slack workspace belongs to, and identity links.
   * @param installs - Flips a connection to revoked.
   * @param links - Issues and revokes identity links.
   */
  constructor(
    @Inject(SLACK_API) private readonly slack: SlackApi,
    private readonly repository: SlackRepository,
    private readonly installs: SlackInstallService,
    private readonly links: SlackLinkService,
  ) {}

  /**
   * An Events API delivery.
   *
   * @param body - The parsed JSON body.
   * @returns What to answer with at once: the challenge for the URL-verification handshake,
   *   otherwise an empty acknowledgement.
   */
  event(body: unknown): Record<string, unknown> {
    if (field(body, "type") === "url_verification") {
      return { challenge: field(body, "challenge") ?? "" };
    }

    const eventId = field(body, "event_id");
    const event = part(body, "event");
    const teamId = field(body, "team_id");

    // Acknowledged whether or not it is new: a redelivery must stop being redelivered.
    if (eventId !== undefined && event !== undefined && this.seen.first(eventId, new Date())) {
      this.detach(`event ${eventId}`, () => this.handleEvent(event, teamId));
    }

    return {};
  }

  /**
   * A slash command.
   *
   * @param body - The parsed form: `team_id`, `user_id`, `text`, `response_url`.
   * @returns {@link COMMAND_ACK} — the result follows as a separate message.
   */
  command(body: unknown): typeof COMMAND_ACK {
    const teamId = field(body, "team_id");
    const userId = field(body, "user_id");
    const responseUrl = field(body, "response_url");

    if (teamId !== undefined && userId !== undefined && responseUrl !== undefined) {
      const subcommand = subcommandOf(field(body, "text"));

      this.detach(`command ${subcommand}`, () =>
        this.answer(responseUrl, () => this.handleCommand(teamId, userId, subcommand)),
      );
    }

    return COMMAND_ACK;
  }

  /**
   * A button press, or any other interaction.
   *
   * @param body - The form carrying `payload`, or the payload itself.
   * @returns An empty acknowledgement — the result follows as a separate message.
   */
  interaction(body: unknown): Record<string, never> {
    const payload = interactionPayload(body);
    const teamId = field(part(payload, "team"), "id");
    const userId = field(part(payload, "user"), "id");
    const responseUrl = field(payload, "response_url");

    // A card's link button opens a page in the browser; Slack reports the press all the same.
    // There is nothing to answer, and answering would put a reply under every link followed.
    if (opensOnlyLinks(payload)) {
      return {};
    }

    if (teamId !== undefined && userId !== undefined && responseUrl !== undefined) {
      this.detach("interaction", () =>
        this.answer(responseUrl, () => this.handleInteraction(teamId, userId)),
      );
    }

    return {};
  }

  /**
   * Wait for every piece of detached work started so far.
   *
   * @returns When nothing is running.
   */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all(this.running);
    }
  }

  /**
   * What an event does.
   *
   * @param event - The inner event.
   * @param teamId - The Slack workspace it is about.
   */
  private async handleEvent(
    event: Record<string, unknown>,
    teamId: string | undefined,
  ): Promise<void> {
    const type = field(event, "type");

    // `tokens_revoked` also fires for user tokens, which this app never holds: only a revoked
    // bot token ends the install.
    const botRevoked =
      type === "tokens_revoked" &&
      Array.isArray(part(event, "tokens")?.bot) &&
      (part(event, "tokens")?.bot as unknown[]).length > 0;

    if ((type !== "app_uninstalled" && !botRevoked) || teamId === undefined) {
      return;
    }

    const connection = await this.repository.activeByWorkspace(teamId);

    if (connection !== undefined) {
      await this.installs.revoke(connection, type ?? "tokens_revoked", "event");
    }
  }

  /**
   * What a slash command does.
   *
   * @param teamId - The Slack workspace.
   * @param userId - Who typed it.
   * @param subcommand - The first word after `/ouro`.
   * @returns What to tell them.
   */
  private async handleCommand(
    teamId: string,
    userId: string,
    subcommand: string,
  ): Promise<SlackReply> {
    const connection = await this.repository.activeByWorkspace(teamId);

    if (connection === undefined) {
      return { ephemeral: true, text: REPLIES.notConnected };
    }

    switch (subcommand) {
      case "link":
        return this.offerLink(connection, userId, REPLIES.linkOffer);
      case "unlink":
        return {
          ephemeral: true,
          text: (await this.links.unlink(connection, userId))
            ? REPLIES.unlinked
            : REPLIES.notLinked,
        };
      case "help":
        return { ephemeral: true, text: REPLIES.help };
      default:
        // Only the first word is echoed, and only what matched a command's shape.
        return {
          ephemeral: true,
          text: REPLIES.commandUnavailable(
            /^[a-z][a-z0-9-]{0,31}$/.test(subcommand) ? subcommand : "…",
          ),
        };
    }
  }

  /**
   * What a button press does.
   *
   * @param teamId - The Slack workspace.
   * @param userId - Who pressed it.
   * @returns What to tell them: a link prompt for somebody unlinked, otherwise the honest state
   *   of things.
   */
  private async handleInteraction(teamId: string, userId: string): Promise<SlackReply> {
    const connection = await this.repository.activeByWorkspace(teamId);

    if (connection === undefined) {
      return { ephemeral: true, text: REPLIES.notConnected };
    }

    const link = await this.repository.liveLink(connection.id, userId);

    return link?.state === "linked"
      ? { ephemeral: true, text: REPLIES.actionUnavailable }
      : this.offerLink(connection, userId, REPLIES.needsLink);
  }

  /**
   * A reply offering a link — the one path both entry points share.
   *
   * @param connection - The connection.
   * @param userId - The Slack user.
   * @param text - What to say above the button.
   * @returns The reply, or *already linked*.
   */
  private async offerLink(
    connection: ChatConnectionPublic,
    userId: string,
    text: string,
  ): Promise<SlackReply> {
    const offer = await this.links.offer(connection, userId);

    return offer.kind === "already_linked"
      ? { ephemeral: true, text: REPLIES.alreadyLinked }
      : { ephemeral: true, text, link: { label: REPLIES.linkButton, url: offer.url } };
  }

  /**
   * Do some work and post what it produced to a `response_url`.
   *
   * @param responseUrl - Where the result goes.
   * @param work - The work.
   */
  private async answer(responseUrl: string, work: () => Promise<SlackReply>): Promise<void> {
    let reply: SlackReply;

    try {
      reply = await work();
    } catch (error) {
      this.logger.error(`A Slack request failed after its acknowledgement: ${String(error)}`);
      reply = { ephemeral: true, text: REPLIES.failed };
    }

    const sent = await this.slack.respond(responseUrl, reply);

    if (!sent.ok) {
      this.logger.warn(`A Slack reply was not delivered: ${sent.error}`);
    }
  }

  /**
   * Start work that outlives the acknowledgement. It never rejects.
   *
   * @param what - A short label for the log.
   * @param work - The work.
   */
  private detach(what: string, work: () => Promise<void>): void {
    const task = work()
      .catch((error: unknown) => {
        this.logger.error(`Detached Slack work (${what}) failed: ${String(error)}`);
      })
      .finally(() => {
        this.running.delete(task);
      });

    this.running.add(task);
  }
}
