import { FARM_OFFER_SOURCE_CREDENTIALS } from "./source-credential.service";
import { FarmSourceModule } from "./source.module";

/** The module's shape (#991): what it reaches, and that it exports the minter alone. */

describe("FarmSourceModule", () => {
  it("imports the database, the audit trail, the GitHub token and the gateway's clock", () => {
    const imported = (Reflect.getMetadata("imports", FarmSourceModule) as { name?: string }[]).map(
      (module) => module.name,
    );

    expect(imported).toEqual(["DbModule", "AuditModule", "GithubModule", "FarmGatewayModule"]);
  });

  it("exports the offer's ticket minter and nothing below it", () => {
    expect(Reflect.getMetadata("exports", FarmSourceModule)).toEqual([
      FARM_OFFER_SOURCE_CREDENTIALS,
    ]);
  });
});
