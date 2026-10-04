import { recordingDatabase } from "../db/database.fixture";
import { SERVICE_TOKEN_HINT_STORE, ServiceTokenHintStore } from "./service-accounts.secrets";

/**
 * The vault sweep's view of `service_tokens.hint_sealed` (#485).
 */

describe("the hint store", () => {
  it("names itself after its table", () => {
    expect(new ServiceTokenHintStore(recordingDatabase().service).name).toBe(
      SERVICE_TOKEN_HINT_STORE,
    );
  });

  it("reports the hints of a workspace not yet sealed on a version, keyed by token id", async () => {
    const database = recordingDatabase();

    database.answers({ rows: [{ id: "token-1", hint_sealed: "ouro.v1.1.n.c" }] });

    const pending = await new ServiceTokenHintStore(database.service).pending("org-1", 2);

    expect(pending).toEqual([{ recordId: "token-1", secret: "ouro.v1.1.n.c", sealed: true }]);
    expect(database.statements[0].sql).toContain('"hint_sealed" not like $2');
    expect(database.statements[0].parameters).toEqual(["org-1", "ouro.v1.2.%"]);
  });

  it("stores a resealed hint only over the value it read", async () => {
    const database = recordingDatabase();

    database.answers({ rows: [] });

    await new ServiceTokenHintStore(database.service).store(
      { recordId: "token-1", secret: "ouro.v1.1.n.c", sealed: true },
      "ouro.v1.2.n.c",
    );

    expect(database.statements[0].parameters).toEqual([
      "ouro.v1.2.n.c",
      "token-1",
      "ouro.v1.1.n.c",
    ]);
  });
});
