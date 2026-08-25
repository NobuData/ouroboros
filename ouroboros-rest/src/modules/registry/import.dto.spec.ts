import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { fieldMessages } from "../errors/validation";
import { ALIAS_NAME_MESSAGE, MAX_ALIAS_LENGTH } from "./aliases.dto";
import { ImportAliasesDto, ImportConnectionParams, MAX_IMPORT_ITEMS } from "./import.dto";
import { MODEL_ID_MESSAGE } from "./params.dto";

const CONNECTION = "9c4a5f6e-7d8c-4b10-8f43-5a6b7c8d9e01";

/**
 * The wizard's body, refused the way the pipe refuses it
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)).
 *
 * What is asserted here is **shape only** — the split `aliases.dto.ts` states and this file
 * inherits. Whether the name is taken, whether the model was discovered and whether the params
 * suit it are decisions that need rows, and they answer itemized through
 * `model_import_invalid`; a DTO that tried to state them would be a second, worse copy of the
 * service's rules.
 *
 * The nesting matters and is asserted for it: a complaint about the second row's name has to
 * arrive as `items.1.alias`, because that is the path a form maps back to an input.
 */

/**
 * Validate a body the way the pipe does — whitelisted, unknown fields refused — and answer the
 * field messages a `422 validation_failed` would carry.
 *
 * @param dto - Which class.
 * @param body - The body.
 * @returns Complaints by field; `{}` for an acceptable body.
 */
function complaints(
  dto: new () => object,
  body: Record<string, unknown>,
): Record<string, string[]> {
  return fieldMessages(
    validateSync(plainToInstance(dto, body), { whitelist: true, forbidNonWhitelisted: true }),
  );
}

describe("ImportConnectionParams", () => {
  it("accepts a uuid", () => {
    expect(complaints(ImportConnectionParams, { connectionId: CONNECTION })).toEqual({});
  });

  it("refuses anything else, so `candidates` can never be read as a connection id", () => {
    expect(complaints(ImportConnectionParams, { connectionId: "anthropic" })).toHaveProperty(
      "connectionId",
    );
  });
});

describe("ImportAliasesDto", () => {
  it("accepts a batch of two", () => {
    expect(
      complaints(ImportAliasesDto, {
        connectionId: CONNECTION,
        items: [
          { modelId: "claude-opus-5", alias: "opus-5", params: { thinking: "max" } },
          { modelId: "claude-haiku-4-5", alias: "haiku-tiny" },
        ],
      }),
    ).toEqual({});
  });

  it("refuses an import of nothing", () => {
    // A request nobody meant to send. Answering it `200` with an empty report would let a
    // broken client believe it had imported something.
    expect(complaints(ImportAliasesDto, { connectionId: CONNECTION, items: [] })).toHaveProperty(
      "items",
    );
  });

  it("refuses a batch past the ceiling", () => {
    const items = Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_unused, index) => ({
      modelId: `model-${index.toString()}`,
      alias: `alias-${index.toString()}`,
    }));

    expect(complaints(ImportAliasesDto, { connectionId: CONNECTION, items })).toHaveProperty(
      "items",
    );
  });

  it("addresses a bad row by its position, the way a form reads it", () => {
    const problems = complaints(ImportAliasesDto, {
      connectionId: CONNECTION,
      items: [
        { modelId: "claude-opus-5", alias: "opus-5" },
        { modelId: "claude-haiku-4-5", alias: "Haiku Tiny" },
      ],
    });

    expect(problems["items.1.alias"]).toContain(ALIAS_NAME_MESSAGE);
    expect(problems["items.0.alias"]).toBeUndefined();
  });

  it("holds an item to the same name rule the create dialog does", () => {
    // A wizard that could suggest — or accept — a name `POST /registry/aliases` refuses is a
    // wizard whose rows fail on submission.
    const problems = complaints(ImportAliasesDto, {
      connectionId: CONNECTION,
      items: [{ modelId: "claude-opus-5", alias: "a".repeat(MAX_ALIAS_LENGTH + 1) }],
    });

    expect(problems).toHaveProperty(["items.0.alias"]);
  });

  it("holds an item's model to the same shape rule", () => {
    // Deliberately permissive — a vendor's own string, unfolded — so what this refuses is the
    // padding V019 would store and nobody would ever be able to match again.
    const problems = complaints(ImportAliasesDto, {
      connectionId: CONNECTION,
      items: [{ modelId: " claude-opus-5 ", alias: "opus-5" }],
    });

    expect(problems["items.0.modelId"]).toContain(MODEL_ID_MESSAGE);
  });

  it("refuses params that are not a document", () => {
    expect(
      complaints(ImportAliasesDto, {
        connectionId: CONNECTION,
        items: [{ modelId: "claude-opus-5", alias: "opus-5", params: ["thinking"] }],
      }),
    ).toHaveProperty(["items.0.params"]);
  });

  it("declares no `enabled`, so nothing can ask for the other default", () => {
    // Import creates enabled aliases and says so in one place — the service. A field here
    // would invite a client to ask for the opposite and then have to be told no.
    expect(
      complaints(ImportAliasesDto, {
        connectionId: CONNECTION,
        items: [{ modelId: "claude-opus-5", alias: "opus-5", enabled: false }],
      }),
    ).toHaveProperty(["items.0.enabled"]);
  });

  it("refuses a field none of these classes declare", () => {
    expect(
      complaints(ImportAliasesDto, { connectionId: CONNECTION, items: [], notes: "hello" }),
    ).toHaveProperty("notes");
  });

  it("refuses a body with no connection", () => {
    expect(
      complaints(ImportAliasesDto, {
        items: [{ modelId: "claude-opus-5", alias: "opus-5" }],
      }),
    ).toHaveProperty("connectionId");
  });
});
