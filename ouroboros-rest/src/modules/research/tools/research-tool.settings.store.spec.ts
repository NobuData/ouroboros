import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import type { VaultService } from "../../vault/vault.service";
import { StoredToolSettings, vaultRecordId } from "./research-tool.settings.store";

/**
 * A workspace's stored tool settings (CN.3, #629), against a real Kysely over a recording
 * driver: a row is what *enabled* means, and the credential is sealed on the way in and opened
 * for one call on the way out.
 */

const ORG = "org-acme";
const ENVELOPE = "ouro.v1.1.bm9uY2U.Y2lwaGVydGV4dA";

function harness() {
  const database: RecordingDatabase = recordingDatabase();
  const vault = {
    encryptText: jest.fn().mockResolvedValue(ENVELOPE),
    decryptText: jest.fn().mockResolvedValue("BSA-key"),
  };

  return {
    database,
    vault,
    settings: new StoredToolSettings(database.service, vault as unknown as VaultService),
    last: () => database.statements[database.statements.length - 1],
  };
}

describe("reading a tool's settings", () => {
  it("answers null for a workspace that stored nothing — the idle dot", async () => {
    const { settings, last, vault } = harness();

    expect(await settings.settingsFor(ORG, "web")).toBeNull();
    expect(last().parameters).toEqual([ORG, "web"]);
    expect(last().sql).toContain("s.organization_id = $1 and s.tool_slug = $2");
    expect(vault.decryptText).not.toHaveBeenCalled();
  });

  it("answers the config with no credential for a tool that needs none", async () => {
    const { database, settings, vault } = harness();
    database.answers({ rows: [{ config: {}, credentials_encrypted: null }] });

    expect(await settings.settingsFor(ORG, "code")).toEqual({ config: {}, secret: null });
    expect(vault.decryptText).not.toHaveBeenCalled();
  });

  it("opens the credential for the workspace and the tool it was sealed for", async () => {
    const { database, settings, vault } = harness();
    database.answers({
      rows: [{ config: { provider: "brave" }, credentials_encrypted: ENVELOPE }],
    });

    expect(await settings.settingsFor(ORG, "web")).toEqual({
      config: { provider: "brave" },
      secret: "BSA-key",
    });
    expect(vault.decryptText).toHaveBeenCalledWith(ORG, "research-tool:web", ENVELOPE);
  });

  it("reads a credential that will not open as no credential, rather than failing the card", async () => {
    const { database, settings, vault } = harness();
    database.answers({
      rows: [{ config: { provider: "brave" }, credentials_encrypted: ENVELOPE }],
    });
    vault.decryptText.mockRejectedValueOnce(new Error("wrong key"));

    expect(await settings.settingsFor(ORG, "web")).toEqual({
      config: { provider: "brave" },
      secret: null,
    });
  });
});

describe("storing a tool's settings", () => {
  it("seals a credential and upserts the row, naming who", async () => {
    const { settings, last, vault } = harness();

    await settings.store(ORG, "web", {
      config: { provider: "brave" },
      secret: "BSA-key",
      userId: "user-1",
    });

    expect(vault.encryptText).toHaveBeenCalledWith(ORG, "research-tool:web", "BSA-key");
    expect(last().parameters).toEqual([ORG, "web", '{"provider":"brave"}', ENVELOPE, "user-1"]);
    expect(last().sql).toContain("on conflict (organization_id, tool_slug) do update");
    expect(JSON.stringify(last())).not.toContain("BSA-key");
  });

  it("keeps the stored credential when a save carries none", async () => {
    const { settings, last, vault } = harness();

    await settings.store(ORG, "web", { config: {}, secret: null, userId: "user-1" });

    expect(vault.encryptText).not.toHaveBeenCalled();
    expect(last().parameters).toEqual([ORG, "web", "{}", null, "user-1"]);
    expect(last().sql).toContain(
      "coalesce(excluded.credentials_encrypted, s.credentials_encrypted)",
    );
  });

  it("binds each tool's credential to its own vault record", () => {
    expect(vaultRecordId("web")).toBe("research-tool:web");
    expect(vaultRecordId("web")).not.toBe(vaultRecordId("competitor"));
  });
});
