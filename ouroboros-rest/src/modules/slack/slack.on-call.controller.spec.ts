import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { SlackOnCallController } from "./slack.on-call.controller";
import { PutOnCallDto } from "./slack.on-call.dto";
import type { OnCallResource, SlackOnCallService } from "./slack.on-call.service";

/**
 * The on-call routes (#543): any member reads who is on call, owners and admins choose, and the
 * workspace and the chooser come from the session — never the request.
 */

const TENANT = { id: "org-acme" } as Organization;
const PRINCIPAL = { user: { id: "u-ken" } } as Principal;
const ANSWER: OnCallResource = {
  scope: "decisions",
  designee: null,
  assignedAt: null,
  candidates: [],
};

/** The controller over a stubbed service. */
function setup() {
  const service = {
    read: jest.fn().mockResolvedValue(ANSWER),
    assign: jest.fn().mockResolvedValue(ANSWER),
  };

  return {
    service,
    controller: new SlackOnCallController(service as unknown as SlackOnCallService),
  };
}

/** The roles a handler asks for — undefined when any member may call it. */
function rolesOf(handler: object): unknown {
  return Reflect.getMetadata(REQUIRED_ROLES, handler);
}

describe("the on-call routes", () => {
  it("are GET and PUT /chat/on-call", () => {
    const { controller } = setup();

    expect(Reflect.getMetadata(PATH_METADATA, SlackOnCallController)).toBe("chat/on-call");
    expect(
      [controller.read, controller.assign].map((handler) => [
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number],
        Reflect.getMetadata(PATH_METADATA, handler) as string,
      ]),
    ).toEqual([
      ["GET", "/"],
      ["PUT", "/"],
    ]);
  });

  it("let any member read, and only owners and admins choose", () => {
    const { controller } = setup();

    expect(rolesOf(controller.read)).toBeUndefined();
    expect(rolesOf(controller.assign)).toEqual([...ADMINISTRATORS]);
  });

  it("read the session's workspace", async () => {
    const { controller, service } = setup();

    await expect(controller.read(TENANT)).resolves.toBe(ANSWER);
    expect(service.read).toHaveBeenCalledWith("org-acme");
  });

  it("choose as the session's person — a member, or nobody", async () => {
    const { controller, service } = setup();

    await expect(controller.assign(TENANT, PRINCIPAL, { memberId: "mem-maya" })).resolves.toBe(
      ANSWER,
    );
    await controller.assign(TENANT, PRINCIPAL, { memberId: null });

    expect(service.assign.mock.calls).toEqual([
      ["org-acme", "u-ken", "mem-maya"],
      ["org-acme", "u-ken", null],
    ]);
  });
});

describe("the on-call body", () => {
  /** The validation complaints about a body. */
  async function problems(body: unknown): Promise<string[]> {
    const errors = await validate(plainToInstance(PutOnCallDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  }

  it.each([[{ memberId: "mem-maya" }], [{ memberId: null }]])("takes %j", async (body) => {
    await expect(problems(body)).resolves.toEqual([]);
  });

  it.each([[{}], [{ memberId: 7 }], [{ memberId: ["mem-maya"] }]])(
    "refuses %j — the field is always sent",
    async (body) => {
      await expect(problems(body)).resolves.toEqual(["memberId must be a member id or null"]);
    },
  );

  it("refuses a field it does not know", async () => {
    await expect(problems({ memberId: null, scope: "pages" })).resolves.toHaveLength(1);
  });
});
