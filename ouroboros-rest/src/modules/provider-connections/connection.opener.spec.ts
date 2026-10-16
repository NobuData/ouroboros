import { ProviderAdapterError } from "../providers/provider.errors";
import type { ModelProviderRegistry } from "../providers/provider.registry";
import type { VaultService } from "../vault/vault.service";
import { ConnectionOpener } from "./connection.opener";
import type { ProviderConnectionsRepository } from "./provider-connections.repository";

const ORG = "acme";
const ID = "c0000000-0000-4000-8000-000000000001";

/** An adapter stand-in with the flags the case names. */
function adapter(invocation: boolean) {
  return {
    kind: "anthropic",
    capabilities: () => ({ discovery: true, pull: false, entitlements: false, invocation }),
    configSchema: () => ({ type: "object", properties: {}, required: [] }),
    invoke: invocation ? jest.fn() : undefined,
  };
}

/** The opener over fakes. */
function opener(options: { row?: unknown; envelope?: string | null; invocation?: boolean }) {
  const connections = {
    find: jest
      .fn()
      .mockResolvedValue(
        "row" in options ? options.row : { id: ID, kind: "anthropic", monthly_cap_cents: 60_000 },
      ),
    envelopeOf: jest.fn().mockResolvedValue(options.envelope ?? null),
    touch: jest.fn().mockResolvedValue(undefined),
  };
  const vault = { decryptText: jest.fn().mockResolvedValue("sk-opened") };
  const registry = { find: jest.fn().mockReturnValue(adapter(options.invocation ?? true)) };

  return {
    connections,
    vault,
    opener: new ConnectionOpener(
      connections as unknown as ProviderConnectionsRepository,
      vault as unknown as VaultService,
      registry as unknown as ModelProviderRegistry,
    ),
  };
}

describe("ConnectionOpener", () => {
  it("describes a connection's kind and monthly cap without opening it", async () => {
    const { opener: subject, vault } = opener({});

    await expect(subject.describe(ORG, ID)).resolves.toEqual({
      id: ID,
      kind: "anthropic",
      monthlyCapCents: 60_000,
    });
    expect(vault.decryptText).not.toHaveBeenCalled();
  });

  it("opens the credential for one call, scoped to the workspace and the connection", async () => {
    const { opener: subject, vault } = opener({ envelope: "ouro.v1.sealed" });
    const opened = await subject.open(ORG, ID);

    expect(opened.context).toEqual({
      connectionId: ID,
      config: {},
      secret: "sk-opened",
      baseUrl: null,
    });
    expect(vault.decryptText).toHaveBeenCalledWith(ORG, ID, "ouro.v1.sealed");
  });

  it("carries the row's base_url beside the config, for a kind whose schema has no address field (#1314)", async () => {
    const seeded = opener({
      row: {
        id: ID,
        kind: "anthropic",
        monthly_cap_cents: null,
        base_url: "http://provider-fixture:8080",
      },
    });

    await expect(seeded.opener.open(ORG, ID)).resolves.toMatchObject({
      context: { baseUrl: "http://provider-fixture:8080", config: {} },
    });
  });

  it("opens a keyless connection with a null secret", async () => {
    await expect(opener({}).opener.open(ORG, ID)).resolves.toMatchObject({
      context: { secret: null },
    });
  });

  it("refuses a removed connection and an uncleared kind as config, a fact about the hop", async () => {
    await expect(opener({ row: undefined }).opener.open(ORG, ID)).rejects.toBeInstanceOf(
      ProviderAdapterError,
    );
    await expect(opener({ invocation: false }).opener.open(ORG, ID)).rejects.toMatchObject({
      errorClass: "config",
    });
  });

  it("stamps last_used_at through the repository", async () => {
    const { opener: subject, connections } = opener({});
    const at = new Date("2026-10-14T09:00:00.000Z");

    await subject.touch(ORG, ID, at);

    expect(connections.touch).toHaveBeenCalledWith(ORG, ID, at);
  });
});
