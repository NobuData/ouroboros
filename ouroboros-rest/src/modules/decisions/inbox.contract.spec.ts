/**
 * The OpenAPI document and what `GET /api/v1/inbox/feed` sends (#461). `openapi.spec.ts` sees the
 * route only unauthenticated; this holds real service answers — an empty inbox, a busy one with
 * snoozed items — to the documented, closed `InboxFeed` schema.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { DecisionStore } from "./decision.store.fixture";
import { InboxFeedService } from "./inbox.feed";

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

describe("the inbox feed and the document", () => {
  const validate = validatorFor("InboxFeed");

  it("sends what InboxFeed describes, empty and busy", async () => {
    const store = new DecisionStore();
    const service = new InboxFeedService(store.asRepository());

    expect(validate(JSON.parse(JSON.stringify(await service.feed("acme"))))).toBeUndefined();

    store.items.push(
      {
        id: "1",
        organizationId: "acme",
        kindId: "merge_approval",
        kindVersion: 1,
        payload: {},
        refs: [],
        severity: "err",
        status: "open",
        plane: "pr.gates",
        sourceRef: "pr:1",
        snoozedUntil: null,
      },
      {
        id: "2",
        organizationId: "acme",
        kindId: "fact_review",
        kindVersion: 1,
        payload: {},
        refs: [],
        severity: "info",
        status: "snoozed",
        plane: "facts",
        sourceRef: "fact:1:proposed",
        snoozedUntil: new Date(Date.now() + 3_600_000),
      },
    );

    const busy = JSON.parse(JSON.stringify(await service.feed("acme"))) as Record<string, unknown>;

    expect(validate(busy)).toBeUndefined();
    expect(busy.open).toBe(1);
    expect(busy.snoozed).toBe(1);
  });

  it("refuses a feed with a field the document does not name", () => {
    expect(
      validate({
        open: 0,
        bySeverity: { err: 0, warn: 0, info: 0 },
        snoozed: 0,
        nextWakeAt: null,
        asOf: "2026-10-04T09:12:00.000Z",
        pill: 0,
      }),
    ).toBeDefined();
  });
});
