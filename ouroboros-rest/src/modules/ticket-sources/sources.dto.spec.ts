import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  CreateSourceDto,
  MAX_CONFIG_FIELDS,
  MAX_CONFIG_LIST_LENGTH,
  MAX_CONFIG_VALUE_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  SetCredentialsDto,
  SourceParams,
  UpdateSourceDto,
} from "./sources.dto";

/**
 * The request shapes ([#141](https://github.com/NobuData/ouroboros/issues/141)): V030's
 * CHECKs restated so a bad body is a `422` naming the field, and the cheap bounds in front of
 * the schema check.
 */

async function refusalsOf(type: unknown, body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(type as new () => object, body));

  return errors.map((error) => error.property).sort();
}

const ADD = {
  kind: "github",
  displayName: "GitHub · acme-robotics",
  config: { login: "acme-robotics", repos: ["helios-firmware"], token: "ghp_x" },
};

describe("the create body", () => {
  it("accepts the shape the settings form sends", async () => {
    expect(await refusalsOf(CreateSourceDto, ADD)).toStrictEqual([]);
  });

  it("holds the kind to V030's five", async () => {
    expect(await refusalsOf(CreateSourceDto, { ...ADD, kind: "bugzilla" })).toStrictEqual(["kind"]);
  });

  it("holds the name to be present, trimmed and bounded", async () => {
    expect(await refusalsOf(CreateSourceDto, { ...ADD, displayName: "" })).toStrictEqual([
      "displayName",
    ]);
    expect(await refusalsOf(CreateSourceDto, { ...ADD, displayName: " padded " })).toStrictEqual([
      "displayName",
    ]);
    expect(
      await refusalsOf(CreateSourceDto, {
        ...ADD,
        displayName: "x".repeat(MAX_DISPLAY_NAME_LENGTH + 1),
      }),
    ).toStrictEqual(["displayName"]);
    expect(
      await refusalsOf(CreateSourceDto, {
        ...ADD,
        displayName: "x".repeat(MAX_DISPLAY_NAME_LENGTH),
      }),
    ).toStrictEqual([]);
  });

  it("holds the config to an object of strings and lists of strings", async () => {
    expect(await refusalsOf(CreateSourceDto, { ...ADD, config: "github" })).toStrictEqual([
      "config",
    ]);
    expect(await refusalsOf(CreateSourceDto, { ...ADD, config: [] })).toStrictEqual(["config"]);
    expect(await refusalsOf(CreateSourceDto, { ...ADD, config: { n: 3 } })).toStrictEqual([
      "config",
    ]);
    expect(await refusalsOf(CreateSourceDto, { ...ADD, config: { l: [1] } })).toStrictEqual([
      "config",
    ]);
    expect(
      await refusalsOf(CreateSourceDto, { ...ADD, config: { l: ["a"], s: "b" } }),
    ).toStrictEqual([]);
  });

  it("bounds the config before the schema check has to walk it", async () => {
    const wide = Object.fromEntries(
      Array.from({ length: MAX_CONFIG_FIELDS + 1 }, (_value, index) => [`k${String(index)}`, "v"]),
    );

    expect(await refusalsOf(CreateSourceDto, { ...ADD, config: wide })).toStrictEqual(["config"]);
    expect(
      await refusalsOf(CreateSourceDto, {
        ...ADD,
        config: { s: "x".repeat(MAX_CONFIG_VALUE_LENGTH + 1) },
      }),
    ).toStrictEqual(["config"]);
    expect(
      await refusalsOf(CreateSourceDto, {
        ...ADD,
        config: { l: Array.from({ length: MAX_CONFIG_LIST_LENGTH + 1 }, () => "x") },
      }),
    ).toStrictEqual(["config"]);
  });
});

describe("the patch body", () => {
  it("accepts an empty body, which changes nothing", async () => {
    expect(await refusalsOf(UpdateSourceDto, {})).toStrictEqual([]);
  });

  it("takes two of the column's three statuses, and never the loop's own", async () => {
    expect(await refusalsOf(UpdateSourceDto, { status: "paused" })).toStrictEqual([]);
    expect(await refusalsOf(UpdateSourceDto, { status: "active" })).toStrictEqual([]);
    expect(await refusalsOf(UpdateSourceDto, { status: "error" })).toStrictEqual(["status"]);
  });

  it("holds a new config to the same shape as an add's", async () => {
    expect(await refusalsOf(UpdateSourceDto, { config: { n: 3 } })).toStrictEqual(["config"]);
    expect(await refusalsOf(UpdateSourceDto, { config: { repos: ["a"] } })).toStrictEqual([]);
  });
});

describe("the credential body", () => {
  it("requires a non-empty, bounded secret", async () => {
    expect(await refusalsOf(SetCredentialsDto, {})).toStrictEqual(["secret"]);
    expect(await refusalsOf(SetCredentialsDto, { secret: "" })).toStrictEqual(["secret"]);
    expect(await refusalsOf(SetCredentialsDto, { secret: "x".repeat(4097) })).toStrictEqual([
      "secret",
    ]);
    expect(await refusalsOf(SetCredentialsDto, { secret: "ghp_x" })).toStrictEqual([]);
  });
});

describe("the id", () => {
  it("must be a uuid, so a bad path never reaches a statement", async () => {
    expect(await refusalsOf(SourceParams, { id: "catalog" })).toStrictEqual(["id"]);
    expect(
      await refusalsOf(SourceParams, { id: "5eed001a-0000-4000-8000-000000000001" }),
    ).toStrictEqual([]);
  });
});
