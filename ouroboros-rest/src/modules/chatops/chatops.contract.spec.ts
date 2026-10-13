/**
 * The OpenAPI document and what the chat routes send (#537, #539). The real grammar as a caller
 * sees it, real completions — a command being typed, an argument being typed, a finished line —
 * a command's result and a command read back are held to their schemas, which are
 * `additionalProperties: false` throughout.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { complete } from "./chatops.completions";
import { callerGrammar, toCommand, toCommandResult } from "./chatops.resources";
import { renderReference } from "./grammar.help";
import type { CompletionSources } from "./grammar.ports";
import { GRAMMAR } from "./grammar.registry";
import type { Invoker } from "./grammar.types";

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns A function answering Ajv's complaint, or undefined when the value validates.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/** A value as the client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const KEN: Invoker = { userId: "user-ken", name: "Ken", roles: ["owner"], canApproveLoops: null };

/** Every vocabulary answers one entry, so each argument's completions have something in them. */
const SOURCES: CompletionSources = {
  complete: (_organizationId, _invoker, source) =>
    Promise.resolve([{ value: `a-${source}`, label: `one of the ${source}` }]),
};

describe("the /ouro grammar on the wire", () => {
  const grammar = validatorFor("ChatGrammar");

  it.each([
    ["an owner", { roles: ["owner" as const], canApproveLoops: null }],
    ["a viewer, who is denied most of it", { roles: ["viewer" as const], canApproveLoops: null }],
    ["a service account", null],
  ])("is the documented ChatGrammar for %s", (_who, caller) => {
    expect(grammar(wire(callerGrammar(GRAMMAR, caller)))).toBeUndefined();
  });

  it("is the committed reference with the caller's standing laid over it, and nothing else", () => {
    const served = wire(callerGrammar(GRAMMAR, KEN)) as { commands: Record<string, unknown>[] };

    // chat-grammar.json is everybody's: it never carries one caller's answer.
    expect(grammar(wire(renderReference(GRAMMAR)))).toContain("allowed");
    expect(JSON.stringify(renderReference(GRAMMAR))).not.toContain("deniedReason");

    for (const command of served.commands) {
      delete command.allowed;
      delete command.deniedReason;
    }

    expect(served).toEqual(wire(renderReference(GRAMMAR)));
  });

  it("refuses a command with a field the document does not have", () => {
    const reference = wire(callerGrammar(GRAMMAR, KEN)) as { commands: Record<string, unknown>[] };

    reference.commands[0].handler = "anything";

    expect(grammar(reference)).toContain("additional properties");
  });
});

describe("a console command on the wire", () => {
  const result = validatorFor("ChatCommandResult");
  const command = validatorFor("ChatCommand");
  const ID = "0b0c6a9e-6f0b-4c53-9d6f-0d1c6f8a1b11";
  const link = { label: "Open in Copilot", url: "https://ouroboros.example/copilot/standard-fix" };

  it.each([
    [
      "ran",
      { outcome: "ok", reply: { text: "Queued #485.", link }, commandId: ID, command: "queue" },
    ],
    [
      "help",
      { outcome: "ok", reply: { text: "Ouroboros commands" }, commandId: null, command: null },
    ],
    ["denied", { outcome: "denied", reply: { text: "No." }, commandId: ID, command: "route" }],
    [
      "started",
      { outcome: "async_pending", reply: { text: "…" }, commandId: ID, command: "dry-run" },
    ],
    [
      "a preview",
      {
        outcome: "error",
        reply: { text: "Add `confirm`." },
        commandId: ID,
        command: "pause all",
        confirmWith: "pause all confirm",
      },
    ],
    ["unknown", { outcome: "error", reply: { text: "?" }, commandId: ID, command: null }],
  ] as const)("is the documented ChatCommandResult when it %s", (_which, dispatched) => {
    expect(result(wire(toCommandResult(dispatched)))).toBeUndefined();
  });

  it("documents no unlinked outcome: the console has no link to lack", () => {
    expect(
      result({ outcome: "unlinked", reply: { text: "Link first." }, commandId: ID, command: null }),
    ).toContain("allowed values");
  });

  it("carries nothing of a reply but its text and link", () => {
    const stray = { text: "Done.", link: { ...link, style: "primary" }, blocks: [] } as never;

    expect(
      result(
        wire(toCommandResult({ outcome: "ok", reply: stray, commandId: ID, command: "status" })),
      ),
    ).toBeUndefined();
  });

  it.each([
    [
      "pending",
      { outcome: "async_pending", completed_at: null, settled_reply: null, error_detail: null },
    ],
    [
      "settled",
      {
        outcome: "ok",
        completed_at: new Date("2026-10-12T16:00:41.000Z"),
        settled_reply: { text: "Dry run passed.", link },
        error_detail: null,
      },
    ],
    [
      "failed",
      {
        outcome: "error",
        completed_at: new Date("2026-10-12T16:00:41.000Z"),
        settled_reply: { text: "The harness stopped at build." },
        error_detail: "dry_run_harness_failed",
      },
    ],
  ] as const)("is the documented ChatCommand while %s", (_which, state) => {
    expect(
      command(
        wire(
          toCommand({
            id: ID,
            command: "dry-run",
            raw_text: "/ouro dry-run #486",
            invoked_at: new Date("2026-10-12T16:00:00.000Z"),
            reply: { text: "Rehearsing standard-fix on #486 with no writes — the result follows." },
            ...state,
          }),
        ),
      ),
    ).toBeUndefined();
  });

  it("documents the channel a command typed under a mirror names (#542)", () => {
    const body = validatorFor("ChatCommandRequest");

    expect(
      body({ text: "status", channelId: "5eed009c-0000-4000-8000-0000000000a1" }),
    ).toBeUndefined();
    expect(body({ text: "status", channelId: null })).toBeUndefined();
    expect(body({ text: "status", channelId: "loops" })).toBeDefined();
    expect(body({ text: "status", channel: "loops" })).toBeDefined();
  });

  it("documents the body's bound as the route enforces it", () => {
    const body = validatorFor("ChatCommandRequest");

    expect(body({ text: "status" })).toBeUndefined();
    expect(body({ text: "" })).toBeDefined();
    expect(body({ text: "x".repeat(2001) })).toBeDefined();
    expect(body({ text: "status", userId: "user-somebody-else" })).toContain(
      "additional properties",
    );
  });
});

describe("completions on the wire", () => {
  const completions = validatorFor("ChatCompletions");

  it.each([
    "",
    "pau",
    "queue ",
    "queue #485 st",
    "answer q-231 ",
    "explain pr 5",
    "pause all ",
    "status ",
    "nonsense words",
  ])("is the documented ChatCompletions for %j", async (text) => {
    expect(
      completions(wire(await complete(GRAMMAR, SOURCES, "org-acme", KEN, text))),
    ).toBeUndefined();
  });

  it("documents every argument's vocabulary", () => {
    const schemas = document().components as unknown as {
      schemas: {
        ChatGrammarCommand: {
          properties: { arguments: { items: { properties: { completion: { enum: unknown[] } } } } };
        };
      };
    };
    const documented =
      schemas.schemas.ChatGrammarCommand.properties.arguments.items.properties.completion.enum;

    for (const command of GRAMMAR.commands) {
      for (const argument of command.arguments) {
        if (argument.completion !== undefined) {
          expect(documented).toContain(argument.completion);
        }
      }
    }
  });
});
