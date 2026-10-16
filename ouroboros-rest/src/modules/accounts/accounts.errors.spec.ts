import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HttpStatus } from "@nestjs/common";

import {
  ACCOUNTS_ERRORS,
  accountNotFound,
  alreadyPreapproved,
  cannotDenyAppAdmin,
  preapprovedEmailNotFound,
} from "./accounts.errors";

/** The admin routes' refusals: each code published in `openapi.yaml`, each with its status. */

const SPECIFICATION = readFileSync(join(__dirname, "..", "..", "..", "openapi.yaml"), "utf8");

describe("the account-approval codes", () => {
  it.each(Object.values(ACCOUNTS_ERRORS))("documents %s in openapi.yaml", (code) => {
    expect(SPECIFICATION).toContain(`\`${code}\``);
  });

  it("answers with the documented statuses and details", () => {
    expect(accountNotFound("u1").getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(accountNotFound("u1").envelope().details).toEqual({ userId: "u1" });
    expect(cannotDenyAppAdmin("u1").getStatus()).toBe(HttpStatus.CONFLICT);
    expect(alreadyPreapproved("a@b.dev").getStatus()).toBe(HttpStatus.CONFLICT);
    expect(alreadyPreapproved("a@b.dev").envelope().code).toBe("already_preapproved");
    expect(preapprovedEmailNotFound("a@b.dev").getStatus()).toBe(HttpStatus.NOT_FOUND);
  });
});
