import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import type { Organization } from "../db/schema";
import { ForbiddenError } from "../errors/error.envelope";
import type { CapabilityRepository } from "../tenancy/capability.repository";
import {
  runWithTenantContext,
  setTenantContext,
  type ActiveMembership,
} from "../tenancy/tenant.context";
import { COMPLETION_LIMIT } from "./chatops.completions";
import { CHAT_ROUTE, ChatopsController } from "./chatops.controller";
import { COMPLETION_TEXT_LIMIT, ChatCompletionsQuery } from "./chatops.dto";
import { CHAT_PERSON_REQUIRED } from "./chatops.errors";
import { renderReference } from "./grammar.help";
import type { Completion, CompletionSources } from "./grammar.ports";
import { GRAMMAR, GRAMMAR_VERSION, withCommands } from "./grammar.registry";
import type { Grammar } from "./grammar.types";

/**
 * The chat routes (#537): the grammar as the docs print it, and completions for the member who
 * is typing — in their workspace, as themselves.
 */

const ORG = { id: "org-acme" } as Organization;
const MEMBER: ActiveMembership = { tenant: ORG, roles: ["member"] };
const TICKETS: Completion[] = [{ value: "#485", label: "Flaky retry in the sync worker" }];

/**
 * The controller over doubles.
 *
 * @param grammar - The grammar it serves.
 * @param explicit - The caller's explicit `can_approve_loops`.
 * @returns The controller, and what the completion port and capability read were asked.
 */
function setup(grammar: Grammar = GRAMMAR, explicit: boolean | null = true) {
  const asked: unknown[][] = [];
  const capabilityReads: unknown[][] = [];
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
    controller: new ChatopsController(grammar, sources, capabilities),
    asked,
    capabilityReads,
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

/** The messages a query string is refused with. */
function problems(query: unknown): string[] {
  return validateSync(plainToInstance(ChatCompletionsQuery, query) as object).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

describe("ChatopsController (#537)", () => {
  it("is served under /chat", () => {
    expect(CHAT_ROUTE).toBe("chat");
    expect(Reflect.getMetadata("path", ChatopsController)).toBe("chat");
  });

  describe("GET /chat/grammar", () => {
    it("answers the whole grammar, generated from the registry the dispatcher runs", () => {
      const { controller } = setup();

      const reference = controller.reference();

      expect(reference).toEqual(renderReference(GRAMMAR));
      expect(reference.version).toBe(GRAMMAR_VERSION);
      expect(reference.commands.map((command) => command.id)).toEqual(
        GRAMMAR.commands.map((command) => command.id),
      );
    });

    it("lists a command added to the grammar with no other change", () => {
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

      expect(controller.reference().commands.at(-1)).toMatchObject({
        id: "ping",
        syntax: "/ouro ping",
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
