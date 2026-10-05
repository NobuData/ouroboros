/**
 * The OpenAPI document and what `/api/v1/settings/retention` sends
 * ([#482](https://github.com/NobuData/ouroboros/issues/482)). Real service answers — defaults,
 * stored tiers, a custom class, a booked and a swept class, a viewer — are held to
 * `RetentionSettings`, which is `additionalProperties: false` throughout, and a refusal's details
 * to what the `422` documents.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { DomainError } from "../errors/error.envelope";
import { retentionHarness } from "./retention.fixture";

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
const ADMIN = { userId: "u-ken", roles: ["owner"] as const };
const VIEWER = { userId: "u-jorge", roles: ["viewer"] as const };

describe("the retention tiers on the wire", () => {
  const settings = validatorFor("RetentionSettings");
  const patch = validatorFor("RetentionPatch");

  it("matches RetentionSettings for the defaults, as a viewer", async () => {
    const { service } = retentionHarness();

    expect(settings(wire(await service.read(ORG, VIEWER)))).toBeUndefined();
  });

  it("matches RetentionSettings for stored, custom, booked and swept classes", async () => {
    const { service, schedule } = retentionHarness();
    schedule.booked("transcripts", new Date("2026-10-04T13:00:00.000Z"));
    schedule.swept("transcripts", new Date("2026-10-04T12:00:00.000Z"), 3);

    const card = await service.update(ORG, ADMIN, {
      classes: { transcripts: 14, audit: 730, "custom:chat-commands": 1095 },
    });

    expect(settings(wire(card))).toBeUndefined();
  });

  it("documents both bodies the card sends", () => {
    expect(patch({ loopDays: 30 })).toBeUndefined();
    expect(patch({ classes: { audit: 400, "custom:chat-messages": 60 } })).toBeUndefined();
    expect(patch({ loopDays: "30" })).toBeDefined();
    expect(patch({ days: 30 })).toBeDefined();
  });

  it("refuses with the details the 422 documents", async () => {
    const { service } = retentionHarness();
    const error = await service
      .update(ORG, ADMIN, { classes: { audit: 30 } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).envelope()).toEqual({
      code: "retention_out_of_bounds",
      message: "Retention for audit must be at least 90 days.",
      details: {
        refusals: [
          {
            dataClass: "audit",
            days: 30,
            reason: "below_floor",
            floor: 90,
            ceiling: 3650,
            message: "Retention for audit must be at least 90 days.",
          },
        ],
        fields: { "classes.audit": ["Retention for audit must be at least 90 days."] },
      },
    });
  });
});
