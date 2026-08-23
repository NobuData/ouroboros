import { chipMeta, hostOf, providerHealthResource } from "./resources";
import type { ProviderHealthSnapshot } from "./snapshot";

/**
 * The chips, against the mockup that specifies them.
 *
 * `docs/mockups/06-model-routing.html`'s `.phealth` strip draws five, and each one is a
 * different combination of what is and is not known:
 *
 * ```
 * Anthropic          ● 42ms
 * Cursor             ●
 * GitHub Copilot     ⚠ degraded · elevated latency
 * OpenAI-compatible  ● vLLM local
 * Ollama             ● workstation · 3 models
 * ```
 *
 * They are asserted here as five cases of one composition rule rather than as five branches,
 * which is the claim worth testing: `Cursor ●` and `Ollama ● workstation · 3 models` come out
 * of the same code because the second knows two more facts, not because anything asked which
 * provider it was.
 *
 * This is also where the Y.4 parity criterion is met in the form it can be met in today —
 * Y.4 ([#192](https://github.com/NobuData/ouroboros/issues/192)) has not landed, so its rows
 * are stood up here as fixtures and the payload is asserted against the mockup itself. The
 * same five states are re-asserted against a real database in
 * `provider-health.integration-spec.ts`.
 */

/** A snapshot with nothing known, which every other case adds to. */
function snapshot(overrides: Partial<ProviderHealthSnapshot> = {}): ProviderHealthSnapshot {
  return {
    connectionId: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
    kind: "anthropic",
    displayName: "Anthropic",
    baseUrl: null,
    status: "unknown",
    checkedAt: null,
    measured: { check: null, latencyMs: null, models: null, detail: null },
    ...overrides,
  };
}

describe("the host on a chip", () => {
  it("is the hostname alone, so two Ollama daemons are distinguishable", () => {
    expect(hostOf("http://workstation:11434")).toBe("workstation");
  });

  it("drops the path as well as the port", () => {
    expect(hostOf("http://vllm.internal:8000/v1")).toBe("vllm.internal");
  });

  it("is absent for a provider reached at its vendor's own endpoint", () => {
    expect(hostOf(null)).toBeNull();
  });

  it("is absent rather than fatal for an address that does not parse", () => {
    // V015's CHECK makes this unreachable through the column. A strip that 500s because one
    // row is malformed still tells a person nothing about the four providers that are fine.
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("the mockup's five chips", () => {
  it("draws `42ms` for a cloud provider whose key validated", () => {
    const chip = snapshot({
      displayName: "Anthropic",
      status: "active",
      measured: { check: "key_validation", latencyMs: 42, models: null, detail: null },
    });

    expect(chipMeta(chip)).toBe("42ms");
  });

  it("draws nothing beside a provider nothing is known about", () => {
    // `Cursor ●` in the mockup. Null rather than an empty string: the `.meta` span has its own
    // colour and spacing, and an empty one is a gap that reads as a bug in the page.
    expect(chipMeta(snapshot({ displayName: "Cursor", kind: "cursor" }))).toBeNull();
  });

  it("draws the seeded degraded line for a provider this service cannot check", () => {
    const chip = snapshot({
      kind: "copilot",
      displayName: "GitHub Copilot",
      status: "error",
      measured: {
        check: null,
        latencyMs: null,
        models: null,
        detail: "degraded · elevated latency",
      },
    });

    expect(chipMeta(chip)).toBe("degraded · elevated latency");
  });

  it("draws the host for a local OpenAI-compatible server", () => {
    const chip = snapshot({
      kind: "openai_compatible",
      displayName: "OpenAI-compatible",
      baseUrl: "http://vllm-local:8000",
      status: "active",
      measured: { check: "reachability", latencyMs: null, models: null, detail: null },
    });

    expect(chipMeta(chip)).toBe("vllm-local");
  });

  it("draws `workstation · 3 models` for a reachable Ollama daemon", () => {
    const chip = snapshot({
      kind: "ollama",
      displayName: "Ollama",
      baseUrl: "http://workstation:11434",
      status: "active",
      measured: { check: "reachability", latencyMs: null, models: 3, detail: null },
    });

    expect(chipMeta(chip)).toBe("workstation · 3 models");
  });
});

describe("what a chip never says", () => {
  it("shows no latency at all rather than `0ms` for a provider nothing measured", () => {
    // Decision M8 in one assertion. `0ms` is not "unknown", it is an excellent latency.
    const chip = providerHealthResource(snapshot({ status: "unknown" }));

    expect(chip.latencyMs).toBeNull();
    expect(chip.meta).toBeNull();
  });

  it("keeps `unknown` as `unknown`, and never as something a client could read as healthy", () => {
    expect(providerHealthResource(snapshot()).status).toBe("unknown");
  });

  it("distinguishes a measured zero from an absent measurement", () => {
    // A loopback daemon really can answer in under half a millisecond, and that rounds to 0.
    // The point of the rule is not that 0 is forbidden — it is that it must have been
    // measured, which `latencyMs: 0` beside a `checkedAt` says and `null` does not.
    const chip = providerHealthResource(
      snapshot({
        status: "active",
        checkedAt: new Date("2026-08-23T10:00:00.000Z"),
        measured: { check: "reachability", latencyMs: 0, models: null, detail: null },
      }),
    );

    expect(chip.latencyMs).toBe(0);
    expect(chip.meta).toBe("0ms");
  });
});

describe("the chip as the contract publishes it", () => {
  it("renders the stamp as ISO 8601", () => {
    const chip = providerHealthResource(
      snapshot({ checkedAt: new Date("2026-08-23T10:00:00.000Z") }),
    );

    expect(chip.checkedAt).toBe("2026-08-23T10:00:00.000Z");
  });

  it("publishes which question produced the state, because the two are different claims", () => {
    const reachable = providerHealthResource(
      snapshot({
        measured: { check: "reachability", latencyMs: 1, models: null, detail: null },
      }),
    );
    const validated = providerHealthResource(
      snapshot({
        measured: { check: "key_validation", latencyMs: 42, models: null, detail: null },
      }),
    );

    expect(reachable.check).toBe("reachability");
    expect(validated.check).toBe("key_validation");
  });

  it("carries every field the strip draws, and nothing that could hold a credential", () => {
    const chip = providerHealthResource(snapshot());

    expect(Object.keys(chip).sort()).toEqual([
      "check",
      "checkedAt",
      "detail",
      "displayName",
      "host",
      "id",
      "kind",
      "latencyMs",
      "meta",
      "models",
      "status",
    ]);
  });
});
