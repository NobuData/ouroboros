import { supportsPull } from "../provider.adapter";
import { ProviderAdapterError } from "../provider.errors";
import { partitionSubmission } from "../provider.forms";
import {
  FAKE_BASE_URL,
  FAKE_CONFIG,
  FAKE_CONFIG_SCHEMA,
  FAKE_FAILURES,
  FAKE_MODELS,
  FAKE_PULL_EVENTS,
  FAKE_SECRET,
  FakeModelProviderAdapter,
  FakePullingProviderAdapter,
} from "./fake.adapter.fixture";
import { conformanceContext, type AdapterConformance } from "../conformance.fixture";

/**
 * The fake's own behaviour — the part `describeAdapterConformance` does not reach.
 *
 * The kit checks that the fake honours the SPI. This checks that it is a *usable test double*:
 * that scripting works, that it counts calls, that it hands out copies, and that the one thing
 * it derives rather than scripts — a `config` failure from its own required fields — really is
 * derived. That last one matters beyond the fake, because `docs/MODEL_PROVIDERS.md` presents it
 * as the habit an adapter author should copy.
 */

/** The context the members that take one are called with. */
const CONNECTION = conformanceContext({
  sampleConfig: FAKE_CONFIG,
  secret: FAKE_SECRET,
} as AdapterConformance);

describe("what the fake answers by default", () => {
  it("registers as custom, the kind V015 has for an endpoint with no adapter opinion", () => {
    expect(new FakeModelProviderAdapter().kind).toBe("custom");
  });

  it("takes a kind, so it can stand in for a specific provider", () => {
    // A discovery-scheduler test that needs an `ollama` row is better served by a fake saying
    // `ollama` than by a real daemon.
    expect(new FakeModelProviderAdapter({ kind: "anthropic" }).kind).toBe("anthropic");
  });

  it("succeeds when nothing is scripted", () => {
    // The default a test should not have to ask for.
    return expect(
      new FakeModelProviderAdapter().validate(FAKE_CONFIG, FAKE_SECRET),
    ).resolves.toEqual({ status: "ok", latencyMs: 7, detail: "200" });
  });

  it("reports the latency it was built with", async () => {
    const adapter = new FakeModelProviderAdapter({ latencyMs: 38 });

    await expect(adapter.validate(FAKE_CONFIG, FAKE_SECRET)).resolves.toMatchObject({
      latencyMs: 38,
    });
  });

  it("answers the models it was built with", async () => {
    await expect(new FakeModelProviderAdapter().discoverModels(CONNECTION)).resolves.toEqual(
      FAKE_MODELS,
    );
  });

  it("hands out a copy of the model list", async () => {
    // A caller sorting the answer in place must not reorder the fixture the next assertion
    // compares against.
    const adapter = new FakeModelProviderAdapter();
    const models = await adapter.discoverModels(CONNECTION);
    models.reverse();

    await expect(adapter.discoverModels(CONNECTION)).resolves.toEqual(FAKE_MODELS);
  });

  it("counts what it was asked to do", async () => {
    const adapter = new FakePullingProviderAdapter();

    await adapter.validate(FAKE_CONFIG, FAKE_SECRET);
    await adapter.discoverModels(CONNECTION);

    for await (const _event of adapter.pullModel(CONNECTION, "phi4:14b")) {
      // Drained: the counter increments when the generator is first pulled from, not when it is
      // constructed, so a test that never iterated would see zero.
    }

    expect(adapter.calls).toEqual({ validate: 1, discoverModels: 1, pullModel: 1 });
  });
});

describe("scripting", () => {
  it.each(["auth", "network", "upstream", "rate_limit"] as const)(
    "answers the recorded %s failure once",
    async (errorClass) => {
      const adapter = new FakeModelProviderAdapter().willFail(errorClass);

      await expect(adapter.validate(FAKE_CONFIG, FAKE_SECRET)).resolves.toEqual(
        FAKE_FAILURES[errorClass],
      );
      // One call, one scripted outcome. A script that repeated forever would make a test that
      // expects recovery impossible to write.
      await expect(adapter.validate(FAKE_CONFIG, FAKE_SECRET)).resolves.toMatchObject({
        status: "ok",
      });
    },
  );

  it("answers scripted outcomes oldest first", async () => {
    const adapter = new FakeModelProviderAdapter().willFail("network").willFail("upstream");

    await expect(adapter.validate(FAKE_CONFIG, FAKE_SECRET)).resolves.toMatchObject({
      errorClass: "network",
    });
    await expect(adapter.validate(FAKE_CONFIG, FAKE_SECRET)).resolves.toMatchObject({
      errorClass: "upstream",
    });
  });

  it("throws from discovery rather than answering an empty list", async () => {
    // `discoverModels` answers a list and has no room for a failure — so a provider that could
    // not be asked must not look like a provider with no models.
    const adapter = new FakeModelProviderAdapter().willFailDiscovery("upstream");

    await expect(adapter.discoverModels(CONNECTION)).rejects.toThrow(ProviderAdapterError);
    await expect(adapter.discoverModels(CONNECTION)).rejects.toMatchObject({
      errorClass: "upstream",
      detail: "503 upstream",
    });
  });
});

describe("the config failure it derives rather than scripts", () => {
  it("finds its own required field missing before anything is opened", async () => {
    // The habit `docs/MODEL_PROVIDERS.md` asks an author to copy: a missing address is something
    // an adapter knows about before it opens a socket, and reporting it as `network` because the
    // socket failed would send somebody to check a firewall.
    await expect(new FakeModelProviderAdapter().validate({}, FAKE_SECRET)).resolves.toEqual({
      status: "failed",
      errorClass: "config",
      detail: "baseUrl required",
    });
  });

  it("treats a blank value as missing", async () => {
    await expect(
      new FakeModelProviderAdapter().validate({ baseUrl: "" }, FAKE_SECRET),
    ).resolves.toMatchObject({ errorClass: "config" });
  });

  it("checks configuration before it consults the script", async () => {
    // Otherwise a suite that scripted an auth failure and forgot the address would be told about
    // the wrong one of its two mistakes.
    const adapter = new FakeModelProviderAdapter().willFail("auth");

    await expect(adapter.validate({}, FAKE_SECRET)).resolves.toMatchObject({
      errorClass: "config",
    });
  });
});

describe("the fake's schema", () => {
  it("is mockup 07's two-field shape — a required address and an optional key", () => {
    // Deliberately not the simplest schema: it is the only card shape that exercises both
    // halves of `partitionSubmission`, which every suite built on this fake then gets for free.
    expect(partitionSubmission(FAKE_CONFIG_SCHEMA, { baseUrl: FAKE_BASE_URL })).toEqual({
      config: { baseUrl: FAKE_BASE_URL },
      secret: null,
    });
    expect(
      partitionSubmission(FAKE_CONFIG_SCHEMA, { baseUrl: FAKE_BASE_URL, apiKey: FAKE_SECRET }),
    ).toEqual({ config: { baseUrl: FAKE_BASE_URL }, secret: FAKE_SECRET });
  });

  it("is handed out as a fresh copy every call", () => {
    const adapter = new FakeModelProviderAdapter();

    expect(adapter.configSchema()).not.toBe(adapter.configSchema());
    expect(adapter.configSchema()).toEqual(FAKE_CONFIG_SCHEMA);
  });

  it("uses a credential distinctive enough for the kit to find", () => {
    // The kit searches every rendered detail for this exact string. A secret of "x" would appear
    // in a hundred innocent sentences and prove nothing.
    expect(FAKE_SECRET.length).toBeGreaterThan(16);
  });
});

describe("the pulling fake", () => {
  it("declares the capability and is reachable only through the guard", () => {
    const adapter = new FakePullingProviderAdapter();

    expect(adapter.capabilities().pull).toBe(true);
    expect(supportsPull(adapter)).toBe(true);
  });

  it("defaults to the kind a pulling provider is in this product", () => {
    expect(new FakePullingProviderAdapter().kind).toBe("ollama");
  });

  it("streams the scripted events in order", async () => {
    const adapter = new FakePullingProviderAdapter();
    const events = [];

    for await (const event of adapter.pullModel(CONNECTION, "qwen3-coder:32b")) {
      events.push(event);
    }

    expect(events).toEqual(FAKE_PULL_EVENTS);
  });

  it("reports a manifest fetch with no byte counts at all", () => {
    // The reason `ModelPullProgress`'s counts are nullable rather than defaulted to zero: a
    // `0 of 0` progress bar is a claim, and an absent one is the truth.
    expect(FAKE_PULL_EVENTS[0]).toMatchObject({ completedBytes: null, totalBytes: null });
  });

  it("takes its own events, for a suite that needs a different shape", async () => {
    const adapter = new FakePullingProviderAdapter({}, [
      { status: "success", completedBytes: 1, totalBytes: 1, done: true },
    ]);
    const events = [];

    for await (const event of adapter.pullModel(CONNECTION, "phi4:14b")) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
  });
});
