import type { AuditService } from "../audit/audit.service";
import type { CapabilityRepository } from "../tenancy/capability.repository";
import { resolveActions } from "./decision.actions";
import type { DecisionKindRegistry } from "./decision-kind.registry";
import { MOCKUP_PROSE, SEEDED_PAYLOADS, SHIPPED_KINDS } from "./decision.kinds.fixture";
import { renderDecision } from "./decision.templates";
import { InboxQueueService } from "./inbox.queue";
import type {
  InboxItemRow,
  InboxRepository,
  InboxResolvedRow,
  InboxWeekRow,
} from "./inbox.repository";

/**
 * The page's reads and snooze over a stubbed store and the real renderer: the mockup's queue and
 * head, role-filtered actions, the snoozed collection, the resolved day, the stat card on a cold
 * workspace, and snooze's audit trail.
 */

const ORG = "org-acme";
const NOW = new Date("2026-10-04T10:00:00Z");

/** An item asked `minutes` before {@link NOW}. */
function item(
  kindId: string,
  minutes: number,
  overrides: Partial<InboxItemRow> = {},
): InboxItemRow {
  return {
    id: `item-${kindId}`,
    kindId,
    kindVersion: 1,
    severity: SHIPPED_KINDS[kindId].severityDefault,
    status: "open",
    payload: SEEDED_PAYLOADS[kindId],
    refs: [],
    createdAt: new Date(NOW.getTime() - minutes * 60_000),
    snoozedUntil: null,
    snoozedBy: null,
    snoozeReason: null,
    ...overrides,
  };
}

/** The seeded week (#460). */
const WEEK: InboxWeekRow = {
  week: "2026-09-28",
  decisions: 11,
  medianAnswerSeconds: 41,
  maxLoopWaitSeconds: 360,
  policyResolutions: 1,
  autoAcceptShare: 0.0909,
  perKind: {
    plan_sign_off: 290,
    resize_review: 25,
    split_approval: 55.5,
    run_needs_human: 55,
    protected_path_allow_once: 8,
  },
};

/** The service over stubs. */
function service(
  options: { open?: InboxItemRow[]; snoozed?: InboxItemRow[]; week?: InboxWeekRow } = {},
) {
  const repository = {
    wake: jest.fn(() => Promise.resolve(0)),
    open: jest.fn(() =>
      Promise.resolve(
        options.open ?? [
          item("merge_approval", 8),
          item("protected_path_allow_once", 21),
          item("claim_waiver", 34),
        ],
      ),
    ),
    snoozed: jest.fn(() => Promise.resolve(options.snoozed ?? [])),
    week: jest.fn(() => Promise.resolve("week" in options ? options.week : WEEK)),
    item: jest.fn((_org: string, id: string) =>
      Promise.resolve(id === "missing" ? undefined : item("fact_review", 5, { id })),
    ),
    resolved: jest.fn(() => Promise.resolve([] as InboxResolvedRow[])),
    previousDay: jest.fn(() => Promise.resolve("2026-10-02" as string | null)),
    snooze: jest.fn(() => Promise.resolve("event-1")),
    snoozeAll: jest.fn((): Promise<{ eventId: string | null; items: string[] }> =>
      Promise.resolve({ eventId: "event-2", items: ["a", "b"] }),
    ),
    unsnooze: jest.fn(() => Promise.resolve(["a"])),
  };
  const registry: Pick<DecisionKindRegistry, "pinnedKind" | "render" | "actionsFor"> = {
    pinnedKind: (kindId) => Promise.resolve(SHIPPED_KINDS[kindId]),
    render: renderDecision,
    actionsFor: (kind, viewer) => resolveActions(kind.actions, viewer),
  };
  const capabilities = { explicitFor: jest.fn(() => Promise.resolve(null as boolean | null)) };
  const audit = { record: jest.fn(() => Promise.resolve("audit-1")) };
  const queue = new InboxQueueService(
    repository as unknown as InboxRepository,
    registry as unknown as DecisionKindRegistry,
    capabilities as unknown as CapabilityRepository,
    audit as unknown as AuditService,
  );

  jest.spyOn(queue, "now").mockReturnValue(NOW);

  return { queue, repository, capabilities, audit };
}

describe("InboxQueueService.queue", () => {
  it("reproduces the mockup: three cards newest first, their ages, their prose, and the head", async () => {
    const { queue, repository } = service();

    const page = await queue.queue(ORG, { userId: "user-ken", roles: ["owner"] });

    expect(repository.wake).toHaveBeenCalledWith(ORG);
    expect(page.head.sentence).toBe("3 decisions. About 90 seconds of your time.");
    expect(page.items.map((card) => [card.kindId, card.ageSeconds, card.severity])).toEqual([
      ["merge_approval", 480, "err"],
      ["protected_path_allow_once", 1260, "warn"],
      ["claim_waiver", 2040, "warn"],
    ]);

    for (const card of page.items) {
      expect({ question: card.question, why: card.why, tags: card.tags }).toEqual(
        MOCKUP_PROSE[card.kindId],
      );
      expect(card.facts).toEqual(SEEDED_PAYLOADS[card.kindId]);
    }

    expect(page.items[0].mergeClass).toBe(true);
    expect(page.asOf).toBe(NOW.toISOString());
  });

  it("resolves actions against the viewer: a member without the capability sees approve disabled with its reason", async () => {
    const { queue, capabilities } = service();

    const page = await queue.queue(ORG, { userId: "user-jorge", roles: ["member"] });

    expect(capabilities.explicitFor).toHaveBeenCalledWith(ORG, "user-jorge");
    expect(page.items[0].actions.find((action) => action.id === "approve_merge")).toMatchObject({
      allowed: false,
      disabledReason: "capability_required",
    });
    expect(page.items[0].snooze.allowed).toBe(true);
  });

  it("lets an explicit can_approve_loops enable a member, and never lets a viewer snooze", async () => {
    const granted = service();
    granted.capabilities.explicitFor.mockResolvedValue(true);
    const viewer = service();

    const member = await granted.queue.queue(ORG, { userId: "user-jorge", roles: ["member"] });
    const watcher = await viewer.queue.queue(ORG, { userId: "user-vic", roles: ["viewer"] });

    expect(member.items[0].actions.find((action) => action.id === "approve_merge")?.allowed).toBe(
      true,
    );
    expect(watcher.items[0].snooze.allowed).toBe(false);
  });

  it("keeps snoozed items apart with their wake time, still ageing", async () => {
    const snoozed = item("fact_review", 120, {
      status: "snoozed",
      snoozedUntil: new Date("2026-10-05T09:00:00Z"),
      snoozedBy: "user-ken",
      snoozeReason: "after the ISR review",
    });
    const { queue } = service({ snoozed: [snoozed] });

    const page = await queue.queue(ORG, { userId: "user-ken", roles: ["owner"] });

    expect(page.head.count).toBe(3);
    expect(page.snoozed).toEqual([
      expect.objectContaining({
        kindId: "fact_review",
        ageSeconds: 7200,
        snoozedUntil: "2026-10-05T09:00:00.000Z",
        snoozedBy: "user-ken",
        reason: "after the ISR review",
      }),
    ]);
  });

  it("reads 'No decisions waiting.' for an empty queue, and no estimate on a cold week", async () => {
    const empty = service({ open: [] });
    const cold = service({ week: undefined });

    expect((await empty.queue.queue(ORG, { userId: null, roles: [] })).head.sentence).toBe(
      "No decisions waiting.",
    );
    expect((await cold.queue.queue(ORG, { userId: null, roles: [] })).head.sentence).toBe(
      "3 decisions.",
    );
  });
});

describe("InboxQueueService.resolved", () => {
  it("composes each row's line and pages by day", async () => {
    const { queue, repository } = service();
    repository.resolved.mockResolvedValue([
      {
        itemId: "item-1",
        kindId: "resize_review",
        kindVersion: 1,
        payload: { ticket_key: "#486", from_effort: "L", to_effort: "M", confidence: 82 },
        refs: [{ type: "ticket", id: "t", label: "issue #486" }],
        actionId: "accept_resize",
        resolver: "policy",
        policy: "auto_accept_resize",
        actorId: null,
        actorName: null,
        channel: "api",
        note: null,
        outcome: { org_policy_version: 7 },
        resolvedAt: new Date("2026-10-04T08:47:12Z"),
        answerLatencySeconds: 12,
        loopWaitSeconds: null,
      },
    ]);

    const day = await queue.resolved(ORG, undefined);

    expect(repository.resolved).toHaveBeenCalledWith(ORG, "2026-10-04");
    expect(day).toMatchObject({
      day: "2026-10-04",
      count: 1,
      previousDay: "2026-10-02",
      nextDay: null,
    });
    expect(day.rows[0]).toMatchObject({
      summary: "Estimator re-size #486 L→M — auto-accepted by policy",
      resolver: "policy",
      policy: "auto_accept_resize",
      actor: null,
      channel: "api",
      outcome: { org_policy_version: 7 },
    });
  });

  it("offers the next day when the day asked is in the past", async () => {
    const { queue } = service();

    expect((await queue.resolved(ORG, "2026-09-30")).nextDay).toBe("2026-10-01");
  });
});

describe("InboxQueueService.stats", () => {
  it("matches the week's view: 11 · 41s · 6m", async () => {
    const { queue, repository } = service();

    const stats = await queue.stats(ORG);

    expect(repository.week).toHaveBeenCalledWith(ORG, "2026-09-28");
    expect(stats).toMatchObject({
      decisions: 11,
      medianAnswerSeconds: 41,
      maxLoopWaitSeconds: 360,
      display: { decisions: "11", medianAnswer: "41s", maxLoopWait: "6m" },
    });
  });

  it("renders em-dashes, not zeros, on a cold workspace", async () => {
    const { queue } = service({ week: undefined });

    expect(await queue.stats(ORG)).toEqual({
      week: "2026-09-28",
      decisions: null,
      medianAnswerSeconds: null,
      maxLoopWaitSeconds: null,
      policyResolutions: null,
      autoAcceptShare: null,
      display: { decisions: "—", medianAnswer: "—", maxLoopWait: "—" },
    });
  });
});

describe("snooze", () => {
  it("snoozes one item until the time asked, and audits it", async () => {
    const { queue, repository, audit } = service();

    const answer = await queue.snooze(ORG, "item-7", "user-ken", 60, "after lunch");

    expect(repository.snooze).toHaveBeenCalledWith(
      "item-7",
      new Date("2026-10-04T11:00:00Z"),
      "user-ken",
      "after lunch",
    );
    expect(answer).toEqual({
      snoozed: ["item-7"],
      until: "2026-10-04T11:00:00.000Z",
      eventId: "event-1",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "decision.snoozed",
        subjectId: "item-7",
        actorId: "user-ken",
      }),
    );
  });

  it("refuses an item the workspace does not have, or one already answered", async () => {
    const { queue, repository } = service();

    await expect(queue.snooze(ORG, "missing", "user-ken", 60, null)).rejects.toMatchObject({
      code: "decision_item_not_found",
    });
    repository.item.mockResolvedValueOnce(
      item("fact_review", 1, { id: "done", status: "resolved" }),
    );
    await expect(queue.snooze(ORG, "done", "user-ken", 60, null)).rejects.toMatchObject({
      code: "decision_item_not_open",
    });
    expect(repository.snooze).not.toHaveBeenCalled();
  });

  it("snoozes all as one audited event, and audits nothing when nothing was open", async () => {
    const { queue, repository, audit } = service();

    expect(await queue.snoozeAll(ORG, "user-ken", 60, null)).toEqual({
      snoozed: ["a", "b"],
      until: "2026-10-04T11:00:00.000Z",
      eventId: "event-2",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "decision.snoozed_all", subjectId: null }),
    );

    repository.snoozeAll.mockResolvedValue({ eventId: null, items: [] });
    audit.record.mockClear();

    expect(await queue.snoozeAll(ORG, "user-ken", 60, null)).toEqual({
      snoozed: [],
      until: null,
      eventId: null,
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("un-snoozes one or all, audited only when something came back", async () => {
    const { queue, repository, audit } = service();

    expect(await queue.unsnooze(ORG, "item-7", "user-ken")).toEqual({ unsnoozed: ["a"] });
    expect(repository.unsnooze).toHaveBeenCalledWith(ORG, "item-7");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "decision.unsnoozed" }),
    );

    repository.unsnooze.mockResolvedValue([]);
    audit.record.mockClear();
    await queue.unsnooze(ORG, null, "user-ken");

    expect(repository.unsnooze).toHaveBeenLastCalledWith(ORG, null);
    expect(audit.record).not.toHaveBeenCalled();
    await expect(queue.unsnooze(ORG, "missing", "user-ken")).rejects.toMatchObject({
      code: "decision_item_not_found",
    });
  });
});
