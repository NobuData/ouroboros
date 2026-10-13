/**
 * The shapes the `/ouro` grammar is written in (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * Mockup 19's caption — *"Identical in Slack, Teams, and the in-app console"* — is a promise about
 * architecture: three surfaces run the same commands only if a command is defined in exactly one
 * place. These types are that place's vocabulary. A command is a {@link CommandDefinition} in the
 * registry (`grammar.registry.ts`); what it does is a {@link CommandBinding} that calls an
 * **existing** plane service — the same method the UI's route calls — and nothing else; a surface
 * is an adapter that turns its own payload into a {@link DispatchInput} and a {@link CommandReply}
 * back into its own message. Parsing, identity, the role check, confirmation, recording and
 * auditing belong to the dispatcher and are never repeated by a surface or a binding.
 */

import type { OrganizationRole } from "../db/schema";

/** Where a command was typed. `chat_commands.surface` (V131). */
export type ChatSurface = "slack" | "console";

/** Whether a command runs today (`available`) or is listed and answers honestly that it does not (`v2`). */
export type CommandStage = "available" | "v2";

/**
 * What completes an argument — the plane that owns the vocabulary.
 *
 * `tickets` open issues by number · `loops` live loop numbers · `workflows` offered workflow slugs ·
 * `aliases` model aliases · `questions` open decision items by short id · `actions` the answers the
 * named question takes · `task_kinds` routable task kinds.
 */
export type CompletionSource =
  "tickets" | "loops" | "workflows" | "aliases" | "questions" | "actions" | "task_kinds";

/** How an argument's text is read. */
export type ArgumentType =
  /** `#485`, `485`, `owner/repo#485` or an issue URL — all the same issue. */
  | "ticket"
  /** `1847` or `#1847` — a loop number (`runs.loop_seq`). */
  | "loop"
  /** A workflow slug. */
  | "workflow"
  /** A model alias. */
  | "alias"
  /** A task kind — what mockup 19 calls a stage in `route implement …`. */
  | "task_kind"
  /** `q-231` — a decision item's short id. */
  | "question"
  /** An answer id of the question named before it — `allow_once`. */
  | "action"
  /** A pull request number. */
  | "pr"
  /** A fixed word that must be typed as written — `loop`, `all`, `pr`. */
  | "keyword"
  /** The literal `confirm`. Present only on destructive commands. */
  | "confirm";

/** One argument of a command, in the order it is typed. */
export interface ArgumentSpec {
  /** The name it is recorded under in `chat_commands.args` and shown as in help — `ticket`. */
  readonly name: string;
  readonly type: ArgumentType;
  /** Whether the command may be typed without it. Optional arguments come last. */
  readonly optional: boolean;
  /** For `keyword`: the word itself. */
  readonly word?: string;
  /** Where its completions come from; absent for an argument with no vocabulary to offer. */
  readonly completion?: CompletionSource;
  /** One line for `/ouro help <command>`. */
  readonly description: string;
}

/** Who may run a command — the roles the UI's own route asks for. Empty means every member. */
export interface CommandRequirement {
  /** The roles any one of which suffices; `[]` admits every member, viewers included. */
  readonly roles: readonly OrganizationRole[];
  /** The member capability also required, if any (#485). */
  readonly capability?: "can_approve_loops";
}

/** One command of the grammar. */
export interface CommandDefinition {
  /** The words that name it, as recorded in `chat_commands.command` — `pause loop`, `dry-run`. */
  readonly id: string;
  /** Other spellings that reach the same command. */
  readonly aliases: readonly string[];
  /** Mockup 19's right-hand column — `send an issue into the loop`. */
  readonly summary: string;
  /** The usage line as mockup 19's COMMANDS card prints it, without the `/ouro` prefix. */
  readonly usage: string;
  readonly arguments: readonly ArgumentSpec[];
  readonly requires: CommandRequirement;
  /**
   * Whether the first attempt only describes what would happen: the command runs only when its
   * `confirm` argument was typed. True exactly for commands with a `confirm` argument.
   */
  readonly destructive: boolean;
  /** What a refused first attempt says — required when `destructive`. */
  readonly confirmPrompt?: string;
  /** `sync` replies with the result; `async` acknowledges, and the result follows as its own message. */
  readonly mode: "sync" | "async";
  readonly stage: CommandStage;
  /** For a `v2` command: the honest reply it gives instead of running. */
  readonly unavailableReply?: string;
  /** The existing API the binding calls, as documentation — `POST /api/v1/backlog/queue`. */
  readonly binds: string;
}

/** The whole grammar at one version. */
export interface Grammar {
  /** Bumped whenever a command, an argument or a requirement changes. */
  readonly version: number;
  readonly commands: readonly CommandDefinition[];
}

/** An argument after coercion — what a binding is handed. */
export type ResolvedArgument =
  | {
      readonly type: "ticket";
      readonly issueId: string;
      readonly number: number;
      readonly repository: string;
      readonly ticketId: string | null;
    }
  | { readonly type: "loop"; readonly runId: string; readonly loopSeq: number }
  | { readonly type: "workflow"; readonly slug: string }
  | { readonly type: "alias"; readonly alias: string }
  | { readonly type: "task_kind"; readonly name: string }
  | { readonly type: "question"; readonly itemId: string; readonly shortId: string }
  | { readonly type: "action"; readonly actionId: string }
  | { readonly type: "pr"; readonly number: number }
  | { readonly type: "keyword"; readonly word: string }
  | { readonly type: "confirm" };

/** The person a command acts as — never the app. */
export interface Invoker {
  readonly userId: string;
  /** The display name plane services record a requester under. */
  readonly name: string;
  readonly roles: readonly OrganizationRole[];
  /** Their explicit `can_approve_loops` grant: `true`, `false`, or `null` for the role's default. */
  readonly canApproveLoops: boolean | null;
}

/** What a binding is called with. */
export interface CommandContext {
  readonly organizationId: string;
  readonly invoker: Invoker;
  readonly surface: ChatSurface;
  /** The arguments by {@link ArgumentSpec.name}; an optional argument not typed is absent. */
  readonly args: Readonly<Record<string, ResolvedArgument>>;
  /** The public origin links in a reply are built on — `https://ouroboros.example`. */
  readonly appUrl: string;
}

/** A link a reply carries. */
export interface ReplyLink {
  readonly label: string;
  /** Absolute. */
  readonly url: string;
}

/** What is said back. Plain text and at most one link: every surface can draw that. */
export interface CommandReply {
  readonly text: string;
  readonly link?: ReplyLink;
}

/** A binding's result. */
export type BindingResult =
  /** Done; this is the answer. `ref` names what was made or changed, for `chat_commands.result_ref`. */
  | {
      readonly kind: "done";
      readonly reply: CommandReply;
      readonly ref?: Readonly<Record<string, string | number>>;
    }
  /**
   * Started; `reply` is the honest acknowledgement, and `result` settles later with what to post
   * as its own message. A rejection of `result` is recorded as the command's error.
   */
  | {
      readonly kind: "started";
      readonly reply: CommandReply;
      readonly ref?: Readonly<Record<string, string | number>>;
      readonly result: Promise<CommandReply>;
    };

/**
 * What a command does: one call to the plane service the UI's route calls.
 *
 * A binding never checks who the invoker is (the dispatcher has), never parses text, and never
 * reaches a driver, a queue table or a provider itself. A refusal by the plane is thrown as the
 * plane throws it; the dispatcher turns it into the reply.
 */
export interface CommandBinding {
  /** The {@link CommandDefinition.id} it serves. */
  readonly command: string;
  run(context: CommandContext): Promise<BindingResult>;
}

/** How an invocation ended. `chat_commands.outcome` (V131). */
export type CommandOutcome = "ok" | "error" | "denied" | "unlinked" | "async_pending";

/** What every surface hands the dispatcher. */
interface DispatchInputBase {
  /** The text after `/ouro`, as typed. */
  readonly text: string;
  /**
   * Where a later message for this invocation goes — the surface's own way of posting one. Called
   * at most once, with an async command's result. A surface with nowhere to post one (the
   * console) leaves it out and reads `chat_commands.settled_reply` instead.
   */
  readonly followUp?: (reply: CommandReply) => Promise<void>;
}

/** A command typed in Slack: who typed it is a platform user, still to be resolved to a person. */
export interface SlackDispatchInput extends DispatchInputBase {
  readonly surface: "slack";
  /** The Slack workspace and user. */
  readonly slack: {
    readonly teamId: string;
    readonly userId: string;
    readonly channelId: string | null;
  };
}

/**
 * A command typed in the app's own console (BZ.5, #539): who typed it is the signed-in session,
 * so there is no connection to find and no identity link to follow.
 */
export interface ConsoleDispatchInput extends DispatchInputBase {
  readonly surface: "console";
  /** The session: the workspace the request is in, and the person signed in. */
  readonly console: {
    readonly organizationId: string;
    readonly userId: string;
    /**
     * The bound channel whose mirror the command was typed under (#542) — a `chat_channels` id
     * the route has already checked is this workspace's. Absent or null for the palette, whose
     * commands belong to no channel and show in no mirror.
     */
    readonly channelId?: string | null;
  };
}

/** What a surface hands the dispatcher — the text, and its own way of saying who typed it. */
export type DispatchInput = SlackDispatchInput | ConsoleDispatchInput;

/** What the dispatcher hands back at once. */
export interface DispatchResult {
  readonly outcome: CommandOutcome;
  readonly reply: CommandReply;
  /** The `chat_commands` row, when one could be written (a workspace with no connection has none). */
  readonly commandId: string | null;
  /**
   * The grammar command the text named — its {@link CommandDefinition.id}, whatever alias or case
   * was typed. Null for `help`, for text that names no command, and when nobody could be asked.
   */
  readonly command: string | null;
  /**
   * Present exactly when the reply is a destructive command's describe-first preview
   * (`confirmation_required`): the text after `/ouro` that really does it — what was typed, with
   * `confirm` as its last word.
   */
  readonly confirmWith?: string;
}
