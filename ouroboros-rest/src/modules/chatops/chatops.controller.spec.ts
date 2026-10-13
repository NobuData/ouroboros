import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import type { Organization, OrganizationRole } from "../db/schema";
import { ForbiddenError, NotFoundError } from "../errors/error.envelope";
import type { CapabilityRepository } from "../tenancy/capability.repository";
import {
  runWithTenantContext,
  setTenantContext,
  type ActiveMembership,
} from "../tenancy/tenant.context";
import { COMPLETION_LIMIT } from "./chatops.completions";
import { CHAT_ROUTE, ChatopsController } from "./chatops.controller";
import {
  COMMAND_TEXT_LIMIT,
  COMMAND_TEXT_MESSAGE,
  COMPLETION_TEXT_LIMIT,
  ChatCommandRequest,
  ChatCompletionsQuery,
  commandText,
} from "./chatops.dto";
import type { SlackRepository } from "../slack/slack.repository";
import {
  CHAT_CHANNEL_NOT_FOUND,
  CHAT_COMMAND_NOT_FOUND,
  CHAT_PERSON_REQUIRED,
} from "./chatops.errors";
import { deniedText } from "./chatops.replies";
import type { ChatopsRepository, OwnConsoleCommand } from "./chatops.repository";
import type { ChatDispatcher } from "./dispatcher.service";
import { renderReference } from "./grammar.help";
import type { Completion, CompletionSources } from "./grammar.ports";
import { GRAMMAR, GRAMMAR_VERSION, withCommands } from "./grammar.registry";
import type { CommandDefinition, DispatchInput, DispatchResult, Grammar } from "./grammar.types";

/**
 * The chat routes (#537, #539): the grammar as the docs print it with what the caller may run,
 * completions for the member who is typing, a command run as the signed-in person through the
 * dispatcher, and that person's own command read back — in their workspace, as themselves.
 */

const ORG = { id: "org-acme" } as Organization;
const MEMBER: ActiveMembership = { tenant: ORG, roles: ["member"] };
const TICKETS: Completion[] = [{ value: "#485", label: "Flaky retry in the sync worker" }];
const COMMAND_ID = "0b0c6a9e-6f0b-4c53-9d6f-0d1c6f8a1b11";

/** What the dispatcher double answers unless a test says otherwise. */
const RAN: DispatchResult = {
  outcome: "ok",
  reply: { text: "3 loops live · 12 queued" },
  commandId: COMMAND_ID,
  command: "status",
};

/** A console command of Maya's, settled. */
const ROW: OwnConsoleCommand = {
  id: COMMAND_ID,
  command: "dry-run",
  outcome: "ok",
  raw_text: "/ouro dry-run #486",
  invoked_at: new Date("2026-10-12T16:00:00.000Z"),
  completed_at: new Date("2026-10-12T16:00:41.000Z"),
  reply: { text: "Rehearsing #486 with no writes — the result follows." },
  settled_reply: {
    text: "Dry run of #486 finished: no writes.",
    link: { label: "Open the dry run", url: "https://app.example.test/copilot/dr-1" },
  },
  error_detail: null,
};

/** A fixture command that asks for the approve capability on top of a role. */
const APPROVE: CommandDefinition = {
  id: "approve",
  aliases: [],
  summary: "approve a loop",
  usage: "approve",
  arguments: [],
  requires: { roles: ["owner", "admin", "member"], capability: "can_approve_loops" },
  destructive: false,
  mode: "sync",
  stage: "available",
  binds: "a fixture",
};

/**
 * The controller over doubles.
 *
 * @param grammar - The grammar it serves.
 * @param explicit - The caller's explicit `can_approve_loops`.
 * @param result - What the dispatcher answers.
 * @param row - The console command the trail holds for the caller; `null` for none.
 * @param bound - The ids of the workspace's bound channels.
 * @returns The controller, and what the completion port, capability read, dispatcher, trail and
 *   channel store were asked.
 */
function setup(
  grammar: Grammar = GRAMMAR,
  explicit: boolean | null = true,
  result: DispatchResult = RAN,
  row: OwnConsoleCommand | null = ROW,
  bound: readonly string[] = [],
) {
  const asked: unknown[][] = [];
  const capabilityReads: unknown[][] = [];
  const dispatched: DispatchInput[] = [];
  const lookups: unknown[][] = [];
  const channelReads: unknown[][] = [];
  const channels = {
    boundChannel: (organizationId: string, id: string) => {
      channelReads.push([organizationId, id]);

      return Promise.resolve(bound.includes(id) ? id : undefined);
    },
  } as unknown as SlackRepository;
  const dispatcher = {
    dispatch: (input: DispatchInput) => {
      dispatched.push(input);

      return Promise.resolve(result);
    },
  } as unknown as ChatDispatcher;
  const commands = {
    ownConsoleCommand: (...args: unknown[]) => {
      lookups.push(args);

      return Promise.resolve(row ?? undefined);
    },
  } as unknown as ChatopsRepository;
  const sources: CompletionSources = {
    complete: (...args) => {
      asked.push(args);

      return Promise.resolve(TICKETS);
    },
  };
  const capabilities = {
    explicitFor: (...args: unknown[]) => {
      capabilityReads.push(args);

      return Promise.resolve(explicit);
    },
  } as unknown as CapabilityRepository;

  return {
    controller: new ChatopsController(
      grammar,
      sources,
      capabilities,
      dispatcher,
      commands,
      channels,
    ),
    channelReads,
    asked,
    capabilityReads,
    dispatched,
    lookups,
  };
}

/**
 * Run some work as a signed-in person.
 *
 * @param work - The work.
 * @returns What it returned.
 */
function asMaya<T>(work: () => Promise<T>): Promise<T> {
  return runWithTenantContext(() => {
    setTenantContext({ user: { id: "user-maya", name: "Maya Chen" } as never });

    return work();
  });
}

/**
 * Run some work as a service account: a role-less membership, and no person.
 *
 * @param work - The work.
 * @returns What it returned.
 */
function asService<T>(work: () => Promise<T>): Promise<T> {
  return runWithTenantContext(() => {
    setTenantContext({ membership: { tenant: ORG, roles: [] } });

    return work();
  });
}

/**
 * A membership with some roles.
 *
 * @param roles - The roles.
 * @returns The membership.
 */
function holding(...roles: OrganizationRole[]): ActiveMembership {
  return { tenant: ORG, roles };
}

/**
 * A command body as the validation pipe makes it, and what it is refused with.
 *
 * @param body - The JSON body.
 * @returns The transformed request and its problems.
 */
function commandBody(body: unknown): { request: ChatCommandRequest; problems: string[] } {
  const request = plainToInstance(ChatCommandRequest, body);

  return {
    request,
    problems: validateSync(request as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    }).flatMap((error) => Object.values(error.constraints ?? {})),
  };
}

/** The messages a query string is refused with. */
function problems(query: unknown): string[] {
  return validateSync(plainToInstance(ChatCompletionsQuery, query) as object).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

describe("ChatopsController (#537, #539)", () => {
  it("is served under /chat", () => {
    expect(CHAT_ROUTE).toBe("chat");
    expect(Reflect.getMetadata("path", ChatopsController)).toBe("chat");
  });

  describe("GET /chat/grammar", () => {
    /** The grammar as one caller sees it, by command id. */
    async function standing(
      grammar: Grammar,
      membership: ActiveMembership,
      explicit: boolean | null,
    ): Promise<Record<string, string | null | true>> {
      const { controller } = setup(grammar, explicit);
      const reference = await asMaya(() => controller.reference(ORG, membership));

      return Object.fromEntries(
        reference.commands.map((command) => {
          // The two fields are one fact: a reason exactly when not allowed.
          expect(command.deniedReason === null).toBe(command.allowed);

          return [command.id, command.allowed ? true : command.deniedReason];
        }),
      );
    }

    it("answers the whole grammar, generated from the registry the dispatcher runs", async () => {
      const { controller, capabilityReads } = setup();

      const reference = await asMaya(() => controller.reference(ORG, holding("owner")));

      // Everything the committed chat-grammar.json says, and the caller's standing laid over it.
      expect({
        ...reference,
        commands: reference.commands.map(({ allowed, deniedReason, ...command }) => {
          expect([allowed, deniedReason]).toEqual([true, null]);

          return command;
        }),
      }).toEqual(renderReference(GRAMMAR));
      expect(reference.version).toBe(GRAMMAR_VERSION);
      expect(reference.commands.map((command) => command.id)).toEqual(
        GRAMMAR.commands.map((command) => command.id),
      );
      expect(capabilityReads).toEqual([["org-acme", "user-maya"]]);
    });

    it("gives the console what it draws a command from", async () => {
      const { controller } = setup();

      const reference = await asMaya(() => controller.reference(ORG, holding("member")));
      const byId = Object.fromEntries(reference.commands.map((command) => [command.id, command]));

      expect(byId.queue).toMatchObject({
        id: "queue",
        usage: "queue #485 [workflow]",
        syntax: "/ouro queue <ticket> [workflow]",
        summary: "send an issue into the loop",
        arguments: [
          { name: "ticket", optional: false, completion: "tickets" },
          { name: "workflow", optional: true, completion: "workflows" },
        ],
        stage: "available",
        unavailableReply: null,
        destructive: false,
        mode: "sync",
        allowed: true,
        deniedReason: null,
      });
      expect(byId["abort loop"]).toMatchObject({ destructive: true, allowed: false });
      expect(byId["dry-run"]).toMatchObject({ mode: "async" });
      expect(byId["explain pr"]).toMatchObject({
        stage: "v2",
        unavailableReply: expect.stringContaining("AI presence") as string,
      });
      expect(reference.confirmRule).toContain("confirm");
    });

    it("lets owners and admins run everything", async () => {
      for (const role of ["owner", "admin"] as const) {
        expect(Object.values(await standing(GRAMMAR, holding(role), null))).toEqual(
          GRAMMAR.commands.map(() => true),
        );
      }
    });

    it("lists every command for a member, the ones they may not run named with what is missing", async () => {
      expect(await standing(GRAMMAR, holding("member"), null)).toEqual({
        status: true,
        queue: true,
        "pause loop": "for workspace owners and admins",
        "resume loop": "for workspace owners and admins",
        "abort loop": "for workspace owners and admins",
        answer: true,
        "dry-run": true,
        route: "for workspace owners and admins",
        "explain pr": true,
        estimate: true,
        "pause all": "for workspace owners and admins",
      });
    });

    it("lists every command for a viewer too — dimmed, never hidden", async () => {
      expect(await standing(GRAMMAR, holding("viewer"), null)).toEqual({
        status: true,
        queue: "for workspace owners, admins and members",
        "pause loop": "for workspace owners and admins",
        "resume loop": "for workspace owners and admins",
        "abort loop": "for workspace owners and admins",
        answer: true,
        "dry-run": "for workspace owners, admins and members",
        route: "for workspace owners and admins",
        // Nothing runs, so there is nothing to deny: the dispatcher answers a viewer too.
        "explain pr": true,
        estimate: true,
        "pause all": "for workspace owners and admins",
      });
    });

    it("says the words the dispatcher's own refusal says, for every command", async () => {
      const { controller } = setup();

      const reference = await asMaya(() => controller.reference(ORG, holding("viewer")));

      for (const command of reference.commands.filter((candidate) => !candidate.allowed)) {
        const definition = GRAMMAR.commands.find((candidate) => candidate.id === command.id);

        expect(deniedText(definition as CommandDefinition)).toBe(
          `\`/ouro ${command.id}\` is ${String(command.deniedReason)}.`,
        );
      }
    });

    it("reads a member's can_approve_loops for a command that asks for it", async () => {
      const grammar = withCommands(GRAMMAR, APPROVE);

      // An explicit grant, an explicit refusal, and the role's default (a member's is false).
      expect((await standing(grammar, holding("member"), true)).approve).toBe(true);
      expect((await standing(grammar, holding("member"), false)).approve).toBe(
        "for workspace owners, admins and members who can approve loops",
      );
      expect((await standing(grammar, holding("admin"), null)).approve).toBe(true);
      // The capability does not stand in for the role.
      expect((await standing(grammar, holding("viewer"), true)).approve).toBe(
        "for workspace owners, admins and members who can approve loops",
      );
    });

    it("allows a caller who is not a person nothing, and reads nothing about them", async () => {
      const { controller, capabilityReads } = setup();

      const reference = await asService(() => controller.reference(ORG, holding()));

      expect(reference.commands.map((command) => [command.allowed, command.deniedReason])).toEqual(
        GRAMMAR.commands.map(() => [false, "for signed-in workspace members"]),
      );
      expect(capabilityReads).toEqual([]);
    });

    it("lists a command added to the grammar with no other change", async () => {
      const { controller } = setup(
        withCommands(GRAMMAR, {
          id: "ping",
          aliases: [],
          summary: "check the loop is listening",
          usage: "ping",
          arguments: [],
          requires: { roles: [] },
          destructive: false,
          mode: "sync",
          stage: "available",
          binds: "a fixture",
        }),
      );

      const reference = await asMaya(() => controller.reference(ORG, holding("viewer")));

      expect(reference.commands.at(-1)).toMatchObject({
        id: "ping",
        syntax: "/ouro ping",
        allowed: true,
        deniedReason: null,
      });
    });
  });

  describe("GET /chat/completions", () => {
    it("completes the argument being typed, in the caller's workspace and as the caller", async () => {
      const { controller, asked, capabilityReads } = setup();

      const answer = await asMaya(() => controller.completions(ORG, MEMBER, { text: "queue #4" }));

      expect(answer).toEqual({
        grammarVersion: GRAMMAR_VERSION,
        command: "queue",
        argument: "ticket",
        source: "tickets",
        completions: TICKETS,
      });
      expect(asked).toEqual([
        [
          "org-acme",
          { userId: "user-maya", name: "Maya Chen", roles: ["member"], canApproveLoops: true },
          "tickets",
          "#4",
          {},
          COMPLETION_LIMIT,
        ],
      ]);
      expect(capabilityReads).toEqual([["org-acme", "user-maya"]]);
    });

    it("keeps a trailing space: it is what says the last word is finished", async () => {
      const { controller, asked } = setup();

      const answer = await asMaya(() =>
        controller.completions(ORG, MEMBER, { text: "queue #485 " }),
      );

      expect(answer).toMatchObject({ command: "queue", argument: "workflow" });
      expect(asked[0].slice(2, 5)).toEqual(["workflows", "", { ticket: "#485" }]);
    });

    it("offers the commands when no text is sent", async () => {
      const { controller, asked } = setup();

      const answer = await asMaya(() => controller.completions(ORG, MEMBER, {}));

      expect(answer.command).toBeNull();
      expect(answer.completions.map((completion) => completion.value)).toEqual([
        ...GRAMMAR.commands.map((command) => command.id),
        "help",
      ]);
      expect(asked).toEqual([]);
    });

    it("refuses a caller who is not a person with 403 chat_person_required, and reads nothing", async () => {
      const { controller, asked, capabilityReads } = setup();

      const refused = runWithTenantContext(() => {
        // A service account: a role-less membership, and no user.
        setTenantContext({ membership: { tenant: ORG, roles: [] } });

        return controller.completions(ORG, { tenant: ORG, roles: [] }, { text: "queue " });
      });

      await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
      await expect(refused).rejects.toMatchObject({ code: CHAT_PERSON_REQUIRED, status: 403 });
      expect(asked).toEqual([]);
      expect(capabilityReads).toEqual([]);
    });
  });

  describe("POST /chat/commands", () => {
    it("answers 200, not 201: a command is run, and nothing is created at an address", () => {
      expect(
        Reflect.getMetadata(
          "__httpCode__",
          Object.getOwnPropertyDescriptor(ChatopsController.prototype, "run")?.value as object,
        ),
      ).toBe(200);
    });

    it("hands the dispatcher the text and the session, and answers what it said", async () => {
      const { controller, dispatched } = setup();

      const answer = await asMaya(() => controller.run(ORG, { text: "status" }));

      expect(dispatched).toEqual([
        {
          surface: "console",
          text: "status",
          console: { organizationId: "org-acme", userId: "user-maya", channelId: null },
        },
      ]);
      expect(answer).toEqual({
        commandId: COMMAND_ID,
        command: "status",
        outcome: "ok",
        reply: { text: "3 loops live · 12 queued" },
      });
      expect(Object.keys(answer)).not.toContain("confirmWith");
    });

    it.each([
      ["/ouro queue #485", "queue #485"],
      ["/OURO   queue #485", "queue #485"],
      ["  /ouro status  ", "status"],
      ["queue #485 standard-fix", "queue #485 standard-fix"],
      // Only a leading prefix is one: the word later in the line is an argument like any other.
      ["help /ouro", "help /ouro"],
      ["/ourobouros", "/ourobouros"],
      // A bare prefix is empty text, which the dispatcher answers with help — as in Slack.
      ["/ouro", ""],
    ])("takes %j as %j", async (typed, text) => {
      const { controller, dispatched } = setup();
      const { request, problems } = commandBody({ text: typed });

      expect(problems).toEqual([]);
      await asMaya(() => controller.run(ORG, request));

      expect(dispatched.map((input) => input.text)).toEqual([text]);
      expect(commandText(typed)).toBe(text);
    });

    it("passes a refusal through as a 200 whose outcome says so — the dispatcher decides, not the route", async () => {
      const denied: DispatchResult = {
        outcome: "denied",
        reply: { text: "`/ouro route` is for workspace owners and admins." },
        commandId: COMMAND_ID,
        command: "route",
      };
      const { controller } = setup(GRAMMAR, null, denied);

      expect(await asMaya(() => controller.run(ORG, { text: "route implement x" }))).toEqual({
        commandId: COMMAND_ID,
        command: "route",
        outcome: "denied",
        reply: denied.reply,
      });
    });

    it("carries the reply's link, and the confirming text of a describe-first reply", async () => {
      const link = { label: "Open loop 1848", url: "https://app.example.test/runs/run-1848" };
      const linked = setup(GRAMMAR, null, { ...RAN, reply: { text: "Queued #485.", link } });
      const preview = setup(GRAMMAR, null, {
        outcome: "error",
        reply: { text: "Add `confirm` to pause everything." },
        commandId: COMMAND_ID,
        command: "pause all",
        confirmWith: "pause all confirm",
      });

      expect(await asMaya(() => linked.controller.run(ORG, { text: "queue #485" }))).toMatchObject({
        reply: { text: "Queued #485.", link },
      });
      expect(await asMaya(() => preview.controller.run(ORG, { text: "pause all" }))).toEqual({
        commandId: COMMAND_ID,
        command: "pause all",
        outcome: "error",
        reply: { text: "Add `confirm` to pause everything." },
        confirmWith: "pause all confirm",
      });
    });

    it("answers help with no command id, since help records nothing", async () => {
      const { controller } = setup(GRAMMAR, null, {
        outcome: "ok",
        reply: { text: "Ouroboros commands" },
        commandId: null,
        command: null,
      });

      expect(await asMaya(() => controller.run(ORG, { text: "help" }))).toEqual({
        commandId: null,
        command: null,
        outcome: "ok",
        reply: { text: "Ouroboros commands" },
      });
    });

    it("refuses a caller who is not a person with 403 chat_person_required, and runs nothing", async () => {
      const { controller, dispatched } = setup();

      const refused = asService(() => controller.run(ORG, { text: "pause all confirm" }));

      await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
      await expect(refused).rejects.toMatchObject({
        code: CHAT_PERSON_REQUIRED,
        status: 403,
        message: "Commands are run by a signed-in member, not by a service account.",
      });
      expect(dispatched).toEqual([]);
    });
  });

  describe("the command body", () => {
    it("accepts 1 to 2000 characters, counted after trimming", () => {
      expect(commandBody({ text: "s" }).problems).toEqual([]);
      expect(commandBody({ text: "x".repeat(COMMAND_TEXT_LIMIT) }).problems).toEqual([]);
      expect(commandBody({ text: `  ${"x".repeat(COMMAND_TEXT_LIMIT)}\n` }).problems).toEqual([]);
      expect(commandBody({ text: "  status \n" }).request.text).toBe("status");
    });

    it("refuses blank text, text that is too long, no text, and text that is not a string", () => {
      expect(commandBody({ text: "" }).problems).toEqual([COMMAND_TEXT_MESSAGE]);
      expect(commandBody({ text: " \n\t " }).problems).toEqual([COMMAND_TEXT_MESSAGE]);
      expect(commandBody({ text: "x".repeat(COMMAND_TEXT_LIMIT + 1) }).problems).toEqual([
        COMMAND_TEXT_MESSAGE,
      ]);
      expect(commandBody({}).problems).not.toEqual([]);
      expect(commandBody({ text: 485 }).problems).not.toEqual([]);
      expect(commandBody({ text: ["status"] }).problems).not.toEqual([]);
    });

    it("refuses a field the route does not take — nobody names who a command acts as", () => {
      expect(commandBody({ text: "status", userId: "user-somebody-else" }).problems).not.toEqual(
        [],
      );
      expect(commandBody({ text: "status", surface: "slack" }).problems).not.toEqual([]);
    });
  });

  describe("POST /chat/commands under a channel's mirror (#542)", () => {
    const CHANNEL = "5eed009c-0000-4000-8000-0000000000a1";

    it("hands the dispatcher the bound channel it was typed under", async () => {
      const { controller, dispatched, channelReads } = setup(GRAMMAR, true, RAN, ROW, [CHANNEL]);

      await asMaya(() => controller.run(ORG, { text: "/ouro status", channelId: CHANNEL }));

      expect(channelReads).toEqual([["org-acme", CHANNEL]]);
      expect(dispatched).toEqual([
        {
          surface: "console",
          text: "status",
          console: { organizationId: "org-acme", userId: "user-maya", channelId: CHANNEL },
        },
      ]);
    });

    it("refuses a channel that is not a bound channel of this workspace, and runs nothing", async () => {
      // Another workspace's, an unbound one and a DM row are all one answer from the store.
      const { controller, dispatched } = setup(GRAMMAR, true, RAN, ROW, []);

      const refused = asMaya(() => controller.run(ORG, { text: "pause all", channelId: CHANNEL }));

      await expect(refused).rejects.toBeInstanceOf(NotFoundError);
      await expect(refused).rejects.toMatchObject({ code: CHAT_CHANNEL_NOT_FOUND, status: 404 });
      expect(dispatched).toEqual([]);
    });

    it("asks the channel store nothing for the palette, which names no channel", async () => {
      const { controller, channelReads } = setup();

      await asMaya(() => controller.run(ORG, { text: "status" }));

      expect(channelReads).toEqual([]);
    });

    it.each([["not-a-uuid"], [""], [7], [null]])(
      "refuses a channelId that is not a UUID before the route runs (%p)",
      (channelId) => {
        const errors = validateSync(
          plainToInstance(ChatCommandRequest, { text: "status", channelId }),
        );

        // `null` is read as absent by `@IsOptional()`: the palette's body, not a refusal.
        expect(errors.map((error) => error.property)).toEqual(
          channelId === null ? [] : ["channelId"],
        );
      },
    );

    it("accepts a body with a UUID channelId, and one with none", () => {
      expect(
        validateSync(plainToInstance(ChatCommandRequest, { text: "status", channelId: CHANNEL })),
      ).toEqual([]);
      expect(validateSync(plainToInstance(ChatCommandRequest, { text: "status" }))).toEqual([]);
    });

    it("reads a null channelId as none: the palette's command, checked against no channel", async () => {
      const { controller, dispatched, channelReads } = setup();

      await asMaya(() => controller.run(ORG, { text: "status", channelId: null }));

      expect(channelReads).toEqual([]);
      expect(dispatched[0]).toMatchObject({ console: { channelId: null } });
    });
  });

  describe("GET /chat/commands/{id}", () => {
    it("answers the caller's own console command, asked for by workspace, person and id", async () => {
      const { controller, lookups } = setup();

      const answer = await asMaya(() => controller.command(ORG, COMMAND_ID));

      expect(lookups).toEqual([["org-acme", "user-maya", COMMAND_ID]]);
      expect(answer).toEqual({
        id: COMMAND_ID,
        command: "dry-run",
        outcome: "ok",
        rawText: "/ouro dry-run #486",
        invokedAt: "2026-10-12T16:00:00.000Z",
        completedAt: "2026-10-12T16:00:41.000Z",
        // What it said at once, beside what it said when it finished (#542).
        reply: { text: "Rehearsing #486 with no writes — the result follows." },
        settledReply: {
          text: "Dry run of #486 finished: no writes.",
          link: { label: "Open the dry run", url: "https://app.example.test/copilot/dr-1" },
        },
        errorDetail: null,
      });
    });

    it("answers a command still pending with no completion and no settled reply", async () => {
      const { controller } = setup(GRAMMAR, null, RAN, {
        ...ROW,
        outcome: "async_pending",
        completed_at: null,
        settled_reply: null,
      });

      expect(await asMaya(() => controller.command(ORG, COMMAND_ID))).toMatchObject({
        outcome: "async_pending",
        completedAt: null,
        settledReply: null,
        errorDetail: null,
      });
    });

    it("answers a failed command with its reason, and a settled reply without a link as text alone", async () => {
      const { controller } = setup(GRAMMAR, null, RAN, {
        ...ROW,
        outcome: "error",
        settled_reply: { text: "The harness stopped at build." },
        error_detail: "dry_run_harness_failed",
      });

      const answer = await asMaya(() => controller.command(ORG, COMMAND_ID));

      expect(answer).toMatchObject({
        outcome: "error",
        settledReply: { text: "The harness stopped at build." },
        errorDetail: "dry_run_harness_failed",
      });
      expect(Object.keys(answer.settledReply ?? {})).toEqual(["text"]);
    });

    it("answers 404 chat_command_not_found when the trail has no such command of the caller's", async () => {
      // Somebody else's, a Slack command, another workspace's: the repository's one question
      // answers none of them, and the route says the same of each.
      const { controller } = setup(GRAMMAR, null, RAN, null);

      const refused = asMaya(() => controller.command(ORG, COMMAND_ID));

      await expect(refused).rejects.toBeInstanceOf(NotFoundError);
      await expect(refused).rejects.toMatchObject({ code: CHAT_COMMAND_NOT_FOUND, status: 404 });
    });

    it.each(["not-a-uuid", "1847", "0b0c6a9e6f0b4c539d6f0d1c6f8a1b11", `${COMMAND_ID}'--`])(
      "answers 404 for %j without asking the database",
      async (id) => {
        const { controller, lookups } = setup();

        await expect(asMaya(() => controller.command(ORG, id))).rejects.toMatchObject({
          code: CHAT_COMMAND_NOT_FOUND,
          status: 404,
        });
        expect(lookups).toEqual([]);
      },
    );

    it("refuses a caller who is not a person with 403 chat_person_required, and reads nothing", async () => {
      const { controller, lookups } = setup();

      await expect(asService(() => controller.command(ORG, COMMAND_ID))).rejects.toMatchObject({
        code: CHAT_PERSON_REQUIRED,
        status: 403,
      });
      expect(lookups).toEqual([]);
    });
  });

  describe("the completions query", () => {
    it("accepts text, empty text and no text", () => {
      expect(problems({ text: "queue #485 " })).toEqual([]);
      expect(problems({ text: "" })).toEqual([]);
      expect(problems({})).toEqual([]);
      expect(problems({ text: "x".repeat(COMPLETION_TEXT_LIMIT) })).toEqual([]);
    });

    it("refuses text longer than a slash command can be, and text that is not a string", () => {
      expect(problems({ text: "x".repeat(COMPLETION_TEXT_LIMIT + 1) })).toHaveLength(1);
      expect(problems({ text: ["queue", "#485"] })).not.toEqual([]);
    });
  });
});
