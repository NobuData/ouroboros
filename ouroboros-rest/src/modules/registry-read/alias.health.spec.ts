import { PROVIDERS_FIX_PATH } from "../registry/aliases.errors";
import {
  ALIAS_HEALTH_STATES,
  NO_KEY_NOTE,
  aliasHealth,
  type AliasHealthConnection,
  type AliasHealthInput,
} from "./alias.health";

/**
 * The `Health` column's derivation ([#588](https://github.com/NobuData/ouroboros/issues/588)),
 * asserted as the pure function it is.
 *
 * Two properties matter more than any single case, and both are checked below rather than
 * assumed:
 *
 *   * **Totality.** Every combination of the four inputs reaches exactly one of the six states.
 *     The table-driven cases walk each status against each of the three discovery shapes, so a
 *     branch added without an answer shows up as a case with no expectation rather than as a
 *     cell that renders nothing.
 *   * **Precedence.** Where two things are wrong at once, the nearer cause wins — an unbound
 *     alias is `no_key` whatever discovery says, a switched-off connection is
 *     `provider_disabled` whatever its status says, and a failing provider is `degraded` whether
 *     or not its catalog still lists the model. Each of those is asserted with *both* faults
 *     present, which is the only version of the claim that means anything.
 *
 * Nothing here reaches a database or a provider, because there is nothing to reach: that is the
 * whole of decision **R8** and the reason this file is beside a function rather than a service.
 */

/** A healthy connection, for a case that wants to vary one thing about it. */
const HEALTHY: AliasHealthConnection = {
  displayName: "Anthropic Claude",
  enabled: true,
  status: "active",
  detail: null,
  checkedAt: new Date("2026-08-25T09:00:00.000Z"),
};

/**
 * The whole input, defaulted to the ordinary row: bound, healthy, discovered.
 *
 * @param overrides - What this case is about.
 * @returns The input.
 */
function input(overrides: Partial<AliasHealthInput> = {}): AliasHealthInput {
  return {
    modelId: "claude-fable-5",
    connection: HEALTHY,
    discovered: true,
    catalogued: true,
    ...overrides,
  };
}

/**
 * The same, with one thing changed about the connection.
 *
 * @param overrides - What this case is about.
 * @returns The connection.
 */
function connection(overrides: Partial<AliasHealthConnection> = {}): AliasHealthConnection {
  return { ...HEALTHY, ...overrides };
}

describe("the health of one alias", () => {
  it("is ok for a bound, enabled, checked alias whose model is still listed", () => {
    expect(aliasHealth(input())).toEqual({
      state: ALIAS_HEALTH_STATES.ok,
      note: null,
      fix: null,
      checkedAt: HEALTHY.checkedAt,
    });
  });

  describe("the unbound row — mockup 21's ✗ no key", () => {
    it("is no_key, with the mockup's note and the Providers pointer", () => {
      expect(
        aliasHealth(input({ connection: null, discovered: false, catalogued: false })),
      ).toEqual({
        state: ALIAS_HEALTH_STATES.noKey,
        note: NO_KEY_NOTE,
        fix: PROVIDERS_FIX_PATH,
        checkedAt: null,
      });
    });

    it("is what a probe could never answer, and says so without one", () => {
      // The orphan proves decision R8: there is nothing to probe, so *no key* has to be a
      // binding fact or it cannot be a fact at all. Asserted as the absence of any dependence
      // on discovery — the two flags say the opposite things and the answer does not move.
      const bound = aliasHealth(input({ connection: null, discovered: true, catalogued: true }));

      expect(bound.state).toBe(ALIAS_HEALTH_STATES.noKey);
      expect(bound.checkedAt).toBeNull();
    });
  });

  describe("an operator's intent", () => {
    it("reads provider_disabled when the connection is switched off", () => {
      expect(aliasHealth(input({ connection: connection({ enabled: false }) }))).toEqual({
        state: ALIAS_HEALTH_STATES.providerDisabled,
        note: "Anthropic Claude is switched off",
        fix: PROVIDERS_FIX_PATH,
        checkedAt: HEALTHY.checkedAt,
      });
    });

    it("reads provider_disabled when the connection is paused", () => {
      expect(aliasHealth(input({ connection: connection({ status: "paused" }) }))).toEqual({
        state: ALIAS_HEALTH_STATES.providerDisabled,
        note: "Anthropic Claude is paused",
        fix: PROVIDERS_FIX_PATH,
        checkedAt: HEALTHY.checkedAt,
      });
    });

    it("prefers the switch to the status, because the switch is the nearer cause", () => {
      const off = aliasHealth(
        input({ connection: connection({ enabled: false, status: "error", detail: "boom" }) }),
      );

      expect(off).toMatchObject({
        state: ALIAS_HEALTH_STATES.providerDisabled,
        note: "Anthropic Claude is switched off",
      });
    });
  });

  describe("what Z.3 last measured", () => {
    it("reads the seeded Copilot row as degraded, with the check's own note", () => {
      // Mockup 21's `coder-fallback` row. AC.6 seeds that connection in `error` with
      // `elevated latency`, the mockup draws `⚠ degraded`, and nothing stores the word — this
      // is where it comes from. See `alias.health.ts`'s header.
      const copilot = aliasHealth(
        input({
          modelId: "gpt-5-codex",
          connection: connection({
            displayName: "GitHub Copilot",
            status: "error",
            detail: "elevated latency",
          }),
        }),
      );

      expect(copilot).toMatchObject({
        state: ALIAS_HEALTH_STATES.degraded,
        note: "elevated latency",
        fix: null,
      });
    });

    it("names the connection when the failed check recorded no detail", () => {
      // A stopped Ollama is the ticket's own case: the probe fails, Z.3 writes `error`, and
      // there may be nothing but the failure to say. The cell still says which provider.
      expect(
        aliasHealth(
          input({
            connection: connection({ displayName: "Ollama · workstation", status: "error" }),
          }),
        ).note,
      ).toBe("the last check of Ollama · workstation failed");
    });

    it("reads an unchecked connection as unknown, never as ok", () => {
      // Decision M8, inherited from Z.3 unchanged: `unknown` is the absence of a measurement,
      // and rendering it as healthy would be the product's one claim about the outside world
      // made on no evidence.
      expect(
        aliasHealth(input({ connection: connection({ status: "unknown", checkedAt: null }) })),
      ).toEqual({
        state: ALIAS_HEALTH_STATES.unknown,
        note: "nothing has checked Anthropic Claude yet",
        fix: null,
        checkedAt: null,
      });
    });

    it("carries Z.3's stamp rather than a clock of its own", () => {
      const checkedAt = new Date("2026-01-02T03:04:05.000Z");

      expect(aliasHealth(input({ connection: connection({ checkedAt }) })).checkedAt).toBe(
        checkedAt,
      );
    });
  });

  describe("discovery membership — AC.6's catalog", () => {
    it("warns when the bound model is no longer listed on the connection", () => {
      expect(aliasHealth(input({ discovered: false, catalogued: true }))).toEqual({
        state: ALIAS_HEALTH_STATES.modelMissing,
        note: "claude-fable-5 is no longer listed on Anthropic Claude",
        fix: null,
        checkedAt: HEALTHY.checkedAt,
      });
    });

    it("stays ok when discovery has never reached the connection", () => {
      // A gap and a mismatch are different claims — V017's distinction, which
      // `AliasesRepository.discovery` already answers both halves of. Flagging every alias on a
      // connection nothing has swept would be a warning about this deployment's sweep.
      expect(aliasHealth(input({ discovered: false, catalogued: false })).state).toBe(
        ALIAS_HEALTH_STATES.ok,
      );
    });

    it("is not asked at all of a provider that is not answering", () => {
      // A catalog read from a failing provider is not evidence that a model went away, so the
      // nearer cause wins even though both faults are present.
      expect(
        aliasHealth(
          input({
            connection: connection({ status: "error", detail: "elevated latency" }),
            discovered: false,
            catalogued: true,
          }),
        ).state,
      ).toBe(ALIAS_HEALTH_STATES.degraded);
    });
  });

  describe("totality", () => {
    const DISCOVERY = [
      { discovered: true, catalogued: true, label: "listed" },
      { discovered: false, catalogued: true, label: "missing from a catalog that exists" },
      { discovered: false, catalogued: false, label: "on a connection nothing has swept" },
    ] as const;

    const STATES: readonly string[] = Object.values(ALIAS_HEALTH_STATES);

    it.each(
      (["active", "paused", "error", "unknown"] as const).flatMap((status) =>
        DISCOVERY.map((discovery) => [status, discovery.label, discovery] as const),
      ),
    )("answers exactly one state for a %s connection, %s", (status, _label, discovery) => {
      const health = aliasHealth(
        input({
          connection: connection({ status }),
          discovered: discovery.discovered,
          catalogued: discovery.catalogued,
        }),
      );

      expect(STATES).toContain(health.state);
      // Only `ok` has nothing to explain; every other state owes the reader a sentence.
      expect(health.note === null).toBe(health.state === ALIAS_HEALTH_STATES.ok);
    });

    it("points at Providers & keys exactly where somebody can act there", () => {
      // The mockup draws *Fix in Providers →* on the orphan row alone, and the switched-off and
      // paused rows are the same kind of claim: a person changes them on mockup 07. A provider
      // failing upstream is not something that page can fix, so those carry no pointer.
      const withFix = [
        aliasHealth(input({ connection: null })),
        aliasHealth(input({ connection: connection({ enabled: false }) })),
        aliasHealth(input({ connection: connection({ status: "paused" }) })),
      ];
      const withoutFix = [
        aliasHealth(input()),
        aliasHealth(input({ connection: connection({ status: "error" }) })),
        aliasHealth(input({ connection: connection({ status: "unknown" }) })),
        aliasHealth(input({ discovered: false, catalogued: true })),
      ];

      expect(withFix.map((health) => health.fix)).toEqual(Array(3).fill(PROVIDERS_FIX_PATH));
      expect(withoutFix.map((health) => health.fix)).toEqual(Array(4).fill(null));
    });

    it("is deterministic — the same facts answer the same cell twice", () => {
      const facts = input({
        connection: connection({ status: "error", detail: "elevated latency" }),
      });

      expect(aliasHealth(facts)).toEqual(aliasHealth(facts));
    });
  });
});
