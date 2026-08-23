import {
  FAKE_CONFIG_SCHEMA,
  FakeModelProviderAdapter,
} from "../providers/adapters/fake.adapter.fixture";
import {
  BASE_URL_FIELD,
  CAPABILITY_NOTE_MAX_LENGTH,
  PROVIDER_CONFIG_DIALECT,
  type ProviderConfigSchema,
  type ProviderFieldSchema,
} from "../providers/provider.config";
import { configViolations, fieldViolations } from "./config.validation";

/**
 * A submission, checked against an adapter's own schema.
 *
 * The dialect is closed — `provider.config.ts` admits seven keywords and
 * `configSchemaViolations` is the gate that keeps it closed — so this suite is exhaustive
 * rather than representative: every keyword has a case, and the shape rules (`required`,
 * `additionalProperties`) have one each.
 */

/** A schema exercising every keyword the dialect has, in one object. */
const EVERY_KEYWORD: ProviderConfigSchema = {
  $schema: PROVIDER_CONFIG_DIALECT,
  type: "object",
  title: "Connect everything",
  properties: {
    [BASE_URL_FIELD]: { type: "string", title: "Base URL", format: "uri", minLength: 1 },
    region: { type: "string", title: "Region", enum: ["us-east-1", "eu-west-1"] },
    note: { type: "string", title: "Note", maxLength: CAPABILITY_NOTE_MAX_LENGTH },
    handle: { type: "string", title: "Handle", pattern: "^[a-z][a-z0-9-]*$" },
  },
  required: [BASE_URL_FIELD],
  additionalProperties: false,
};

describe("checking a submission against a schema", () => {
  it("accepts a submission that satisfies every rule", () => {
    expect(
      configViolations(EVERY_KEYWORD, {
        [BASE_URL_FIELD]: "https://provider.example/v1",
        region: "eu-west-1",
        note: "self-hosted",
        handle: "acme-robotics",
      }),
    ).toEqual({});
  });

  it("accepts a submission that fills in only what is required", () => {
    expect(configViolations(EVERY_KEYWORD, { [BASE_URL_FIELD]: "https://x.example" })).toEqual({});
  });

  describe("the shape rules", () => {
    it("names a required field that was not sent", () => {
      expect(configViolations(EVERY_KEYWORD, {})).toEqual({
        [BASE_URL_FIELD]: ["Base URL is required"],
      });
    });

    it("reads an empty string as not sent, which is what an untouched input submits", () => {
      // The same reading `partitionSubmission` gives an empty optional credential. A schema
      // that required a field means *fill this in*, and `""` has not.
      expect(configViolations(EVERY_KEYWORD, { [BASE_URL_FIELD]: "" })).toEqual({
        [BASE_URL_FIELD]: ["Base URL is required"],
      });
    });

    it("leaves an optional field alone when it is empty", () => {
      expect(
        configViolations(EVERY_KEYWORD, { [BASE_URL_FIELD]: "https://x.example", region: "" }),
      ).toEqual({});
    });

    it("refuses a setting the schema does not declare", () => {
      // `additionalProperties: false` in the dialect, as a message rather than as a silent
      // drop: a value discarded without complaint is a setting somebody believes they made.
      expect(
        configViolations(EVERY_KEYWORD, { [BASE_URL_FIELD]: "https://x.example", nonsense: "x" }),
      ).toEqual({ nonsense: ["nonsense is not a setting this provider takes"] });
    });
  });

  describe("the keyword rules", () => {
    it.each([
      ["enum", { region: "ap-south-1" }, "region", "Region must be one of us-east-1, eu-west-1"],
      [
        "maxLength",
        { note: "x".repeat(CAPABILITY_NOTE_MAX_LENGTH + 1) },
        "note",
        `Note must be at most ${CAPABILITY_NOTE_MAX_LENGTH} characters`,
      ],
      ["pattern", { handle: "Acme" }, "handle", "Handle is not in the expected format"],
      [
        "format: uri — a host typed with no scheme, which is the commonest address mistake",
        { [BASE_URL_FIELD]: "ken-station.local:11434" },
        BASE_URL_FIELD,
        'Base URL is not usable: the address scheme "ken-station.local:" is not http or https',
      ],
      [
        "format: uri — a credential pasted into the address",
        { [BASE_URL_FIELD]: "http://key:secret@10.0.4.20:8000/v1" },
        BASE_URL_FIELD,
        "Base URL is not usable: the address must not carry a credential — use the API key field",
      ],
    ])("reports %s", (_keyword, values, field, message) => {
      const violations = configViolations(EVERY_KEYWORD, {
        [BASE_URL_FIELD]: "https://x.example",
        ...values,
      });

      expect(violations[field]).toContain(message);
    });

    it("reports minLength", () => {
      const schema: ProviderConfigSchema = {
        ...EVERY_KEYWORD,
        properties: { token: { type: "string", title: "Token", minLength: 8 } },
        required: [],
      };

      expect(configViolations(schema, { token: "short" })).toEqual({
        token: ["Token must be at least 8 characters"],
      });
    });

    it("collects every complaint about every field in one answer", () => {
      // A person filling in a form should be told about all four mistakes at once rather
      // than one per attempt — the same argument `configSchemaViolations` makes.
      const violations = configViolations(EVERY_KEYWORD, {
        [BASE_URL_FIELD]: "not-a-url",
        region: "ap-south-1",
        handle: "Acme",
      });

      expect(Object.keys(violations).sort()).toEqual([BASE_URL_FIELD, "handle", "region"]);
    });

    it("reports more than one complaint about a single field", () => {
      const field: ProviderFieldSchema = {
        type: "string",
        title: "Handle",
        minLength: 10,
        pattern: "^[a-z]+$",
      };

      expect(fieldViolations(field, "Ac")).toEqual([
        "Handle must be at least 10 characters",
        "Handle is not in the expected format",
      ]);
    });
  });

  describe("an address is checked through AC.3's own policy", () => {
    it("accepts a private address, because that is the whole use case", () => {
      // `provider.address.ts` allows RFC-1918 deliberately: both address-taking adapters
      // exist to reach a model server the customer runs themselves. A form check that
      // refused one would refuse the only thing it is for.
      expect(
        fieldViolations(
          { type: "string", title: "Host", format: "uri" },
          "http://10.0.4.20:8000/v1",
        ),
      ).toEqual([]);
    });

    it("gives the same answer the adapter would about the same string", () => {
      // The point of sharing the policy rather than parsing here: a form that asked its own
      // question would eventually disagree with the adapter about one of these.
      expect(
        fieldViolations({ type: "string", title: "Host", format: "uri" }, "file:///etc/passwd"),
      ).toEqual(['Host is not usable: the address scheme "file:" is not http or https']);
    });
  });

  describe("how a pattern is read", () => {
    it("is a search rather than a full match, exactly as JSON Schema specifies", () => {
      // An adapter that means "the whole value" writes `^…$`, and both adapters that declare
      // a pattern do. Anchoring here would refuse values a generic validator — and therefore
      // the add-form's own client-side check — accepts.
      expect(
        fieldViolations({ type: "string", title: "Handle", pattern: "ok" }, "not-ok!"),
      ).toEqual([]);
    });

    it("refuses a value when the expression will not compile", () => {
      // A broken adapter rather than a bad value, and refusing is the safe direction: a
      // pattern nobody can evaluate must not read as *anything is fine*.
      expect(
        fieldViolations({ type: "string", title: "Handle", pattern: "([unclosed" }, "anything"),
      ).toEqual(["Handle is not in the expected format"]);
    });
  });

  describe("against the adapters that actually ship", () => {
    it("accepts what the fake adapter's own sample configuration says", () => {
      // The fake's schema is mockup 07's vLLM card — a required address and an optional key —
      // which is the only shape that exercises both halves at once.
      expect(
        configViolations(FAKE_CONFIG_SCHEMA, { [BASE_URL_FIELD]: "https://fake.invalid/v1" }),
      ).toEqual({});
    });

    it("refuses a submission the adapter would then have to refuse itself", () => {
      const adapter = new FakeModelProviderAdapter();

      expect(configViolations(adapter.configSchema(), {})).toEqual({
        [BASE_URL_FIELD]: ["Base URL is required"],
      });
    });
  });
});
