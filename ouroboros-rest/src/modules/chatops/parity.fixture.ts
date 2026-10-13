/**
 * The parity corpus (BZ.5, [#539](https://github.com/NobuData/ouroboros/issues/539)) — the
 * invocations that `parity.spec.ts` runs through the dispatcher twice, once as a linked Slack
 * user and once as the same person's console session, to hold mockup 19's *"Identical in Slack,
 * Teams, and the in-app console"* to something a test can fail on.
 *
 * ```
 * for every invocation:   console result ≡ Slack result
 *                         outcome · reply text and link · matched command · confirmWith
 *                         recorded row · settled reply · audit event
 *                         — differing only in surface and Slack's own provenance
 * ```
 *
 * It is data and nothing else — no dispatcher, no doubles, no test framework — so another
 * surface's suite (the console's own, in the UI) can type the same invocations and expect the
 * same endings. `text` is what follows `/ouro`; `expect` is how it must end on **every** surface.
 *
 * **What the planes do is the invocation's `scene`**, because a parity test is about the
 * dispatcher: the planes are doubles, and an invocation says only which way its plane answers.
 *
 * **One known difference, named rather than hidden** — {@link ParityInvocation.differs}: the
 * `help` list prints the built-ins a surface has, and `link` / `unlink` are Slack's alone
 * (`BUILTINS` in `grammar.registry.ts`): the console has no linking step to offer. Everything
 * else in the list, and every other invocation, is the same text.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import type { OrganizationRole } from "../db/schema";
import type { CommandOutcome } from "./grammar.types";

/** How the plane behind an invocation answers. */
export type ParityScene =
  /** The binding answers at once. */
  | "runs"
  /** The plane refuses with a `409` of its own — its code and its words are relayed. */
  | "plane_refuses"
  /** The plane fails with a `5xx` — its code is recorded, its words are never shown. */
  | "plane_faults"
  /** An async binding acknowledges, and its result arrives later with a link. */
  | "settles_ok"
  /** An async binding acknowledges, and its result is later refused by the plane. */
  | "settles_refused"
  /** The person is no longer a member of the workspace. */
  | "not_a_member";

/** One invocation, and how it must end on every surface. */
export interface ParityInvocation {
  /** What the case is called in a test's title. */
  readonly name: string;
  /** The text after `/ouro`, exactly as typed. */
  readonly text: string;
  /** The role of the person typing. */
  readonly as: OrganizationRole;
  readonly scene: ParityScene;
  readonly expect: {
    readonly outcome: CommandOutcome;
    /** The grammar command the text names; null for `help` and for text that names none. */
    readonly command: string | null;
    /** `chat_commands.error_detail` — present exactly for an `error` outcome. */
    readonly errorDetail?: string;
    /** Whether a `chat_commands` row and an audit event are written. `help` writes neither. */
    readonly recorded: boolean;
    /** For a destructive command's preview: the text that really does it. */
    readonly confirmWith?: string;
    /** For an async command: how its row settles. */
    readonly settles?: { readonly outcome: "ok" | "error"; readonly errorDetail?: string };
  };
  /**
   * The one way the two surfaces' reply text may differ: `slack_builtins` — Slack's reply also
   * lists its own built-ins. Absent for every invocation whose text must be identical.
   */
  readonly differs?: "slack_builtins";
}

/** The codes the plane doubles refuse with. */
export const PARITY_PLANE = {
  refusal: { code: "ticket_already_queued", message: "#485 is already queued on standard-fix." },
  fault: { code: "engine_unreachable", message: "connect ECONNREFUSED engine.internal:8080" },
  lateRefusal: { code: "dry_run_harness_failed", message: "The harness stopped at build." },
} as const;

/**
 * An invocation that runs.
 *
 * @param name - The case's name.
 * @param text - The text after `/ouro`.
 * @param command - The command it names.
 * @param as - Who types it.
 * @returns The invocation.
 */
function ok(
  name: string,
  text: string,
  command: string,
  as: OrganizationRole = "owner",
): ParityInvocation {
  return { name, text, as, scene: "runs", expect: { outcome: "ok", command, recorded: true } };
}

/**
 * An invocation the dispatcher itself ends in `error`.
 *
 * @param name - The case's name.
 * @param text - The text after `/ouro`.
 * @param command - The command it names, if it names one.
 * @param errorDetail - The recorded reason.
 * @param confirmWith - For a describe-first refusal, the confirming text.
 * @returns The invocation.
 */
function refused(
  name: string,
  text: string,
  command: string | null,
  errorDetail: string,
  confirmWith?: string,
): ParityInvocation {
  return {
    name,
    text,
    as: "owner",
    scene: "runs",
    expect: {
      outcome: "error",
      command,
      errorDetail,
      recorded: true,
      ...(confirmWith === undefined ? {} : { confirmWith }),
    },
  };
}

/**
 * An invocation denied for who is typing.
 *
 * @param name - The case's name.
 * @param text - The text after `/ouro`.
 * @param command - The command it names.
 * @param as - Who types it.
 * @returns The invocation.
 */
function denied(
  name: string,
  text: string,
  command: string,
  as: OrganizationRole,
): ParityInvocation {
  return { name, text, as, scene: "runs", expect: { outcome: "denied", command, recorded: true } };
}

/**
 * A request for help — answered for anybody, and recorded nowhere.
 *
 * @param name - The case's name.
 * @param text - The text after `/ouro`.
 * @param differs - Set for the list, which prints each surface's own built-ins.
 * @returns The invocation.
 */
function helps(name: string, text: string, differs?: "slack_builtins"): ParityInvocation {
  return {
    name,
    text,
    as: "viewer",
    scene: "runs",
    expect: { outcome: "ok", command: null, recorded: false },
    ...(differs === undefined ? {} : { differs }),
  };
}

/** The corpus. Every available command runs at least once with valid arguments. */
export const PARITY_CORPUS: readonly ParityInvocation[] = [
  // Every command, with valid arguments.
  ok("status", "status", "status"),
  ok("status, by a viewer", "status", "status", "viewer"),
  ok("queue", "queue #485", "queue"),
  ok("queue with a workflow, by a member", "queue #485 standard-fix", "queue", "member"),
  ok("pause loop", "pause loop 1847", "pause loop"),
  ok("pause loop, shouted and hashed", "PAUSE  Loop #1847", "pause loop", "admin"),
  ok("resume loop", "resume loop 1847", "resume loop"),
  ok("abort loop with confirm", "abort loop 1847 confirm", "abort loop"),
  ok("answer", "answer q-231 allow_once", "answer"),
  ok("answer, by a viewer", "answer q-231 allow_once", "answer", "viewer"),
  ok("route", "route implement claude-fable-5", "route"),
  ok("estimate", "estimate #490", "estimate", "viewer"),
  ok("pause all with confirm", "pause all confirm", "pause all"),

  // The v2 command: listed, and answers honestly that it does not run — for anybody.
  ok("explain pr, its v2 reply", "explain pr 514", "explain pr"),
  ok("explain pr, by a viewer", "explain pr #514", "explain pr", "viewer"),

  // The confirm rule: the first attempt only describes.
  refused(
    "abort loop without confirm",
    "abort loop 1847",
    "abort loop",
    "confirmation_required",
    "abort loop 1847 confirm",
  ),
  refused(
    "pause all without confirm",
    "pause all",
    "pause all",
    "confirmation_required",
    "pause all confirm",
  ),
  refused(
    "abort loop with a word that is not confirm",
    "abort loop 1847 yes",
    "abort loop",
    "bad_arguments",
  ),

  // Text that names no command.
  refused("an unknown command near a real one", "statsu", null, "unknown_command"),
  refused("an unknown command near nothing", "frobnicate the loop", null, "unknown_command"),
  refused("text that is not a word", "#485", null, "unknown_command"),

  // Bad arguments: missing, extra, and naming nothing.
  refused("a missing argument", "queue", "queue", "bad_arguments"),
  refused("an argument too many", "status now", "status", "bad_arguments"),
  refused("a ticket that names nothing", "queue nope", "queue", "bad_arguments"),
  refused("a workflow that names nothing", "queue #485 feature-lopp", "queue", "bad_arguments"),
  refused("a loop that is not a number", "pause loop soon", "pause loop", "bad_arguments"),

  // Denied: the role is too low — said before the confirm rule, and before anything runs.
  denied("queue, by a viewer", "queue #485", "queue", "viewer"),
  denied("dry-run, by a viewer", "dry-run #486", "dry-run", "viewer"),
  denied("route, by a member", "route implement claude-fable-5", "route", "member"),
  denied("pause all confirm, by a member", "pause all confirm", "pause all", "member"),
  denied("abort loop without confirm, by a member", "abort loop 1847", "abort loop", "member"),
  {
    name: "status, by somebody no longer a member",
    text: "status",
    as: "member",
    scene: "not_a_member",
    expect: { outcome: "denied", command: "status", recorded: true },
  },

  // Help: the list, a bare prefix, one command, and a name that is no command.
  helps("help", "help", "slack_builtins"),
  helps("a bare /ouro", "", "slack_builtins"),
  helps("help for a command", "help queue"),
  helps("help for a destructive command", "HELP abort loop"),
  helps("help for an async command, by its alias", "help dryrun"),
  helps("help for the v2 command", "help explain pr"),
  helps("help for help", "help help"),
  helps("help for a name that is no command", "help frobnicate"),

  // An async command, through to its settled result.
  {
    name: "dry-run, through to its result",
    text: "dry-run #486",
    as: "owner",
    scene: "settles_ok",
    expect: {
      outcome: "async_pending",
      command: "dry-run",
      recorded: true,
      settles: { outcome: "ok" },
    },
  },
  {
    name: "dry-run by its alias with a workflow, by a member",
    text: "dryrun #486 standard-fix",
    as: "member",
    scene: "settles_ok",
    expect: {
      outcome: "async_pending",
      command: "dry-run",
      recorded: true,
      settles: { outcome: "ok" },
    },
  },
  {
    name: "dry-run whose result the plane refuses",
    text: "dry-run #486",
    as: "owner",
    scene: "settles_refused",
    expect: {
      outcome: "async_pending",
      command: "dry-run",
      recorded: true,
      settles: { outcome: "error", errorDetail: PARITY_PLANE.lateRefusal.code },
    },
  },

  // The plane refuses, and the plane fails.
  {
    name: "queue, refused by the plane",
    text: "queue #485",
    as: "owner",
    scene: "plane_refuses",
    expect: {
      outcome: "error",
      command: "queue",
      errorDetail: PARITY_PLANE.refusal.code,
      recorded: true,
    },
  },
  {
    name: "pause all confirm, refused by the plane",
    text: "pause all confirm",
    as: "admin",
    scene: "plane_refuses",
    expect: {
      outcome: "error",
      command: "pause all",
      errorDetail: PARITY_PLANE.refusal.code,
      recorded: true,
    },
  },
  {
    name: "queue, when the plane fails",
    text: "queue #485",
    as: "owner",
    scene: "plane_faults",
    expect: {
      outcome: "error",
      command: "queue",
      errorDetail: PARITY_PLANE.fault.code,
      recorded: true,
    },
  },
];
