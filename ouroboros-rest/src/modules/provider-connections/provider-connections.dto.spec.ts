import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { VALIDATION_FAILED, validationPipe } from "../errors/validation";
import { CAPABILITY_NOTE_MAX_LENGTH } from "../providers/provider.config";
import {
  ConnectionParams,
  CreateConnectionDto,
  ListConnectionsQuery,
  MAX_CONFIG_FIELDS,
  MAX_CONFIG_VALUE_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_MONTHLY_CAP_CENTS,
  MAX_PASSWORD_LENGTH,
  MAX_SECRET_LENGTH,
  RevealConnectionDto,
  RotateConnectionDto,
  UpdateConnectionDto,
} from "./provider-connections.dto";

/**
 * The request grammar, and the schema CHECKs it restates.
 *
 * The database is still the authority — `provider_connections_display_name_present` and its
 * siblings are what actually stop a blank name being stored. What is asserted here is that
 * the *client* is told which field was wrong rather than being handed a `500` from a
 * constraint whose message they may not be shown, and that the two rules a `PATCH` needs —
 * *absent means leave alone*, *null means clear* — survive the pipe.
 */

/** Validate a body the way the pipe would, and report which fields were refused. */
async function refusalsOf(type: unknown, body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(type as new () => object, body));

  return errors.map((error) => error.property).sort();
}

/** A well-formed add, which the cases below vary one field of. */
const ADD = {
  kind: "anthropic",
  displayName: "Anthropic Claude",
  config: { apiKey: "sk-ant-api03-x" },
};

describe("the connection id in a path", () => {
  it("accepts a uuid", async () => {
    await expect(
      refusalsOf(ConnectionParams, { id: "5eed000c-0000-4000-8000-000000000001" }),
    ).resolves.toEqual([]);
  });

  it("refuses anything that could not name a row", async () => {
    // A `422` before a statement is issued, rather than a round trip to answer `404`.
    await expect(refusalsOf(ConnectionParams, { id: "not-a-uuid" })).resolves.toEqual(["id"]);
  });
});

describe("the listing's window", () => {
  it("is the shared pagination query and nothing else", async () => {
    await expect(refusalsOf(ListConnectionsQuery, {})).resolves.toEqual([]);
    await expect(refusalsOf(ListConnectionsQuery, { limit: 0 })).resolves.toEqual(["limit"]);
  });
});

describe("adding a provider", () => {
  it("accepts a well-formed body", async () => {
    await expect(refusalsOf(CreateConnectionDto, ADD)).resolves.toEqual([]);
  });

  it.each([
    ["kind", { kind: "not-a-kind" }],
    ["displayName", { displayName: "" }],
    ["config", { config: "not-an-object" }],
    ["monthlyCapCents", { monthlyCapCents: -1 }],
  ])("refuses a bad %s", async (field, override) => {
    await expect(refusalsOf(CreateConnectionDto, { ...ADD, ...override })).resolves.toEqual([
      field,
    ]);
  });

  it("checks the kind against the schema's six rather than against the registry's set", async () => {
    // A kind this build has no adapter for is a `501` naming the ones it has, which is a more
    // useful answer than *not one of six* — so `custom` passes the pipe and meets the
    // registry.
    await expect(refusalsOf(CreateConnectionDto, { ...ADD, kind: "custom" })).resolves.toEqual([]);
  });

  describe("the display name", () => {
    it("refuses one that is only whitespace, as V015 does", async () => {
      await expect(
        refusalsOf(CreateConnectionDto, { ...ADD, displayName: "   " }),
      ).resolves.toEqual(["displayName"]);
    });

    it("refuses surrounding whitespace rather than trimming it for the caller", async () => {
      // Trimming would store something other than what was sent, which is the failure this
      // surface refuses everywhere else.
      await expect(
        refusalsOf(CreateConnectionDto, { ...ADD, displayName: " Anthropic " }),
      ).resolves.toEqual(["displayName"]);
    });

    it("refuses one longer than the column", async () => {
      await expect(
        refusalsOf(CreateConnectionDto, {
          ...ADD,
          displayName: "x".repeat(MAX_DISPLAY_NAME_LENGTH + 1),
        }),
      ).resolves.toEqual(["displayName"]);
    });
  });

  describe("the configuration's shape", () => {
    it("accepts a flat object of strings", async () => {
      await expect(
        refusalsOf(CreateConnectionDto, { ...ADD, config: { a: "1", b: "2" } }),
      ).resolves.toEqual([]);
    });

    it("accepts an empty object, for a provider that takes nothing", async () => {
      await expect(refusalsOf(CreateConnectionDto, { ...ADD, config: {} })).resolves.toEqual([]);
    });

    it.each([
      ["an array", []],
      ["null", null],
      ["a string", "baseUrl=x"],
      ["a nested object", { a: { b: "c" } }],
      ["a number value", { a: 1 }],
    ])("refuses %s", async (_shape, config) => {
      await expect(refusalsOf(CreateConnectionDto, { ...ADD, config })).resolves.toEqual([
        "config",
      ]);
    });

    it("refuses more settings than any schema declares", async () => {
      // The cheap refusal in front of the adapter's own check: `additionalProperties: false`
      // would catch these, but only after an object with fifty thousand keys had been built.
      const config = Object.fromEntries(
        Array.from({ length: MAX_CONFIG_FIELDS + 1 }, (_value, n) => [`f${n.toString()}`, "x"]),
      );

      await expect(refusalsOf(CreateConnectionDto, { ...ADD, config })).resolves.toEqual([
        "config",
      ]);
    });

    it("refuses a value longer than the longest column any setting lands in", async () => {
      await expect(
        refusalsOf(CreateConnectionDto, {
          ...ADD,
          config: { baseUrl: "x".repeat(MAX_CONFIG_VALUE_LENGTH + 1) },
        }),
      ).resolves.toEqual(["config"]);
    });
  });

  describe("the monthly cap", () => {
    it("admits zero, which is a real instruction meaning spend nothing", async () => {
      await expect(
        refusalsOf(CreateConnectionDto, { ...ADD, monthlyCapCents: 0 }),
      ).resolves.toEqual([]);
    });

    it("admits null and absence alike, both meaning no cap", async () => {
      await expect(
        refusalsOf(CreateConnectionDto, { ...ADD, monthlyCapCents: null }),
      ).resolves.toEqual([]);
      await expect(refusalsOf(CreateConnectionDto, ADD)).resolves.toEqual([]);
    });

    it("refuses a fraction of a cent", async () => {
      await expect(
        refusalsOf(CreateConnectionDto, { ...ADD, monthlyCapCents: 1.5 }),
      ).resolves.toEqual(["monthlyCapCents"]);
    });

    it("refuses more than the column can hold", async () => {
      // Bounded here because an out-of-range `integer` is a `22003` from the driver, and the
      // client deserves to be told which field was out of range.
      await expect(
        refusalsOf(CreateConnectionDto, { ...ADD, monthlyCapCents: MAX_MONTHLY_CAP_CENTS + 1 }),
      ).resolves.toEqual(["monthlyCapCents"]);
    });
  });
});

describe("editing a connection", () => {
  it("accepts an empty body, which changes nothing", async () => {
    await expect(refusalsOf(UpdateConnectionDto, {})).resolves.toEqual([]);
  });

  it("accepts each setting on its own", async () => {
    for (const body of [
      { displayName: "Renamed" },
      { enabled: false },
      { monthlyCapCents: 75_000 },
      { capabilityNote: "a note" },
      { config: { baseUrl: "http://10.0.4.20:8000/v1" } },
    ]) {
      await expect(refusalsOf(UpdateConnectionDto, body)).resolves.toEqual([]);
    }
  });

  it("admits null on the two settings whose absence is itself a value", async () => {
    await expect(
      refusalsOf(UpdateConnectionDto, { monthlyCapCents: null, capabilityNote: null }),
    ).resolves.toEqual([]);
  });

  it("does not admit null on a switch or a name, which have no meaning for one", async () => {
    await expect(refusalsOf(UpdateConnectionDto, { enabled: null })).resolves.toEqual(["enabled"]);
    await expect(refusalsOf(UpdateConnectionDto, { displayName: null })).resolves.toEqual([
      "displayName",
    ]);
  });

  it("refuses a capability note longer than the column", async () => {
    await expect(
      refusalsOf(UpdateConnectionDto, {
        capabilityNote: "x".repeat(CAPABILITY_NOTE_MAX_LENGTH + 1),
      }),
    ).resolves.toEqual(["capabilityNote"]);
  });

  it("refuses a blank capability note, which V017 refuses too", async () => {
    await expect(refusalsOf(UpdateConnectionDto, { capabilityNote: "  " })).resolves.toEqual([
      "capabilityNote",
    ]);
  });

  it("carries no credential field at all, and the pipe refuses one outright", async () => {
    // Replacing a credential is `rotate`, which validates before it destroys; an edit that
    // could silently carry a key would be that operation without the check. `whitelist` plus
    // `forbidNonWhitelisted` is what turns *not declared* into *refused* rather than into
    // *quietly dropped* — the mass-assignment failure, closed by construction.
    await expect(
      validationPipe().transform(
        { secret: "sk-ant-api03-x" },
        { type: "body", metatype: UpdateConnectionDto },
      ),
    ).rejects.toMatchObject({ response: { code: VALIDATION_FAILED } });
  });
});

describe("revealing", () => {
  it("accepts an empty body, which is what a fresh session sends", async () => {
    await expect(refusalsOf(RevealConnectionDto, {})).resolves.toEqual([]);
  });

  it("accepts a password", async () => {
    await expect(refusalsOf(RevealConnectionDto, { password: "correct-horse" })).resolves.toEqual(
      [],
    );
  });

  it("refuses an empty one, and one past the library's own maximum", async () => {
    await expect(refusalsOf(RevealConnectionDto, { password: "" })).resolves.toEqual(["password"]);
    await expect(
      refusalsOf(RevealConnectionDto, { password: "x".repeat(MAX_PASSWORD_LENGTH + 1) }),
    ).resolves.toEqual(["password"]);
  });
});

describe("rotating", () => {
  it("requires the new credential", async () => {
    await expect(refusalsOf(RotateConnectionDto, {})).resolves.toEqual(["secret"]);
  });

  it("accepts one, unnormalised", async () => {
    // A credential is an opaque string: a service that stripped a character would break a key
    // that legitimately carried it.
    const padded = "  sk-ant-api03-x  ";

    await expect(refusalsOf(RotateConnectionDto, { secret: padded })).resolves.toEqual([]);
    expect(plainToInstance(RotateConnectionDto, { secret: padded }).secret).toBe(padded);
  });

  it("refuses one longer than this API will accept", async () => {
    await expect(
      refusalsOf(RotateConnectionDto, { secret: "x".repeat(MAX_SECRET_LENGTH + 1) }),
    ).resolves.toEqual(["secret"]);
  });
});
