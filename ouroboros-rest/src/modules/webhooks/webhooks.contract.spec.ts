/**
 * The OpenAPI document and what the webhook routes send (#487). `openapi.spec.ts` sees these routes
 * only unauthenticated, so this is where real answers from the service — a list with a SIEM row in
 * each state, a create's secret, a delivery-log page — are held to the documented schemas, every
 * one `additionalProperties: false`.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { WebhookDispatcher } from "./webhook.dispatcher";
import type { HostResolver } from "./webhook.ssrf";
import { WebhooksService } from "./webhooks.service";
import {
  FakeVault,
  FakeWebhookStore,
  RecordingAudit,
  ScriptedTransport,
  WORKSPACE,
  transportFailure,
  webhookConfig,
} from "./webhooks.store.fixture";

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

const dns: HostResolver = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]);

/** A service over fresh fakes, with one attempt before the DLQ. */
function harness() {
  const store = new FakeWebhookStore();
  const vault = new FakeVault();
  const transport = new ScriptedTransport();
  const config = webhookConfig({ webhookMaxAttempts: 1 });
  const dispatcher = new WebhookDispatcher(
    store.asRepository(),
    vault.asService(),
    transport,
    config,
    () => 0.5,
  );
  const service = new WebhooksService(
    store.asRepository(),
    vault.asService(),
    new RecordingAudit().asService(),
    dispatcher,
    config,
    dns,
  );

  return { store, transport, dispatcher, service };
}

describe("the webhook routes' answers, against the OpenAPI document", () => {
  it("documents a create's secret, an empty list and a list with a warning SIEM row", async () => {
    const { store, transport, dispatcher, service } = harness();

    expect(validatorFor("WebhookList")(wire(await service.list(WORKSPACE)))).toBeUndefined();

    const created = await service.create(WORKSPACE, "user-admin", {
      name: "SIEM · Splunk HEC",
      description: "Splunk HEC",
      url: "https://siem.acme.dev/services/collector/event",
      eventFamilies: ["audit.*"],
      siem: true,
    });
    expect(validatorFor("WebhookSecret")(wire(created))).toBeUndefined();

    const now = new Date();
    store.now = now;
    store.seedEvent({ occurred_at: new Date(now.getTime() + 1000) });
    transport.answer({ status: 503, body: "upstream unavailable" });
    await dispatcher.tick(now);

    const list = await service.list(WORKSPACE);
    expect(list.siem?.warning).toBe(true);
    expect(validatorFor("WebhookList")(wire(list))).toBeUndefined();
    expect(validatorFor("WebhookEndpoint")(wire(list.items[0]))).toBeUndefined();
  });

  it("documents a ping, a delivery page and a redelivery", async () => {
    const { store, transport, dispatcher, service } = harness();
    const { endpoint } = await service.create(WORKSPACE, "user-admin", {
      name: "Release notes bot",
      url: "https://hooks.acme.dev/ouroboros",
      eventFamilies: ["pr.*", "run.merged"],
    });

    expect(
      validatorFor("WebhookDelivery")(wire(await service.ping(WORKSPACE, endpoint.id))),
    ).toBeUndefined();

    const now = new Date();
    store.now = now;
    store.seedEvent({ event_type: "run.merged", occurred_at: new Date(now.getTime() + 1000) });
    transport.answer(transportFailure("timeout", "no answer within 10000 ms"));
    await dispatcher.tick(now);

    const page = await service.deliveries(WORKSPACE, endpoint.id, {});
    expect(validatorFor("WebhookDeliveryPage")(wire(page))).toBeUndefined();

    const dead = page.items.find((item) => item.status === "dead_lettered");
    const queued = await service.redeliver(WORKSPACE, "user-admin", endpoint.id, dead?.id ?? "");
    expect(validatorFor("WebhookDelivery")(wire(queued))).toBeUndefined();
  });
});
