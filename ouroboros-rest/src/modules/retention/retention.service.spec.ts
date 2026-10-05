import { DomainError } from "../errors/error.envelope";
import { VALIDATION_FAILED } from "../errors/validation";
import { RETENTION_ERRORS } from "./retention.errors";
import { retentionHarness, type RetentionHarness } from "./retention.fixture";
import { RETENTION_EFFECT_NOTE } from "./retention.resources";
import { TIER_CACHE_MS, type RetentionCaller } from "./retention.service";

/**
 * `RetentionPolicyService` (#482): defaults that reproduce the old sweeps, bounds with reasons,
 * the simple select against the advanced editor, one audit row per change, per-class cutoffs.
 */

const ORG = "org-acme";
const OTHER = "org-other";
const NOW = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;
const ADMIN: RetentionCaller = { userId: "u-ken", roles: ["owner"] };
const VIEWER: RetentionCaller = { userId: "u-jorge", roles: ["member"] };

let harness: RetentionHarness;

beforeEach(() => {
  harness = retentionHarness();
});

/** The thrown error's envelope. */
async function refusal(work: Promise<unknown>): Promise<ReturnType<DomainError["envelope"]>> {
  const error: unknown = await work.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  return (error as DomainError).envelope();
}

describe("defaults", () => {
  it("reproduce the old sweeps for a workspace that stored nothing — 30/30/30 and audit 400", async () => {
    const card = await harness.service.read(ORG, ADMIN);

    expect(card.classes.map((tier) => [tier.dataClass, tier.days, tier.source])).toEqual([
      ["transcripts", 30, "default"],
      ["build_logs", 30, "default"],
      ["artifacts", 30, "default"],
      ["audit", 400, "default"],
    ]);
    expect(card.loopDays).toBe(30);
    expect(card.effect).toBe(RETENTION_EFFECT_NOTE);
  });

  it("keep a deployment's OURO_ARTIFACT_RETENTION_DAYS for artifacts, so an upgrade deletes nothing", async () => {
    const raised = retentionHarness([], 90);

    expect(await raised.service.daysFor(ORG, "artifacts")).toBe(90);
    expect((await raised.service.cutoffs("artifacts", NOW)).fallback).toEqual(
      new Date(NOW.getTime() - 90 * DAY),
    );
  });

  it("give a custom class with no stored tier loop data's thirty days", async () => {
    expect(await harness.service.daysFor(ORG, "custom:chat-messages")).toBe(30);
  });
});

describe("cutoffs", () => {
  beforeEach(() => {
    harness = retentionHarness([
      { organizationId: ORG, dataClass: "transcripts", days: 7 },
      { organizationId: OTHER, dataClass: "build_logs", days: 90 },
    ]);
  });

  it("are computed centrally — now − days — for the class asked, per workspace", async () => {
    const transcripts = await harness.service.cutoffs("transcripts", NOW);

    expect(transcripts.dataClass).toBe("transcripts");
    expect(transcripts.fallback).toEqual(new Date(NOW.getTime() - 30 * DAY));
    expect([...transcripts.byOrganization]).toEqual([[ORG, new Date(NOW.getTime() - 7 * DAY)]]);
  });

  it("move for the changed class only — the unchanged classes keep their cutoffs", async () => {
    const before = await harness.service.cutoffs("build_logs", NOW);
    await harness.service.update(ORG, ADMIN, { classes: { artifacts: 14 } });

    expect(await harness.service.cutoffs("build_logs", NOW)).toEqual(before);
    expect((await harness.service.cutoffs("artifacts", NOW)).byOrganization.get(ORG)).toEqual(
      new Date(NOW.getTime() - 14 * DAY),
    );
    expect((await harness.service.cutoffs("audit", NOW)).byOrganization.size).toBe(0);
  });
});

describe("the simple select", () => {
  it("sets the three loop-data classes and leaves audit untouched", async () => {
    await harness.service.update(ORG, ADMIN, { classes: { audit: 500 } });
    const card = await harness.service.update(ORG, ADMIN, { loopDays: 90 });

    expect(card.classes.map((tier) => [tier.dataClass, tier.days])).toEqual([
      ["transcripts", 90],
      ["build_logs", 90],
      ["artifacts", 90],
      ["audit", 500],
    ]);
    expect(card.loopDays).toBe(90);
  });

  it("reads `mixed` (null) once the advanced editor has set the loop classes apart", async () => {
    const card = await harness.service.update(ORG, ADMIN, { classes: { transcripts: 14 } });

    expect(card.loopDays).toBeNull();
  });

  it("refuses below the floor once, bound to the select, and stores nothing", async () => {
    const envelope = await refusal(harness.service.update(ORG, ADMIN, { loopDays: 3 }));

    expect(envelope.code).toBe(RETENTION_ERRORS.outOfBounds);
    expect(envelope.details.fields).toEqual({
      loopDays: ["Retention for transcripts, logs and artifacts must be at least 7 days."],
    });
    expect(envelope.details.refusals).toHaveLength(3);
    expect(harness.repository.rows.size).toBe(0);
    expect(harness.audited).toEqual([]);
  });
});

describe("the advanced editor", () => {
  it("sets classes individually, custom ones included, without a schema change", async () => {
    const card = await harness.service.update(ORG, ADMIN, {
      classes: { build_logs: 60, audit: 730, "custom:chat-commands": 1095 },
    });

    expect(card.classes.map((tier) => [tier.dataClass, tier.days, tier.source])).toEqual([
      ["transcripts", 30, "default"],
      ["build_logs", 60, "policy"],
      ["artifacts", 30, "default"],
      ["audit", 730, "policy"],
      ["custom:chat-commands", 1095, "policy"],
    ]);
    expect(await harness.service.daysFor(ORG, "custom:chat-commands")).toBe(1095);
  });

  it("refuses audit below 90 and loop data below 7, every refusal with its reason, all or nothing", async () => {
    const envelope = await refusal(
      harness.service.update(ORG, ADMIN, {
        classes: { audit: 30, transcripts: 3, build_logs: 60 },
      }),
    );

    expect(envelope.code).toBe(RETENTION_ERRORS.outOfBounds);
    expect(envelope.message).toBe("Retention for audit must be at least 90 days.");
    expect(envelope.details.refusals).toEqual([
      expect.objectContaining({ dataClass: "audit", days: 30, reason: "below_floor", floor: 90 }),
      expect.objectContaining({
        dataClass: "transcripts",
        days: 3,
        reason: "below_floor",
        floor: 7,
      }),
    ]);
    expect(envelope.details.fields).toEqual({
      "classes.audit": ["Retention for audit must be at least 90 days."],
      "classes.transcripts": ["Retention for transcripts must be at least 7 days."],
    });
    // build_logs was valid, and still nothing was stored.
    expect(harness.repository.rows.size).toBe(0);
  });

  it("refuses above the ceiling", async () => {
    const envelope = await refusal(
      harness.service.update(ORG, ADMIN, { classes: { artifacts: 400 } }),
    );

    expect(envelope.details.refusals).toEqual([
      expect.objectContaining({ reason: "above_ceiling", ceiling: 365 }),
    ]);
  });

  it("refuses an unknown class or a non-number as a malformed body", async () => {
    const envelope = await refusal(
      harness.service.update(ORG, ADMIN, { classes: { everything: 30, audit: "400" } }),
    );

    expect(envelope.code).toBe(VALIDATION_FAILED);
    expect(Object.keys(envelope.details.fields as object).sort()).toEqual([
      "classes.audit",
      "classes.everything",
    ]);
  });

  it("refuses a body carrying both controls", async () => {
    const envelope = await refusal(
      harness.service.update(ORG, ADMIN, { loopDays: 30, classes: { audit: 400 } }),
    );

    expect(envelope.code).toBe(VALIDATION_FAILED);
    expect(Object.keys(envelope.details.fields as object)).toEqual(["loopDays", "classes"]);
  });
});

describe("change auditing", () => {
  it("writes one audit row per changed class, with the class, old value, new value and actor", async () => {
    await harness.service.update(ORG, ADMIN, { classes: { audit: 400, build_logs: 14 } });
    await harness.service.update(ORG, ADMIN, { loopDays: 60 });

    expect(
      harness.audited.map((event) => ({
        actor: event.actorId,
        action: event.action,
        subject: [event.subjectType, event.subjectId],
        ...event.detail,
      })),
    ).toEqual([
      // audit: 400 is its default — not a change, so no row.
      {
        actor: "u-ken",
        action: "workspace.retention_changed",
        subject: ["workspace", ORG],
        dataClass: "build_logs",
        previousDays: 30,
        previousSource: "default",
        days: 14,
      },
      expect.objectContaining({ dataClass: "transcripts", previousDays: 30, days: 60 }),
      expect.objectContaining({
        dataClass: "build_logs",
        previousDays: 14,
        previousSource: "policy",
        days: 60,
      }),
      expect.objectContaining({ dataClass: "artifacts", previousDays: 30, days: 60 }),
    ]);
  });

  it("writes nothing for a save that changes nothing, or an empty body", async () => {
    await harness.service.update(ORG, ADMIN, { loopDays: 30 });
    await harness.service.update(ORG, ADMIN, {});

    expect(harness.audited).toEqual([]);
    expect(harness.repository.rows.size).toBe(0);
  });

  it("records who stored the tier", async () => {
    const card = await harness.service.update(ORG, ADMIN, { classes: { audit: 500 } });

    expect(card.classes.find((tier) => tier.dataClass === "audit")?.updatedBy).toBe("u-ken");
  });
});

describe("the card", () => {
  it("is editable for an administrator and read-only, with its reason, for anyone else", async () => {
    expect(await harness.service.read(ORG, ADMIN)).toMatchObject({ editable: true, reason: null });
    expect(await harness.service.read(ORG, VIEWER)).toMatchObject({
      editable: false,
      reason: "role",
    });
  });

  it("carries each class's bounds and when its next sweep applies a change", async () => {
    const next = new Date("2026-10-04T13:00:00.000Z");
    harness.schedule.booked("build_logs", next);
    harness.schedule.swept("build_logs", NOW, 4);

    const card = await harness.service.read(ORG, ADMIN);
    const logs = card.classes.find((tier) => tier.dataClass === "build_logs");
    const audit = card.classes.find((tier) => tier.dataClass === "audit");

    expect(logs).toMatchObject({
      floor: 7,
      ceiling: 365,
      loopData: true,
      nextSweepAt: next.toISOString(),
      lastSweep: { at: NOW.toISOString(), removed: 4 },
    });
    // Nothing booked an audit purge in this harness, and the card says so rather than inventing a time.
    expect(audit).toMatchObject({ floor: 90, ceiling: 3650, loopData: false, nextSweepAt: null });
  });

  it("is the workspace's own — another workspace's tiers never show", async () => {
    await harness.service.update(OTHER, ADMIN, { classes: { audit: 900 } });

    expect((await harness.service.read(ORG, ADMIN)).classes[3]).toMatchObject({
      days: 400,
      source: "default",
    });
  });
});

describe("the per-workspace lookup a write path uses", () => {
  it("is cached, and a save through the service refreshes it", async () => {
    expect(await harness.service.daysFor(ORG, "build_logs")).toBe(30);
    expect(await harness.service.daysFor(ORG, "artifacts")).toBe(30);
    expect(harness.repository.storedCalls).toBe(1);

    await harness.service.update(ORG, ADMIN, { classes: { build_logs: 45 } });

    expect(await harness.service.daysFor(ORG, "build_logs")).toBe(45);
    expect(await harness.service.retainUntil(ORG, "build_logs", NOW)).toEqual(
      new Date(NOW.getTime() + 45 * DAY),
    );
  });

  it("is read again once the cache window has passed — a save on another replica is seen", async () => {
    jest.useFakeTimers({ now: NOW });
    try {
      await harness.service.daysFor(ORG, "build_logs");
      jest.setSystemTime(NOW.getTime() + TIER_CACHE_MS + 1);
      await harness.service.daysFor(ORG, "build_logs");

      expect(harness.repository.storedCalls).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
