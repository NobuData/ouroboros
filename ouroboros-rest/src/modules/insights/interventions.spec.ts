import { Reflector } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { FIXTURE_USER } from "../auth/principal.fixture";
import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import type { InterventionEvent, InterventionOverride, Organization } from "../db/schema";
import { NotFoundError, ConflictError } from "../errors/error.envelope";
import { CONTRIBUTORS, REQUIRED_ROLES } from "../tenancy/roles.guard";
import {
  runWithTenantContext,
  setTenantContext,
  type ActiveMembership,
} from "../tenancy/tenant.context";
import { InterventionsController } from "./interventions.controller";
import {
  InterventionIdParams,
  MAX_RECATEGORIZE_REASON_LENGTH,
  RecategorizeInterventionBody,
} from "./interventions.dto";
import { INTERVENTION_ERRORS } from "./interventions.errors";
import { InterventionRepository, type InterventionStore } from "./interventions.repository";
import { interventionResource } from "./interventions.resources";
import { InterventionsService } from "./interventions.service";

/**
 * The intervention re-categorization (BI.3, #434), without a server: the body's shape, the
 * resource, the service's refusals, the repository's statements and the route's role. What the
 * database does with the call — the audit row, the human cause a rule run never undoes — is
 * `tests/constraints.sql`'s V079 section; the route through the guards is
 * `interventions.integration-spec.ts`.
 */

const ORG = "org-interventions";
const EVENT_ID = "a7920000-0000-4000-8000-0000000e0001";

const EVENT = {
  id: EVENT_ID,
  organization_id: ORG,
  run_id: "a7920000-0000-0000-0000-000000000900",
  source: "waiver",
  source_ref: "a7970000-0000-0000-0000-000000000900",
  detected_at: new Date("2026-09-01T10:08:00.000Z"),
  signals: [],
  cause: "infra_rig",
  cause_origin: "human",
  rule_id: null,
  rule_version: null,
  created_at: new Date("2026-09-01T10:08:00.000Z"),
  updated_at: new Date("2026-09-02T09:00:00.000Z"),
} satisfies InterventionEvent;

const OVERRIDE = {
  id: "a7920000-0000-4000-8000-0000000f0001",
  organization_id: ORG,
  event_id: EVENT_ID,
  actor_id: FIXTURE_USER.id,
  from_cause: "other",
  to_cause: "infra_rig",
  reason: "A bench limit, not a policy call.",
  created_at: new Date("2026-09-02T09:00:00.000Z"),
} satisfies InterventionOverride;

const BODY: RecategorizeInterventionBody = {
  cause: "infra_rig",
  reason: "A bench limit, not a policy call.",
};

/**
 * The properties a body is refused on.
 *
 * @param body - The plain body.
 * @returns The refused properties.
 */
async function refusalsOf(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(RecategorizeInterventionBody, body));

  return errors.map((error) => error.property);
}

describe("the re-categorize body", () => {
  it.each([
    ["infra_rig"],
    ["ambiguous_ticket"],
    ["policy_gate"],
    ["model_disagreement"],
    ["other"],
  ])("accepts the cause %s", async (cause) => {
    await expect(refusalsOf({ cause, reason: "Because." })).resolves.toEqual([]);
  });

  it.each([["flaky"], ["INFRA_RIG"], [""], [null]])("refuses the cause %p", async (cause) => {
    await expect(refusalsOf({ cause, reason: "Because." })).resolves.toEqual(["cause"]);
  });

  it.each([[""], ["   "], [undefined], [42], ["x".repeat(MAX_RECATEGORIZE_REASON_LENGTH + 1)]])(
    "refuses the reason %p — a correction says why",
    async (reason) => {
      await expect(refusalsOf({ cause: "other", reason })).resolves.toEqual(["reason"]);
    },
  );

  it("accepts a reason of exactly the longest length", async () => {
    await expect(
      refusalsOf({ cause: "other", reason: "x".repeat(MAX_RECATEGORIZE_REASON_LENGTH) }),
    ).resolves.toEqual([]);
  });

  it("names the event by uuid", async () => {
    await expect(
      validate(plainToInstance(InterventionIdParams, { id: "nope" })),
    ).resolves.toHaveLength(1);
    await expect(
      validate(plainToInstance(InterventionIdParams, { id: EVENT_ID })),
    ).resolves.toEqual([]);
  });
});

describe("the intervention resource", () => {
  it("names the event, its origin and the override that set a human cause", () => {
    expect(interventionResource(EVENT, OVERRIDE)).toEqual({
      id: EVENT_ID,
      runId: EVENT.run_id,
      source: "waiver",
      sourceRef: EVENT.source_ref,
      detectedAt: "2026-09-01T10:08:00.000Z",
      signals: [],
      cause: "infra_rig",
      causeOrigin: "human",
      ruleId: null,
      ruleVersion: null,
      override: {
        actorId: FIXTURE_USER.id,
        fromCause: "other",
        toCause: "infra_rig",
        reason: "A bench limit, not a policy call.",
        createdAt: "2026-09-02T09:00:00.000Z",
      },
    });
  });

  it("carries the rule and no override for a rule-origin event", () => {
    const ruled = {
      ...EVENT,
      cause: "policy_gate",
      cause_origin: "rule",
      rule_id: "review-required",
      rule_version: 1,
      signals: ["check:review_required"],
    } satisfies InterventionEvent;

    expect(interventionResource(ruled, undefined)).toMatchObject({
      causeOrigin: "rule",
      ruleId: "review-required",
      ruleVersion: 1,
      signals: ["check:review_required"],
      override: null,
    });
  });
});

describe("the interventions service", () => {
  let store: jest.Mocked<InterventionStore>;
  let service: InterventionsService;

  beforeEach(() => {
    store = { recategorize: jest.fn() };
    service = new InterventionsService(store);
  });

  it("re-categorizes in the person's name and answers the event with its override", async () => {
    store.recategorize.mockResolvedValue({ event: EVENT, override: OVERRIDE });

    await expect(service.recategorize(ORG, FIXTURE_USER.id, EVENT_ID, BODY)).resolves.toEqual(
      interventionResource(EVENT, OVERRIDE),
    );
    expect(store.recategorize).toHaveBeenCalledWith(
      ORG,
      EVENT_ID,
      FIXTURE_USER.id,
      "infra_rig",
      "A bench limit, not a policy call.",
    );
  });

  it("answers 404 for an event that is not this workspace's", async () => {
    store.recategorize.mockResolvedValue(undefined);

    const refusal = service.recategorize(ORG, FIXTURE_USER.id, EVENT_ID, BODY);

    await expect(refusal).rejects.toBeInstanceOf(NotFoundError);
    await expect(refusal).rejects.toMatchObject({ code: INTERVENTION_ERRORS.notFound });
  });

  it("answers 409 when the event already has that cause", async () => {
    store.recategorize.mockRejectedValue({
      code: "23514",
      constraint: "intervention_overrides_changes_cause",
    });

    const refusal = service.recategorize(ORG, FIXTURE_USER.id, EVENT_ID, BODY);

    await expect(refusal).rejects.toBeInstanceOf(ConflictError);
    await expect(refusal).rejects.toMatchObject({ code: INTERVENTION_ERRORS.causeUnchanged });
  });

  it("lets any other failure through", async () => {
    const failure = new Error("connection reset");
    store.recategorize.mockRejectedValue(failure);

    await expect(service.recategorize(ORG, FIXTURE_USER.id, EVENT_ID, BODY)).rejects.toBe(failure);
  });
});

describe("the interventions repository", () => {
  let database: RecordingDatabase;
  let repository: InterventionRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new InterventionRepository(database.service);
  });

  it("calls recategorize_intervention and reads back the override, in one transaction", async () => {
    database.answers({ rows: [EVENT] }, { rows: [OVERRIDE] });

    await expect(
      repository.recategorize(ORG, EVENT_ID, FIXTURE_USER.id, "infra_rig", BODY.reason),
    ).resolves.toEqual({ event: EVENT, override: OVERRIDE });

    const sqls = database.statements.map((statement) => statement.sql);

    expect(sqls[0]).toBe("begin");
    expect(sqls[1]).toContain("select * from ouroboros.recategorize_intervention(");
    expect(database.statements[1].parameters).toEqual([
      ORG,
      EVENT_ID,
      FIXTURE_USER.id,
      "infra_rig",
      BODY.reason,
    ]);
    expect(sqls[2]).toContain('from "ouroboros"."intervention_overrides"');
    expect(database.statements[2].parameters).toContain(EVENT_ID);
    expect(sqls.at(-1)).toBe("commit");
  });

  it("answers undefined, and reads nothing more, when the event is not the workspace's", async () => {
    await expect(
      repository.recategorize(ORG, EVENT_ID, FIXTURE_USER.id, "other", BODY.reason),
    ).resolves.toBeUndefined();
    expect(database.statements.map((statement) => statement.sql)).toEqual([
      "begin",
      expect.stringContaining("recategorize_intervention"),
      "commit",
    ]);
  });
});

describe("the interventions controller", () => {
  const MEMBER: ActiveMembership = {
    tenant: { id: ORG } as Organization,
    roles: ["member"],
  };

  let service: jest.Mocked<InterventionsService>;
  let controller: InterventionsController;

  beforeEach(() => {
    service = {
      recategorize: jest.fn().mockResolvedValue(interventionResource(EVENT, OVERRIDE)),
    } as unknown as jest.Mocked<InterventionsService>;
    controller = new InterventionsController(service);
  });

  it("re-categorizes in the session's workspace, in the signed-in person's name", async () => {
    await runWithTenantContext(async () => {
      setTenantContext({ user: FIXTURE_USER, membership: MEMBER });

      await controller.recategorize(MEMBER, { id: EVENT_ID }, BODY);
    });

    expect(service.recategorize).toHaveBeenCalledWith(ORG, FIXTURE_USER.id, EVENT_ID, BODY);
  });

  it("refuses a correction nobody can be named for", () => {
    expect(() => controller.recategorize(MEMBER, { id: EVENT_ID }, BODY)).toThrow(
      /no signed-in person/,
    );
  });

  it("asks member and above — a viewer is refused", () => {
    const roles = new Reflector().get<string[]>(REQUIRED_ROLES, controller.recategorize);

    expect(roles).toEqual([...CONTRIBUTORS]);
    expect(roles).toContain("member");
    expect(roles).not.toContain("viewer");
  });
});
