import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import type { AuditService } from "../../audit/audit.service";
import { VALIDATION_FAILED, validationPipe } from "../../errors/validation";
import { REQUIRED_ROLES } from "../../tenancy/roles.guard";
import { FakeRunStore } from "../analysis.fixture";
import type { AnalysisRepository } from "../analysis.repository";
import { FakeCorpusRepository, mockupCorpus, ORG, REPO } from "../corpus/corpus.fixture";
import type { CorpusRepository } from "../corpus/corpus.repository";
import { AnalysisScheduleController } from "./schedule.controller";
import { PutAnalysisScheduleBody } from "./schedule.dto";
import { AnalysisScheduleService } from "./schedule.service";

const ACTOR = "5eed0002-0000-4000-8000-000000000001";

/** The seeded schedule, as the editor would save it. */
const BODY = {
  repo: REPO,
  enabled: true,
  weeklyEnabled: true,
  weeklyDay: 1,
  weeklyTime: "06:00",
  everyNBuilds: 50,
  maxBuilds: 2000,
  maxLogLines: 1_230_000,
  computeCeilingSeconds: 3600,
};

/** The fields a body is refused on. */
async function refusals(body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(PutAnalysisScheduleBody, body));

  return errors.map((error) => error.property).sort();
}

function harness() {
  const store = new FakeRunStore();
  const corpus = new FakeCorpusRepository(mockupCorpus());
  const audit = { record: jest.fn().mockResolvedValue("audit-1") };
  const service = new AnalysisScheduleService(
    store as unknown as AnalysisRepository,
    corpus as unknown as CorpusRepository,
    audit as unknown as AuditService,
  );

  return { store, audit, service };
}

describe("the schedule body", () => {
  it("accepts the seeded schedule", async () => {
    expect(await refusals(BODY)).toEqual([]);
  });

  it("accepts the weekly trigger off with no slot, and every-N off", async () => {
    expect(
      await refusals({
        ...BODY,
        weeklyEnabled: false,
        weeklyDay: null,
        weeklyTime: null,
        everyNBuilds: null,
      }),
    ).toEqual([]);
  });

  it("requires a whole weekly slot while the weekly trigger is on (V080's weekly_slot)", async () => {
    expect(await refusals({ ...BODY, weeklyDay: null, weeklyTime: null })).toEqual([
      "weeklyDay",
      "weeklyTime",
    ]);
  });

  it("still checks a kept slot while the weekly trigger is off", async () => {
    expect(await refusals({ ...BODY, weeklyEnabled: false, weeklyDay: 8 })).toEqual(["weeklyDay"]);
  });

  it.each([0, 8, 1.5])("refuses weekday %p", async (weeklyDay) => {
    expect(await refusals({ ...BODY, weeklyDay })).toEqual(["weeklyDay"]);
  });

  it.each(["6:00", "24:00", "06:60", "06:00:00", "noon"])("refuses time %p", async (weeklyTime) => {
    expect(await refusals({ ...BODY, weeklyTime })).toEqual(["weeklyTime"]);
  });

  it("refuses an every-N threshold below one, and a missing one", async () => {
    expect(await refusals({ ...BODY, everyNBuilds: 0 })).toEqual(["everyNBuilds"]);
    const { everyNBuilds: _omitted, ...missing } = BODY;
    expect(await refusals(missing)).toEqual(["everyNBuilds"]);
  });

  it("refuses budgets below one, fractions and ones past the column", async () => {
    expect(
      await refusals({ ...BODY, maxBuilds: 0, maxLogLines: 1.5, computeCeilingSeconds: 2 ** 31 }),
    ).toEqual(["computeCeilingSeconds", "maxBuilds", "maxLogLines"]);
  });

  it("refuses a repository that is not owner/name", async () => {
    expect(await refusals({ ...BODY, repo: "../etc" })).toEqual(["repo"]);
  });

  it("refuses a field it does not declare — the counter is not a client's to set", async () => {
    await expect(
      validationPipe().transform(
        { ...BODY, buildCounter: 0 },
        { type: "body", metatype: PutAnalysisScheduleBody },
      ),
    ).rejects.toMatchObject({ response: { code: VALIDATION_FAILED } });
  });
});

describe("reading a schedule", () => {
  it("answers V080's defaults, unsaved, for a repository with none", async () => {
    const { service } = harness();

    expect(await service.read(ORG, REPO)).toEqual({
      repo: REPO,
      saved: false,
      enabled: true,
      weeklyEnabled: false,
      weeklyDay: null,
      weeklyTime: null,
      everyNBuilds: null,
      buildCounter: 0,
      maxBuilds: 2000,
      maxLogLines: 5_000_000,
      computeCeilingSeconds: 3600,
    });
  });

  it("answers the saved schedule with its live counter and an HH:MM time", async () => {
    const { service, store } = harness();
    await store.saveSchedule(ORG, { ...BODY, repoRef: REPO }, ACTOR);
    store.schedules[0].build_counter = 12;

    expect(await service.read(ORG, REPO)).toMatchObject({
      saved: true,
      weeklyDay: 1,
      weeklyTime: "06:00",
      everyNBuilds: 50,
      buildCounter: 12,
      maxLogLines: 1_230_000,
    });
  });

  it("is a 404 for a repository the workspace does not have", async () => {
    const { service } = harness();

    await expect(service.read(ORG, "someone/else")).rejects.toMatchObject({
      response: { code: "analysis_repository_not_found" },
    });
  });
});

describe("saving a schedule", () => {
  it("saves the whole configuration, audits it, and leaves the counter alone", async () => {
    const { service, store, audit } = harness();
    await store.saveSchedule(ORG, { ...BODY, repoRef: REPO }, ACTOR);
    store.schedules[0].build_counter = 37;

    const saved = await service.save(ORG, ACTOR, {
      ...BODY,
      weeklyEnabled: false,
      everyNBuilds: 25,
    });

    expect(saved).toMatchObject({
      saved: true,
      weeklyEnabled: false,
      weeklyDay: 1,
      weeklyTime: "06:00",
      everyNBuilds: 25,
      buildCounter: 37,
    });
    expect(store.schedules).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: ACTOR,
      action: "analyzer.schedule_updated",
      subjectType: "analysis_schedule",
      subjectId: store.schedules[0].id,
      at: store.schedules[0].updated_at,
      detail: {
        repo: REPO,
        enabled: true,
        weeklyEnabled: false,
        weeklyDay: 1,
        weeklyTime: "06:00",
        everyNBuilds: 25,
        maxBuilds: 2000,
        maxLogLines: 1_230_000,
        computeCeilingSeconds: 3600,
      },
    });
  });

  it("saves nothing and audits nothing for a repository the workspace does not have", async () => {
    const { service, store, audit } = harness();

    await expect(service.save(ORG, ACTOR, { ...BODY, repo: "someone/else" })).rejects.toMatchObject(
      { response: { code: "analysis_repository_not_found" } },
    );
    expect(store.schedules).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("who may do what", () => {
  const roles = (handler: keyof AnalysisScheduleController): unknown =>
    Reflect.getMetadata(REQUIRED_ROLES, AnalysisScheduleController.prototype[handler]);

  it("lets every member read and only an administrator save", () => {
    expect(roles("read")).toBeUndefined();
    expect(roles("save")).toEqual(["owner", "admin"]);
  });
});
