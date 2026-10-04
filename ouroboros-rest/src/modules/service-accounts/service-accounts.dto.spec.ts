import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CreateServiceAccountDto } from "./service-accounts.dto";

/**
 * The create body (#485): a name the audit trail can print, and scopes from the allow-list.
 */

/** The validation messages for a body. */
function errors(body: object): string[] {
  return validateSync(plainToInstance(CreateServiceAccountDto, body)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

describe("creating a service account", () => {
  it("accepts devops-bot with registered scopes", () => {
    expect(errors({ name: "devops-bot", scopes: ["api.read", "farm.submit"] })).toEqual([]);
  });

  it.each(["Devops", "a", "-bot", "bot-", "devops bot", "x".repeat(41)])(
    "refuses the name %p",
    (name) => {
      expect(errors({ name, scopes: ["api.read"] })).not.toEqual([]);
    },
  );

  it("refuses a scope nobody registered", () => {
    expect(errors({ name: "devops-bot", scopes: ["admin"] })).toEqual([
      "each scope must be one of api.read, farm.submit",
    ]);
  });

  it("refuses no scopes and repeated scopes", () => {
    expect(errors({ name: "devops-bot", scopes: [] })).toContain(
      "scopes must name at least one scope",
    );
    expect(errors({ name: "devops-bot", scopes: ["api.read", "api.read"] })).toContain(
      "scopes must not repeat",
    );
  });
});
