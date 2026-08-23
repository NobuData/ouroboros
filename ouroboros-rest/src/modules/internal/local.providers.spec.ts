import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import { LocalProviders } from "./local.providers";

/**
 * The seam Y.1 replaces, asserted at the size it is today.
 *
 * Two methods over a validated map, so the suite is short — and that is the point of the
 * class existing at all. What it buys is that `lease.ts` asks a *question* rather than
 * reading a variable, so when `provider_connections` (Y.1,
 * [#189](https://github.com/NobuData/ouroboros/issues/189)) arrives the answer moves and the
 * caller does not.
 */

/** A configuration service over a chosen `OURO_LOCAL_PROVIDER_URLS`. */
function providersFor(value?: string): LocalProviders {
  const configuration = testConfiguration(
    value === undefined ? {} : { OURO_LOCAL_PROVIDER_URLS: value },
  );

  return new LocalProviders(
    new AppConfigService({
      getOrThrow: (key: string) => configuration[key as keyof typeof configuration],
      get: (key: string) => configuration[key as keyof typeof configuration],
    } as never),
  );
}

describe("a deployment that declares nothing", () => {
  it("knows about no providers", () => {
    // The normal case, and it is not a misconfiguration: most installations run no local
    // model server. What to tell a worker about it is the lease surface's decision, which is
    // why this answers `undefined` rather than throwing.
    expect(providersFor().declared()).toEqual([]);
    expect(providersFor().addressOf("ollama")).toBeUndefined();
  });
});

describe("a deployment that declares one", () => {
  it("answers with the address the operator wrote", () => {
    expect(providersFor("ollama=http://localhost:11434").addressOf("ollama")).toBe(
      "http://localhost:11434",
    );
  });

  it("still knows nothing about the other kind", () => {
    expect(
      providersFor("ollama=http://localhost:11434").addressOf("openai_compatible"),
    ).toBeUndefined();
  });

  it("lists what was declared", () => {
    expect(providersFor("ollama=http://localhost:11434").declared()).toEqual(["ollama"]);
  });
});

describe("a deployment that declares both", () => {
  const both = "ollama=http://localhost:11434,openai_compatible=http://localhost:8001/v1";

  it("keeps each address with its own kind", () => {
    const providers = providersFor(both);

    expect(providers.addressOf("ollama")).toBe("http://localhost:11434");
    expect(providers.addressOf("openai_compatible")).toBe("http://localhost:8001/v1");
  });

  it("preserves a path on the base URL", () => {
    // vLLM is served at `/v1`, and an address truncated to its origin would send every
    // request to a 404 that looks like the model server being down.
    expect(providersFor(both).addressOf("openai_compatible")).toContain("/v1");
  });

  it("lists both", () => {
    expect(providersFor(both).declared().toSorted()).toEqual(["ollama", "openai_compatible"]);
  });
});
