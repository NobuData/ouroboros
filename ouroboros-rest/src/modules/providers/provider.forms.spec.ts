import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PROVIDER_CONNECTION_KINDS } from "../db/schema";
import { CARD_SHAPES } from "./card.shapes.fixture";
import { BASE_URL_FIELD, SECRET_ANNOTATION, type ProviderConfigSchema } from "./provider.config";
import { partitionSubmission, secretFieldName, toFormFields, widgetFor } from "./provider.forms";

/**
 * AC.1's third acceptance criterion, in two halves.
 *
 * *"Config schemas render AE.5's forms with **zero UI special-casing** — proven with a fixture,
 * not asserted."*
 *
 *   * **The fixture** is `card.shapes.fixture.ts`: mockup 07's five cards as schemas, each with
 *     the field list it must render to, written out in full. The five differ in label, in
 *     widget, in how many fields there are and in whether a credential is collected at all —
 *     and they all come out of the same call.
 *   * **The proof there is no special-casing** is reading this module's own source with its
 *     comments stripped and failing if any of V015's six kinds appears in the code. That is the
 *     only version of the claim that survives somebody being in a hurry; a test named *renders
 *     without special-casing* asserts nothing.
 *
 * `registry.repository.spec.ts` reads its own module's source for the same kind of reason.
 */

describe("the renderer knows nothing about providers", () => {
  it("names no provider kind anywhere in its code", () => {
    const source = readFileSync(join(__dirname, "provider.forms.ts"), "utf8");
    // Comments are stripped first, deliberately. The claim is about behaviour, and prose that
    // explains which card a rule came from is documentation working rather than a leak.
    const code = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

    for (const kind of PROVIDER_CONNECTION_KINDS) {
      expect(code).not.toContain(kind);
    }
  });

  it("imports nothing from an adapter", () => {
    // The other half of the same claim: a renderer that reached for an adapter would have
    // acquired a provider's opinion through the back door. `.dependency-cruiser.cjs` enforces
    // this across the whole service; here it is asserted where it matters most.
    const source = readFileSync(join(__dirname, "provider.forms.ts"), "utf8");

    expect(source).not.toContain("./adapters/");
  });
});

describe("mockup 07's five cards", () => {
  it.each(CARD_SHAPES.map((shape) => [shape.kind, shape.drawn, shape] as const))(
    "renders the %s card — %s",
    (_kind, _drawn, shape) => {
      expect(toFormFields(shape.schema)).toEqual(shape.fields);
    },
  );

  it("draws five different-looking cards out of one function", () => {
    // The summary of the whole fixture: same call, five shapes. If this ever collapses to one
    // shape, the dialect has stopped being expressive enough and somebody is about to add a
    // branch to a card component.
    const rendered = CARD_SHAPES.map((shape) =>
      toFormFields(shape.schema)
        .map((field) => `${field.label}:${field.widget}${field.required ? "!" : "?"}`)
        .join(" + "),
    );

    expect(rendered).toEqual([
      "API key:secret!",
      "API key:secret!",
      "GitHub token:secret!",
      "Base URL:url! + API key:secret?",
      "Host:url!",
    ]);
  });

  it("gives the address field the same name on every card that has one", () => {
    // `Host` and `Base URL` are two labels for one property. That is the reserved-name trick
    // `provider.config.ts` argues for, seen from the renderer's side: a card looking for the
    // address never has to ask which provider it is drawing.
    const addressed = CARD_SHAPES.filter((shape) =>
      toFormFields(shape.schema).some((field) => field.widget === "url"),
    );

    expect(addressed.map((shape) => shape.kind)).toEqual(["openai_compatible", "ollama"]);

    for (const shape of addressed) {
      const address = toFormFields(shape.schema).find((field) => field.widget === "url");

      expect(address?.name).toBe(BASE_URL_FIELD);
    }
  });
});

describe("widgetFor", () => {
  it("draws a credential as a masked row whatever else it says about itself", () => {
    // Order of precedence, asserted rather than assumed: getting this wrong renders a key in
    // the clear on a page somebody screenshots.
    expect(
      widgetFor({
        type: "string",
        title: "Key endpoint",
        format: "uri",
        enum: ["a", "b"],
        [SECRET_ANNOTATION]: true,
      }),
    ).toBe("secret");
  });

  it.each([
    ["select", { type: "string", title: "Region", enum: ["us", "eu"] }],
    ["url", { type: "string", title: "Base URL", format: "uri" }],
    ["text", { type: "string", title: "Account" }],
  ] as const)("draws %s", (expected, field) => {
    expect(widgetFor(field)).toBe(expected);
  });
});

describe("secretFieldName", () => {
  it("finds the field routed to the vault", () => {
    expect(secretFieldName(CARD_SHAPES[0].schema)).toBe("apiKey");
  });

  it("answers null for a provider that needs no credential", () => {
    // The ordinary state of a local one, not an unfinished schema.
    const ollama = CARD_SHAPES.find((shape) => shape.kind === "ollama");

    expect(secretFieldName(ollama!.schema)).toBeNull();
  });
});

describe("partitionSubmission", () => {
  const twoField = CARD_SHAPES.find((shape) => shape.kind === "openai_compatible")!.schema;

  it("keeps the credential out of the configuration", () => {
    // The reason this function exists rather than each consumer splitting the object by hand.
    // V015's CHECK guards the *encrypted* column; nothing stops a plaintext key being written
    // into `base_url` by a caller that got the split wrong once.
    const submission = partitionSubmission(twoField, {
      [BASE_URL_FIELD]: "http://10.0.4.20:8000/v1",
      apiKey: "sk-secret-value",
    });

    expect(submission.config).toEqual({ [BASE_URL_FIELD]: "http://10.0.4.20:8000/v1" });
    expect(submission.secret).toBe("sk-secret-value");
    expect(JSON.stringify(submission.config)).not.toContain("sk-secret-value");
  });

  it("treats an untouched optional key row as no credential", () => {
    // Mockup 07's vLLM card ships with that row empty. Sealing `""` would produce a connection
    // that looks credentialled and fails at first use.
    expect(
      partitionSubmission(twoField, { [BASE_URL_FIELD]: "http://host:8000/v1", apiKey: "" }).secret,
    ).toBeNull();
  });

  it("answers a null credential for a schema that declares none", () => {
    const ollama = CARD_SHAPES.find((shape) => shape.kind === "ollama")!.schema;

    expect(
      partitionSubmission(ollama, { [BASE_URL_FIELD]: "http://ken-station.local:11434" }),
    ).toEqual({ config: { [BASE_URL_FIELD]: "http://ken-station.local:11434" }, secret: null });
  });

  it("drops values the schema does not declare", () => {
    // `additionalProperties: false` says these are not configuration. Passing one through would
    // store a value nothing validates and nothing renders.
    expect(
      partitionSubmission(twoField, {
        [BASE_URL_FIELD]: "http://host:8000/v1",
        region: "eu-west-1",
      }).config,
    ).toEqual({ [BASE_URL_FIELD]: "http://host:8000/v1" });
  });

  it("omits a field nobody filled in rather than storing an undefined", () => {
    const optionalOnly: ProviderConfigSchema = {
      ...twoField,
      required: [],
    };

    expect(partitionSubmission(optionalOnly, {}).config).toEqual({});
  });
});
