import { RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { ADMINISTRATORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import { SlackChannelsController } from "./slack.channels.controller";
import type { SlackChannelsService } from "./slack.channels.service";
import { SlackConnectionController } from "./slack.controller";
import { KEN, ORG } from "./slack.fixture";
import type { SlackChannelsResource } from "./slack.resources";

/**
 * The channel routes (#541): each hands the session's workspace — and, for a write, the person —
 * to the service, and the three writes are gated to owners and admins exactly as the
 * connection's verify is.
 */

const TENANT = { id: ORG } as Organization;
const PRINCIPAL = { user: { id: KEN.userId, name: KEN.name, email: KEN.email } } as Principal;
const CHANNEL = "5eed009c-0000-4000-8000-000000000011";
const ANSWER: SlackChannelsResource = { connected: true, refreshedAt: null, channels: [] };

/** The controller over a stubbed service. */
function setup() {
  const service = {
    list: jest.fn().mockResolvedValue(ANSWER),
    refresh: jest.fn().mockResolvedValue(ANSWER),
    bind: jest.fn().mockResolvedValue(ANSWER),
    unbind: jest.fn().mockResolvedValue(ANSWER),
  };

  return {
    service,
    controller: new SlackChannelsController(service as unknown as SlackChannelsService),
  };
}

/** The roles a handler asks for — undefined when any member may call it. */
function rolesOf(handler: object): unknown {
  return Reflect.getMetadata(REQUIRED_ROLES, handler);
}

describe("the Slack channel routes", () => {
  it("sit under /slack/channels, with the binding addressed by the channel's id", () => {
    const { controller } = setup();

    expect(Reflect.getMetadata(PATH_METADATA, SlackChannelsController)).toBe("slack/channels");
    expect(
      [controller.list, controller.refresh, controller.bind, controller.unbind].map((handler) => [
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number],
        Reflect.getMetadata(PATH_METADATA, handler) as string,
      ]),
    ).toEqual([
      ["GET", "/"],
      ["POST", "refresh"],
      ["PUT", ":id/binding"],
      ["DELETE", ":id/binding"],
    ]);
  });

  it("answer a refresh with 200 — it returns the list, it creates nothing addressable", () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, setup().controller.refresh)).toBe(200);
  });

  it("let any member read the list, as the connection's status does", () => {
    const { controller } = setup();

    expect(rolesOf(controller.list)).toBeUndefined();
    expect(rolesOf(SlackConnectionController.prototype.status)).toBeUndefined();
  });

  it("gate every write to owners and admins, as the connection's verify is", () => {
    const { controller } = setup();

    expect(rolesOf(SlackConnectionController.prototype.verify)).toEqual([...ADMINISTRATORS]);
    for (const handler of [controller.refresh, controller.bind, controller.unbind]) {
      expect(rolesOf(handler)).toEqual(["owner", "admin"]);
    }
  });

  it("list the session's workspace", async () => {
    const { controller, service } = setup();

    await expect(controller.list(TENANT)).resolves.toBe(ANSWER);
    expect(service.list).toHaveBeenCalledWith(ORG);
  });

  it("refresh the session's workspace", async () => {
    const { controller, service } = setup();

    await expect(controller.refresh(TENANT)).resolves.toBe(ANSWER);
    expect(service.refresh).toHaveBeenCalledWith(ORG);
  });

  it("bind as the signed-in person, for the purpose in the body", async () => {
    const { controller, service } = setup();

    await expect(controller.bind(TENANT, PRINCIPAL, CHANNEL, { purpose: "alerts" })).resolves.toBe(
      ANSWER,
    );
    expect(service.bind).toHaveBeenCalledWith(ORG, KEN.userId, CHANNEL, "alerts");
  });

  it("unbind as the signed-in person", async () => {
    const { controller, service } = setup();

    await expect(controller.unbind(TENANT, PRINCIPAL, CHANNEL)).resolves.toBe(ANSWER);
    expect(service.unbind).toHaveBeenCalledWith(ORG, KEN.userId, CHANNEL);
  });

  it("let the service's refusal through as it is", async () => {
    const { controller, service } = setup();
    const refusal = new Error("slack_channel_not_joined");
    service.bind.mockRejectedValue(refusal);

    await expect(controller.bind(TENANT, PRINCIPAL, CHANNEL, { purpose: "loops" })).rejects.toBe(
      refusal,
    );
  });
});
