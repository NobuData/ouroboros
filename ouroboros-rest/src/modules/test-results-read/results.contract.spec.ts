import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import type { ArtifactStore } from "../farm/artifacts/artifact.store";
import { attemptId, FakeResultsRepository, mockupUniverse, ORG, RUN } from "./results.fixture";
import type { ResultsRepository } from "./results.repository";
import { ResultsService } from "./results.service";

/**
 * The OpenAPI document and what the reads actually send (#333). `openapi.spec.ts` sees these
 * routes only unauthenticated, so this is where a `200` body is held to its schema — and since
 * every schema is `additionalProperties: false`, a field the code adds and the document does not
 * list fails here.
 */

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

/** The reads over the mockup, as JSON goes over the wire. */
function service(repository = new FakeResultsRepository(mockupUniverse())): ResultsService {
  return new ResultsService(
    repository as unknown as ResultsRepository,
    { driver: "local" } as ArtifactStore,
  );
}

/** A value as the client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("the test-results reads keep their OpenAPI contract", () => {
  it("GET /runs/{id}/test-runs sends a TestRunTimeline", async () => {
    expect(
      validatorFor("TestRunTimeline")(wire(await service().timeline(ORG, RUN))),
    ).toBeUndefined();
  });

  it("…with no PR, no intents and no attempts too", async () => {
    const repository = new FakeResultsRepository(mockupUniverse());
    repository.universe.pullRequests = [];
    repository.universe.intents = [];
    repository.universe.attempts = [];

    expect(
      validatorFor("TestRunTimeline")(wire(await service(repository).timeline(ORG, RUN))),
    ).toBeUndefined();
  });

  it.each([1, 2, 3, 4])("GET /test-runs/{id} sends a TestRunPage for Build %i", async (n) => {
    expect(
      validatorFor("TestRunPage")(wire(await service().page(ORG, attemptId(n)))),
    ).toBeUndefined();
  });

  it("…with a tombstone, a truncated file, a build and parse warnings", async () => {
    const repository = new FakeResultsRepository(mockupUniverse());
    Object.assign(repository.universe.artifacts[2], {
      expired_at: new Date("2026-10-21T00:00:00Z"),
    });
    Object.assign(repository.universe.artifacts[3], {
      truncated: true,
      truncation_note: "cut at the 64 MiB per-file cap",
    });
    Object.assign(repository.universe.attempts[2], {
      build_job_id: "5eed0040-0000-4000-8000-000000000479",
      job_number: 479,
      runner_name: "forge-01",
      test_selection: { scope: "failed", test_run_id: attemptId(2), case_keys: ["a".repeat(64)] },
      parse_warnings: [
        { code: "junit_platform_missing", file: "junit.xml", message: "no platform", at: "line 3" },
      ],
    });

    expect(
      validatorFor("TestRunPage")(wire(await service(repository).page(ORG, attemptId(3)))),
    ).toBeUndefined();
  });

  it("GET /test-runs/{id}/cases/{caseId}/failure sends a TestCaseFailureDetail", async () => {
    const repository = new FakeResultsRepository(mockupUniverse());
    const overshoot = repository.universe.cases.find(
      (each) => each.test_run_id === attemptId(3) && each.name === "overshoot_under_load",
    );

    const failure = await service(repository).failure(ORG, attemptId(3), overshoot?.id ?? "");

    expect(validatorFor("TestCaseFailureDetail")(wire(failure))).toBeUndefined();
  });

  it("refuses a field the document does not list", () => {
    expect(
      validatorFor("TestCoverage")({
        percent: 87.4,
        linesCovered: 1,
        linesTotal: 2,
        storageRef: {},
      }),
    ).toMatch(/additional properties/);
  });
});
