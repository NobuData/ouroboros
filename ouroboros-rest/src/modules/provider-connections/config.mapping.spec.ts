import type { ProviderConnection } from "../db/schema";
import {
  FAKE_CONFIG_SCHEMA,
  FakeModelProviderAdapter,
} from "../providers/adapters/fake.adapter.fixture";
import {
  BASE_URL_FIELD,
  CAPABILITY_NOTE_FIELD,
  PROVIDER_CONFIG_DIALECT,
  SECRET_ANNOTATION,
  type ProviderConfigSchema,
} from "../providers/provider.config";
import {
  STORABLE_FIELDS,
  columnsFor,
  configOf,
  submissionOf,
  unstorableFields,
} from "./config.mapping";

/**
 * Field name ↔ column, and the honest refusal where there is no column.
 *
 * Two properties are asserted rather than described. **Only the two reserved names have
 * columns**, which is what lets one form renderer serve five providers; and **a submitted
 * value with nowhere to go is reported rather than dropped**, which is what turns a real gap
 * in the schema into a `501` somebody can read instead of a setting that silently vanishes.
 */

/** A schema whose only non-reserved field is optional — mockup 07's Copilot card, in miniature. */
const WITH_UNSTORABLE: ProviderConfigSchema = {
  $schema: PROVIDER_CONFIG_DIALECT,
  type: "object",
  title: "Connect a seat-billed provider",
  properties: {
    token: { type: "string", title: "Token", [SECRET_ANNOTATION]: true },
    organization: { type: "string", title: "Billing organization" },
    [CAPABILITY_NOTE_FIELD]: { type: "string", title: "Capability note" },
  },
  required: ["token"],
  additionalProperties: false,
};

/** A stored row, as the repository reads one. */
const row = (
  overrides: Partial<Pick<ProviderConnection, "base_url" | "capability_note">> = {},
): Pick<ProviderConnection, "base_url" | "capability_note"> => ({
  base_url: "http://10.0.4.20:8000/v1",
  capability_note: "self-hosted · A100 ×2",
  ...overrides,
});

describe("which field names have a column", () => {
  it("is the two `provider.config.ts` reserves, and only those", () => {
    // Derived from that file's constants rather than spelled again, so renaming a reserved
    // field is a compile error here rather than a setting that silently stops being stored.
    expect(STORABLE_FIELDS).toEqual([BASE_URL_FIELD, CAPABILITY_NOTE_FIELD]);
  });
});

describe("finding what cannot be stored", () => {
  it("finds nothing when only reserved fields were filled in", () => {
    expect(
      unstorableFields(WITH_UNSTORABLE, {
        token: "ghu_x",
        [CAPABILITY_NOTE_FIELD]: "billed through GitHub",
      }),
    ).toEqual([]);
  });

  it("never reports the credential, which goes to the vault rather than to a column", () => {
    expect(unstorableFields(WITH_UNSTORABLE, { token: "ghu_x" })).toEqual([]);
  });

  it("reports a declared field that was filled in and has no column", () => {
    expect(unstorableFields(WITH_UNSTORABLE, { token: "ghu_x", organization: "acme" })).toEqual([
      "organization",
    ]);
  });

  it("does not report a declared field that was left empty", () => {
    // The check is on the *submitted values*, never on the schema: Copilot declaring an
    // `organization` is fine as long as nobody fills it in, which is why Copilot connects.
    expect(unstorableFields(WITH_UNSTORABLE, { token: "ghu_x", organization: "" })).toEqual([]);
  });

  it("does not report a key the schema never declared", () => {
    // That is a typo and is already a `422` from the schema check. Reporting it here too
    // would answer `501` — *this build cannot* — for a mistake the caller made.
    expect(unstorableFields(WITH_UNSTORABLE, { token: "ghu_x", nonsense: "x" })).toEqual([]);
  });

  it("sorts what it reports, so a message built from it is stable", () => {
    const schema: ProviderConfigSchema = {
      ...WITH_UNSTORABLE,
      properties: {
        ...WITH_UNSTORABLE.properties,
        zone: { type: "string", title: "Zone" },
      },
    };

    expect(unstorableFields(schema, { zone: "eu", organization: "acme" })).toEqual([
      "organization",
      "zone",
    ]);
  });

  it("finds nothing in any submission the fake adapter's schema accepts", () => {
    const adapter = new FakeModelProviderAdapter();

    expect(
      unstorableFields(adapter.configSchema(), {
        [BASE_URL_FIELD]: "https://fake.invalid/v1",
        apiKey: "sk-fake",
      }),
    ).toEqual([]);
  });
});

describe("a submission's columns", () => {
  it("maps the two reserved names onto their columns", () => {
    expect(
      columnsFor({
        [BASE_URL_FIELD]: "http://ken-station.local:11434",
        [CAPABILITY_NOTE_FIELD]: "zero-cost lane",
      }),
    ).toEqual({
      base_url: "http://ken-station.local:11434",
      capability_note: "zero-cost lane",
    });
  });

  it("writes null rather than an empty string for a field nobody filled in", () => {
    // V017 refuses a blank note, and an empty address would satisfy V015's *has a base_url*
    // check while being an address nothing can reach.
    expect(columnsFor({ [BASE_URL_FIELD]: "", [CAPABILITY_NOTE_FIELD]: "" })).toEqual({
      base_url: null,
      capability_note: null,
    });
  });

  it("writes null for a field the schema never had", () => {
    expect(columnsFor({})).toEqual({ base_url: null, capability_note: null });
  });

  it("ignores everything that is not a reserved name", () => {
    // What the caller must have already refused, asserted here so that a caller that forgot
    // does not silently store it somewhere.
    expect(columnsFor({ organization: "acme" })).toEqual({
      base_url: null,
      capability_note: null,
    });
  });
});

describe("a stored row's configuration", () => {
  it("includes only the fields the adapter's schema declares", () => {
    // An Anthropic connection with a capability note — which is every one of them on mockup
    // 07 — yields an empty config, because AC.2's schema declares no such field and handing
    // an adapter a setting it never asked for is how a config acquires keys nobody validates.
    const anthropicShaped: ProviderConfigSchema = {
      ...FAKE_CONFIG_SCHEMA,
      properties: { apiKey: FAKE_CONFIG_SCHEMA.properties.apiKey },
      required: ["apiKey"],
    };

    expect(configOf(anthropicShaped, row())).toEqual({});
  });

  it("includes a declared address and note", () => {
    const schema: ProviderConfigSchema = {
      ...FAKE_CONFIG_SCHEMA,
      properties: {
        ...FAKE_CONFIG_SCHEMA.properties,
        [CAPABILITY_NOTE_FIELD]: { type: "string", title: "Capability note" },
      },
    };

    expect(configOf(schema, row())).toEqual({
      [BASE_URL_FIELD]: "http://10.0.4.20:8000/v1",
      [CAPABILITY_NOTE_FIELD]: "self-hosted · A100 ×2",
    });
  });

  it("omits a declared field the row has no value for", () => {
    expect(configOf(FAKE_CONFIG_SCHEMA, row({ base_url: null }))).toEqual({});
  });

  it("is frozen, so an adapter cannot reach back into its caller's state", () => {
    const config = configOf(FAKE_CONFIG_SCHEMA, row());

    expect(Object.isFrozen(config)).toBe(true);
  });

  it("answers the same values as a mutable submission an edit merges onto", () => {
    const stored = row();

    expect(submissionOf(FAKE_CONFIG_SCHEMA, stored)).toEqual({
      ...configOf(FAKE_CONFIG_SCHEMA, stored),
    });
    expect(Object.isFrozen(submissionOf(FAKE_CONFIG_SCHEMA, stored))).toBe(false);
  });
});
