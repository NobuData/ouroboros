/**
 * The OpenAPI document and what the Slack family sends (#535). Real answers — every connection
 * state, both acknowledgements, a tile for each state — are held to their schemas, which are
 * `additionalProperties: false` throughout.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import type { ChatChannel, ChatConnectionPublic } from "../db/schema";
import { composeIntegrations } from "../integrations/integrations.tiles";
import { COMMAND_ACK } from "./slack.inbound.service";
import { channelsResource, connectionResource } from "./slack.resources";

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns A function answering Ajv's complaint, or undefined when the value validates.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/** A value as the client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const CONNECTION: ChatConnectionPublic = {
  id: "0b6d7c1e-3f52-4c1a-9a53-6f0d0f1f7a10",
  organization_id: "org-acme",
  platform: "slack",
  workspace_id: "T024AB",
  workspace_name: "acme-robotics",
  bot_user_id: "U07OUROBOT",
  install_meta: { scopes: ["chat:write", "commands"], app_id: "A07OUROBOROS", app_version: "v1.0" },
  status: "active",
  status_detail: null,
  installed_by: "user-ken",
  installed_at: new Date("2026-10-01T09:00:00Z"),
  last_verified_at: new Date("2026-10-12T14:00:00Z"),
  created_at: new Date("2026-10-01T09:00:00Z"),
  updated_at: new Date("2026-10-12T14:00:00Z"),
};

const BASE = { configured: true, channels: { total: 3, joined: 2 }, socketMode: false };

describe("the Slack connection on the wire", () => {
  const connection = validatorFor("SlackConnection");
  const verification = validatorFor("SlackVerification");

  it.each([
    ["connected", { ...BASE, connection: CONNECTION }],
    [
      "revoked",
      {
        ...BASE,
        connection: { ...CONNECTION, status: "revoked" as const, status_detail: "app_uninstalled" },
      },
    ],
    [
      "failing, never verified",
      {
        ...BASE,
        connection: {
          ...CONNECTION,
          status: "error" as const,
          status_detail: "ratelimited",
          last_verified_at: null,
          install_meta: {},
        },
      },
    ],
    ["not connected", { ...BASE, connection: undefined }],
    ["not configured", { ...BASE, configured: false, connection: undefined }],
  ])("matches SlackConnection when %s", (_label, input) => {
    expect(connection(wire(connectionResource(input)))).toBeUndefined();
  });

  it.each(["verified", "revoked", "unreachable", "not_connected"])(
    "matches SlackVerification for %s",
    (result) => {
      const answer = {
        result,
        connection: connectionResource({ ...BASE, connection: CONNECTION }),
      };

      expect(verification(wire(answer))).toBeUndefined();
    },
  );

  it("matches SlackConnection with a dead letter on its delivery", () => {
    const answer = connectionResource({
      ...BASE,
      connection: CONNECTION,
      delivery: {
        pending: 1,
        retrying: 2,
        deadLettered: 1,
        lastError: "channel_not_found",
        lastDeadLetteredAt: new Date("2026-10-12T14:00:00Z"),
        lastSentAt: new Date("2026-10-12T13:00:00Z"),
      },
    });

    expect(connection(wire(answer))).toBeUndefined();
    expect(validatorFor("SlackDelivery")(wire(answer.delivery))).toBeUndefined();
  });

  it("refuses a status that grew a token field", () => {
    const leaked = {
      ...connectionResource({ ...BASE, connection: CONNECTION }),
      botToken: "xoxb-1",
    };

    expect(connection(wire(leaked))).toContain("additional properties");
  });
});

describe("the Slack channels on the wire (#541)", () => {
  const channels = validatorFor("SlackChannels");
  const binding = validatorFor("SlackChannelBinding");
  const ROW: ChatChannel = {
    id: "5eed009c-0000-4000-8000-000000000011",
    organization_id: "org-acme",
    connection_id: CONNECTION.id,
    platform: "slack",
    channel_id: "C071LOOPS",
    channel_name: "ouroboros-loops",
    is_private: false,
    joined: true,
    joined_at: new Date("2026-10-01T09:00:00Z"),
    member_count: 24,
    purpose_tag: "loops",
    archived: false,
    created_at: new Date("2026-10-01T09:00:00Z"),
    updated_at: new Date("2026-10-12T14:02:11Z"),
  };

  it("matches SlackChannels for a bound channel, an unbound one never counted, and a foreign tag", () => {
    const answer = channelsResource({
      connection: CONNECTION,
      channels: [
        ROW,
        {
          ...ROW,
          id: "5eed009c-0000-4000-8000-000000000014",
          channel_id: "G074PRIV",
          channel_name: "eng-leads",
          is_private: true,
          joined: false,
          joined_at: null,
          member_count: null,
          purpose_tag: null,
        },
        { ...ROW, id: "5eed009c-0000-4000-8000-000000000015", purpose_tag: "incidents" },
      ],
      routes: [{ kind: "custom:loop-finished", chatChannelId: ROW.id }],
    });

    expect(channels(wire(answer))).toBeUndefined();
    expect(answer.channels.map((channel) => channel.purpose)).toEqual(["loops", null, null]);
  });

  it.each([
    ["never installed", undefined],
    ["revoked", { ...CONNECTION, status: "revoked" as const }],
  ])("matches SlackChannels when %s", (_label, connection) => {
    const answer = channelsResource({ connection, channels: [ROW], routes: [] });

    expect(channels(wire(answer))).toBeUndefined();
    expect(answer).toEqual({ connected: false, refreshedAt: null, channels: [] });
  });

  it("refuses a channel that grew a field, and a purpose that is not one of the three", () => {
    const answer = channelsResource({ connection: CONNECTION, channels: [ROW], routes: [] });
    const grown = { ...answer, channels: [{ ...answer.channels[0], botToken: "xoxb-1" }] };
    const tagged = { ...answer, channels: [{ ...answer.channels[0], purpose: "dm" }] };

    expect(channels(wire(grown))).toContain("additional properties");
    expect(channels(wire(tagged))).toBeDefined();
  });

  it("takes the three purposes as a binding and nothing else", () => {
    for (const purpose of ["loops", "alerts", "leads"]) {
      expect(binding({ purpose })).toBeUndefined();
    }

    expect(binding({ purpose: "dm" })).toBeDefined();
    expect(binding({})).toBeDefined();
    expect(binding({ purpose: "loops", channel: "C071LOOPS" })).toContain("additional properties");
  });

  it("documents every refusal's code under the status it is answered with", () => {
    const paths = document().paths as Record<
      string,
      Record<string, { responses: Record<string, { description: string }> }>
    >;
    const bind = paths["/api/v1/slack/channels/{id}/binding"].put.responses;
    const unbind = paths["/api/v1/slack/channels/{id}/binding"].delete.responses;
    const refresh = paths["/api/v1/slack/channels/refresh"].post.responses;

    expect(bind["404"].description).toContain("slack_channel_not_found");
    for (const code of [
      "slack_not_connected",
      "slack_channel_archived",
      "slack_channel_not_joined",
    ]) {
      expect(bind["409"].description).toContain(code);
    }
    expect(bind["422"].description).toContain("validation_failed");
    expect(unbind["404"].description).toContain("slack_channel_not_found");
    expect(unbind["409"].description).toContain("slack_not_connected");
    expect(refresh["409"].description).toContain("slack_not_connected");
    expect(refresh["502"].description).toContain("slack_channel_list_failed");
  });
});

describe("what Slack is answered with, on the wire", () => {
  it("matches the command acknowledgement and both event answers", () => {
    expect(validatorFor("SlackCommandAcknowledgement")(COMMAND_ACK)).toBeUndefined();
    expect(validatorFor("SlackEventAcknowledgement")({})).toBeUndefined();
    expect(validatorFor("SlackEventAcknowledgement")({ challenge: "3eZbrw1a" })).toBeUndefined();
  });
});

describe("the Slack tile on the wire", () => {
  const grid = validatorFor("Integrations");
  const facts = {
    githubTokenStored: false,
    githubOrgs: [],
    sources: [],
    activeWebhooks: 0,
    runners: new Map(),
  };

  it.each([
    ["no app on the deployment", { configured: false, connection: null }],
    ["an app, not installed", { configured: true, connection: null }],
    [
      "installed",
      {
        configured: true,
        connection: {
          workspaceName: "acme-robotics",
          status: "active" as const,
          statusDetail: null,
        },
      },
    ],
    [
      "revoked",
      {
        configured: true,
        connection: {
          workspaceName: "acme-robotics",
          status: "revoked" as const,
          statusDetail: "app_uninstalled",
        },
      },
    ],
  ])("matches Integrations with %s", (_label, slack) => {
    expect(grid(wire(composeIntegrations({ ...facts, slack })))).toBeUndefined();
  });
});
