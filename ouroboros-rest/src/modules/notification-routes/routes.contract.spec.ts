/**
 * The OpenAPI document and what `/api/v1/settings/notifications` and
 * `/api/v1/settings/integrations` send (#488). Real answers — default and stored routes, a locked
 * one, every tile state — are held to their schemas, which are `additionalProperties: false`
 * throughout, and the locked-route refusal to what the `409` documents.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import type { AuditService } from "../audit/audit.service";
import type { RunnerStatus } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import { composeIntegrations } from "../integrations/integrations.tiles";
import { NotificationRoutesService } from "./routes.service";
import { FakeRouteStore } from "./routes.store.fixture";

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

const ORG = "org-acme";

/**
 * The routes service over an in-memory store.
 *
 * @returns The service and its store.
 */
function routes(): { service: NotificationRoutesService; store: FakeRouteStore } {
  const store = new FakeRouteStore();
  const audit = { record: () => Promise.resolve("audit-id") } as unknown as AuditService;

  return { service: new NotificationRoutesService(store.repository(), audit), store };
}

describe("the notification routes on the wire", () => {
  const card = validatorFor("NotificationRoutes");
  const route = validatorFor("NotificationRoute");
  const patch = validatorFor("NotificationRoutePatch");

  it("matches NotificationRoutes for defaults, stored, locked and custom routes", async () => {
    const { service, store } = routes();
    store
      .route(ORG, "loop_failures", { channel: "pagerduty", config: {}, enabled: false })
      .route(ORG, "custom:release-notes", { channel: "email", config: {}, enabled: true });
    await service.update(ORG, "u-ken", "weekly_insights", {
      enabled: true,
      config: { weekday: "monday", time: "09:00", recipients: ["eng-leads@acme-robotics.dev"] },
    });

    expect(card(wire(await service.list(ORG)))).toBeUndefined();
    expect(route(wire(await service.read(ORG, "daily_digest")))).toBeUndefined();
  });

  it("documents the bodies the card sends, and refuses others", () => {
    expect(patch({ enabled: true })).toBeUndefined();
    expect(
      patch({ channel: "email", config: { time: "07:30", recipients: ["a@acme.dev"] } }),
    ).toBeUndefined();
    expect(patch({ channel: "sms" })).toBeDefined();
    expect(patch({ config: { channel: "#eng-leads" } })).toBeDefined();
  });

  it("refuses a locked enable with the details the 409 documents", async () => {
    const { service } = routes();
    const error = await service
      .update(ORG, "u-ken", "loop_failures", { enabled: true })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).envelope().details).toEqual({
      kind: "loop_failures",
      channel: "pagerduty",
      locked: true,
      reason: "connect PagerDuty first",
    });
  });
});

describe("the integrations grid on the wire", () => {
  const grid = validatorFor("Integrations");

  it("matches Integrations for a bare workspace and a connected one", () => {
    expect(
      grid(
        wire(
          composeIntegrations({
            githubTokenStored: false,
            githubOrgs: [],
            sources: [],
            activeWebhooks: 0,
            runners: new Map(),
          }),
        ),
      ),
    ).toBeUndefined();
    expect(
      grid(
        wire(
          composeIntegrations({
            githubTokenStored: true,
            githubOrgs: [{ login: "acme-robotics", appInstalled: true }],
            sources: [
              {
                kind: "jira",
                displayName: "Jira · PROJ",
                status: "error",
                statusReason: "401 from Jira",
                config: { base_url: "https://acme-robotics.atlassian.net" },
                hasCredential: true,
              },
            ],
            activeWebhooks: 2,
            runners: new Map<RunnerStatus, number>([
              ["online", 1],
              ["offline", 1],
            ]),
          }),
        ),
      ),
    ).toBeUndefined();
  });
});
