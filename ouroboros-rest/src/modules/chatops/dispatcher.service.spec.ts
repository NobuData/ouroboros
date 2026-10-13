import { Logger } from "@nestjs/common";

import type { AuditService } from "../audit/audit.service";
import type { AppConfigService } from "../config/config.service";
import type { ChatConnectionPublic, ChatIdentityLink, OrganizationRole } from "../db/schema";
import { ConflictError, UpstreamError } from "../errors/error.envelope";
import type { SlackRepository } from "../slack/slack.repository";
import type { CapabilityRepository } from "../tenancy/capability.repository";
import type { OrganizationRepository } from "../tenancy/organization.repository";
import { CHAT_REPLIES, deniedText } from "./chatops.replies";
import type { ChatopsRepository, CommandRecord, RecordedOutcome } from "./chatops.repository";
import {
  ChatDispatcher,
  DISPATCH_ERRORS,
  failureOf,
  permitted,
  recordedArgument,
} from "./dispatcher.service";
import { help, helpText, requirementWords } from "./grammar.help";
import { failureText, syntaxOf, unknownCommand } from "./grammar.parser";
import { ChatArgumentError, type ArgumentResolvers } from "./grammar.ports";
import { GRAMMAR, GRAMMAR_VERSION, withCommands } from "./grammar.registry";
import type {
  ArgumentSpec,
  ArgumentType,
  BindingResult,
  CommandBinding,
  CommandContext,
  CommandDefinition,
  CommandReply,
  ConsoleDispatchInput,
  Grammar,
  ResolvedArgument,
  SlackDispatchInput,
} from "./grammar.types";

/**
 * The `/ouro` dispatcher (#537), over doubles of everything it reaches: the real grammar, and
 * fake bindings, resolvers, repositories and audit plane — so what is asserted is the
 * dispatcher's own: who typed it, whether they may, whether they confirmed, what is said back
 * and what is written down.
 *
 * The command matrix is driven by the registry: a command added to `grammar.registry.ts` is
 * covered here without an edit.
 */

const ORG = "org-acme";
const TEAM = "T024AB";
const SLACK_MAYA = "U07MAYA";
const MAYA = "user-maya";
const CHANNEL = "C071LOOPS";
const CHANNEL_ROW = "chan-loops";
const AUDIT_EVENT = "audit-event-1";

const CONNECTION = {
  id: "conn-1",
  organization_id: ORG,
  workspace_id: TEAM,
  status: "active",
} as ChatConnectionPublic;

const LINK = {
  id: "link-maya",
  connection_id: CONNECTION.id,
  platform_user_id: SLACK_MAYA,
  state: "linked",
  user_id: MAYA,
} as ChatIdentityLink;

/** The word that makes the fake resolver refuse an argument. */
const NAMES_NOTHING = "nope";

/**
 * What is typed for an argument of each type, and what the fake resolver makes of it. Keyed by
 * every {@link ArgumentType}, so a new type cannot be added without a sample.
 */
const SAMPLES: Readonly<Record<ArgumentType, { raw: string; resolved: ResolvedArgument }>> = {
  ticket: {
    raw: "#485",
    resolved: {
      type: "ticket",
      issueId: "issue-485",
      number: 485,
      repository: "acme/helios",
      ticketId: null,
    },
  },
  loop: { raw: "1847", resolved: { type: "loop", runId: "run-1847", loopSeq: 1847 } },
  workflow: { raw: "standard-fix", resolved: { type: "workflow", slug: "standard-fix" } },
  alias: { raw: "claude-fable-5", resolved: { type: "alias", alias: "claude-fable-5" } },
  task_kind: { raw: "implement", resolved: { type: "task_kind", name: "implement" } },
  question: { raw: "q-231", resolved: { type: "question", itemId: "item-231", shortId: "q-231" } },
  action: { raw: "allow_once", resolved: { type: "action", actionId: "allow_once" } },
  pr: { raw: "514", resolved: { type: "pr", number: 514 } },
  keyword: { raw: "", resolved: { type: "keyword", word: "" } },
  confirm: { raw: "confirm", resolved: { type: "confirm" } },
};

/**
 * What is typed for one argument.
 *
 * @param argument - The argument.
 * @returns Its sample text — a keyword's own word.
 */
function rawOf(argument: ArgumentSpec): string {
  return argument.type === "keyword" ? (argument.word ?? "") : SAMPLES[argument.type].raw;
}

/**
 * A command as somebody would type it, with every argument filled in.
 *
 * @param definition - The command.
 * @param confirm - Whether its `confirm` word is typed; ignored by a command without one.
 * @returns The text after `/ouro`, and the arguments `chat_commands.args` should then hold.
 */
function typed(
  definition: CommandDefinition,
  confirm = true,
): { text: string; args: Record<string, string | number | boolean> } {
  const used = definition.arguments.filter((argument) => argument.type !== "confirm" || confirm);

  return {
    text: [definition.id, ...used.map(rawOf)].join(" "),
    args: Object.fromEntries(
      used.map((argument) => [
        argument.name,
        argument.type === "keyword"
          ? (argument.word ?? "")
          : recordedArgument(SAMPLES[argument.type].resolved),
      ]),
    ),
  };
}

/** A binding double that remembers what it was called with. */
type BindingRun = jest.Mock<Promise<BindingResult>, [CommandContext]>;

/**
 * A finished binding's answer.
 *
 * @param reply - What it says.
 * @param ref - What it made or changed.
 * @returns The `done` result.
 */
function done(reply: CommandReply, ref?: Record<string, string | number>): BindingResult {
  return ref === undefined ? { kind: "done", reply } : { kind: "done", reply, ref };
}

/** What a fake binding answers unless a test says otherwise. */
function ran(command: string): BindingResult {
  return done({ text: `ran ${command}` }, { made: command });
}

/** A promise a test settles when it chooses. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/** What a test changes about the world before typing. */
interface Scene {
  grammar: Grammar;
  /** Bindings beyond one per available command of the grammar, or replacing one of those. */
  bindings: CommandBinding[];
  connection: ChatConnectionPublic | undefined;
  link: ChatIdentityLink | undefined;
  /** The linked person's roles; `undefined` when they are no longer a member. */
  roles: OrganizationRole[] | undefined;
  /** Their explicit `can_approve_loops`. */
  explicit: boolean | null;
  userName: string | undefined;
  workspaceName: string | undefined;
  recordFails: boolean;
  auditFails: boolean;
  settleFails: boolean;
}

/**
 * The dispatcher over doubles.
 *
 * @param changes - What differs from a linked owner typing in a joined channel.
 * @returns The dispatcher, everything written, and the binding doubles by command id.
 */
function world(changes: Partial<Scene> = {}) {
  const scene: Scene = {
    grammar: GRAMMAR,
    bindings: [],
    connection: CONNECTION,
    link: LINK,
    roles: ["owner"],
    explicit: null,
    userName: "Maya Chen",
    workspaceName: "Acme Robotics",
    recordFails: false,
    auditFails: false,
    settleFails: false,
    ...changes,
  };
  const records: CommandRecord[] = [];
  const settles: {
    id: string;
    ended: RecordedOutcome;
    at: Date;
    reply: CommandReply | null;
  }[] = [];
  const memberships: { organizationId: string; userId: string }[] = [];
  const attached: { commandId: string; auditEventId: string }[] = [];
  const audits: Record<string, unknown>[] = [];
  const resolved: { organizationId: string; argument: string; raw: string; previous: string[] }[] =
    [];
  const order: string[] = [];
  const runs = new Map<string, BindingRun>();

  for (const definition of scene.grammar.commands) {
    if (definition.stage === "available") {
      runs.set(
        definition.id,
        jest.fn<Promise<BindingResult>, [CommandContext]>(() =>
          Promise.resolve(ran(definition.id)),
        ),
      );
    }
  }

  const slack = {
    activeByWorkspace: jest.fn((teamId: string) =>
      Promise.resolve(teamId === TEAM ? scene.connection : undefined),
    ),
    liveLink: jest.fn((connectionId: string, userId: string) =>
      Promise.resolve(
        scene.link?.connection_id === connectionId && scene.link.platform_user_id === userId
          ? scene.link
          : undefined,
      ),
    ),
  };
  const commands = {
    joinedChannel: jest.fn((_connectionId: string, platformChannelId: string) =>
      Promise.resolve(platformChannelId === CHANNEL ? CHANNEL_ROW : undefined),
    ),
    userName: () => Promise.resolve(scene.userName),
    workspaceName: () => Promise.resolve(scene.workspaceName),
    record: (command: CommandRecord) => {
      if (scene.recordFails) {
        return Promise.reject(new Error("chat_commands is unreachable"));
      }

      records.push(command);
      order.push("record");

      return Promise.resolve({ id: command.id, messageId: null });
    },
    settle: (id: string, ended: RecordedOutcome, at: Date, reply: CommandReply | null) => {
      if (scene.settleFails) {
        return Promise.reject(new Error("chat_commands is unreachable"));
      }

      settles.push({ id, ended, at, reply });
      order.push("settle");

      return Promise.resolve(true);
    },
    attachAudit: (commandId: string, auditEventId: string) => {
      attached.push({ commandId, auditEventId });

      return Promise.resolve();
    },
  };
  const resolvers: ArgumentResolvers = {
    resolve: (organizationId, spec, raw, previous) => {
      resolved.push({ organizationId, argument: spec.name, raw, previous: Object.keys(previous) });

      return raw === NAMES_NOTHING
        ? Promise.reject(
            new ChatArgumentError(spec.name, `unknown ${spec.name} "${raw}"`, ["nearest", "next"]),
          )
        : Promise.resolve(SAMPLES[spec.type].resolved);
    },
  };
  const bindings: CommandBinding[] = [
    ...[...runs]
      .filter(([command]) => !scene.bindings.some((binding) => binding.command === command))
      .map(([command, run]) => ({ command, run })),
    ...scene.bindings,
  ];

  /** Build the dispatcher — separately, so a test can assert that it refuses to be built. */
  const build = (): ChatDispatcher =>
    new ChatDispatcher(
      scene.grammar,
      bindings,
      resolvers,
      slack as unknown as SlackRepository,
      commands as unknown as ChatopsRepository,
      {
        rolesFor: (organizationId: string, userId: string) => {
          memberships.push({ organizationId, userId });

          return Promise.resolve(scene.roles);
        },
      } as unknown as OrganizationRepository,
      {
        explicitFor: () => Promise.resolve(scene.explicit),
      } as unknown as CapabilityRepository,
      {
        record: (event: Record<string, unknown>) => {
          if (scene.auditFails) {
            return Promise.reject(new Error("the audit plane is unreachable"));
          }

          audits.push(event);
          order.push("audit");

          return Promise.resolve(AUDIT_EVENT);
        },
      } as unknown as AuditService,
      // A trailing slash, to see that links are not built on `//`.
      { uiUrl: "https://app.example.test/" } as unknown as AppConfigService,
    );

  return {
    scene,
    build,
    records,
    settles,
    memberships,
    attached,
    audits,
    resolved,
    order,
    runs,
    slack,
    commands,
    /** The binding double of one command. */
    run: (command: string): BindingRun => {
      const run = runs.get(command);

      if (run === undefined) {
        throw new Error(`no binding double for "${command}"`);
      }

      return run;
    },
  };
}

/**
 * What the Slack adapter hands over.
 *
 * @param text - The text after `/ouro`.
 * @param extra - Anything else about the invocation.
 * @returns The dispatcher's input.
 */
function slackInput(text: string, extra: Partial<SlackDispatchInput> = {}): SlackDispatchInput {
  return {
    surface: "slack",
    text,
    slack: { teamId: TEAM, userId: SLACK_MAYA, channelId: CHANNEL },
    ...extra,
  };
}

/**
 * What the console's route hands over: the text and the signed-in session.
 *
 * @param text - The text after `/ouro`.
 * @param extra - Anything else about the invocation.
 * @returns The dispatcher's input.
 */
function consoleInput(
  text: string,
  extra: Partial<ConsoleDispatchInput> = {},
): ConsoleDispatchInput {
  return { surface: "console", text, console: { organizationId: ORG, userId: MAYA }, ...extra };
}

/** The keys a console command's audit detail holds: no chat provenance, because there is none. */
const CONSOLE_AUDIT_DETAIL_KEYS = ["command", "grammarVersion", "outcome", "surface"];

/** The keys a `chat.command_invoked` event's detail holds — provenance, and nothing typed. */
const AUDIT_DETAIL_KEYS = [
  "channelId",
  "command",
  "connectionId",
  "grammarVersion",
  "outcome",
  "platformChannelId",
  "platformUserId",
  "surface",
];

let errors: jest.SpyInstance;
let warnings: jest.SpyInstance;

beforeEach(() => {
  errors = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  warnings = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

describe("the command matrix", () => {
  describe.each(GRAMMAR.commands.map((definition) => [definition.id, definition] as const))(
    "/ouro %s",
    (id, definition) => {
      const available = definition.stage === "available";
      const open =
        definition.requires.roles.length === 0 && definition.requires.capability === undefined;

      it("runs for somebody who may, says what its binding said, and records ok", async () => {
        const { build, records, audits, attached, runs } = world();
        const { text, args } = typed(definition);

        const result = await build().dispatch(slackInput(text));

        expect(result.outcome).toBe("ok");
        expect(result.reply).toEqual(
          available ? { text: `ran ${id}` } : { text: definition.unavailableReply },
        );
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          id: result.commandId,
          organizationId: ORG,
          connectionId: CONNECTION.id,
          channelId: CHANNEL_ROW,
          invokerLinkId: LINK.id,
          platformUserId: SLACK_MAYA,
          invokerUserId: MAYA,
          surface: "slack",
          command: id,
          args,
          rawText: `/ouro ${text}`,
          ended: { outcome: "ok" },
          withReplyMessage: true,
        });
        expect(records[0].ref).toEqual(available ? { made: id } : undefined);
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          action: "chat.command_invoked",
          actorId: MAYA,
          subjectType: "chat_command",
          subjectId: result.commandId,
          detail: { command: id, outcome: "ok" },
        });
        expect(attached).toEqual([{ commandId: result.commandId, auditEventId: AUDIT_EVENT }]);

        // One call to its own binding and to no other; a v2 command has none to call.
        for (const [command, run] of runs) {
          expect(run).toHaveBeenCalledTimes(command === id ? 1 : 0);
        }

        expect(runs.has(id)).toBe(available);
      });

      it("is refused for somebody unlinked, who is told to link, and records unlinked", async () => {
        const { build, records, audits, runs } = world({ link: undefined });
        const { text } = typed(definition);

        const result = await build().dispatch(slackInput(text));

        expect(result.outcome).toBe("unlinked");
        expect(result.reply).toEqual({ text: CHAT_REPLIES.unlinked });
        expect(records).toHaveLength(1);
        // Nothing was read of what they typed, and nobody is named — but the attempt is kept,
        // with the platform's user id.
        expect(records[0]).toMatchObject({
          command: id,
          args: {},
          rawText: `/ouro ${text}`,
          invokerLinkId: null,
          platformUserId: SLACK_MAYA,
          invokerUserId: null,
          ended: { outcome: "unlinked" },
          withReplyMessage: false,
        });
        expect(audits[0]).toMatchObject({ actorId: null, detail: { outcome: "unlinked" } });

        for (const run of runs.values()) {
          expect(run).not.toHaveBeenCalled();
        }
      });

      if (open) {
        it("is open to every member: a viewer runs it", async () => {
          const { build, records, runs } = world({ roles: ["viewer"] });

          const result = await build().dispatch(slackInput(typed(definition).text));

          expect(result.outcome).toBe("ok");
          expect(records[0].ended).toEqual({ outcome: "ok" });
          expect(runs.get(id)?.mock.calls ?? []).toHaveLength(available ? 1 : 0);
        });
      } else {
        it("is denied to a viewer, in words that name who it is for, and records denied", async () => {
          const { build, records, audits, runs } = world({ roles: ["viewer"] });
          const { text, args } = typed(definition);

          const result = await build().dispatch(slackInput(text));

          expect(result.outcome).toBe("denied");
          expect(result.reply).toEqual({ text: deniedText(definition) });
          expect(result.reply.text).toContain(`\`/ouro ${id}\``);
          expect(result.reply.text).toContain(requirementWords(definition.requires));
          expect(records).toHaveLength(1);
          expect(records[0]).toMatchObject({
            command: id,
            args,
            invokerLinkId: LINK.id,
            ended: { outcome: "denied" },
            withReplyMessage: false,
          });
          expect(audits[0]).toMatchObject({ actorId: MAYA, detail: { outcome: "denied" } });

          for (const run of runs.values()) {
            expect(run).not.toHaveBeenCalled();
          }
        });
      }

      it("is refused with its syntax when an argument too many is typed, and records bad_arguments", async () => {
        const { build, records, audits, runs } = world();
        const text = `${typed(definition).text} surplus`;

        const result = await build().dispatch(slackInput(text));

        expect(result.outcome).toBe("error");
        expect(result.reply).toEqual({
          text: failureText({ kind: "extra_argument", definition, extra: "surplus" }),
        });
        expect(result.reply.text).toContain(syntaxOf(definition));
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          command: id,
          args: {},
          rawText: `/ouro ${text}`,
          ended: { outcome: "error", detail: "bad_arguments" },
          withReplyMessage: false,
        });
        expect(audits[0]).toMatchObject({ detail: { command: id, outcome: "error" } });

        for (const run of runs.values()) {
          expect(run).not.toHaveBeenCalled();
        }
      });

      const required = definition.arguments.find((argument) => !argument.optional);

      if (required !== undefined) {
        it("is refused with its syntax when a required argument is missing", async () => {
          const { build, records, runs } = world();

          const result = await build().dispatch(slackInput(id));

          expect(result.outcome).toBe("error");
          expect(result.reply).toEqual({
            text: failureText({ kind: "missing_argument", definition, argument: required }),
          });
          expect(records[0].ended).toEqual({ outcome: "error", detail: "bad_arguments" });

          for (const run of runs.values()) {
            expect(run).not.toHaveBeenCalled();
          }
        });
      }

      const named = definition.arguments.find(
        (argument) => argument.type !== "keyword" && argument.type !== "confirm",
      );

      if (named !== undefined) {
        it("relays the plane's own words and nearest names when an argument names nothing", async () => {
          const { build, records, runs } = world();
          const text = [
            id,
            ...definition.arguments
              .slice(0, definition.arguments.indexOf(named) + 1)
              .map((argument) => (argument === named ? NAMES_NOTHING : rawOf(argument))),
          ].join(" ");

          const result = await build().dispatch(slackInput(text));

          expect(result.outcome).toBe("error");
          expect(result.reply).toEqual({
            text: `unknown ${named.name} "${NAMES_NOTHING}" — try: nearest, next`,
          });
          expect(records[0].ended).toEqual({ outcome: "error", detail: "bad_arguments" });

          for (const run of runs.values()) {
            expect(run).not.toHaveBeenCalled();
          }
        });
      }
    },
  );

  it("covers every command of the registry, and each outcome the dispatcher can record", () => {
    // The table above is generated: this pins what it was generated from.
    expect(GRAMMAR.commands.map((command) => command.id)).toEqual([
      "status",
      "queue",
      "pause loop",
      "resume loop",
      "abort loop",
      "answer",
      "dry-run",
      "route",
      "explain pr",
      "estimate",
      "pause all",
    ]);
    expect(DISPATCH_ERRORS).toEqual({
      unknownCommand: "unknown_command",
      badArguments: "bad_arguments",
      confirmationRequired: "confirmation_required",
      internal: "internal_error",
    });
  });
});

describe("what a binding is handed", () => {
  it("is the person, their workspace, the surface, the resolved arguments and the public origin", async () => {
    const { build, run, resolved } = world({ roles: ["admin"], explicit: false });

    await build().dispatch(slackInput("queue #485 standard-fix"));

    expect(run("queue")).toHaveBeenCalledWith({
      organizationId: ORG,
      invoker: { userId: MAYA, name: "Maya Chen", roles: ["admin"], canApproveLoops: false },
      surface: "slack",
      args: { ticket: SAMPLES.ticket.resolved, workflow: SAMPLES.workflow.resolved },
      appUrl: "https://app.example.test",
    });
    // Each argument is resolved in the workspace, in order, with the ones before it.
    expect(resolved).toEqual([
      { organizationId: ORG, argument: "ticket", raw: "#485", previous: [] },
      { organizationId: ORG, argument: "workflow", raw: "standard-fix", previous: ["ticket"] },
    ]);
  });

  it("leaves an optional argument that was not typed out of the arguments and the record", async () => {
    const { build, run, records } = world();

    await build().dispatch(slackInput("queue #485"));

    expect(run("queue").mock.calls[0][0].args).toEqual({ ticket: SAMPLES.ticket.resolved });
    expect(records[0].args).toEqual({ ticket: "acme/helios#485" });
  });

  it("reaches the same command by an alias and in any case, and records its id", async () => {
    const { build, run, records } = world();
    const dispatcher = build();

    await dispatcher.dispatch(slackInput("dryrun #486"));
    await dispatcher.dispatch(slackInput("  PAUSE   Loop 1847 "));

    expect(run("dry-run")).toHaveBeenCalledTimes(1);
    expect(run("pause loop")).toHaveBeenCalledTimes(1);
    expect(records.map((record) => [record.command, record.rawText])).toEqual([
      ["dry-run", "/ouro dryrun #486"],
      ["pause loop", "/ouro PAUSE   Loop 1847"],
    ]);
  });

  it("carries the reply's link and the binding's ref through untouched", async () => {
    const reply = {
      text: "Queued #485.",
      link: { label: "Open the loop", url: "https://app.example.test/runs/run-1" },
    };
    const { build, records } = world({
      bindings: [
        {
          command: "queue",
          run: () => Promise.resolve(done(reply, { run: "run-1", loop: 1848 })),
        },
      ],
    });

    const result = await build().dispatch(slackInput("queue #485"));

    expect(result.reply).toEqual(reply);
    expect(records[0].ref).toEqual({ run: "run-1", loop: 1848 });
  });
});

describe("who typed it", () => {
  it("treats a link that is still pending as no link at all", async () => {
    const { build, records, run } = world({
      link: { ...LINK, state: "pending", user_id: null },
    });

    const result = await build().dispatch(slackInput("status"));

    expect(result.outcome).toBe("unlinked");
    expect(records[0]).toMatchObject({ invokerLinkId: null, ended: { outcome: "unlinked" } });
    expect(run("status")).not.toHaveBeenCalled();
  });

  it("denies a linked person who is no longer a member, and says why", async () => {
    const { build, records, audits, run } = world({ roles: undefined });

    const result = await build().dispatch(slackInput("status"));

    expect(result).toMatchObject({ outcome: "denied", reply: { text: CHAT_REPLIES.notAMember } });
    expect(records[0]).toMatchObject({
      command: "status",
      invokerLinkId: LINK.id,
      ended: { outcome: "denied" },
    });
    expect(audits[0]).toMatchObject({ actorId: MAYA, detail: { outcome: "denied" } });
    expect(run("status")).not.toHaveBeenCalled();
  });

  it("denies a link whose person no longer exists", async () => {
    const { build, run } = world({ userName: undefined });

    const result = await build().dispatch(slackInput("status"));

    expect(result).toMatchObject({ outcome: "denied", reply: { text: CHAT_REPLIES.notAMember } });
    expect(run("status")).not.toHaveBeenCalled();
  });

  it("asks who somebody is before it reads what they typed: unlinked beats unknown", async () => {
    const { build, records } = world({ link: undefined });

    const result = await build().dispatch(slackInput("frobnicate now"));

    expect(result).toMatchObject({ outcome: "unlinked", reply: { text: CHAT_REPLIES.unlinked } });
    expect(records[0]).toMatchObject({ command: "frobnicate", ended: { outcome: "unlinked" } });
  });

  it.each<[string, OrganizationRole[], boolean | null, "ok" | "denied"]>([
    ["a member nobody granted it", ["member"], null, "denied"],
    ["a member granted it", ["member"], true, "ok"],
    ["an admin, by their role", ["admin"], null, "ok"],
    ["an admin it was taken from", ["admin"], false, "denied"],
  ])(
    "checks a command's capability as well as its role: %s",
    async (_who, roles, explicit, outcome) => {
      const approve: CommandDefinition = {
        id: "approve",
        aliases: [],
        summary: "approve a loop",
        usage: "approve 1847",
        arguments: [],
        requires: { roles: ["owner", "admin", "member"], capability: "can_approve_loops" },
        destructive: false,
        mode: "sync",
        stage: "available",
        binds: "a fixture",
      };
      const { build, run } = world({ grammar: withCommands(GRAMMAR, approve), roles, explicit });

      const result = await build().dispatch(slackInput("approve"));

      expect(result.outcome).toBe(outcome);
      expect(run("approve")).toHaveBeenCalledTimes(outcome === "ok" ? 1 : 0);

      if (outcome === "denied") {
        expect(result.reply.text).toBe(
          "`/ouro approve` is for workspace owners, admins and members who can approve loops.",
        );
      }
    },
  );
});

describe("destructive commands", () => {
  it("abort loop without confirm aborts nothing and says precisely what it would do to that loop", async () => {
    const { build, records, audits, run } = world();

    const result = await build().dispatch(slackInput("abort loop 1847"));

    expect(run("abort loop")).not.toHaveBeenCalled();
    expect(result.outcome).toBe("error");
    expect(result.reply).toEqual({
      text: "Add `confirm` to abort — this stops loop 1847 for good and closes its run as canceled. Its branch is kept; nothing is reverted or deleted. `/ouro abort loop 1847 confirm`",
    });
    expect(records[0]).toMatchObject({
      command: "abort loop",
      args: { loop: 1847 },
      ended: { outcome: "error", detail: "confirmation_required" },
      withReplyMessage: false,
    });
    expect(audits[0]).toMatchObject({ detail: { command: "abort loop", outcome: "error" } });
    // The text that really does it: what was typed, and the word.
    expect(result.confirmWith).toBe("abort loop 1847 confirm");
    expect(result.reply.text).toContain(`\`/ouro ${String(result.confirmWith)}\``);
  });

  it("names the confirming text from what was typed, and only on the describe-first reply", async () => {
    const { build } = world();
    const dispatcher = build();

    expect(await dispatcher.dispatch(slackInput("  ABORT  loop   #1847 "))).toMatchObject({
      command: "abort loop",
      confirmWith: "abort loop #1847 confirm",
    });
    expect(await dispatcher.dispatch(slackInput("pause all"))).toMatchObject({
      command: "pause all",
      confirmWith: "pause all confirm",
    });

    for (const text of ["abort loop 1847 confirm", "pause all confirm", "status", "abort loop"]) {
      expect(await dispatcher.dispatch(slackInput(text))).not.toHaveProperty("confirmWith");
    }
  });

  it("abort loop with confirm calls its binding once", async () => {
    const { build, records, run } = world();

    const result = await build().dispatch(slackInput("abort loop 1847 confirm"));

    expect(run("abort loop")).toHaveBeenCalledTimes(1);
    expect(run("abort loop").mock.calls[0][0].args).toEqual({
      loop: SAMPLES.loop.resolved,
      confirm: { type: "confirm" },
    });
    expect(result.outcome).toBe("ok");
    expect(records[0]).toMatchObject({
      args: { loop: 1847, confirm: true },
      ended: { outcome: "ok" },
    });
  });

  it("pause all without confirm pauses nothing and says precisely what it would do to the workspace", async () => {
    const { build, records, run } = world();

    const result = await build().dispatch(slackInput("pause all"));

    expect(run("pause all")).not.toHaveBeenCalled();
    expect(result.outcome).toBe("error");
    expect(result.reply).toEqual({
      text: "Add `confirm` to pause everything — this stops every loop in Acme Robotics from starting anything new. Stages already running finish, and queued work stays queued until an owner or admin resumes the workspace. `/ouro pause all confirm`",
    });
    expect(records[0]).toMatchObject({
      command: "pause all",
      args: {},
      ended: { outcome: "error", detail: "confirmation_required" },
    });
  });

  it("pause all with confirm calls its binding once", async () => {
    const { build, records, run } = world();

    const result = await build().dispatch(slackInput("pause all confirm"));

    expect(run("pause all")).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("ok");
    expect(records[0]).toMatchObject({ args: { confirm: true }, ended: { outcome: "ok" } });
  });

  it("still describes the pause when the workspace's name cannot be read", async () => {
    const { build } = world({ workspaceName: undefined });

    const result = await build().dispatch(slackInput("pause all"));

    expect(result.reply.text).toContain("every loop in this workspace from");
  });

  it.each(GRAMMAR.commands.filter((command) => command.destructive))(
    "every destructive command describes first and runs only on confirm: $id",
    async (definition) => {
      const { build, records, run } = world();
      const dispatcher = build();

      const first = await dispatcher.dispatch(slackInput(typed(definition, false).text));

      expect(first.outcome).toBe("error");
      expect(first.reply.text).not.toMatch(/\{[a-z_]+\}/);
      expect(first.reply.text).toContain(`\`/ouro ${typed(definition).text}\``);
      expect(records[0].ended).toEqual({ outcome: "error", detail: "confirmation_required" });
      expect(run(definition.id)).not.toHaveBeenCalled();

      const second = await dispatcher.dispatch(slackInput(typed(definition).text));

      expect(second.outcome).toBe("ok");
      expect(run(definition.id)).toHaveBeenCalledTimes(1);
    },
  );

  it("takes only the word confirm: anything else there is a bad argument, and nothing runs", async () => {
    const { build, records, run } = world();

    const result = await build().dispatch(slackInput("abort loop 1847 yes"));

    expect(run("abort loop")).not.toHaveBeenCalled();
    expect(result.reply.text).toContain("takes the word `confirm`");
    expect(records[0].ended).toEqual({ outcome: "error", detail: "bad_arguments" });
  });

  it("tells somebody who may not that they may not, rather than how to confirm", async () => {
    const { build, records, run } = world({ roles: ["member"] });

    const result = await build().dispatch(slackInput("pause all"));

    expect(result).toMatchObject({
      outcome: "denied",
      reply: { text: "`/ouro pause all` is for workspace owners and admins." },
    });
    expect(records[0].ended).toEqual({ outcome: "denied" });
    expect(run("pause all")).not.toHaveBeenCalled();
  });
});

describe("a v2 command", () => {
  it("explain pr 514 answers with its honest v2 text, records ok, and summarises nothing", async () => {
    const { build, records, audits, runs } = world();

    const result = await build().dispatch(slackInput("explain pr 514"));

    expect(result.outcome).toBe("ok");
    expect(result.reply).toEqual({
      text: "Plain-language PR summaries arrive with AI presence (CB.1, #546). `/ouro explain pr` is listed so you know it is coming; it does not summarise anything yet.",
    });
    expect(result.reply.link).toBeUndefined();
    expect(records[0]).toMatchObject({
      command: "explain pr",
      args: { pr: 514 },
      ended: { outcome: "ok" },
    });
    expect(records[0].ref).toBeUndefined();
    expect(audits[0]).toMatchObject({ detail: { command: "explain pr", outcome: "ok" } });
    // No binding exists for it, and none of the others was called in its place.
    expect(runs.has("explain pr")).toBe(false);

    for (const run of runs.values()) {
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("is answered the same for a viewer: nothing runs, so there is nothing to deny", async () => {
    const { build } = world({ roles: ["viewer"] });

    const result = await build().dispatch(slackInput("explain pr 514"));

    expect(result.outcome).toBe("ok");
    expect(result.reply.text).toContain("does not summarise anything yet");
  });
});

describe("an async command", () => {
  const ACK = { text: "Rehearsing #486 — the result follows here." };
  const RESULT = {
    text: "Dry run of #486 finished: no writes.",
    link: { label: "Open the dry run", url: "https://app.example.test/dry-runs/dr-1" },
  };

  /** A world whose `dry-run` binding answers `started`, with the result in the test's hands. */
  function started() {
    const result = deferred<CommandReply>();
    const acknowledged: BindingResult = {
      kind: "started",
      reply: ACK,
      ref: { dryRun: "dr-1" },
      result: result.promise,
    };
    const scene = world({
      bindings: [{ command: "dry-run", run: () => Promise.resolve(acknowledged) }],
    });
    const followUp = jest.fn<Promise<void>, [CommandReply]>(() => {
      scene.order.push("followUp");

      return Promise.resolve();
    });

    return { ...scene, result, followUp };
  }

  it("is acknowledged at once and recorded async_pending, then settled ok and its result delivered", async () => {
    const { build, records, settles, audits, order, result, followUp } = started();
    const dispatcher = build();

    const dispatched = await dispatcher.dispatch(slackInput("dry-run #486", { followUp }));

    // The acknowledgement is the binding's own sentence, and the result has not happened yet.
    expect(dispatched).toEqual({
      outcome: "async_pending",
      reply: ACK,
      commandId: records[0].id,
      command: "dry-run",
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      command: "dry-run",
      args: { ticket: "acme/helios#485" },
      ended: { outcome: "async_pending" },
      // The acknowledgement is the row's `reply`; the result will be its `settled_reply`.
      reply: ACK,
      ref: { dryRun: "dr-1" },
      withReplyMessage: true,
    });
    expect(audits[0]).toMatchObject({ detail: { outcome: "async_pending" } });
    expect(settles).toEqual([]);
    expect(followUp).not.toHaveBeenCalled();

    result.resolve(RESULT);
    await dispatcher.idle();

    // What it said is kept on the row as well as posted (#539).
    expect(settles).toEqual([
      { id: records[0].id, ended: { outcome: "ok" }, at: expect.any(Date) as Date, reply: RESULT },
    ]);
    expect(followUp).toHaveBeenCalledTimes(1);
    expect(followUp).toHaveBeenCalledWith(RESULT);
    // The row exists before it is settled, and is settled before anything is posted.
    expect(order).toEqual(["record", "audit", "settle", "followUp"]);
    // One invocation is one row and one event: settling adds neither.
    expect(records).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it("settles error with the plane's code, and delivers the plane's words, when the result is refused", async () => {
    const { build, records, settles, result, followUp } = started();
    const dispatcher = build();

    await dispatcher.dispatch(slackInput("dry-run #486", { followUp }));
    result.reject(new ConflictError("dry_run_harness_failed", "The harness stopped at build."));
    await dispatcher.idle();

    expect(settles).toEqual([
      {
        id: records[0].id,
        ended: { outcome: "error", detail: "dry_run_harness_failed" },
        at: expect.any(Date) as Date,
        // A refusal's words are what it said: kept, as they are posted.
        reply: { text: "The harness stopped at build." },
      },
    ]);
    expect(followUp).toHaveBeenCalledWith({ text: "The harness stopped at build." });
  });

  it("settles internal_error, and says only that it did not finish, when the result fails unknowably", async () => {
    const { build, settles, result, followUp } = started();
    const dispatcher = build();

    await dispatcher.dispatch(slackInput("dry-run #486", { followUp }));
    result.reject(new Error("ECONNRESET 10.0.3.7:5432 password=hunter2"));
    await dispatcher.idle();

    expect(settles[0].ended).toEqual({ outcome: "error", detail: "internal_error" });
    expect(settles[0].reply).toEqual({ text: CHAT_REPLIES.asyncFailed("dry-run") });
    expect(JSON.stringify(settles)).not.toContain("hunter2");
    expect(followUp).toHaveBeenCalledWith({ text: CHAT_REPLIES.asyncFailed("dry-run") });
    expect(JSON.stringify(followUp.mock.calls)).not.toContain("hunter2");
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("keeps the recorded outcome when the result cannot be delivered", async () => {
    const { build, records, settles, result, followUp } = started();
    const dispatcher = build();

    followUp.mockRejectedValue(new Error("Slack did not take the reply: expired_url"));
    await dispatcher.dispatch(slackInput("dry-run #486", { followUp }));
    result.resolve(RESULT);

    await expect(dispatcher.idle()).resolves.toBeUndefined();

    expect(followUp).toHaveBeenCalledTimes(1);
    expect(settles).toEqual([
      { id: records[0].id, ended: { outcome: "ok" }, at: expect.any(Date) as Date, reply: RESULT },
    ]);
    expect(warnings).toHaveBeenCalledTimes(1);
  });

  it("still delivers the result when the row could not be settled", async () => {
    const { build, scene, settles, result, followUp } = started();
    const dispatcher = build();

    await dispatcher.dispatch(slackInput("dry-run #486", { followUp }));
    scene.settleFails = true;
    result.resolve(RESULT);
    await dispatcher.idle();

    expect(settles).toEqual([]);
    expect(followUp).toHaveBeenCalledWith(RESULT);
  });

  it("settles the row on a surface that gave it nowhere to post a later message", async () => {
    const { build, settles, result } = started();
    const dispatcher = build();

    await dispatcher.dispatch(slackInput("dry-run #486"));
    result.resolve(RESULT);
    await dispatcher.idle();

    expect(settles.map((settled) => settled.ended)).toEqual([{ outcome: "ok" }]);
  });

  it("waits at shutdown for a result that is still to come", async () => {
    const { build, settles, result, followUp } = started();
    const dispatcher = build();

    await dispatcher.dispatch(slackInput("dry-run #486", { followUp }));

    let down = false;
    const shutdown = dispatcher.onApplicationShutdown().then(() => {
      down = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(down).toBe(false);

    result.resolve(RESULT);
    await shutdown;

    expect(settles).toHaveLength(1);
    expect(followUp).toHaveBeenCalledTimes(1);
  });

  it("has nothing to wait for when nothing was started", async () => {
    await expect(world().build().idle()).resolves.toBeUndefined();
  });
});

describe("recording", () => {
  it("writes one row and one audit event carrying where it came from — and nothing that was typed", async () => {
    const { build, records, audits, attached } = world();

    const result = await build().dispatch(slackInput("queue #485 standard-fix"));

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      id: result.commandId,
      organizationId: ORG,
      connectionId: CONNECTION.id,
      channelId: CHANNEL_ROW,
      invokerLinkId: LINK.id,
      platformUserId: SLACK_MAYA,
      invokerUserId: MAYA,
      surface: "slack",
      command: "queue",
      args: { ticket: "acme/helios#485", workflow: "standard-fix" },
      rawText: "/ouro queue #485 standard-fix",
      ended: { outcome: "ok" },
      // What it said at once, kept on the row (#542).
      reply: { text: "ran queue" },
      ref: { made: "queue" },
      invokedAt: expect.any(Date) as Date,
      completedAt: expect.any(Date) as Date,
      withReplyMessage: true,
    });
    expect(records[0].invokedAt.getTime()).toBeLessThanOrEqual(records[0].completedAt.getTime());

    expect(audits).toEqual([
      {
        organizationId: ORG,
        actorId: MAYA,
        action: "chat.command_invoked",
        subjectType: "chat_command",
        subjectId: result.commandId,
        at: records[0].completedAt,
        detail: {
          surface: "slack",
          command: "queue",
          outcome: "ok",
          connectionId: CONNECTION.id,
          channelId: CHANNEL_ROW,
          platformChannelId: CHANNEL,
          platformUserId: SLACK_MAYA,
          grammarVersion: GRAMMAR_VERSION,
        },
      },
    ]);
    expect(Object.keys(audits[0].detail as object).sort()).toEqual(AUDIT_DETAIL_KEYS);
    expect(JSON.stringify(audits[0])).not.toContain("#485");
    expect(JSON.stringify(audits[0])).not.toContain("acme/helios");
    expect(JSON.stringify(audits[0])).not.toContain("standard-fix");
    expect(attached).toEqual([{ commandId: result.commandId, auditEventId: AUDIT_EVENT }]);
  });

  it.each([
    ["an ok", "status", {}],
    ["an unlinked", "status", { link: undefined }],
    ["a denied", "pause all confirm", { roles: ["viewer"] as OrganizationRole[] }],
    ["an unknown-command", "frobnicate <secret>", {}],
    ["a bad-arguments", "queue", {}],
    ["a confirmation-required", "abort loop 1847", {}],
  ])("records %s invocation as exactly one row and one event", async (_which, text, changes) => {
    const { build, records, audits, attached } = world(changes);

    const result = await build().dispatch(slackInput(text));

    expect(result.commandId).toEqual(expect.any(String));
    expect(records.map((record) => record.id)).toEqual([result.commandId]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "chat.command_invoked",
      subjectId: result.commandId,
      detail: {
        surface: "slack",
        outcome: result.outcome,
        connectionId: CONNECTION.id,
        channelId: CHANNEL_ROW,
        platformChannelId: CHANNEL,
        platformUserId: SLACK_MAYA,
        grammarVersion: GRAMMAR_VERSION,
      },
    });
    expect(Object.keys(audits[0].detail as object).sort()).toEqual(AUDIT_DETAIL_KEYS);
    expect(JSON.stringify(audits[0])).not.toContain("secret");
    expect(attached).toHaveLength(1);
  });

  it("gives every invocation its own id", async () => {
    const { build, records } = world();
    const dispatcher = build();

    await dispatcher.dispatch(slackInput("status"));
    await dispatcher.dispatch(slackInput("status"));

    expect(new Set(records.map((record) => record.id)).size).toBe(2);
  });

  it("names no channel row for a DM or a channel the app has not joined, and keeps the platform's id", async () => {
    const { build, records, audits } = world();

    await build().dispatch(
      slackInput("status", { slack: { teamId: TEAM, userId: SLACK_MAYA, channelId: "D0DM" } }),
    );

    expect(records[0].channelId).toBeNull();
    expect(audits[0]).toMatchObject({ detail: { channelId: null, platformChannelId: "D0DM" } });
  });

  it("looks no channel up when the surface named none", async () => {
    const { build, records, commands } = world();

    await build().dispatch(
      slackInput("status", { slack: { teamId: TEAM, userId: SLACK_MAYA, channelId: null } }),
    );

    expect(commands.joinedChannel).not.toHaveBeenCalled();
    expect(records[0].channelId).toBeNull();
  });

  it("writes nothing for help — the list, one command, or a bare /ouro — and answers anybody", async () => {
    const { build, records, audits, slack, runs } = world({ link: undefined });
    const dispatcher = build();

    const results = await Promise.all(
      ["", "   ", "help", "HELP queue", "help frobnicate"].map((text) =>
        dispatcher.dispatch(slackInput(text)),
      ),
    );

    expect(results.map((result) => [result.outcome, result.commandId])).toEqual(
      Array.from({ length: 5 }, () => ["ok", null]),
    );
    expect(results.map((result) => result.reply.text)).toEqual([
      helpText(GRAMMAR, "slack"),
      helpText(GRAMMAR, "slack"),
      helpText(GRAMMAR, "slack"),
      help(GRAMMAR, "slack", ["queue"]),
      help(GRAMMAR, "slack", ["frobnicate"]),
    ]);
    expect(records).toEqual([]);
    expect(audits).toEqual([]);
    // Nobody's identity was looked up, and nothing ran.
    expect(slack.liveLink).not.toHaveBeenCalled();

    for (const run of runs.values()) {
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("lists every command of the grammar in help, generated from the registry", async () => {
    const result = await world().build().dispatch(slackInput("help"));

    for (const definition of GRAMMAR.commands) {
      expect(result.reply.text).toContain(`\`${syntaxOf(definition)}\` — ${definition.summary}`);
    }
  });

  it("writes nothing for a Slack workspace with no connection, and says so — help included", async () => {
    const { build, records, audits, slack, run } = world({ connection: undefined });
    const dispatcher = build();

    for (const text of ["status", "help", "pause all confirm"]) {
      expect(await dispatcher.dispatch(slackInput(text))).toEqual({
        outcome: "error",
        reply: { text: CHAT_REPLIES.notConnected },
        commandId: null,
        command: null,
      });
    }

    expect(slack.activeByWorkspace).toHaveBeenCalledWith(TEAM);
    expect(slack.liveLink).not.toHaveBeenCalled();
    expect(records).toEqual([]);
    expect(audits).toEqual([]);
    expect(run("pause all")).not.toHaveBeenCalled();
  });

  it("still says what truthfully happened when the row cannot be written, with no command id", async () => {
    const { build, records, audits, run } = world({ recordFails: true });

    const result = await build().dispatch(slackInput("queue #485"));

    // The command ran: saying "nothing was changed" would be a lie.
    expect(run("queue")).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      outcome: "ok",
      reply: { text: "ran queue" },
      commandId: null,
      command: "queue",
    });
    expect(records).toEqual([]);
    expect(audits).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("was not fully recorded"),
      expect.any(String),
    );
  });

  it("answers the same when only the audit event could not be written", async () => {
    const { build, records, attached } = world({ auditFails: true });

    const result = await build().dispatch(slackInput("status"));

    expect(result).toEqual({
      outcome: "ok",
      reply: { text: "ran status" },
      commandId: null,
      command: "status",
    });
    expect(records).toHaveLength(1);
    expect(attached).toEqual([]);
  });

  it("still tells a refused person why when the refusal cannot be recorded", async () => {
    const { build } = world({ recordFails: true, link: undefined });

    expect(await build().dispatch(slackInput("status"))).toEqual({
      outcome: "unlinked",
      reply: { text: CHAT_REPLIES.unlinked },
      commandId: null,
      command: "status",
    });
  });
});

describe("what a command said at once is recorded (#542)", () => {
  it.each([
    ["slack", (text: string) => slackInput(text)],
    ["console", (text: string) => consoleInput(text)],
  ] as const)("on %s, for every outcome that says something", async (_surface, input) => {
    const { build, records } = world();
    const dispatcher = build();

    // ok · bad arguments · unknown command · a destructive command's preview
    const results = [
      await dispatcher.dispatch(input("queue #485 standard-fix")),
      await dispatcher.dispatch(input("queue")),
      await dispatcher.dispatch(input("frobnicate")),
      await dispatcher.dispatch(input("pause all")),
    ];

    expect(results.map((result) => result.outcome)).toEqual(["ok", "error", "error", "error"]);
    // The row holds the very reply the surface was handed — no second wording.
    expect(records.map((record) => record.reply)).toEqual(results.map((result) => result.reply));
    expect(records.every((record) => (record.reply?.text ?? "") !== "")).toBe(true);
  });

  it("records the refusal a viewer is given, and the prompt somebody unlinked is given", async () => {
    const denied = world({ roles: ["viewer"] });
    const refused = await denied.build().dispatch(slackInput("pause all confirm"));
    const unlinked = world({ link: undefined });
    const prompted = await unlinked.build().dispatch(slackInput("status"));

    expect(refused.outcome).toBe("denied");
    expect(denied.records[0].reply).toEqual(refused.reply);
    expect(prompted.outcome).toBe("unlinked");
    expect(unlinked.records[0].reply).toEqual({ text: CHAT_REPLIES.unlinked });
  });

  it("records the channel a console command was typed under, and nothing else of Slack's", async () => {
    const { build, records, slack, commands } = world();

    await build().dispatch(
      consoleInput("status", {
        console: { organizationId: ORG, userId: MAYA, channelId: CHANNEL_ROW },
      }),
    );

    expect(records[0]).toMatchObject({
      surface: "console",
      channelId: CHANNEL_ROW,
      connectionId: null,
      invokerLinkId: null,
      platformUserId: null,
      // Nothing was posted to the channel: the mirror reads the reply off the row.
      withReplyMessage: false,
    });
    // The route has already checked the channel: the dispatcher looks nothing up.
    expect(slack.activeByWorkspace).not.toHaveBeenCalled();
    expect(commands.joinedChannel).not.toHaveBeenCalled();
  });

  it("records no channel for the palette's console command", async () => {
    const { build, records } = world();

    await build().dispatch(consoleInput("status"));

    expect(records[0].channelId).toBeNull();
  });
});

describe("when a binding fails", () => {
  /** A world whose `queue` binding rejects. */
  function failing(error: unknown) {
    return world({
      bindings: [
        {
          command: "queue",
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point of these specs is what the dispatcher does with whatever a plane throws, a non-Error included.
          run: () => Promise.reject(error),
        },
      ],
    });
  }

  it("relays a plane's refusal in the plane's words, and records its code", async () => {
    const { build, records, audits } = failing(
      new ConflictError("ticket_already_queued", "#485 is already in the queue."),
    );

    const result = await build().dispatch(slackInput("queue #485"));

    expect(result.outcome).toBe("error");
    expect(result.reply).toEqual({ text: "#485 is already in the queue." });
    expect(records[0]).toMatchObject({
      command: "queue",
      ended: { outcome: "error", detail: "ticket_already_queued" },
      withReplyMessage: false,
    });
    // A refusal names no arguments in the record: the binding did not finish.
    expect(audits[0]).toMatchObject({ detail: { outcome: "error" } });
    // A refusal is not a fault.
    expect(errors).not.toHaveBeenCalled();
  });

  it("says only the fallback for a plane's 5xx, never its text, and records its code", async () => {
    const { build, records } = failing(
      new UpstreamError("engine_unreachable", "connect ECONNREFUSED engine.internal:8080"),
    );

    const result = await build().dispatch(slackInput("queue #485"));

    expect(result.outcome).toBe("error");
    expect(result.reply).toEqual({ text: CHAT_REPLIES.failed });
    expect(result.reply.text).not.toContain("ECONNREFUSED");
    expect(records[0].ended).toEqual({ outcome: "error", detail: "engine_unreachable" });
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an Error", new Error("duplicate key value violates unique constraint runs_pkey")],
    ["a TypeError", new TypeError("Cannot read properties of undefined (reading 'runs_pkey')")],
    ["something that is not an error", "runs_pkey"],
  ])("says only the fallback for %s, and records internal_error", async (_what, error) => {
    const { build, records } = failing(error);

    const result = await build().dispatch(slackInput("queue #485"));

    expect(result.outcome).toBe("error");
    expect(result.reply).toEqual({ text: CHAT_REPLIES.failed });
    expect(JSON.stringify(result)).not.toContain("runs_pkey");
    expect(records[0].ended).toEqual({ outcome: "error", detail: "internal_error" });
    expect(JSON.stringify(records[0].ended)).not.toContain("runs_pkey");
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("reads a binding's own ChatArgumentError as a bad argument", async () => {
    const { build, records } = failing(
      new ChatArgumentError("ticket", "ticket #485 is closed", ["#486"]),
    );

    const result = await build().dispatch(slackInput("queue #485"));

    expect(result.reply).toEqual({ text: "ticket #485 is closed — try: #486" });
    expect(records[0].ended).toEqual({ outcome: "error", detail: "bad_arguments" });
  });

  it("treats a resolver that fails — rather than refuses — as a fault of the service", async () => {
    const scene = world();
    const dispatcher = new ChatDispatcher(
      GRAMMAR,
      [...scene.runs].map(([command, run]) => ({ command, run })),
      { resolve: () => Promise.reject(new Error("github_issues is unreachable")) },
      scene.slack as unknown as SlackRepository,
      scene.commands as unknown as ChatopsRepository,
      { rolesFor: () => Promise.resolve(["owner"]) } as unknown as OrganizationRepository,
      { explicitFor: () => Promise.resolve(null) } as unknown as CapabilityRepository,
      { record: () => Promise.resolve(AUDIT_EVENT) } as unknown as AuditService,
      { uiUrl: "https://app.example.test" } as unknown as AppConfigService,
    );

    const result = await dispatcher.dispatch(slackInput("queue #485"));

    expect(result).toMatchObject({ outcome: "error", reply: { text: CHAT_REPLIES.failed } });
    expect(scene.records[0].ended).toEqual({ outcome: "error", detail: "internal_error" });
    expect(scene.run("queue")).not.toHaveBeenCalled();
  });
});

describe("text that names no command", () => {
  it("is answered with the nearest names, recorded unknown_command under its first word", async () => {
    const { build, records, audits, runs } = world();

    const result = await build().dispatch(slackInput("pause lop 1847"));

    expect(result.outcome).toBe("error");
    expect(result.reply).toEqual({
      text: failureText(unknownCommand(GRAMMAR, ["pause", "lop", "1847"])),
    });
    expect(result.reply.text).toContain("pause loop");
    expect(records[0]).toMatchObject({
      command: "pause",
      args: {},
      rawText: "/ouro pause lop 1847",
      ended: { outcome: "error", detail: "unknown_command" },
      withReplyMessage: false,
    });
    expect(audits[0]).toMatchObject({ detail: { command: "pause", outcome: "error" } });

    for (const run of runs.values()) {
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("points at help when nothing is near", async () => {
    const result = await world().build().dispatch(slackInput("xyzzy"));

    expect(result.reply.text).toBe('unknown command "xyzzy" — `/ouro help` lists the commands');
  });

  it.each([
    ["<!channel> *look*", "unknown"],
    ["485", "unknown"],
    [`${"a".repeat(65)} now`, "unknown"],
    ["Deploy-2 now", "deploy-2"],
  ])("records %p under a command name the column accepts: %p", async (text, command) => {
    const { build, records } = world();

    const result = await build().dispatch(slackInput(text));

    expect(records[0].command).toBe(command);
    expect(records[0].ended).toEqual({ outcome: "error", detail: "unknown_command" });
    // What was typed is kept in the row, and not said back as markup.
    expect(records[0].rawText).toBe(`/ouro ${text}`);
    expect(result.reply.text).not.toContain("<!channel>");
  });
});

describe("the console (#539)", () => {
  it("runs a command as the session's person, through the same binding, with no Slack lookup at all", async () => {
    const { build, records, audits, attached, memberships, slack, commands, run } = world({
      // Slack is not installed here at all: the console does not need it.
      connection: undefined,
      link: undefined,
    });

    const result = await build().dispatch(consoleInput("queue #485 standard-fix"));

    expect(result).toEqual({
      outcome: "ok",
      reply: { text: "ran queue" },
      commandId: records[0].id,
      command: "queue",
    });
    expect(run("queue")).toHaveBeenCalledTimes(1);
    expect(run("queue").mock.calls[0][0]).toMatchObject({
      organizationId: ORG,
      surface: "console",
      invoker: { userId: MAYA, name: "Maya Chen", roles: ["owner"], canApproveLoops: null },
      appUrl: "https://app.example.test",
    });
    // Who they are is the session: the membership is read for it, and nothing of Slack's is.
    expect(memberships).toEqual([{ organizationId: ORG, userId: MAYA }]);
    expect(slack.activeByWorkspace).not.toHaveBeenCalled();
    expect(slack.liveLink).not.toHaveBeenCalled();
    expect(commands.joinedChannel).not.toHaveBeenCalled();

    expect(records).toEqual([
      {
        id: result.commandId,
        organizationId: ORG,
        surface: "console",
        connectionId: null,
        channelId: null,
        invokerLinkId: null,
        platformUserId: null,
        invokerUserId: MAYA,
        command: "queue",
        args: { ticket: "acme/helios#485", workflow: "standard-fix" },
        rawText: "/ouro queue #485 standard-fix",
        ended: { outcome: "ok" },
        reply: { text: "ran queue" },
        ref: { made: "queue" },
        invokedAt: expect.any(Date) as Date,
        completedAt: expect.any(Date) as Date,
        // There is no channel for the reply to be a message of.
        withReplyMessage: false,
      },
    ]);
    expect(audits).toEqual([
      {
        organizationId: ORG,
        actorId: MAYA,
        action: "chat.command_invoked",
        subjectType: "chat_command",
        subjectId: result.commandId,
        at: records[0].completedAt,
        detail: {
          surface: "console",
          command: "queue",
          outcome: "ok",
          grammarVersion: GRAMMAR_VERSION,
        },
      },
    ]);
    expect(Object.keys(audits[0].detail as object).sort()).toEqual(CONSOLE_AUDIT_DETAIL_KEYS);
    expect(JSON.stringify(audits[0])).not.toContain("#485");
    expect(attached).toEqual([{ commandId: result.commandId, auditEventId: AUDIT_EVENT }]);
  });

  it.each(GRAMMAR.commands.map((definition) => [definition.id, definition] as const))(
    "/ouro %s is recorded on the console surface, with no reply message",
    async (id, definition) => {
      const { build, records, audits } = world();

      const result = await build().dispatch(consoleInput(typed(definition).text));

      expect(result).toMatchObject({ outcome: "ok", command: id });
      expect(records[0]).toMatchObject({
        surface: "console",
        connectionId: null,
        channelId: null,
        invokerLinkId: null,
        platformUserId: null,
        invokerUserId: MAYA,
        command: id,
        withReplyMessage: false,
      });
      expect(audits[0]).toMatchObject({ actorId: MAYA, detail: { surface: "console" } });
    },
  );

  it("has no unlinked outcome: somebody with no Slack link at all runs commands", async () => {
    const { build, records } = world({ link: undefined });

    const result = await build().dispatch(consoleInput("status"));

    expect(result.outcome).toBe("ok");
    expect(records[0].ended).toEqual({ outcome: "ok" });
  });

  it("refuses somebody who is not a member of the workspace as Slack refuses one, and records it", async () => {
    const { build, records, audits, runs } = world({ roles: undefined });

    const result = await build().dispatch(consoleInput("pause all confirm"));

    expect(result).toEqual({
      outcome: "denied",
      reply: { text: CHAT_REPLIES.notAMember },
      commandId: records[0].id,
      command: "pause all",
    });
    expect(records[0]).toMatchObject({
      surface: "console",
      invokerUserId: MAYA,
      ended: { outcome: "denied" },
      withReplyMessage: false,
    });
    expect(audits[0]).toMatchObject({ actorId: MAYA, detail: { outcome: "denied" } });

    for (const run of runs.values()) {
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("denies a command the session's roles do not carry, in the words Slack uses", async () => {
    const { build, records, run } = world({ roles: ["viewer"] });

    const result = await build().dispatch(consoleInput("route implement claude-fable-5"));

    expect(result).toMatchObject({
      outcome: "denied",
      reply: { text: "`/ouro route` is for workspace owners and admins." },
      command: "route",
    });
    expect(run("route")).not.toHaveBeenCalled();
    expect(records[0]).toMatchObject({ surface: "console", ended: { outcome: "denied" } });
  });

  it.each([
    [
      "abort loop 1847",
      "abort loop",
      "Add `confirm` to abort — this stops loop 1847 for good and closes its run as canceled. Its branch is kept; nothing is reverted or deleted. `/ouro abort loop 1847 confirm`",
    ],
    [
      "pause all",
      "pause all",
      "Add `confirm` to pause everything — this stops every loop in Acme Robotics from starting anything new. Stages already running finish, and queued work stays queued until an owner or admin resumes the workspace. `/ouro pause all confirm`",
    ],
  ])(
    "follows the confirm rule: %s describes, and runs only with confirm",
    async (text, id, said) => {
      const { build, records, run } = world();
      const dispatcher = build();

      const first = await dispatcher.dispatch(consoleInput(text));

      expect(first).toEqual({
        outcome: "error",
        reply: { text: said },
        commandId: records[0].id,
        command: id,
        confirmWith: `${text} confirm`,
      });
      expect(records[0].ended).toEqual({ outcome: "error", detail: "confirmation_required" });
      expect(run(id)).not.toHaveBeenCalled();

      const second = await dispatcher.dispatch(consoleInput(first.confirmWith ?? ""));

      expect(second).toMatchObject({ outcome: "ok", reply: { text: `ran ${id}` } });
      expect(second).not.toHaveProperty("confirmWith");
      expect(run(id)).toHaveBeenCalledTimes(1);
    },
  );

  it("answers explain pr with its v2 text, exactly as Slack does", async () => {
    const { build, records, runs } = world({ roles: ["viewer"] });

    const result = await build().dispatch(consoleInput("explain pr 514"));

    expect(result).toMatchObject({
      outcome: "ok",
      reply: {
        text: "Plain-language PR summaries arrive with AI presence (CB.1, #546). `/ouro explain pr` is listed so you know it is coming; it does not summarise anything yet.",
      },
      command: "explain pr",
    });
    expect(records[0]).toMatchObject({ surface: "console", args: { pr: 514 } });

    for (const run of runs.values()) {
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("answers help from the grammar, listing only what the console has, and writes nothing", async () => {
    const { build, records, audits, memberships } = world();
    const dispatcher = build();

    const list = await dispatcher.dispatch(consoleInput("help"));
    const bare = await dispatcher.dispatch(consoleInput(""));
    const one = await dispatcher.dispatch(consoleInput("help abort loop"));

    expect(list).toEqual({
      outcome: "ok",
      reply: { text: helpText(GRAMMAR, "console") },
      commandId: null,
      command: null,
    });
    expect(bare).toEqual(list);
    expect(one.reply.text).toBe(help(GRAMMAR, "slack", ["abort", "loop"]));
    // `link` and `unlink` are Slack's: the console has no linking step to offer.
    expect(list.reply.text).not.toContain("/ouro link");
    expect(helpText(GRAMMAR, "slack")).toContain("/ouro link");
    expect(records).toEqual([]);
    expect(audits).toEqual([]);
    expect(memberships).toEqual([]);
  });

  it("records unknown text and bad arguments as Slack does", async () => {
    const { build, records } = world();
    const dispatcher = build();

    const unknown = await dispatcher.dispatch(consoleInput("statsu"));
    const bad = await dispatcher.dispatch(consoleInput("queue"));

    expect(unknown).toMatchObject({ outcome: "error", command: null });
    expect(unknown.reply.text).toBe(failureText(unknownCommand(GRAMMAR, ["statsu"])));
    expect(bad).toMatchObject({ outcome: "error", command: "queue" });
    expect(records.map((record) => [record.surface, record.command, record.ended])).toEqual([
      ["console", "statsu", { outcome: "error", detail: "unknown_command" }],
      ["console", "queue", { outcome: "error", detail: "bad_arguments" }],
    ]);
  });

  it("keeps an async command's result on the row, having nowhere to post it", async () => {
    const result = deferred<CommandReply>();
    const said = {
      text: "Dry run of #486 finished: no writes.",
      link: { label: "Open the dry run", url: "https://app.example.test/dry-runs/dr-1" },
    };
    const { build, records, settles, order } = world({
      bindings: [
        {
          command: "dry-run",
          run: () =>
            Promise.resolve({
              kind: "started",
              reply: { text: "Rehearsing #486 — the result follows here." },
              result: result.promise,
            }),
        },
      ],
    });
    const dispatcher = build();

    const dispatched = await dispatcher.dispatch(consoleInput("dry-run #486"));

    expect(dispatched).toMatchObject({ outcome: "async_pending", command: "dry-run" });
    expect(records[0]).toMatchObject({
      surface: "console",
      ended: { outcome: "async_pending" },
      withReplyMessage: false,
    });
    expect(settles).toEqual([]);

    result.resolve(said);
    await dispatcher.idle();

    expect(settles).toEqual([
      {
        id: dispatched.commandId,
        ended: { outcome: "ok" },
        at: expect.any(Date) as Date,
        reply: said,
      },
    ]);
    expect(order).toEqual(["record", "audit", "settle"]);
  });

  it("keeps an async command's failure on the row too, in the words Slack would have posted", async () => {
    const result = deferred<CommandReply>();
    const { build, settles } = world({
      bindings: [
        {
          command: "dry-run",
          run: () =>
            Promise.resolve({
              kind: "started",
              reply: { text: "Rehearsing." },
              result: result.promise,
            }),
        },
      ],
    });
    const dispatcher = build();

    await dispatcher.dispatch(consoleInput("dry-run #486"));
    result.reject(new ConflictError("dry_run_harness_failed", "The harness stopped at build."));
    await dispatcher.idle();

    expect(settles.map(({ ended, reply }) => ({ ended, reply }))).toEqual([
      {
        ended: { outcome: "error", detail: "dry_run_harness_failed" },
        reply: { text: "The harness stopped at build." },
      },
    ]);
  });

  it("keeps nothing for a result that said nothing: the column refuses empty text", async () => {
    const { build, settles } = world({
      bindings: [
        {
          command: "dry-run",
          run: () =>
            Promise.resolve({
              kind: "started",
              reply: { text: "Rehearsing." },
              result: Promise.resolve({ text: "" }),
            }),
        },
      ],
    });
    const dispatcher = build();

    await dispatcher.dispatch(consoleInput("dry-run #486"));
    await dispatcher.idle();

    expect(settles.map((settled) => settled.reply)).toEqual([null]);
  });

  it("still says what happened when the row cannot be written, with no command id", async () => {
    const { build, run } = world({ recordFails: true });

    expect(await build().dispatch(consoleInput("status"))).toEqual({
      outcome: "ok",
      reply: { text: "ran status" },
      commandId: null,
      command: "status",
    });
    expect(run("status")).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});

describe("permitted", () => {
  const CAPABLE: CommandDefinition = {
    ...GRAMMAR.commands[0],
    id: "approve",
    requires: { roles: ["owner", "admin", "member"], capability: "can_approve_loops" },
  };

  it.each<[OrganizationRole, string[]]>([
    ["owner", GRAMMAR.commands.map((command) => command.id)],
    ["admin", GRAMMAR.commands.map((command) => command.id)],
    ["member", ["status", "queue", "answer", "dry-run", "explain pr", "estimate"]],
    ["viewer", ["status", "answer", "explain pr", "estimate"]],
  ])("lets a workspace %s run exactly the commands their role carries", (role, expected) => {
    expect(
      GRAMMAR.commands
        .filter((command) => permitted(command, { roles: [role], canApproveLoops: null }))
        .map((command) => command.id),
    ).toEqual(expected);
  });

  it("asks for the capability as well as the role, when a command names one", () => {
    expect(permitted(CAPABLE, { roles: ["member"], canApproveLoops: true })).toBe(true);
    expect(permitted(CAPABLE, { roles: ["member"], canApproveLoops: false })).toBe(false);
    // An explicit grant does not stand in for the role.
    expect(permitted(CAPABLE, { roles: ["viewer"], canApproveLoops: true })).toBe(false);
  });
});

describe("adding a command", () => {
  const PING: CommandDefinition = {
    id: "ping",
    aliases: ["pong"],
    summary: "check the loop is listening",
    usage: "ping 1847",
    arguments: [
      {
        name: "loop",
        type: "loop",
        optional: false,
        completion: "loops",
        description: "the loop's number",
      },
    ],
    requires: { roles: ["owner", "admin", "member"] },
    destructive: false,
    mode: "sync",
    stage: "available",
    binds: "a fixture",
  };

  it("is one registry entry and one binding: it dispatches, is recorded and is listed in help", async () => {
    const ping = jest.fn<Promise<BindingResult>, [CommandContext]>(() =>
      Promise.resolve(done({ text: "pong from loop 1847" })),
    );
    const { build, records, audits } = world({
      grammar: { ...GRAMMAR, commands: [...GRAMMAR.commands, PING] },
      bindings: [{ command: "ping", run: ping }],
    });
    const dispatcher = build();

    const result = await dispatcher.dispatch(slackInput("ping 1847"));

    expect(result).toMatchObject({ outcome: "ok", reply: { text: "pong from loop 1847" } });
    expect(ping).toHaveBeenCalledTimes(1);
    expect(ping.mock.calls[0][0].args).toEqual({ loop: SAMPLES.loop.resolved });
    expect(records[0]).toMatchObject({
      command: "ping",
      args: { loop: 1847 },
      ended: { outcome: "ok" },
    });
    expect(audits[0]).toMatchObject({ detail: { command: "ping", outcome: "ok" } });

    // Its alias, its role check and its syntax errors come with the entry.
    expect((await dispatcher.dispatch(slackInput("pong 1847"))).outcome).toBe("ok");
    expect((await dispatcher.dispatch(slackInput("ping"))).reply.text).toBe(
      "`/ouro ping` needs a loop — usage: `/ouro ping <loop>`",
    );

    const list = await dispatcher.dispatch(slackInput("help"));
    const detail = await dispatcher.dispatch(slackInput("help ping"));

    expect(list.reply.text).toContain("`/ouro ping <loop>` — check the loop is listening");
    expect(detail.reply.text).toContain("Who: workspace owners, admins and members.");
    expect(detail.reply.text).toContain("Also typed as: `/ouro pong`");
  });

  it("is unknown to a dispatcher built over the grammar without it", async () => {
    const result = await world().build().dispatch(slackInput("ping 1847"));

    expect(result.outcome).toBe("error");
    expect(result.reply.text).toContain('unknown command "ping"');
    expect((await world().build().dispatch(slackInput("help"))).reply.text).not.toContain(
      "/ouro ping",
    );
  });
});

describe("starting", () => {
  it("starts over the real grammar with one binding per available command", () => {
    expect(() => world().build()).not.toThrow();
  });

  it("refuses a binding for a command the grammar does not define", () => {
    const { build } = world({
      bindings: [{ command: "self-destruct", run: () => Promise.resolve(ran("self-destruct")) }],
    });

    expect(build).toThrow(
      'The /ouro grammar cannot be dispatched: a binding exists for "self-destruct", which the grammar does not define.',
    );
  });

  it("refuses an available command that has no binding", () => {
    const orphan: CommandDefinition = {
      id: "orphan",
      aliases: [],
      summary: "listed, and cannot run",
      usage: "orphan",
      arguments: [],
      requires: { roles: [] },
      destructive: false,
      mode: "sync",
      stage: "available",
      binds: "nothing",
    };
    const scene = world();

    expect(
      () =>
        new ChatDispatcher(
          withCommands(GRAMMAR, orphan),
          [...scene.runs].map(([command, run]) => ({ command, run })),
          { resolve: () => Promise.resolve(SAMPLES.pr.resolved) },
          scene.slack as unknown as SlackRepository,
          scene.commands as unknown as ChatopsRepository,
          {} as OrganizationRepository,
          {} as CapabilityRepository,
          {} as AuditService,
          {} as AppConfigService,
        ),
    ).toThrow('"orphan" is available and has no binding');
  });

  it.each(GRAMMAR.commands.filter((command) => command.stage === "available"))(
    "refuses to start without the binding of $id",
    (definition) => {
      const scene = world();

      expect(
        () =>
          new ChatDispatcher(
            GRAMMAR,
            [...scene.runs]
              .filter(([command]) => command !== definition.id)
              .map(([command, run]) => ({ command, run })),
            { resolve: () => Promise.resolve(SAMPLES.pr.resolved) },
            scene.slack as unknown as SlackRepository,
            scene.commands as unknown as ChatopsRepository,
            {} as OrganizationRepository,
            {} as CapabilityRepository,
            {} as AuditService,
            {} as AppConfigService,
          ),
      ).toThrow(`"${definition.id}" is available and has no binding`);
    },
  );

  it("refuses a binding for a command that is not available yet", () => {
    const { build } = world({
      bindings: [{ command: "explain pr", run: () => Promise.resolve(ran("explain pr")) }],
    });

    expect(build).toThrow('a binding exists for "explain pr", which is not available yet');
  });

  it("refuses two bindings for one command", () => {
    const scene = world();
    const bindings = [...scene.runs].map(([command, run]) => ({ command, run }));

    expect(
      () =>
        new ChatDispatcher(
          GRAMMAR,
          [...bindings, { command: "status", run: () => Promise.resolve(ran("status")) }],
          { resolve: () => Promise.resolve(SAMPLES.pr.resolved) },
          scene.slack as unknown as SlackRepository,
          scene.commands as unknown as ChatopsRepository,
          {} as OrganizationRepository,
          {} as CapabilityRepository,
          {} as AuditService,
          {} as AppConfigService,
        ),
    ).toThrow('"status" has 2 bindings');
  });

  it("refuses a grammar that breaks its own rules", () => {
    const { build } = world({
      grammar: withCommands(GRAMMAR, {
        id: "help me",
        aliases: [],
        summary: "shadows a built-in",
        usage: "help me",
        arguments: [],
        requires: { roles: [] },
        destructive: false,
        mode: "sync",
        stage: "v2",
        unavailableReply: "Not yet.",
        binds: "nothing",
      }),
    });

    expect(build).toThrow('"help me" starts with a built-in\'s name');
  });
});

describe("failureOf", () => {
  const FALLBACK = "Something went wrong.";

  it("reads an argument error as bad arguments, with its suggestions", () => {
    expect(
      failureOf(new ChatArgumentError("workflow", 'unknown workflow "x"', ["hotfix"]), FALLBACK),
    ).toEqual({
      reply: { text: 'unknown workflow "x" — try: hotfix' },
      detail: "bad_arguments",
      fault: false,
    });
  });

  it("relays a 4xx plane error's message and code", () => {
    expect(
      failureOf(new ConflictError("run_not_pausable", "Loop 1847 is done."), FALLBACK),
    ).toEqual({ reply: { text: "Loop 1847 is done." }, detail: "run_not_pausable", fault: false });
  });

  it("keeps a 5xx plane error's code and hides its message", () => {
    expect(
      failureOf(new UpstreamError("engine_unreachable", "10.0.3.7 refused"), FALLBACK),
    ).toEqual({ reply: { text: FALLBACK }, detail: "engine_unreachable", fault: true });
  });

  it.each([[new Error("secret")], ["secret"], [undefined], [{ message: "secret" }]])(
    "says the fallback for anything else: %p",
    (error) => {
      expect(failureOf(error, FALLBACK)).toEqual({
        reply: { text: FALLBACK },
        detail: "internal_error",
        fault: true,
      });
    },
  );
});

describe("recordedArgument", () => {
  it.each<[ResolvedArgument, string | number | boolean]>([
    [SAMPLES.ticket.resolved, "acme/helios#485"],
    [SAMPLES.loop.resolved, 1847],
    [SAMPLES.workflow.resolved, "standard-fix"],
    [SAMPLES.alias.resolved, "claude-fable-5"],
    [SAMPLES.task_kind.resolved, "implement"],
    [SAMPLES.question.resolved, "q-231"],
    [SAMPLES.action.resolved, "allow_once"],
    [SAMPLES.pr.resolved, 514],
    [{ type: "keyword", word: "all" }, "all"],
    [{ type: "confirm" }, true],
  ])("records %j as %p", (argument, recorded) => {
    expect(recordedArgument(argument)).toBe(recorded);
  });

  it("has a recorded form for every argument type", () => {
    for (const { resolved } of Object.values(SAMPLES)) {
      expect(["string", "number", "boolean"]).toContain(typeof recordedArgument(resolved));
    }
  });
});
