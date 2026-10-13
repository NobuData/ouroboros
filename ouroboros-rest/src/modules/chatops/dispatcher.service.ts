/**
 * The `/ouro` dispatcher (BZ.3, [#537](https://github.com/NobuData/ouroboros/issues/537)) — the
 * one path every surface's commands take.
 *
 * ```
 * text ─▶ where from ─▶ help? ─▶ who typed it ─▶ which command ─▶ arguments ─▶ v2?
 *      ─▶ may they? ─▶ confirmed? ─▶ binding.run ─▶ reply ─▶ chat_commands row ─▶ audit event
 * ```
 *
 * **Two surfaces, one path** (BZ.5, [#539](https://github.com/NobuData/ouroboros/issues/539)).
 * Slack and the app's console differ in exactly one step — *who typed it* — and nowhere after:
 *
 * ```
 * slack    team ─▶ active connection ─▶ identity link ─▶ person ─▶ member
 * console  session (workspace, person) ───────────────────────────▶ member
 * ```
 *
 * The console has no connection to find and no link to follow, so it has no `notConnected` and
 * no `unlinked`; from the member onwards the same code runs, and `parity.spec.ts` holds the two
 * to the same outcome, words, row and audit event for the same text.
 *
 * **A command is not a new control path.** The dispatcher never touches a plane: it finds the
 * command's {@link CommandBinding} and calls it, and the binding makes the one call the UI's own
 * route makes. This file imports ports and repositories only — no plane service, and not the
 * Slack adapter that calls it.
 *
 * **Permissions are the person's, never the app's.** The Slack user is resolved to their identity
 * link (#533) and through it to a member; the command's `requires` is checked against that
 * member's roles and capability (#485). Somebody unlinked gets `unlinked` and the link prompt —
 * recorded, with the platform's user id, so the attempt is investigable.
 *
 * **Destructive commands describe first.** Without its `confirm` word a destructive command's
 * binding is not called; the reply is the command's `confirmPrompt`, filled with what was
 * actually named.
 *
 * **A slow command does not lie.** A binding that answers `started` is acknowledged with its own
 * honest sentence and recorded `async_pending`; when its result settles the row becomes `ok` or
 * `error`, what it said is kept on the row (`settled_reply`), and the result goes out through the
 * surface's `followUp` when it has one — the console has none and reads the row instead. That
 * work outlives the call, so it is tracked ({@link ChatDispatcher.idle}) and awaited at shutdown.
 *
 * **Outcomes** — `chat_commands.outcome` with `error_detail`:
 *
 * | What happened | outcome | error_detail |
 * |---|---|---|
 * | ran, or a `v2` command answered honestly | `ok` | — |
 * | acknowledged, result to follow | `async_pending` → `ok` / `error` | — / the failure's code |
 * | not linked (Slack only) | `unlinked` | — |
 * | the member may not, or is no longer a member | `denied` | — |
 * | no such command | `error` | `unknown_command` |
 * | arguments missing, extra or naming nothing | `error` | `bad_arguments` |
 * | destructive, typed without `confirm` | `error` | `confirmation_required` |
 * | the plane refused | `error` | the plane's error code |
 * | anything else failed | `error` | `internal_error` |
 *
 * **Every invocation that has a workspace is one row and one audit event** — except `help`,
 * which is not a command of the grammar, runs nothing and is answered for anybody. A Slack
 * workspace with no active connection has no organisation to record under: it is told so, and
 * nothing is written. A reply is a `chat_messages` row only where there is a channel for it to
 * be a message of — never in the console.
 *
 * **Recording never changes what is said.** By the time the row is written the command has run;
 * a failure to record it is logged loudly and the truthful reply still goes out, because
 * *"nothing was changed"* would be a lie.
 */

import { randomUUID } from "node:crypto";

import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";

import { CHAT_COMMAND_INVOKED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { AppConfigService } from "../config/config.service";
import { DomainError, SERVER_ERROR_FLOOR } from "../errors/error.envelope";
import { SlackRepository } from "../slack/slack.repository";
import { effectiveCanApproveLoops } from "../tenancy/capabilities";
import { CapabilityRepository } from "../tenancy/capability.repository";
import { OrganizationRepository } from "../tenancy/organization.repository";
import { CHAT_REPLIES, deniedText, fill } from "./chatops.replies";
import {
  ChatopsRepository,
  type ConsoleCommandOrigin,
  type RecordedOutcome,
  type SlackCommandOrigin,
} from "./chatops.repository";
import { help, helpTopic } from "./grammar.help";
import {
  CONFIRM_WORD,
  argumentErrorText,
  failureText,
  matchCommand,
  parseArguments,
  tokenize,
  unknownCommand,
} from "./grammar.parser";
import {
  ARGUMENT_RESOLVERS,
  COMMAND_BINDINGS,
  ChatArgumentError,
  type ArgumentResolvers,
  type CommandBindings,
} from "./grammar.ports";
import {
  CHAT_GRAMMAR,
  COMMAND_ID_MAX_LENGTH,
  COMMAND_PREFIX,
  bindingProblems,
  grammarProblems,
} from "./grammar.registry";
import type {
  CommandBinding,
  CommandDefinition,
  CommandReply,
  DispatchInput,
  DispatchResult,
  Grammar,
  Invoker,
  ResolvedArgument,
} from "./grammar.types";

/** The reasons the dispatcher itself records in `chat_commands.error_detail`. */
export const DISPATCH_ERRORS = {
  unknownCommand: "unknown_command",
  badArguments: "bad_arguments",
  confirmationRequired: "confirmation_required",
  internal: "internal_error",
} as const;

/** What `chat_commands.command` holds for text that names no command and is not a word. */
const UNNAMED_COMMAND = "unknown";

/** A single lower-case word `chat_commands.command` accepts. */
const COMMAND_WORD = /^[a-z][a-z0-9-]*$/;

/**
 * Where an invocation came from — the only part of it that depends on the surface. A Slack
 * command has what its row records plus the platform's own channel id, which only the audit
 * event keeps; a console command has nothing but its surface.
 */
type Origin =
  (SlackCommandOrigin & { readonly platformChannelId: string | null }) | ConsoleCommandOrigin;

/** The console's origin: the same for every command typed there. */
const CONSOLE_ORIGIN: ConsoleCommandOrigin = {
  surface: "console",
  connectionId: null,
  channelId: null,
  invokerLinkId: null,
  platformUserId: null,
};

/** Where a command came from, and the person it acts as — nobody, for an unlinked Slack user. */
interface Identity {
  readonly origin: Origin;
  readonly userId: string | null;
}

/** A surface's answer to *which workspace* — known at once — and *who*, asked only for a command. */
interface Source {
  readonly organizationId: string;
  /** Not called for `help`, which is answered for anybody. */
  identify(): Promise<Identity>;
}

/** What is known about an invocation by the time it is recorded. */
interface Invocation {
  readonly id: string;
  readonly organizationId: string;
  readonly origin: Origin;
  /** The person it acts as; null only for an unlinked Slack attempt. */
  readonly userId: string | null;
  /** What `chat_commands.command` records. */
  readonly command: string;
  /** The grammar command the text named, if it named one. */
  readonly matched: string | null;
  readonly rawText: string;
  readonly invokedAt: Date;
}

/** How an invocation ended, with what it is answered and recorded with. */
interface Ending {
  readonly ended: RecordedOutcome;
  readonly reply: CommandReply;
  readonly args?: Readonly<Record<string, ResolvedArgument>>;
  readonly ref?: Readonly<Record<string, string | number>>;
  /** An async command's result, still to come. */
  readonly pending?: Promise<CommandReply>;
  /** For a describe-first refusal: the text that really does it. */
  readonly confirmWith?: string;
}

/**
 * Whether a member may run a command — the one rule, for the dispatcher that enforces it and
 * for the grammar route that says in advance what it would decide (#539).
 *
 * @param definition - The command.
 * @param invoker - The member: their roles and explicit capability.
 * @returns True when they hold one of its roles (or it asks for none) and its capability.
 */
export function permitted(
  definition: Pick<CommandDefinition, "requires">,
  invoker: Pick<Invoker, "roles" | "canApproveLoops">,
): boolean {
  const { roles, capability } = definition.requires;
  const role = roles.length === 0 || roles.some((wanted) => invoker.roles.includes(wanted));

  return (
    role &&
    (capability === undefined || effectiveCanApproveLoops(invoker.roles, invoker.canApproveLoops))
  );
}

/**
 * An argument as `chat_commands.args` records it — the thing it named, in the shortest form
 * that still names it.
 *
 * @param argument - The resolved argument.
 * @returns A scalar.
 */
export function recordedArgument(argument: ResolvedArgument): string | number | boolean {
  switch (argument.type) {
    case "ticket":
      return `${argument.repository}#${String(argument.number)}`;
    case "loop":
      return argument.loopSeq;
    case "workflow":
      return argument.slug;
    case "alias":
      return argument.alias;
    case "task_kind":
      return argument.name;
    case "question":
      return argument.shortId;
    case "action":
      return argument.actionId;
    case "pr":
      return argument.number;
    case "keyword":
      return argument.word;
    case "confirm":
      return true;
  }
}

/**
 * A failure as a reply and a recorded reason.
 *
 * A {@link DomainError} is a plane speaking: its message is written for a person and its code is
 * stable, so both are relayed — unless it is a `5xx`, whose message is about the service. Anything
 * else is unknown: its text is never shown.
 *
 * @param error - What was thrown.
 * @param fallback - What to say when the details cannot be.
 * @returns The reply, the `error_detail`, and whether it needs logging as a fault.
 */
export function failureOf(
  error: unknown,
  fallback: string,
): { reply: CommandReply; detail: string; fault: boolean } {
  if (error instanceof ChatArgumentError) {
    return {
      reply: { text: argumentErrorText(error.argument, error.message, error.suggestions) },
      detail: DISPATCH_ERRORS.badArguments,
      fault: false,
    };
  }

  if (error instanceof DomainError) {
    const fault = error.getStatus() >= SERVER_ERROR_FLOOR;

    return {
      reply: { text: fault ? fallback : error.message },
      detail: error.code,
      fault,
    };
  }

  return { reply: { text: fallback }, detail: DISPATCH_ERRORS.internal, fault: true };
}

@Injectable()
export class ChatDispatcher implements OnApplicationShutdown {
  private readonly logger = new Logger(ChatDispatcher.name);

  /** The bindings by command id. */
  private readonly bindings: ReadonlyMap<string, CommandBinding>;

  /** Async results not yet settled, so a test — and shutdown — can wait for them. */
  private readonly running = new Set<Promise<void>>();

  /**
   * @param grammar - The grammar to run.
   * @param bindings - One binding per available command.
   * @param resolvers - Turns typed arguments into what they name.
   * @param slack - Finds the connection a Slack workspace belongs to, and identity links. Never
   *   asked anything for a console command.
   * @param commands - The command trail.
   * @param organizations - A member's roles.
   * @param capabilities - A member's explicit capability.
   * @param audit - The audit plane.
   * @param config - The public origin links are built on.
   * @throws {Error} When the grammar breaks its own rules, a binding serves a command the
   *   grammar does not define, or an available command has no binding — at start, not at the
   *   first person who types it.
   */
  constructor(
    @Inject(CHAT_GRAMMAR) private readonly grammar: Grammar,
    @Inject(COMMAND_BINDINGS) bindings: CommandBindings,
    @Inject(ARGUMENT_RESOLVERS) private readonly resolvers: ArgumentResolvers,
    private readonly slack: SlackRepository,
    private readonly commands: ChatopsRepository,
    private readonly organizations: OrganizationRepository,
    private readonly capabilities: CapabilityRepository,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {
    const problems = [...grammarProblems(grammar), ...bindingProblems(grammar, bindings)];

    if (problems.length > 0) {
      throw new Error(`The /ouro grammar cannot be dispatched: ${problems.join("; ")}.`);
    }

    this.bindings = new Map(bindings.map((binding) => [binding.command, binding]));
  }

  /**
   * Run what was typed.
   *
   * @param input - The surface, the text after `/ouro`, and who typed it where: Slack's team,
   *   user and channel, or the console's session.
   * @returns The outcome, what to say back at once, and the command row's id when one was
   *   written. It does not reject for anything a person typed or a plane refused; it rejects
   *   only when the workspace or the invoker could not be read at all — before anything ran.
   */
  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const invokedAt = new Date();
    let source: Source;

    if (input.surface === "slack") {
      // Slack's workspace is found before anything is answered — help included — because a
      // workspace nobody has connected is told so whatever was typed.
      const connection = await this.slack.activeByWorkspace(input.slack.teamId);

      if (connection === undefined) {
        return {
          outcome: "error",
          reply: { text: CHAT_REPLIES.notConnected },
          commandId: null,
          command: null,
        };
      }

      source = {
        organizationId: connection.organization_id,
        identify: () => this.slackIdentity(connection.id, input.slack),
      };
    } else {
      // The session is the identity: no connection to find, no link to follow.
      const { organizationId, userId } = input.console;

      source = {
        organizationId,
        identify: () => Promise.resolve({ origin: CONSOLE_ORIGIN, userId }),
      };
    }

    const topic = helpTopic(input.text);

    if (topic !== undefined) {
      return {
        outcome: "ok",
        reply: { text: help(this.grammar, input.surface, topic) },
        commandId: null,
        command: null,
      };
    }

    const tokens = tokenize(input.text);
    const match = matchCommand(this.grammar, tokens);
    const who = await source.identify();
    const invocation: Invocation = {
      id: randomUUID(),
      organizationId: source.organizationId,
      origin: who.origin,
      userId: who.userId,
      command: match?.definition.id ?? commandWord(tokens),
      matched: match?.definition.id ?? null,
      rawText: `${COMMAND_PREFIX} ${input.text.trim()}`,
      invokedAt,
    };

    if (who.userId === null) {
      return this.finish(invocation, {
        ended: { outcome: "unlinked" },
        reply: { text: CHAT_REPLIES.unlinked },
      });
    }

    const invoker = await this.invoker(source.organizationId, who.userId);

    if (invoker === undefined) {
      return this.finish(invocation, {
        ended: { outcome: "denied" },
        reply: { text: CHAT_REPLIES.notAMember },
      });
    }

    if (match === undefined) {
      return this.finish(invocation, {
        ended: { outcome: "error", detail: DISPATCH_ERRORS.unknownCommand },
        reply: { text: failureText(unknownCommand(this.grammar, tokens)) },
      });
    }

    const ending = await this.run(invocation, invoker, match.definition, match.rest, input);
    const result = await this.finish(invocation, ending);

    if (ending.pending !== undefined) {
      // After the row exists: settling moves it out of `async_pending`.
      this.track(invocation, match.definition, ending.pending, input.followUp);
    }

    return result;
  }

  /**
   * Wait for every async result started so far to settle and be recorded.
   *
   * @returns When nothing is running.
   */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all(this.running);
    }
  }

  /**
   * Let pending results record themselves before the process goes.
   *
   * @returns When nothing is running.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.idle();
  }

  /**
   * Arguments, stage, permission, confirmation, binding — everything after *who* and *which*.
   *
   * @param invocation - The invocation so far.
   * @param invoker - The member it acts as.
   * @param definition - The command.
   * @param rest - Its argument tokens.
   * @param input - What the surface handed over.
   * @returns How it ended. Never rejects: a failure is an ending.
   */
  private async run(
    invocation: Invocation,
    invoker: Invoker,
    definition: CommandDefinition,
    rest: readonly string[],
    input: DispatchInput,
  ): Promise<Ending> {
    const { organizationId } = invocation;

    try {
      const parsed = await parseArguments(definition, rest, (spec, raw, previous) =>
        this.resolvers.resolve(organizationId, spec, raw, previous),
      );

      if (!parsed.ok) {
        return {
          ended: { outcome: "error", detail: DISPATCH_ERRORS.badArguments },
          reply: { text: failureText(parsed.failure) },
        };
      }

      const { args } = parsed;

      if (definition.stage === "v2") {
        return {
          ended: { outcome: "ok" },
          reply: { text: definition.unavailableReply ?? "" },
          args,
        };
      }

      if (!permitted(definition, invoker)) {
        return { ended: { outcome: "denied" }, reply: { text: deniedText(definition) }, args };
      }

      if (definition.destructive && !parsed.confirmed) {
        return {
          ended: { outcome: "error", detail: DISPATCH_ERRORS.confirmationRequired },
          reply: { text: await this.confirmPrompt(definition, args, organizationId) },
          args,
          // `confirm` is always the last argument, so what was typed plus the word is the command.
          confirmWith: [definition.id, ...rest, CONFIRM_WORD].join(" "),
        };
      }

      const binding = this.bindings.get(definition.id);

      if (binding === undefined) {
        // Unreachable past the constructor's check; said rather than assumed.
        throw new Error(`No binding serves "${definition.id}".`);
      }

      const result = await binding.run({
        organizationId,
        invoker,
        surface: input.surface,
        args,
        appUrl: this.config.uiUrl.replace(/\/+$/, ""),
      });

      if (result.kind === "started") {
        // Watched from now, so a result that fails before the row is written is not an
        // unhandled rejection; `track` reads the same promise afterwards.
        result.result.catch(() => undefined);

        return {
          ended: { outcome: "async_pending" },
          reply: result.reply,
          args,
          ref: result.ref,
          pending: result.result,
        };
      }

      return { ended: { outcome: "ok" }, reply: result.reply, args, ref: result.ref };
    } catch (error) {
      const failure = failureOf(error, CHAT_REPLIES.failed);

      if (failure.fault) {
        this.logger.error(
          `/ouro ${definition.id} failed (${invocation.id}): ${String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }

      return { ended: { outcome: "error", detail: failure.detail }, reply: failure.reply };
    }
  }

  /**
   * Record an invocation, audit it, and hand back what to say.
   *
   * @param invocation - The invocation.
   * @param ending - How it ended.
   * @returns The dispatch result. `commandId` is null when the row could not be written.
   */
  private async finish(invocation: Invocation, ending: Ending): Promise<DispatchResult> {
    const { organizationId, origin } = invocation;
    const outcome = ending.ended.outcome;
    const at = new Date();
    let commandId: string | null = invocation.id;

    try {
      await this.commands.record({
        ...(origin.surface === "slack"
          ? {
              surface: origin.surface,
              connectionId: origin.connectionId,
              channelId: origin.channelId,
              invokerLinkId: origin.invokerLinkId,
              platformUserId: origin.platformUserId,
            }
          : origin),
        id: invocation.id,
        organizationId,
        invokerUserId: invocation.userId,
        command: invocation.command,
        args: Object.fromEntries(
          Object.entries(ending.args ?? {}).map(([name, argument]) => [
            name,
            recordedArgument(argument),
          ]),
        ),
        rawText: invocation.rawText,
        ended: ending.ended,
        ref: ending.ref,
        invokedAt: invocation.invokedAt,
        completedAt: at,
        // A reply is a message of the channel only when the command was answered: a refusal
        // produced nothing (`result_ref` stays null). The console has no channel for a reply
        // to be a message of, so it never writes one.
        withReplyMessage:
          origin.surface === "slack" && (outcome === "ok" || outcome === "async_pending"),
      });

      const auditEventId = await this.audit.record({
        organizationId,
        actorId: invocation.userId,
        action: CHAT_COMMAND_INVOKED_EVENT,
        subjectType: "chat_command",
        subjectId: invocation.id,
        at,
        detail: {
          surface: origin.surface,
          command: invocation.command,
          outcome,
          // Chat provenance is Slack's alone: the console's is the actor and nothing else.
          ...(origin.surface === "slack"
            ? {
                connectionId: origin.connectionId,
                channelId: origin.channelId,
                platformChannelId: origin.platformChannelId,
                platformUserId: origin.platformUserId,
              }
            : {}),
          grammarVersion: this.grammar.version,
        },
      });

      await this.commands.attachAudit(invocation.id, auditEventId);
    } catch (error) {
      // The command has already run (or been refused); what is said about it stays true.
      commandId = null;
      this.logger.error(
        `/ouro ${invocation.command} (${invocation.id}, ${outcome}) was not fully recorded: ${String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return {
      outcome,
      reply: ending.reply,
      commandId,
      command: invocation.matched,
      ...(ending.confirmWith === undefined ? {} : { confirmWith: ending.confirmWith }),
    };
  }

  /**
   * Follow an async command to its end: settle the row — with what it said — then post the
   * result where the surface has somewhere to post it.
   *
   * The row is settled **before** the surface is asked to post, and a failure to post is only
   * logged — an undelivered message must not cost the recorded outcome. What it said is kept on
   * the row whatever the surface, so both record the same thing and the console can read it.
   *
   * @param invocation - The invocation.
   * @param definition - The command.
   * @param result - The binding's promise of a result.
   * @param followUp - The surface's way of posting a later message.
   */
  private track(
    invocation: Invocation,
    definition: CommandDefinition,
    result: Promise<CommandReply>,
    followUp: DispatchInput["followUp"],
  ): void {
    const settle = async (): Promise<void> => {
      let reply: CommandReply;
      let ended: Extract<RecordedOutcome, { outcome: "ok" | "error" }>;

      try {
        reply = await result;
        ended = { outcome: "ok" };
      } catch (error) {
        const failure = failureOf(error, CHAT_REPLIES.asyncFailed(definition.id));

        if (failure.fault) {
          this.logger.error(
            `/ouro ${definition.id} failed after its acknowledgement (${invocation.id}): ${String(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
        }

        reply = failure.reply;
        ended = { outcome: "error", detail: failure.detail };
      }

      try {
        await this.commands.settle(
          invocation.id,
          ended,
          new Date(),
          // `settled_reply` refuses empty text; a reply with nothing to say keeps nothing.
          reply.text === "" ? null : reply,
        );
      } catch (error) {
        this.logger.error(
          `/ouro ${definition.id} (${invocation.id}) ended ${ended.outcome} and could not be settled: ${String(error)}`,
        );
      }

      if (followUp !== undefined) {
        try {
          await followUp(reply);
        } catch (error) {
          this.logger.warn(
            `/ouro ${definition.id} (${invocation.id}): its result was not delivered: ${String(error)}`,
          );
        }
      }
    };

    const task = settle()
      .catch((error: unknown) => {
        this.logger.error(`/ouro ${definition.id} (${invocation.id}): ${String(error)}`);
      })
      .finally(() => {
        this.running.delete(task);
      });

    this.running.add(task);
  }

  /**
   * The member a person is in a workspace.
   *
   * @param organizationId - The workspace.
   * @param userId - The person their link names, or the session's.
   * @returns The invoker, or `undefined` when they are no longer a member.
   */
  private async invoker(organizationId: string, userId: string): Promise<Invoker | undefined> {
    const roles = await this.organizations.rolesFor(organizationId, userId);

    if (roles === undefined) {
      return undefined;
    }

    const [name, canApproveLoops] = await Promise.all([
      this.commands.userName(userId),
      this.capabilities.explicitFor(organizationId, userId),
    ]);

    return name === undefined ? undefined : { userId, name, roles, canApproveLoops };
  }

  /**
   * Who a Slack user is here: their channel, their identity link, and through it a person.
   *
   * @param connectionId - The workspace's active connection.
   * @param slack - The platform's ids for where and who.
   * @returns Where the command came from and who it acts as — nobody, when they are not linked.
   */
  private async slackIdentity(
    connectionId: string,
    slack: { readonly userId: string; readonly channelId: string | null },
  ): Promise<Identity> {
    const link = await this.slack.liveLink(connectionId, slack.userId);
    const linked = link?.state === "linked" && link.user_id !== null ? link : undefined;

    return {
      origin: {
        surface: "slack",
        connectionId,
        channelId:
          slack.channelId === null
            ? null
            : ((await this.commands.joinedChannel(connectionId, slack.channelId)) ?? null),
        invokerLinkId: linked?.id ?? null,
        platformUserId: slack.userId,
        platformChannelId: slack.channelId,
      },
      userId: linked?.user_id ?? null,
    };
  }

  /**
   * A destructive command's first reply, about what was actually named.
   *
   * @param definition - The command.
   * @param args - Its resolved arguments.
   * @param organizationId - The workspace, for `{workspace}`.
   * @returns The sentence.
   */
  private async confirmPrompt(
    definition: CommandDefinition,
    args: Readonly<Record<string, ResolvedArgument>>,
    organizationId: string,
  ): Promise<string> {
    const template = definition.confirmPrompt ?? "";
    const values: Record<string, string> = Object.fromEntries(
      Object.entries(args).map(([name, argument]) => [name, String(recordedArgument(argument))]),
    );

    if (template.includes("{workspace}")) {
      values.workspace = (await this.commands.workspaceName(organizationId)) ?? "this workspace";
    }

    return fill(template, values);
  }
}

/**
 * What `chat_commands.command` records for text that matched no command: its first word when
 * that is a word the column accepts, otherwise a fixed stand-in. The text as typed is in
 * `raw_text` either way.
 *
 * @param tokens - The tokens typed.
 * @returns A value `chat_commands_command_present` accepts.
 */
function commandWord(tokens: readonly string[]): string {
  const first = (tokens[0] ?? "").toLowerCase();

  return COMMAND_WORD.test(first) && first.length <= COMMAND_ID_MAX_LENGTH
    ? first
    : UNNAMED_COMMAND;
}
