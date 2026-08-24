import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { fieldMessages } from "../errors/validation";
import {
  ALIAS_NAME_MESSAGE,
  AliasParams,
  CreateAliasDto,
  MAX_ALIAS_LENGTH,
  MAX_NOTES_LENGTH,
  ModelOptionsQuery,
  NOTES_MESSAGE,
  UpdateAliasDto,
} from "./aliases.dto";
import { MODEL_ID_MESSAGE } from "./params.dto";

const CONNECTION = "9c4a5f6e-7d8c-4b10-8f43-5a6b7c8d9e01";

/**
 * Validate a body the way the pipe does — whitelisted, unknown fields refused — and answer
 * the field messages a `422 validation_failed` would carry.
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

describe("CreateAliasDto", () => {
  it("accepts a bound alias", () => {
    expect(
      complaints(CreateAliasDto, {
        alias: "coder-max",
        connectionId: CONNECTION,
        modelId: "claude-fable-5",
        params: { thinking: "max" },
        restrictions: { review_vote_only: true },
        notes: "prod key",
        enabled: true,
      }),
    ).toEqual({});
  });

  it("accepts an unbound alias — a model and no connection", () => {
    expect(
      complaints(CreateAliasDto, { alias: "gpt5-experiments", modelId: "gpt-5.2-preview" }),
    ).toEqual({});
    expect(
      complaints(CreateAliasDto, {
        alias: "gpt5-experiments",
        connectionId: null,
        modelId: "gpt-5.2-preview",
      }),
    ).toEqual({});
  });

  it("requires a name and a model", () => {
    expect(Object.keys(complaints(CreateAliasDto, {})).sort()).toEqual(["alias", "modelId"]);
  });

  it("holds the name to V015's shape, with the message", () => {
    for (const alias of ["Coder-Max", "coder max", "-coder", "coder-", "coder--max", ""]) {
      expect(complaints(CreateAliasDto, { alias, modelId: "m" }).alias).toContain(
        ALIAS_NAME_MESSAGE,
      );
    }
    expect(
      complaints(CreateAliasDto, { alias: "a".repeat(MAX_ALIAS_LENGTH + 1), modelId: "m" }).alias,
    ).toBeDefined();
    expect(
      complaints(CreateAliasDto, { alias: "a".repeat(MAX_ALIAS_LENGTH), modelId: "m" }),
    ).toEqual({});
  });

  it("takes the vendor's model spelling unfolded, and refuses a padded one", () => {
    for (const modelId of ["qwen3-coder:32b", "Claude-Fable-5", "openai/gpt-oss-120b"]) {
      expect(complaints(CreateAliasDto, { alias: "x", modelId })).toEqual({});
    }
    expect(complaints(CreateAliasDto, { alias: "x", modelId: " claude-fable-5" }).modelId).toEqual([
      MODEL_ID_MESSAGE,
    ]);
  });

  it("refuses a connection that is not a uuid", () => {
    expect(
      Object.keys(
        complaints(CreateAliasDto, { alias: "x", modelId: "m", connectionId: "bedrock" }),
      ),
    ).toEqual(["connectionId"]);
  });

  it("checks the two documents for shape only", () => {
    // What they may contain is CH.2's, against the bound model; here a document is an object.
    for (const params of [[], "max", 1, null]) {
      expect(Object.keys(complaints(CreateAliasDto, { alias: "x", modelId: "m", params }))).toEqual(
        ["params"],
      );
    }
    expect(
      Object.keys(complaints(CreateAliasDto, { alias: "x", modelId: "m", restrictions: [] })),
    ).toEqual(["restrictions"]);
    expect(
      complaints(CreateAliasDto, { alias: "x", modelId: "m", params: { anything: "goes" } }),
    ).toEqual({});
  });

  it("holds a note to V019's rule — trimmed, non-empty, bounded", () => {
    for (const notes of ["", " ", " padded", "padded "]) {
      expect(complaints(CreateAliasDto, { alias: "x", modelId: "m", notes }).notes).toContain(
        NOTES_MESSAGE,
      );
    }
    expect(
      complaints(CreateAliasDto, {
        alias: "x",
        modelId: "m",
        notes: "a".repeat(MAX_NOTES_LENGTH + 1),
      }).notes,
    ).toBeDefined();
    expect(complaints(CreateAliasDto, { alias: "x", modelId: "m", notes: "two\nlines" })).toEqual(
      {},
    );
  });

  it("refuses a field it does not declare", () => {
    expect(
      Object.keys(complaints(CreateAliasDto, { alias: "x", modelId: "m", id: "chosen" })),
    ).toEqual(["id"]);
  });
});

describe("UpdateAliasDto", () => {
  it("accepts an empty body — the service decides that it changed nothing", () => {
    expect(complaints(UpdateAliasDto, {})).toEqual({});
  });

  it("accepts null where null means unset, and nowhere else", () => {
    expect(complaints(UpdateAliasDto, { connectionId: null, notes: null })).toEqual({});
    expect(Object.keys(complaints(UpdateAliasDto, { alias: null }))).toEqual(["alias"]);
    expect(Object.keys(complaints(UpdateAliasDto, { modelId: null }))).toEqual(["modelId"]);
    expect(Object.keys(complaints(UpdateAliasDto, { params: null }))).toEqual(["params"]);
    expect(Object.keys(complaints(UpdateAliasDto, { enabled: null }))).toEqual(["enabled"]);
  });

  it("holds every field to the create's rules", () => {
    expect(complaints(UpdateAliasDto, { alias: "Coder-Max" }).alias).toContain(ALIAS_NAME_MESSAGE);
    expect(complaints(UpdateAliasDto, { modelId: "" }).modelId).toContain(MODEL_ID_MESSAGE);
    expect(Object.keys(complaints(UpdateAliasDto, { connectionId: "bedrock" }))).toEqual([
      "connectionId",
    ]);
    expect(Object.keys(complaints(UpdateAliasDto, { enabled: "yes" }))).toEqual(["enabled"]);
    expect(complaints(UpdateAliasDto, { notes: " " }).notes).toContain(NOTES_MESSAGE);
  });

  it("accepts the whole inspector at once", () => {
    expect(
      complaints(UpdateAliasDto, {
        alias: "coder-primary",
        connectionId: CONNECTION,
        modelId: "claude-fable-5",
        params: { thinking: "max", token_budget: 400_000 },
        restrictions: {},
        notes: "prod key",
        enabled: false,
      }),
    ).toEqual({});
  });
});

describe("AliasParams and ModelOptionsQuery", () => {
  it("take a uuid and nothing else", () => {
    expect(complaints(AliasParams, { id: CONNECTION })).toEqual({});
    expect(Object.keys(complaints(AliasParams, { id: "model-options" }))).toEqual(["id"]);
    expect(complaints(ModelOptionsQuery, { connection: CONNECTION })).toEqual({});
    expect(Object.keys(complaints(ModelOptionsQuery, {}))).toEqual(["connection"]);
  });
});
