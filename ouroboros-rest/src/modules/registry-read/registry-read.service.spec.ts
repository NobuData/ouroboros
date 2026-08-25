import type { ResolvedPrice } from "../pricing/price";
import type { PricingService } from "../pricing/pricing.service";
import type { AliasesService } from "../registry/aliases.service";
import type { ModelAliasResource } from "../registry/aliases.resources";
import type { VaultService } from "../vault/vault.service";
import { ALIAS_HEALTH_STATES, NO_KEY_NOTE } from "./alias.health";
import type { RegistryReadRepository } from "./registry-read.repository";
import { RegistryReadService } from "./registry-read.service";
import type { RegistryConnectionRow } from "./registry-read.rows";

/**
 * The composition ([#588](https://github.com/NobuData/ouroboros/issues/588)) — which reads
 * happen, how many, and what the row is made of.
 *
 * The derivation itself is `alias.health.spec.ts`'s and the mapping is
 * `registry-read.resources.spec.ts`'s; both run in literals with nothing injected. What is left
 * here is the part that can only be wrong in a service:
 *
 *   * **Every subsystem is asked once for the whole page.** Two aliases on one connection cost
 *     the same reads as eight, and the assertions below count calls rather than trust the
 *     shape. The claim about *statements* is `registry-read.integration-spec.ts`'s, at the
 *     driver;
 *   * **the connection each alias reads its health through is its own** — an assertion worth
 *     writing down, because a map keyed wrongly produces a page that looks entirely plausible;
 *   * **a credential that will not open is a null**, not a five-hundred, and it is logged;
 *   * **prices keep their place**, including across the unbound row that has no kind to look
 *     one up by.
 */

const ORG = "acme-robotics-id";
const ANTHROPIC = "5eed000c-0000-4000-8000-000000000001";
const COPILOT = "5eed000c-0000-4000-8000-000000000003";
const CHECKED_AT = new Date("2026-08-25T09:00:00.000Z");

const TOKEN_PRICE: ResolvedPrice = {
  billingMode: "token",
  inputCentsPer1m: "1000.0000",
  outputCentsPer1m: "5000.0000",
  provenance: {
    source: "bundled",
    catalogVersion: "2026-08-15+litellm.70d51a1",
    effectiveAt: new Date("2026-08-15T00:00:00.000Z"),
  },
};

/**
 * One connection row, defaulted to a healthy Anthropic.
 *
 * @param overrides - What this case is about.
 * @returns The row.
 */
function connectionRow(overrides: Partial<RegistryConnectionRow> = {}): RegistryConnectionRow {
  return {
    id: ANTHROPIC,
    kind: "anthropic",
    display_name: "Anthropic Claude",
    enabled: true,
    status: "active",
    last_checked_at: CHECKED_AT,
    health: {},
    ...overrides,
  };
}

/**
 * One alias resource, defaulted to a bound, enabled row.
 *
 * @param overrides - What this case is about.
 * @returns The alias.
 */
function aliasResource(overrides: Partial<ModelAliasResource> = {}): ModelAliasResource {
  return {
    id: "alias-1",
    alias: "coder-max",
    enabled: true,
    connection: { id: ANTHROPIC, kind: "anthropic", displayName: "Anthropic Claude" },
    modelId: "claude-fable-5",
    params: {},
    restrictions: {},
    notes: null,
    references: [],
    updatedBy: null,
    createdAt: "2026-06-12T16:20:00.000Z",
    updatedAt: "2026-06-12T16:20:00.000Z",
    ...overrides,
  };
}

describe("the registry read service", () => {
  let aliases: jest.Mocked<Pick<AliasesService, "list">>;
  let repository: jest.Mocked<Pick<RegistryReadRepository, keyof RegistryReadRepository>>;
  let pricing: jest.Mocked<Pick<PricingService, "resolveMany">>;
  let vault: jest.Mocked<Pick<VaultService, "decrypt">>;
  let service: RegistryReadService;

  beforeEach(() => {
    aliases = { list: jest.fn().mockResolvedValue({ aliases: [aliasResource()] }) };
    repository = {
      connections: jest.fn().mockResolvedValue([connectionRow()]),
      discoveredModels: jest
        .fn()
        .mockResolvedValue([{ provider_connection_id: ANTHROPIC, model_id: "claude-fable-5" }]),
      sealedCredentials: jest.fn().mockResolvedValue(new Map([[ANTHROPIC, null]])),
    };
    pricing = { resolveMany: jest.fn().mockResolvedValue([TOKEN_PRICE]) };
    vault = { decrypt: jest.fn() };

    service = new RegistryReadService(
      aliases as unknown as AliasesService,
      repository as unknown as RegistryReadRepository,
      pricing as unknown as PricingService,
      vault as unknown as VaultService,
    );
  });

  describe("the composed row", () => {
    it("carries the binding, the monogram, the health, the price and the count", async () => {
      const { aliases: rows } = await service.read(ORG);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        alias: "coder-max",
        binding: { kind: "anthropic", monogram: "AN", mask: null },
        health: { state: ALIAS_HEALTH_STATES.ok, checkedAt: CHECKED_AT.toISOString() },
        price: { display: "$10 · $50", connectionKind: "anthropic" },
        usedBy: 0,
      });
    });

    it("reads the unbound row as no_key without asking anything about a connection", async () => {
      aliases.list.mockResolvedValue({
        aliases: [aliasResource({ alias: "gpt5-experiments", connection: null, enabled: false })],
      });
      pricing.resolveMany.mockResolvedValue([undefined]);

      const { aliases: rows } = await service.read(ORG);

      expect(rows[0]).toMatchObject({
        binding: null,
        health: { state: ALIAS_HEALTH_STATES.noKey, note: NO_KEY_NOTE, checkedAt: null },
        price: { connectionKind: null, display: "—" },
      });
    });

    it("keeps the workspace on every read", async () => {
      await service.read(ORG);

      expect(aliases.list).toHaveBeenCalledWith(ORG);
      expect(repository.connections).toHaveBeenCalledWith(ORG);
      expect(repository.discoveredModels).toHaveBeenCalledWith(ORG);
      expect(repository.sealedCredentials).toHaveBeenCalledWith(ORG);
      expect(pricing.resolveMany).toHaveBeenCalledWith(expect.anything(), ORG);
    });
  });

  describe("each row reads its own connection", () => {
    beforeEach(() => {
      aliases.list.mockResolvedValue({
        aliases: [
          aliasResource(),
          aliasResource({
            id: "alias-2",
            alias: "coder-fallback",
            modelId: "gpt-5-codex",
            connection: { id: COPILOT, kind: "copilot", displayName: "GitHub Copilot" },
          }),
        ],
      });
      repository.connections.mockResolvedValue([
        connectionRow(),
        connectionRow({
          id: COPILOT,
          kind: "copilot",
          display_name: "GitHub Copilot",
          status: "error",
          health: { detail: "elevated latency" },
        }),
      ]);
      repository.discoveredModels.mockResolvedValue([
        { provider_connection_id: ANTHROPIC, model_id: "claude-fable-5" },
        { provider_connection_id: COPILOT, model_id: "gpt-5-codex" },
      ]);
      repository.sealedCredentials.mockResolvedValue(
        new Map([
          [ANTHROPIC, null],
          [COPILOT, null],
        ]),
      );
      pricing.resolveMany.mockResolvedValue([TOKEN_PRICE, undefined]);
    });

    it("gives one row ok and the failing one the mockup's degraded note", async () => {
      const { aliases: rows } = await service.read(ORG);

      expect(rows.map((row) => row.health.state)).toEqual([
        ALIAS_HEALTH_STATES.ok,
        ALIAS_HEALTH_STATES.degraded,
      ]);
      expect(rows[1].health.note).toBe("elevated latency");
    });

    it("does not ask a subsystem twice because there are two rows", async () => {
      await service.read(ORG);

      expect(repository.connections).toHaveBeenCalledTimes(1);
      expect(repository.discoveredModels).toHaveBeenCalledTimes(1);
      expect(repository.sealedCredentials).toHaveBeenCalledTimes(1);
      expect(aliases.list).toHaveBeenCalledTimes(1);
      expect(pricing.resolveMany).toHaveBeenCalledTimes(1);
    });

    it("prices the whole table in one batched call, in the table's own order", async () => {
      await service.read(ORG);

      expect(pricing.resolveMany).toHaveBeenCalledWith(
        [
          { connectionKind: "anthropic", modelId: "claude-fable-5" },
          { connectionKind: "copilot", modelId: "gpt-5-codex" },
        ],
        ORG,
      );
    });

    it("keeps each price with its own row, uncovered ones included", async () => {
      const { aliases: rows } = await service.read(ORG);

      expect(rows.map((row) => row.price.display)).toEqual(["$10 · $50", "—"]);
      expect(rows.map((row) => row.price.modelId)).toEqual(["claude-fable-5", "gpt-5-codex"]);
    });
  });

  describe("discovery membership", () => {
    it("warns when the bound model has left the connection's catalog", async () => {
      repository.discoveredModels.mockResolvedValue([
        { provider_connection_id: ANTHROPIC, model_id: "claude-sonnet-5" },
      ]);

      const { aliases: rows } = await service.read(ORG);

      expect(rows[0].health).toMatchObject({
        state: ALIAS_HEALTH_STATES.modelMissing,
        note: "claude-fable-5 is no longer listed on Anthropic Claude",
      });
    });

    it("says nothing about a connection discovery has never reached", async () => {
      repository.discoveredModels.mockResolvedValue([]);

      const { aliases: rows } = await service.read(ORG);

      expect(rows[0].health.state).toBe(ALIAS_HEALTH_STATES.ok);
    });

    it("does not confuse two connections that list models of the same name", async () => {
      // The failure a badly keyed set produces looks entirely plausible on the page, which is
      // why it is asserted: the model is listed on the *other* connection, and this alias's is
      // still missing.
      repository.discoveredModels.mockResolvedValue([
        { provider_connection_id: COPILOT, model_id: "claude-fable-5" },
      ]);
      repository.connections.mockResolvedValue([
        connectionRow(),
        connectionRow({ id: COPILOT, kind: "copilot", display_name: "GitHub Copilot" }),
      ]);

      const { aliases: rows } = await service.read(ORG);

      expect(rows[0].health.state).toBe(ALIAS_HEALTH_STATES.ok);
    });
  });

  describe("the masked key on the inspector's provider line", () => {
    it("masks the stored credential, and erases the buffer it opened", async () => {
      const opened = Buffer.from("sk-ant-api03-not-a-real-credential-Xq4A", "utf8");
      vault.decrypt.mockResolvedValue(opened);
      repository.sealedCredentials.mockResolvedValue(
        new Map([[ANTHROPIC, "ouro.v1.1.nonce.cipher"]]),
      );

      const { aliases: rows } = await service.read(ORG);

      expect(rows[0].binding?.mask).toBe("••••Xq4A");
      expect(vault.decrypt).toHaveBeenCalledWith(ORG, ANTHROPIC, "ouro.v1.1.nonce.cipher");
      // The vault hands the buffer over and says the caller owns it. This is the caller.
      expect(opened.every((byte) => byte === 0)).toBe(true);
    });

    it("publishes null, and does not decrypt, for a provider that stores no credential", async () => {
      const { aliases: rows } = await service.read(ORG);

      expect(rows[0].binding?.mask).toBeNull();
      expect(vault.decrypt).not.toHaveBeenCalled();
    });

    it("renders the page with a blank key row when the envelope will not open", async () => {
      // A database restored without `tenant_keys` is this deployment's problem and says nothing
      // about the aliases somebody is trying to look at. Logged for an operator; not a 500.
      const warn = jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
      vault.decrypt.mockRejectedValue(new Error("vault: no key at version 1"));
      repository.sealedCredentials.mockResolvedValue(
        new Map([[ANTHROPIC, "ouro.v1.1.nonce.cipher"]]),
      );

      const { aliases: rows } = await service.read(ORG);

      expect(rows[0].binding?.mask).toBeNull();
      expect(rows[0].health.state).toBe(ALIAS_HEALTH_STATES.ok);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(ANTHROPIC);
    });

    it("opens each connection once, however many aliases are bound to it", async () => {
      vault.decrypt.mockResolvedValue(Buffer.from("sk-ant-0000-Xq4A", "utf8"));
      repository.sealedCredentials.mockResolvedValue(
        new Map([[ANTHROPIC, "ouro.v1.1.nonce.cipher"]]),
      );
      aliases.list.mockResolvedValue({
        aliases: [aliasResource(), aliasResource({ id: "alias-2", alias: "coder-std" })],
      });
      pricing.resolveMany.mockResolvedValue([TOKEN_PRICE, TOKEN_PRICE]);

      await service.read(ORG);

      expect(vault.decrypt).toHaveBeenCalledTimes(1);
    });
  });

  describe("a connection the health read did not answer for", () => {
    it("keeps the provider cell and calls the row unknown, never ok and never no_key", async () => {
      // Unreachable through this API — V015's foreign key is what stops a bound alias from
      // outliving its connection — and the answer is still coherent rather than a row whose
      // provider cell and health cell contradict each other.
      repository.connections.mockResolvedValue([]);

      const { aliases: rows } = await service.read(ORG);

      expect(rows[0].binding).toMatchObject({ displayName: "Anthropic Claude", mask: null });
      expect(rows[0].health).toMatchObject({
        state: ALIAS_HEALTH_STATES.unknown,
        note: "nothing has checked Anthropic Claude yet",
        checkedAt: null,
      });
    });
  });

  describe("the empty registry", () => {
    it("is an empty list rather than a failure", async () => {
      aliases.list.mockResolvedValue({ aliases: [] });
      repository.connections.mockResolvedValue([]);
      repository.discoveredModels.mockResolvedValue([]);
      repository.sealedCredentials.mockResolvedValue(new Map());
      pricing.resolveMany.mockResolvedValue([]);

      await expect(service.read(ORG)).resolves.toEqual({ aliases: [] });
    });
  });
});
