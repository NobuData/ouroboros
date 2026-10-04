import { FakeTokenStore, FakeVault } from "./action-token.fixture";
import { ActionTokenService } from "./action-token.service";

describe("ActionTokenService (#463)", () => {
  let store: FakeTokenStore;
  let vault: FakeVault;
  let service: ActionTokenService;

  beforeEach(() => {
    store = new FakeTokenStore();
    vault = new FakeVault();
    service = new ActionTokenService(store.repository(), vault.service());
    store.itemOrganizations.set("item-1", "org-1");
  });

  it("creates and seals the workspace key on first mint, and stores only the HMAC", async () => {
    const token = await service.mint("org-1", "item-1", "confirm", "user-a", "email");

    expect(token).toMatch(/^ouro_act_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    expect(store.keys.size).toBe(1);
    expect([...store.keys.values()][0]?.sealedKey).toMatch(/^fake\.org-1\.act\./);
    expect(store.tokens).toHaveLength(1);
    expect(store.tokens[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(store.tokens)).not.toContain(token);
  });

  it("reuses the workspace key for later mints", async () => {
    await service.mint("org-1", "item-1", "confirm", "user-a", "email");
    await service.mint("org-1", "item-1", "retire", "user-a", "email");

    expect(store.keys.size).toBe(1);
    expect(vault.sealed).toBe(1);
  });

  it("uses another replica's key when it stored one first", async () => {
    const other = new ActionTokenService(store.repository(), vault.service());

    await other.mint("org-1", "item-1", "confirm", "user-a", "email");
    const token = await service.mint("org-1", "item-1", "retire", "user-a", "email");

    expect(store.keys.size).toBe(1);
    expect((await service.inspect(token))?.record.actionId).toBe("retire");
  });

  it("inspects a minted token without spending it", async () => {
    const token = await service.mint("org-1", "item-1", "confirm", "user-a", "email");
    const inspected = await service.inspect(token);

    expect(inspected?.record).toMatchObject({
      itemId: "item-1",
      actionId: "confirm",
      userId: "user-a",
      state: "live",
    });
    expect(store.tokens[0]?.usedAt).toBeNull();
  });

  it("opens a key through the vault when another process minted it", async () => {
    const token = await service.mint("org-1", "item-1", "confirm", "user-a", "email");
    const fresh = new ActionTokenService(store.repository(), vault.service());

    expect((await fresh.inspect(token))?.record.state).toBe("live");
    expect(vault.opened).toBe(1);
  });

  it.each([
    ["a malformed value", "not-a-token"],
    ["a token under a key nobody has", `ouro_act_0000000000000000_${"a".repeat(43)}`],
  ])("answers nothing for %s", async (_label, presented) => {
    await service.mint("org-1", "item-1", "confirm", "user-a", "email");

    expect(await service.inspect(presented)).toBeUndefined();
  });

  it("answers nothing for a forged secret under a real key", async () => {
    const token = await service.mint("org-1", "item-1", "confirm", "user-a", "email");
    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(await service.inspect(forged)).toBeUndefined();
  });

  it("spends a token once", async () => {
    const token = await service.mint("org-1", "item-1", "confirm", "user-a", "email");
    const inspected = await service.inspect(token);

    if (inspected === undefined) {
      throw new Error("expected a token");
    }

    expect((await service.spend(inspected)).outcome).toBe("accepted");
    expect((await service.spend(inspected)).outcome).toBe("used");
  });

  it("supersedes the live token for the same item, action and person", async () => {
    const first = await service.mint("org-1", "item-1", "confirm", "user-a", "email");
    await service.mint("org-1", "item-1", "confirm", "user-a", "email");

    expect((await service.inspect(first))?.record).toMatchObject({
      state: "revoked",
      revokeReason: "superseded",
    });
  });
});
