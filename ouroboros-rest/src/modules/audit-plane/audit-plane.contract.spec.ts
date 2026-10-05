/**
 * The OpenAPI document and what `/api/v1/settings/audit` sends
 * ([#486](https://github.com/NobuData/ouroboros/issues/486)). Real service answers — a page with
 * every actor kind, the today view, and a refusal — are held to `AuditPlanePage`, `AuditToday`
 * and `Error`, which are `additionalProperties: false`, so a field added to a resource without
 * the document fails here.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { DomainError } from "../errors/error.envelope";
import { recordingAudit } from "../audit/audit.fixture";
import { auditEventResource } from "../audit/audit.resources";
import { retentionHarness } from "../retention/retention.fixture";
import {
  InMemoryAuditPlaneRepository,
  MOCKUP_ROWS,
  PLANE_ORG,
  asPlaneRepository,
} from "./audit-plane.fixture";
import { AuditPlaneService } from "./audit-plane.service";

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

describe("the audit plane on the wire", () => {
  /** The service over the mockup's five rows, clock pinned to their afternoon. */
  function service(): AuditPlaneService {
    const built = new AuditPlaneService(
      asPlaneRepository(new InMemoryAuditPlaneRepository(MOCKUP_ROWS)),
      recordingAudit().service,
      retentionHarness().service,
    );
    built.now = () => new Date("2026-10-05T15:00:00.000Z");
    return built;
  }

  it("matches AuditPlanePage for a page holding a bot, people and the system", async () => {
    const page = await service().list(PLANE_ORG, { limit: 3 });

    expect(page.nextCursor).not.toBeNull();
    expect(validatorFor("AuditPlanePage")(wire(page))).toBeUndefined();
    expect(
      validatorFor("AuditPlanePage")(wire(await service().list(PLANE_ORG, { limit: 200 }))),
    ).toBeUndefined();
  });

  it("matches AuditToday for the card's five lines", async () => {
    expect(validatorFor("AuditToday")(wire(await service().today(PLANE_ORG, {})))).toBeUndefined();
  });

  it("matches Error for a refusal", async () => {
    const refusal = await service()
      .list(PLANE_ORG, { cursor: "nope" })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(DomainError);
    expect(validatorFor("Error")(wire((refusal as DomainError).envelope()))).toBeUndefined();
  });

  it("keeps the credential trail's AuditEvent on the new actor-kind vocabulary", () => {
    // The provider row: the trail's `AuditAction` enum names the credential vocabulary only.
    expect(validatorFor("AuditEvent")(wire(auditEventResource(MOCKUP_ROWS[1])))).toBeUndefined();
  });
});
