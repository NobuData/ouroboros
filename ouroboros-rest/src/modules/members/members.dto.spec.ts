import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { InviteMemberDto, UpdateMemberDto } from "./members.dto";

/**
 * The Members card's bodies (#485): the plugin's role names, never the display labels.
 */

/** The validation messages for a body. */
function errors<T extends object>(type: new () => T, body: object): string[] {
  return validateSync(plainToInstance(type, body)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

describe("an invitation", () => {
  it("takes an email and a plugin role", () => {
    expect(errors(InviteMemberDto, { email: "priya@acme.dev", role: "member" })).toEqual([]);
  });

  it("refuses a display label and a malformed address", () => {
    expect(errors(InviteMemberDto, { email: "priya@acme.dev", role: "Maintainer" })).toEqual([
      "role must be one of owner, admin, member, viewer",
    ]);
    expect(errors(InviteMemberDto, { email: "priya", role: "member" })).toEqual([
      "email must be an email address",
    ]);
  });
});

describe("a member update", () => {
  it("takes a role, a capability, or both", () => {
    expect(errors(UpdateMemberDto, { role: "admin" })).toEqual([]);
    expect(errors(UpdateMemberDto, { canApproveLoops: false })).toEqual([]);
    expect(errors(UpdateMemberDto, { role: "viewer", canApproveLoops: true })).toEqual([]);
  });

  it("refuses a capability that is not a boolean", () => {
    expect(errors(UpdateMemberDto, { canApproveLoops: "yes" })).toEqual([
      "canApproveLoops must be true or false",
    ]);
  });
});
