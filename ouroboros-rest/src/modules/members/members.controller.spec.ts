import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import type { Principal } from "../auth/principal";
import { HUMAN_ONLY } from "../auth/service.scopes";
import { membershipIn } from "../tenancy/organization.fixture";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { MembersController } from "./members.controller";
import type { MembersService } from "./members.service";

/**
 * The Members card's routes (#485): every member reads, administrators write, people only.
 */

const reflector = new Reflector();
const PRINCIPAL = { user: { id: "user-ken" } } as Principal;
const MEMBER = membershipIn(["owner"]);

/** The controller over a recording service. */
function subject() {
  const members = {
    page: jest.fn().mockResolvedValue({}),
    invite: jest.fn().mockResolvedValue({}),
    resend: jest.fn().mockResolvedValue({}),
    revoke: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<MembersService>;

  return { controller: new MembersController(members), members };
}

describe("the members routes", () => {
  it("lets every member read the card, and only a person", () => {
    expect(reflector.get(REQUIRED_ROLES, MembersController.prototype.page)).toBeUndefined();
    expect(reflector.get(HUMAN_ONLY, MembersController.prototype.page)).toBe(true);
  });

  it.each(["invite", "resend", "revoke", "update", "remove"] as const)(
    "keeps %s an administrator's",
    (handler) => {
      expect(reflector.get(REQUIRED_ROLES, MembersController.prototype[handler])).toEqual(
        ADMINISTRATORS,
      );
    },
  );

  it("answers a revoke and a remove 204, a resend 200", () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, MembersController.prototype.revoke)).toBe(
      HttpStatus.NO_CONTENT,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, MembersController.prototype.remove)).toBe(
      HttpStatus.NO_CONTENT,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, MembersController.prototype.resend)).toBe(
      HttpStatus.OK,
    );
  });

  it("reads the card as the caller, in the session's workspace", async () => {
    const { controller, members } = subject();

    await controller.page(MEMBER, PRINCIPAL);

    expect(members.page).toHaveBeenCalledWith(MEMBER.tenant.id, {
      userId: "user-ken",
      roles: ["owner"],
    });
  });

  it("hands the plugin the caller's cookies, never anything from the body", async () => {
    const { controller, members } = subject();
    const request = { headers: { cookie: "better-auth.session_token=abc" } };

    await controller.update(MEMBER, PRINCIPAL, request, "member-maya", { canApproveLoops: false });

    const [, caller] = members.update.mock.calls[0];

    expect(caller.userId).toBe("user-ken");
    expect(caller.headers.get("cookie")).toBe("better-auth.session_token=abc");
  });
});
