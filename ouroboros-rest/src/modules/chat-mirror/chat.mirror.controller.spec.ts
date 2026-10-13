import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import type { Organization } from "../db/schema";
import { SlackChannelsController } from "../slack/slack.channels.controller";
import { REQUIRED_ROLES } from "../tenancy/roles.guard";
import { ChatMirrorController } from "./chat.mirror.controller";
import { ChatMirrorQuery } from "./chat.mirror.dto";
import type { ChatMirrorResource } from "./chat.mirror.resources";
import type { ChatMirrorService } from "./chat.mirror.service";

/**
 * The mirror's route (#542): one read under `/chat/channels`, open to every member as the
 * channel list is, handing the workspace, the id and a validated query to the service.
 */

const TENANT = { id: "org-acme" } as Organization;
const CHANNEL = "5eed009c-0000-4000-8000-0000000000a1";
const ANSWER = { entries: [], olderCursor: null } as unknown as ChatMirrorResource;

/**
 * A query as the validation pipe builds and judges it.
 *
 * @param raw - The query string's values.
 * @returns The properties refused, and the instance.
 */
function judged(raw: Record<string, unknown>) {
  const query = plainToInstance(ChatMirrorQuery, raw);

  return { query, refused: validateSync(query).map((error) => error.property) };
}

describe("the channel mirror's route", () => {
  it("is GET /chat/channels/:id/mirror", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ChatMirrorController)).toBe("chat/channels");
    expect(
      RequestMethod[
        Reflect.getMetadata(METHOD_METADATA, ChatMirrorController.prototype.read) as number
      ],
    ).toBe("GET");
    expect(Reflect.getMetadata(PATH_METADATA, ChatMirrorController.prototype.read)).toBe(
      ":id/mirror",
    );
  });

  it("is open to any member, as the channel list is", () => {
    expect(
      Reflect.getMetadata(REQUIRED_ROLES, ChatMirrorController.prototype.read),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(REQUIRED_ROLES, SlackChannelsController.prototype.list),
    ).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_ROLES, ChatMirrorController)).toBeUndefined();
  });

  it("hands the service the session's workspace, the id as given, and the query", async () => {
    const read = jest.fn().mockResolvedValue(ANSWER);
    const controller = new ChatMirrorController({ read } as unknown as ChatMirrorService);
    const { query } = judged({ limit: "20", before: "abc" });

    await expect(controller.read(TENANT, CHANNEL, query)).resolves.toBe(ANSWER);
    expect(read).toHaveBeenCalledWith("org-acme", CHANNEL, { limit: 20, before: "abc" });
  });
});

describe("the mirror's query", () => {
  it("takes no query at all: the newest page, fifty entries", () => {
    expect(judged({})).toEqual({ query: {}, refused: [] });
  });

  it.each([["1"], ["50"], ["100"]])("reads limit=%s as a number", (limit) => {
    const { query, refused } = judged({ limit });

    expect(refused).toEqual([]);
    expect(query.limit).toBe(Number(limit));
  });

  it.each([["0"], ["101"], ["-1"], ["2.5"], ["many"], [""]])("refuses limit=%p", (limit) => {
    expect(judged({ limit }).refused).toEqual(["limit"]);
  });

  it.each([[""], ["x".repeat(257)], [["a", "b"]]])(
    "refuses a before that cannot be a cursor (%p)",
    (before) => {
      expect(judged({ before }).refused).toEqual(["before"]);
    },
  );
});
