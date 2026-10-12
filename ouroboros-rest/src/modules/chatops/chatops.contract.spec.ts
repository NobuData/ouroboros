/**
 * The OpenAPI document and what the chat routes send (#537). The real grammar and real
 * completions — a command being typed, an argument being typed, a finished line — are held to
 * their schemas, which are `additionalProperties: false` throughout.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { complete } from "./chatops.completions";
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
  it("is the documented ChatGrammar", () => {
    expect(validatorFor("ChatGrammar")(wire(renderReference(GRAMMAR)))).toBeUndefined();
  });

  it("refuses a command with a field the document does not have", () => {
    const reference = wire(renderReference(GRAMMAR)) as { commands: Record<string, unknown>[] };

    reference.commands[0].handler = "anything";

    expect(validatorFor("ChatGrammar")(reference)).toContain("additional properties");
  });
});

describe("completions on the wire", () => {
  const completions = validatorFor("ChatCompletions");

  it.each(["", "pau", "queue ", "queue #485 st", "answer q-231 ", "status ", "nonsense words"])(
    "is the documented ChatCompletions for %j",
    async (text) => {
      expect(
        completions(wire(await complete(GRAMMAR, SOURCES, "org-acme", KEN, text))),
      ).toBeUndefined();
    },
  );

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
