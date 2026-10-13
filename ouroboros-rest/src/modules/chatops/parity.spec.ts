import { Logger } from "@nestjs/common";

import type { AuditService } from "../audit/audit.service";
import type { AppConfigService } from "../config/config.service";
import type { ChatConnectionPublic, ChatIdentityLink } from "../db/schema";
import { ConflictError, UpstreamError } from "../errors/error.envelope";
import type { SlackRepository } from "../slack/slack.repository";
import type { CapabilityRepository } from "../tenancy/capability.repository";
import type { OrganizationRepository } from "../tenancy/organization.repository";
import { CHAT_REPLIES } from "./chatops.replies";
import type { ChatopsRepository, CommandRecord, RecordedOutcome } from "./chatops.repository";
import { ChatDispatcher, DISPATCH_ERRORS, recordedArgument } from "./dispatcher.service";
import { ChatArgumentError, type ArgumentResolvers } from "./grammar.ports";
import { BUILTINS, COMMAND_PREFIX, GRAMMAR, GRAMMAR_VERSION } from "./grammar.registry";
import type {
  BindingResult,
  CommandBinding,
  CommandContext,
  CommandReply,
  DispatchInput,
  DispatchResult,
  ResolvedArgument,
} from "./grammar.types";
import { PARITY_CORPUS, PARITY_PLANE, type ParityInvocation } from "./parity.fixture";
import { APP_URL, INVOKER, LOOP, TICKET, WORKSPACE } from "./planes/planes.fixture";

/**
 * Parity (#539): *"Identical in Slack, Teams, and the in-app console"*, as a test.
 *
 * Every invocation of the corpus (`parity.fixture.ts`) is dispatched twice over the same doubles
 * — once as a Slack user linked to a person, once as that person's console session — and the two
 * are held to the same ending:
 *
 * ```
 * outcome · reply text and link · matched command · confirmWith      what is said back
 * the recorded command                                               chat_commands
 * what an async command finally said                                 chat_commands.settled_reply
 * the audit event                                                    chat.command_invoked
 * what the binding was handed                                        the plane's view of it
 * ```
 *
 * What may differ is listed once, below, and is only *where the command came from*:
 * {@link SURFACE_COLUMNS} on the row and {@link SLACK_PROVENANCE} on the event — plus ids and
 * times, which are per invocation. Anything else that differs fails here.
 *
 * The planes are doubles and the grammar is the real one, so this is the dispatcher's claim, not
 * the bindings': a binding is the same object on both surfaces by construction, and is asserted
 * to have been handed the same context.
 */

/** The Slack side of the same person. */
const TEAM = "T024AB";
const SLACK_USER = "U07MIRA";
const CHANNEL = "C071LOOPS";
const CHANNEL_ROW = "chan-loops";

const CONNECTION = {
  id: "conn-1",
  organization_id: WORKSPACE,
  workspace_id: TEAM,
  status: "active",
} as ChatConnectionPublic;

const LINK = {
  id: "link-mira",
  connection_id: CONNECTION.id,
  platform_user_id: SLACK_USER,
  state: "linked",
  user_id: INVOKER.userId,
} as ChatIdentityLink;

/** The record's keys that say where a command came from — the only ones that may differ. */
const SURFACE_COLUMNS = [
  "surface",
  "connectionId",
  "channelId",
  "platformUserId",
  "invokerLinkId",
  // Whether the reply is also a message of a channel: the console has no channel.
  "withReplyMessage",
] as const;

/** The audit detail's keys that are Slack's own provenance, beside `surface`. */
const SLACK_PROVENANCE = ["connectionId", "channelId", "platformChannelId", "platformUserId"];

/** What an async binding says at once, and what it says when it finishes. */
const ACK: CommandReply = { text: "Rehearsing with no writes — the result follows." };
const RESULT: CommandReply = {
  text: "Dry run passed in 41s — no writes, guards clean.",
  link: { label: "Open in Copilot", url: `${APP_URL}/copilot/standard-fix` },
};

/**
 * Turn typed text into what it names — the same answer whoever asks, as a plane's lookup is.
 *
 * @param spec - The argument being read.
 * @param raw - What was typed for it.
 * @returns The resolved argument.
 * @throws {ChatArgumentError} When the text names nothing.
 */
const resolve: ArgumentResolvers["resolve"] = (_organizationId, spec, raw) => {
  const digits = /^#?(\d+)$/.exec(raw)?.[1];
  const nothing = (suggestions: string[] = []): Promise<ResolvedArgument> =>
    Promise.reject(new ChatArgumentError(spec.name, `unknown ${spec.name} "${raw}"`, suggestions));

  switch (spec.type) {
    case "ticket":
      return digits === undefined
        ? nothing(["#485", "#486"])
        : Promise.resolve({
            ...TICKET,
            number: Number(digits),
            issueId: `issue-${digits}`,
            ticketId: `ticket-${digits}`,
          });
    case "loop":
      return digits === undefined
        ? nothing()
        : Promise.resolve({ ...LOOP, runId: `run-${digits}`, loopSeq: Number(digits) });
    case "workflow":
      return raw === "standard-fix"
        ? Promise.resolve({ type: "workflow", slug: raw })
        : nothing(["standard-fix"]);
    case "pr":
      return digits === undefined
        ? nothing()
        : Promise.resolve({ type: "pr", number: Number(digits) });
    case "question":
      return Promise.resolve({ type: "question", itemId: `item-${raw}`, shortId: raw });
    case "action":
      return Promise.resolve({ type: "action", actionId: raw });
    case "alias":
      return Promise.resolve({ type: "alias", alias: raw });
    case "task_kind":
      return Promise.resolve({ type: "task_kind", name: raw });
    case "keyword":
    case "confirm":
      // The parser settles these itself; reaching here is a bug in it.
      throw new Error(`the resolver was asked about a ${spec.type}`);
  }
};

/** Everything one dispatch wrote and said. */
interface Run {
  readonly result: DispatchResult;
  readonly records: CommandRecord[];
  readonly settles: { id: string; ended: RecordedOutcome; reply: CommandReply | null }[];
  readonly audits: Record<string, unknown>[];
  readonly attached: { commandId: string; auditEventId: string }[];
  readonly contexts: CommandContext[];
  readonly followUps: CommandReply[];
  /** Whether anything of Slack's — the connection, a link, a channel — was looked up. */
  readonly slackReads: number;
}

/**
 * Dispatch one invocation on one surface, over fresh doubles, through to any late result.
 *
 * @param invocation - The invocation.
 * @param surface - Where it is typed.
 * @returns What was said and written.
 */
async function dispatched(
  invocation: ParityInvocation,
  surface: "slack" | "console",
): Promise<Run> {
  const records: CommandRecord[] = [];
  const settles: Run["settles"] = [];
  const audits: Record<string, unknown>[] = [];
  const attached: Run["attached"] = [];
  const contexts: CommandContext[] = [];
  const followUps: CommandReply[] = [];
  let slackReads = 0;

  /** What a plane does when its command is run — by the scene, never by the surface. */
  const answer = (command: string, context: CommandContext): Promise<BindingResult> => {
    contexts.push(context);

    if (invocation.scene === "plane_refuses") {
      return Promise.reject(
        new ConflictError(PARITY_PLANE.refusal.code, PARITY_PLANE.refusal.message),
      );
    }

    if (invocation.scene === "plane_faults") {
      return Promise.reject(new UpstreamError(PARITY_PLANE.fault.code, PARITY_PLANE.fault.message));
    }

    if (invocation.scene === "settles_ok" || invocation.scene === "settles_refused") {
      return Promise.resolve({
        kind: "started",
        reply: ACK,
        ref: { dryRun: "dr-1" },
        result:
          invocation.scene === "settles_ok"
            ? Promise.resolve(RESULT)
            : Promise.reject(
                new ConflictError(PARITY_PLANE.lateRefusal.code, PARITY_PLANE.lateRefusal.message),
              ),
      });
    }

    // A reply made of what the binding was handed, so a difference in the arguments shows in
    // the words — and a link, so the link is compared too.
    const named = Object.entries(context.args)
      .map(([name, argument]) => `${name}=${String(recordedArgument(argument))}`)
      .join(" ");

    return Promise.resolve({
      kind: "done",
      reply: {
        text: `${command} done for ${context.invoker.name}${named === "" ? "" : ` (${named})`}.`,
        link: { label: `Open ${command}`, url: `${context.appUrl}/made/${command}` },
      },
      ref: { made: command },
    });
  };

  const bindings: CommandBinding[] = GRAMMAR.commands
    .filter((definition) => definition.stage === "available")
    .map((definition) => ({
      command: definition.id,
      run: (context) => answer(definition.id, context),
    }));

  const dispatcher = new ChatDispatcher(
    GRAMMAR,
    bindings,
    { resolve },
    {
      activeByWorkspace: (teamId: string) => {
        slackReads += 1;

        return Promise.resolve(teamId === TEAM ? CONNECTION : undefined);
      },
      liveLink: (connectionId: string, userId: string) => {
        slackReads += 1;

        return Promise.resolve(
          connectionId === CONNECTION.id && userId === SLACK_USER ? LINK : undefined,
        );
      },
    } as unknown as SlackRepository,
    {
      joinedChannel: (_connectionId: string, platformChannelId: string) => {
        slackReads += 1;

        return Promise.resolve(platformChannelId === CHANNEL ? CHANNEL_ROW : undefined);
      },
      userName: () => Promise.resolve(INVOKER.name),
      workspaceName: () => Promise.resolve("Acme Robotics"),
      record: (command: CommandRecord) => {
        records.push(command);

        return Promise.resolve({ id: command.id, messageId: null });
      },
      settle: (id: string, ended: RecordedOutcome, _at: Date, reply: CommandReply | null) => {
        settles.push({ id, ended, reply });

        return Promise.resolve(true);
      },
      attachAudit: (commandId: string, auditEventId: string) => {
        attached.push({ commandId, auditEventId });

        return Promise.resolve();
      },
    } as unknown as ChatopsRepository,
    {
      rolesFor: (organizationId: string, userId: string) =>
        Promise.resolve(
          invocation.scene === "not_a_member" ||
            organizationId !== WORKSPACE ||
            userId !== INVOKER.userId
            ? undefined
            : [invocation.as],
        ),
    } as unknown as OrganizationRepository,
    { explicitFor: () => Promise.resolve(null) } as unknown as CapabilityRepository,
    {
      record: (event: Record<string, unknown>) => {
        audits.push(event);

        return Promise.resolve(`audit-${String(audits.length)}`);
      },
    } as unknown as AuditService,
    { uiUrl: APP_URL } as unknown as AppConfigService,
  );

  const input: DispatchInput =
    surface === "slack"
      ? {
          surface,
          text: invocation.text,
          slack: { teamId: TEAM, userId: SLACK_USER, channelId: CHANNEL },
          // Slack's own way of being told a late result; the console has none.
          followUp: (reply) => {
            followUps.push(reply);

            return Promise.resolve();
          },
        }
      : {
          surface,
          text: invocation.text,
          console: { organizationId: WORKSPACE, userId: INVOKER.userId },
        };

  const result = await dispatcher.dispatch(input);

  await dispatcher.idle();

  return { result, records, settles, audits, attached, contexts, followUps, slackReads };
}

/**
 * An object without some of its keys.
 *
 * @param value - The object.
 * @param keys - The keys to leave out.
 * @returns The rest.
 */
function without(value: object, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/**
 * A recorded command with everything that is per-surface or per-invocation taken out.
 *
 * @param record - The record.
 * @returns What must be the same on both surfaces.
 */
function comparableRecord(record: CommandRecord): Record<string, unknown> {
  return without(record, [...SURFACE_COLUMNS, "id", "invokedAt", "completedAt"]);
}

/**
 * An audit event with everything that is per-surface or per-invocation taken out.
 *
 * @param event - The event.
 * @returns What must be the same on both surfaces.
 */
function comparableAudit(event: Record<string, unknown>): Record<string, unknown> {
  return {
    ...without(event, ["subjectId", "at"]),
    detail: without(event.detail as object, ["surface", ...SLACK_PROVENANCE]),
  };
}

/** The lines of Slack's help that name a built-in only Slack has. */
const SLACK_ONLY_HELP = BUILTINS.filter((builtin) => !builtin.surfaces.includes("console")).map(
  (builtin) => `\`${COMMAND_PREFIX} ${builtin.usage}\` — ${builtin.summary}`,
);

beforeEach(() => {
  // A plane's 5xx is logged as a fault on both surfaces; the log is not what is compared.
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

describe("parity: console ≡ Slack", () => {
  describe.each(PARITY_CORPUS.map((invocation) => [invocation.name, invocation] as const))(
    "%s",
    (_name, invocation) => {
      let slack: Run;
      let typedInConsole: Run;

      beforeEach(async () => {
        slack = await dispatched(invocation, "slack");
        typedInConsole = await dispatched(invocation, "console");
      });

      it("ends as the corpus says, on both surfaces", () => {
        for (const run of [slack, typedInConsole]) {
          expect(run.result.outcome).toBe(invocation.expect.outcome);
          expect(run.result.command).toBe(invocation.expect.command);
          expect(run.result.confirmWith).toBe(invocation.expect.confirmWith);
          expect(run.records).toHaveLength(invocation.expect.recorded ? 1 : 0);
          expect(run.audits).toHaveLength(invocation.expect.recorded ? 1 : 0);
          expect(run.result.commandId === null).toBe(!invocation.expect.recorded);
          expect(run.result.reply.text).not.toBe("");

          if (invocation.expect.recorded) {
            expect(run.records[0].id).toBe(run.result.commandId);
            expect(run.records[0].ended).toEqual(
              invocation.expect.errorDetail === undefined
                ? { outcome: invocation.expect.outcome }
                : { outcome: "error", detail: invocation.expect.errorDetail },
            );
            expect(run.audits[0].subjectId).toBe(run.result.commandId);
            expect(run.attached).toEqual([
              { commandId: run.result.commandId, auditEventId: "audit-1" },
            ]);
          }
        }
      });

      it("says the same thing back", () => {
        expect(typedInConsole.result.outcome).toBe(slack.result.outcome);
        expect(typedInConsole.result.command).toBe(slack.result.command);
        expect(typedInConsole.result.confirmWith).toBe(slack.result.confirmWith);
        expect(typedInConsole.result.reply.link).toEqual(slack.result.reply.link);

        if (invocation.differs === "slack_builtins") {
          // The one named difference: Slack's list also has Slack's own built-ins — and is
          // otherwise the console's list, line for line.
          const lines = slack.result.reply.text.split("\n");

          expect(lines).toEqual(expect.arrayContaining(SLACK_ONLY_HELP));
          expect(SLACK_ONLY_HELP).not.toEqual([]);
          expect(lines.filter((line) => !SLACK_ONLY_HELP.includes(line)).join("\n")).toBe(
            typedInConsole.result.reply.text,
          );
        } else {
          expect(typedInConsole.result.reply.text).toBe(slack.result.reply.text);
        }
      });

      it("records the same command, differing only in where it came from", () => {
        expect(typedInConsole.records.map(comparableRecord)).toEqual(
          slack.records.map(comparableRecord),
        );

        // And where it came from is exactly what each surface's row may hold (V136).
        for (const record of slack.records) {
          expect(record).toMatchObject({
            surface: "slack",
            connectionId: CONNECTION.id,
            channelId: CHANNEL_ROW,
            platformUserId: SLACK_USER,
            invokerLinkId: LINK.id,
            invokerUserId: INVOKER.userId,
          });
        }

        for (const record of typedInConsole.records) {
          expect(record).toMatchObject({
            surface: "console",
            connectionId: null,
            channelId: null,
            platformUserId: null,
            invokerLinkId: null,
            invokerUserId: INVOKER.userId,
            withReplyMessage: false,
          });
          expect(Object.keys(record).sort()).toEqual(Object.keys(slack.records[0]).sort());
        }
      });

      it("writes the same audit event, differing only in surface and Slack's provenance", () => {
        expect(typedInConsole.audits.map(comparableAudit)).toEqual(
          slack.audits.map(comparableAudit),
        );

        for (const event of slack.audits) {
          expect(event.detail).toMatchObject({
            surface: "slack",
            connectionId: CONNECTION.id,
            channelId: CHANNEL_ROW,
            platformChannelId: CHANNEL,
            platformUserId: SLACK_USER,
          });
        }

        for (const event of typedInConsole.audits) {
          expect(event).toMatchObject({
            organizationId: WORKSPACE,
            actorId: INVOKER.userId,
            action: "chat.command_invoked",
            subjectType: "chat_command",
          });
          expect(event.detail).toEqual({
            surface: "console",
            command: typedInConsole.records[0].command,
            outcome: invocation.expect.outcome,
            grammarVersion: GRAMMAR_VERSION,
          });
        }
      });

      it("hands the binding the same person, workspace and arguments", () => {
        expect(typedInConsole.contexts.map((context) => without(context, ["surface"]))).toEqual(
          slack.contexts.map((context) => without(context, ["surface"])),
        );
        expect(slack.contexts.map((context) => context.surface)).toEqual(
          slack.contexts.map(() => "slack"),
        );
        expect(typedInConsole.contexts.map((context) => context.surface)).toEqual(
          slack.contexts.map(() => "console"),
        );
      });

      it("keeps the same late result on the row", () => {
        const settled = (run: Run): unknown[] =>
          run.settles.map(({ ended, reply }) => ({ ended, reply }));

        expect(settled(typedInConsole)).toEqual(settled(slack));
        expect(settled(slack)).toHaveLength(invocation.expect.settles === undefined ? 0 : 1);

        if (invocation.expect.settles !== undefined) {
          const { outcome, errorDetail } = invocation.expect.settles;

          expect(slack.settles[0].ended).toEqual(
            errorDetail === undefined ? { outcome } : { outcome, detail: errorDetail },
          );
          expect(slack.settles[0].reply).toEqual(
            outcome === "ok" ? RESULT : { text: PARITY_PLANE.lateRefusal.message },
          );
          // Slack is also told through its response_url — the same words that were kept; the
          // console has nowhere to be told and reads the row.
          expect(slack.followUps).toEqual([slack.settles[0].reply]);
          expect(typedInConsole.followUps).toEqual([]);
          expect(typedInConsole.settles[0].id).toBe(typedInConsole.result.commandId);
        }
      });

      it("asks Slack nothing for the console", () => {
        expect(typedInConsole.slackReads).toBe(0);
        expect(slack.slackReads).toBeGreaterThan(0);
      });
    },
  );
});

describe("the corpus", () => {
  const ended = (invocation: ParityInvocation): string =>
    invocation.expect.errorDetail ?? invocation.expect.outcome;

  it("runs every available command at least once with valid arguments", () => {
    const ran = new Set(
      PARITY_CORPUS.filter(
        (invocation) =>
          invocation.scene !== "plane_refuses" &&
          invocation.scene !== "plane_faults" &&
          (invocation.expect.outcome === "ok" || invocation.expect.outcome === "async_pending"),
      ).map((invocation) => invocation.expect.command),
    );

    for (const definition of GRAMMAR.commands) {
      expect([definition.id, ran.has(definition.id)]).toEqual([definition.id, true]);
    }
  });

  it("types every destructive command without and with confirm", () => {
    for (const definition of GRAMMAR.commands.filter((command) => command.destructive)) {
      const of = PARITY_CORPUS.filter(
        (invocation) => invocation.expect.command === definition.id && invocation.as === "owner",
      );

      expect(of.map(ended)).toEqual(expect.arrayContaining(["confirmation_required", "ok"]));
    }
  });

  it("reaches every ending a console invocation can have", () => {
    const endings = new Set(PARITY_CORPUS.map(ended));

    // `unlinked` is Slack's alone — the one outcome with no console counterpart — and
    // `internal_error` is a plane fault's stand-in, covered by the fault's own code.
    expect([...endings].sort()).toEqual(
      [
        "ok",
        "async_pending",
        "denied",
        DISPATCH_ERRORS.unknownCommand,
        DISPATCH_ERRORS.badArguments,
        DISPATCH_ERRORS.confirmationRequired,
        PARITY_PLANE.refusal.code,
        PARITY_PLANE.fault.code,
      ].sort(),
    );
    expect(
      new Set(PARITY_CORPUS.flatMap((invocation) => invocation.expect.settles?.outcome ?? [])),
    ).toEqual(new Set(["ok", "error"]));
  });

  it("covers help, the v2 command, a low role and every scene", () => {
    expect(PARITY_CORPUS.some((invocation) => invocation.text === "help")).toBe(true);
    expect(PARITY_CORPUS.some((invocation) => /^help \S/i.test(invocation.text))).toBe(true);
    expect(
      PARITY_CORPUS.filter((invocation) => invocation.expect.command !== null).map(
        (invocation) => GRAMMAR.commands.find(({ id }) => id === invocation.expect.command)?.stage,
      ),
    ).toContain("v2");
    expect(new Set(PARITY_CORPUS.map((invocation) => invocation.as))).toEqual(
      new Set(["owner", "admin", "member", "viewer"]),
    );
    expect(new Set(PARITY_CORPUS.map((invocation) => invocation.scene))).toEqual(
      new Set([
        "runs",
        "plane_refuses",
        "plane_faults",
        "settles_ok",
        "settles_refused",
        "not_a_member",
      ]),
    );
  });

  it("names its invocations uniquely, and allows a difference only where one is declared", () => {
    expect(new Set(PARITY_CORPUS.map((invocation) => invocation.name)).size).toBe(
      PARITY_CORPUS.length,
    );
    expect(
      PARITY_CORPUS.filter((invocation) => invocation.differs !== undefined).map(
        (invocation) => invocation.text,
      ),
    ).toEqual(["help", ""]);
  });

  it("says the dispatcher's own fixed sentences where the corpus expects them", async () => {
    const gone = PARITY_CORPUS.find((invocation) => invocation.scene === "not_a_member");
    const faulted = PARITY_CORPUS.find((invocation) => invocation.scene === "plane_faults");
    const refused = PARITY_CORPUS.find((invocation) => invocation.scene === "plane_refuses");

    for (const [invocation, text] of [
      [gone, CHAT_REPLIES.notAMember],
      [faulted, CHAT_REPLIES.failed],
      [refused, PARITY_PLANE.refusal.message],
    ] as const) {
      expect(invocation).toBeDefined();

      if (invocation !== undefined) {
        expect((await dispatched(invocation, "console")).result.reply.text).toBe(text);
      }
    }
  });
});
