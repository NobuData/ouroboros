/**
 * The OpenAPI document and what the Needs-You reads send (#464): real service answers — a busy
 * queue with a snoozed item, a resolved day, the stat card warm and cold, the policy card and the
 * snooze results — held to the documented, closed schemas.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import type { AuditService } from "../audit/audit.service";
import { policyCard } from "../inbox-policies/inbox-policies.compose";
import { document } from "../../openapi/specification";
import type { CapabilityRepository } from "../tenancy/capability.repository";
import { resolveActions } from "./decision.actions";
import type { DecisionKindRegistry } from "./decision-kind.registry";
import { SEEDED_PAYLOADS, SHIPPED_KINDS } from "./decision.kinds.fixture";
import { renderDecision } from "./decision.templates";
import { InboxQueueService } from "./inbox.queue";
import type { InboxItemRow, InboxRepository } from "./inbox.repository";

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

/** The answer as it leaves the service — JSON, as a client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

const NOW = new Date("2026-10-04T10:00:00Z");

/** An item of a kind. */
function row(kindId: string, overrides: Partial<InboxItemRow> = {}): InboxItemRow {
  return {
    id: "5eed0082-0000-4000-8000-000000000001",
    kindId,
    kindVersion: 1,
    severity: SHIPPED_KINDS[kindId].severityDefault,
    status: "open",
    payload: SEEDED_PAYLOADS[kindId],
    refs: [{ type: "run", id: "5eed0009-0000-4000-8000-000000000479", label: "loop #1844" }],
    createdAt: new Date(NOW.getTime() - 480_000),
    snoozedUntil: null,
    snoozedBy: null,
    snoozeReason: null,
    ...overrides,
  };
}

/** The service over stubs that answer like the seeded workspace. */
function queue(week: boolean): InboxQueueService {
  const repository = {
    wake: () => Promise.resolve(0),
    open: () => Promise.resolve([row("merge_approval"), row("protected_path_allow_once")]),
    snoozed: () =>
      Promise.resolve([
        row("fact_review", {
          status: "snoozed",
          snoozedUntil: new Date("2026-10-05T09:00:00Z"),
          snoozedBy: "u",
        }),
      ]),
    week: () =>
      Promise.resolve(
        week
          ? {
              week: "2026-09-28",
              decisions: 11,
              medianAnswerSeconds: 41,
              maxLoopWaitSeconds: 360,
              policyResolutions: 1,
              autoAcceptShare: 0.0909,
              perKind: { protected_path_allow_once: 8 },
            }
          : undefined,
      ),
    resolved: () =>
      Promise.resolve([
        {
          itemId: "5eed0082-0000-4000-8000-000000000101",
          kindId: "resize_review",
          kindVersion: 1,
          payload: SEEDED_PAYLOADS.resize_review,
          refs: [
            { type: "ticket", id: "5eed0079-0000-4000-8000-000000000486", label: "issue #486" },
          ],
          actionId: "accept_resize",
          resolver: "policy" as const,
          policy: "auto_accept_resize",
          actorId: null,
          actorName: null,
          channel: "api" as const,
          note: null,
          outcome: { org_policy_version: 7 },
          resolvedAt: new Date("2026-10-04T08:47:12Z"),
          answerLatencySeconds: 12,
          loopWaitSeconds: null,
        },
      ]),
    previousDay: () => Promise.resolve(null),
    item: () => Promise.resolve(row("fact_review")),
    snooze: () => Promise.resolve("5eed0084-0000-4000-8000-000000000001"),
    snoozeAll: () => Promise.resolve({ eventId: null, items: [] }),
    unsnooze: () => Promise.resolve([]),
  };
  const registry: Pick<DecisionKindRegistry, "pinnedKind" | "render" | "actionsFor"> = {
    pinnedKind: (kindId) => Promise.resolve(SHIPPED_KINDS[kindId]),
    render: renderDecision,
    actionsFor: (kind, viewer) => resolveActions(kind.actions, viewer),
  };
  const service = new InboxQueueService(
    repository as unknown as InboxRepository,
    registry as unknown as DecisionKindRegistry,
    { explicitFor: () => Promise.resolve(null) } as unknown as CapabilityRepository,
    { record: () => Promise.resolve("a") } as unknown as AuditService,
  );

  jest.spyOn(service, "now").mockReturnValue(NOW);

  return service;
}

describe("the Needs-You reads and the document", () => {
  it("sends what InboxQueue describes", async () => {
    const validate = validatorFor("InboxQueue");

    expect(
      validate(wire(await queue(true).queue("acme", { userId: "u", roles: ["member"] }))),
    ).toBeUndefined();
    expect(
      validate(wire(await queue(false).queue("acme", { userId: null, roles: [] }))),
    ).toBeUndefined();
  });

  it("sends what InboxResolved describes", async () => {
    expect(
      validatorFor("InboxResolved")(wire(await queue(true).resolved("acme", "2026-10-04"))),
    ).toBeUndefined();
  });

  it("sends what InboxStats describes, warm and cold", async () => {
    const validate = validatorFor("InboxStats");

    expect(validate(wire(await queue(true).stats("acme")))).toBeUndefined();
    expect(validate(wire(await queue(false).stats("acme")))).toBeUndefined();
  });

  it("sends what InboxSnoozeResult and InboxUnsnoozeResult describe", async () => {
    const service = queue(true);

    expect(
      validatorFor("InboxSnoozeResult")(wire(await service.snooze("acme", "x", "u", 60, null))),
    ).toBeUndefined();
    expect(
      validatorFor("InboxSnoozeResult")(wire(await service.snoozeAll("acme", "u", 60, null))),
    ).toBeUndefined();
    expect(
      validatorFor("InboxUnsnoozeResult")(wire(await service.unsnooze("acme", null, "u"))),
    ).toBeUndefined();
  });

  it("sends what InboxPolicyCard describes", () => {
    const card = policyCard({
      policy: {
        version: 7,
        publishedAt: NOW,
        rules: {
          human_review: {
            enabled: true,
            conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
          },
        },
      },
      protectedPaths: [{ glob: "boot/**", repos: 1 }],
      spendDormant: true,
      dryRun: false,
    });

    expect(validatorFor("InboxPolicyCard")(wire(card))).toBeUndefined();
    expect(
      validatorFor("InboxPolicyCard")(
        wire(policyCard({ policy: null, protectedPaths: [], spendDormant: true, dryRun: true })),
      ),
    ).toBeUndefined();
  });
});
