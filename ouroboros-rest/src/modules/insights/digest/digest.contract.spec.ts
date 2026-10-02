/**
 * What the digest routes answer, held to what `openapi.yaml` promises (BJ.4,
 * [#440](https://github.com/NobuData/ouroboros/issues/440)).
 *
 * The service's own suite proves the behaviour; this one proves the **shape** the subscribe
 * sheet (#447) is written against, and that the two request bodies the DTOs accept are the ones
 * the contract documents.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../../openapi/specification";
import type { SessionUser } from "../../auth/principal";
import type { AppConfigService } from "../../config/config.service";
import type { Organization } from "../../db/schema";
import { RecordingMailer } from "../../mail/mail.fixture";
import type { InsightsPageService } from "../page/page.service";
import { DIGEST_STATES, weekPage } from "./digest.fixture";
import { DigestService } from "./digest.service";
import { FakeDigestStore } from "./digest.store.fixture";

/**
 * A validator for one published schema.
 *
 * @param name - The schema's name under `components.schemas`.
 * @returns A function answering the violations, or undefined when the value conforms.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/** A value as it crosses the wire: `undefined` keys gone, nothing but JSON. */
function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const ACME = { id: "org-acme", name: "Acme Robotics" } as Organization;
const KEN = { id: "ken", email: "ken@acme.dev" } as SessionUser;

/**
 * A service over an in-memory store.
 *
 * @param transport - Whether this deployment can send mail.
 * @param facts - The week the page answers.
 * @returns The service and its store.
 */
function build(transport: "smtp" | "none" = "smtp", facts = DIGEST_STATES.priced()) {
  const store = new FakeDigestStore().workspace(ACME.id, ACME.name);
  const service = new DigestService(
    store.repository,
    { read: () => Promise.resolve(weekPage(facts)) } as unknown as InsightsPageService,
    new RecordingMailer(transport),
    { uiUrl: "https://app.acme.dev" } as unknown as AppConfigService,
    () => Date.parse("2026-10-01T12:00:00.000Z"),
  );

  return { service, store };
}

describe("the digest's state against its published schema", () => {
  const violations = validatorFor("InsightsDigest");

  it.each(["smtp", "none"] as const)("admits the default state with transport %s", async (how) => {
    expect(violations(wire(await build(how).service.state(ACME, KEN)))).toBeUndefined();
  });

  it("admits a subscribed member on a saved schedule", async () => {
    const { service } = build();

    await service.setSubscription(ACME, KEN, true);

    expect(
      violations(wire(await service.setSchedule(ACME, KEN, { weeklyDay: 7, weeklyTime: "23:59" }))),
    ).toBeUndefined();
  });

  it("is closed: a key the contract does not name is a violation", async () => {
    const state = wire(await build().service.state(ACME, KEN));

    expect(violations({ ...state, lastRun: null })).toContain("additional properties");
    expect(
      violations({ ...state, schedule: { ...state.schedule, timezone: "PST" } }),
    ).toBeDefined();
    expect(violations({ ...state, mail: { transport: "sendgrid" } })).toBeDefined();
  });
});

describe("the digest's preview against its published schema", () => {
  const violations = validatorFor("InsightsDigestPreview");

  it.each(Object.entries(DIGEST_STATES))("admits the %s digest", async (_name, facts) => {
    expect(violations(wire(await build("smtp", facts()).service.preview(ACME)))).toBeUndefined();
  });
});

describe("the digest's request bodies against their published schemas", () => {
  const subscription = validatorFor("InsightsDigestSubscriptionPut");
  const schedule = validatorFor("InsightsDigestSchedulePatch");

  it("documents the bodies the DTOs accept", () => {
    expect(subscription({ subscribed: true })).toBeUndefined();
    expect(subscription({ subscribed: false })).toBeUndefined();
    expect(schedule({})).toBeUndefined();
    expect(schedule({ weeklyDay: 1 })).toBeUndefined();
    expect(schedule({ weeklyDay: 7, weeklyTime: "00:00" })).toBeUndefined();
  });

  it("documents the same refusals", () => {
    expect(subscription({})).toBeDefined();
    expect(subscription({ subscribed: "true" })).toBeDefined();
    expect(subscription({ subscribed: true, userId: "maya" })).toBeDefined();
    expect(schedule({ weeklyDay: 0 })).toBeDefined();
    expect(schedule({ weeklyDay: 8 })).toBeDefined();
    expect(schedule({ weeklyTime: "9:00" })).toBeDefined();
    expect(schedule({ weeklyTime: "24:00" })).toBeDefined();
    expect(schedule({ timezone: "PST" })).toBeDefined();
  });
});
