import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PROVIDER_CONNECTION_KINDS } from "../db/schema";
import {
  FakeModelProviderAdapter,
  FakePullingProviderAdapter,
} from "../providers/adapters/fake.adapter.fixture";
import { CARD_SHAPES } from "../providers/card.shapes.fixture";
import { PROVIDER_CONFIG_DIALECT, type ProviderConfigSchema } from "../providers/provider.config";
import { ModelProviderRegistry } from "../providers/provider.registry";
import { providerCatalog } from "./catalog";

/**
 * The add-provider catalog ([#231](https://github.com/NobuData/ouroboros/issues/231)) — the
 * registry, as a page receives it.
 *
 * Three claims, and they are the ticket's own. **The tiles derive from the registry**: what
 * comes out is exactly what went in, in V015's order, with nothing added and nothing that has
 * to be added to a list. **The fake adapter shows up unbidden**: registered under `custom`
 * beside the five card shapes, it comes out with a working form and this file did not learn
 * its name. **A field type no MVP adapter uses renders anyway**: an `enum` field — the shape
 * AF.3's Bedrock region will take — is a `select` with its choices, from the same function.
 */

/**
 * A schema with the one widget none of mockup 07's five cards asks for.
 *
 * Bedrock's region field, before Bedrock exists: an `enum` is what drives the `select` widget,
 * and the fake declaring one is how the catalog is proven to carry it before an adapter needs
 * it to.
 */
const REGIONAL: ProviderConfigSchema = {
  $schema: PROVIDER_CONFIG_DIALECT,
  type: "object",
  title: "Connect a regional test provider",
  properties: {
    region: {
      type: "string",
      title: "Region",
      description: "Where the provider is served from.",
      enum: ["us-east-1", "eu-west-1"],
      default: "us-east-1",
    },
    apiKey: {
      type: "string",
      title: "API key",
      "x-ouroboros-secret": true,
    },
  },
  required: ["region", "apiKey"],
  additionalProperties: false,
};

/**
 * A registry holding mockup 07's five cards — each a fake answering that card's schema — plus
 * whatever else a case registers.
 *
 * @param extra - Adapters to register beside the five.
 * @returns The registry.
 */
function registryOf(...extra: FakeModelProviderAdapter[]): ModelProviderRegistry {
  return new ModelProviderRegistry([
    ...CARD_SHAPES.map(
      (shape) =>
        new FakeModelProviderAdapter({
          kind: shape.kind as FakeModelProviderAdapter["kind"],
          schema: shape.schema,
        }),
    ),
    ...extra,
  ]);
}

describe("the catalog derives from the registry", () => {
  it("lists every registered kind, and nothing else", () => {
    const catalog = providerCatalog(registryOf());

    expect(catalog.kinds.map((entry) => entry.kind).sort()).toEqual(
      CARD_SHAPES.map((shape) => shape.kind).sort(),
    );
  });

  it("orders the entries as V015 declares the kinds, not as they were registered", () => {
    // `CARD_SHAPES` is deliberately not in V015's order, so this is a real assertion: a page's
    // ordering must not depend on an injector's.
    const catalog = providerCatalog(registryOf());
    const declared = PROVIDER_CONNECTION_KINDS.filter((kind) =>
      CARD_SHAPES.some((shape) => shape.kind === kind),
    );

    expect(catalog.kinds.map((entry) => entry.kind)).toEqual(declared);
  });

  it.each(CARD_SHAPES.map((shape) => [shape.kind, shape.drawn, shape] as const))(
    "carries the %s card's form — %s — exactly as the renderer derives it",
    (_kind, _drawn, shape) => {
      const entry = providerCatalog(registryOf()).kinds.find((one) => one.kind === shape.kind);

      expect(entry).toEqual({
        kind: shape.kind,
        title: shape.schema.title,
        fields: shape.fields,
        capabilities: { discovery: true, pull: false, entitlements: false, invocation: false },
      });
    },
  );

  it("is empty for a build that registers nothing, rather than a failure", () => {
    expect(providerCatalog(new ModelProviderRegistry([]))).toEqual({ kinds: [] });
  });
});

describe("the fake adapter shows up unbidden", () => {
  it("appears in the catalog with a working form, and nobody added it to a list", () => {
    // The ticket's proof. `custom` is the kind V015 has for a provider this product holds no
    // opinion about, and the fake registered under it comes out with the vLLM-shaped form its
    // schema declares — address first, optional key second.
    const fake = new FakeModelProviderAdapter();
    const catalog = providerCatalog(registryOf(fake));

    expect(catalog.kinds).toHaveLength(CARD_SHAPES.length + 1);

    const entry = catalog.kinds.find((one) => one.kind === "custom");

    expect(entry?.title).toBe("Connect a test provider");
    expect(entry?.fields.map((field) => [field.name, field.widget, field.required])).toEqual([
      ["baseUrl", "url", true],
      ["apiKey", "secret", false],
    ]);
  });

  it("renders a field type no MVP adapter declares — an enum, as a select with its choices", () => {
    const fake = new FakeModelProviderAdapter({ schema: REGIONAL });
    const entry = providerCatalog(registryOf(fake)).kinds.find((one) => one.kind === "custom");

    expect(entry?.fields[0]).toMatchObject({
      name: "region",
      widget: "select",
      required: true,
      choices: ["us-east-1", "eu-west-1"],
      defaultValue: "us-east-1",
      help: "Where the provider is served from.",
    });
  });

  it("asks each adapter for a fresh schema rather than holding one", () => {
    // The fake answers a deep copy every call, and the catalog is built from that call: a page
    // holding an entry while somebody types cannot reach back into the adapter's own value.
    const fake = new FakeModelProviderAdapter();
    const spy = jest.spyOn(fake, "configSchema");

    providerCatalog(registryOf(fake));
    providerCatalog(registryOf(fake));

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("the capabilities cross the wire with the fields", () => {
  it("copies each adapter's own flags onto its entry, unchanged", () => {
    // AE.2's (#228) card chooses the models region on `pull` and the refresh affordance on
    // `discovery`, and it lives where neither the registry nor an adapter can be reached — so
    // the flags travel as the adapter answers them, in the SPI's own vocabulary.
    const pulling = new FakePullingProviderAdapter({ discovery: false, entitlements: true });
    const entry = providerCatalog(new ModelProviderRegistry([pulling])).kinds.find(
      (one) => one.kind === "ollama",
    );

    expect(entry?.capabilities).toEqual({
      discovery: false,
      pull: true,
      entitlements: true,
      invocation: false,
    });
  });

  it("asks the adapter rather than remembering an answer", () => {
    // Spied after the registry is built: the registry itself reads the flags once while it
    // checks the adapter in, and what this holds is that the catalog asks again.
    const fake = new FakeModelProviderAdapter();
    const registry = registryOf(fake);
    const spy = jest.spyOn(fake, "capabilities");

    providerCatalog(registry);
    providerCatalog(registry);

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("the catalog knows nothing about providers", () => {
  it("names no provider kind anywhere in its code", () => {
    // The same discipline `provider.forms.spec.ts` holds the renderer to: comments are
    // stripped first, because prose explaining which card a rule came from is documentation
    // working rather than a leak.
    const source = readFileSync(join(__dirname, "catalog.ts"), "utf8");
    const code = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

    for (const kind of PROVIDER_CONNECTION_KINDS) {
      expect(code).not.toContain(kind);
    }
  });

  it("imports nothing from an adapter", () => {
    const source = readFileSync(join(__dirname, "catalog.ts"), "utf8");

    expect(source).not.toContain("/adapters/");
  });
});
