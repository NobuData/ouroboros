/**
 * The OpenAPI document and what the Slack family sends (#535). Real answers — every connection
 * state, both acknowledgements, a tile for each state — are held to their schemas, which are
 * `additionalProperties: false` throughout.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import type { ChatConnectionPublic } from "../db/schema";
import { composeIntegrations } from "../integrations/integrations.tiles";
import { COMMAND_ACK } from "./slack.inbound.service";
import { connectionResource } from "./slack.resources";

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
