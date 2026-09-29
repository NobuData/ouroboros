/**
 * The OpenAPI document and what the detection routes send
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)). `openapi.spec.ts` sees these routes only
 * unauthenticated, so this is where a real scan — every fixture repository, run through the service
 * — is held to `RepoDetection` and `RepoDetectionRescan`, both `additionalProperties: false`.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { EMPTY, NODE, PYTHON, ZEPHYR, type FixtureRepo } from "./detection.fixture";
import { RulePackRegistry } from "./detection.registry";
import { DEFAULT_SCAN_BUDGET } from "./detection.scan";
import { DetectionService } from "./detection.service";
import {
  DETECTION_NOW,
  DETECTION_REPO,
  DETECTION_WORKSPACE,
  FixtureOpener,
  InMemoryDetectionStore,
  fixtureProvider,
  fixtureRegistry,
} from "./detection.store.fixture";
import { CORE_PACKS } from "./packs/core.packs";

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

describe("the detection routes and the document", () => {
  it.each([
    ["Zephyr", ZEPHYR],
    ["Node", NODE],
    ["Python", PYTHON],
    ["empty", EMPTY],
  ])(
    "send what RepoDetection and RepoDetectionRescan describe — %s",
    async (_name, repo: FixtureRepo) => {
      const service = new DetectionService(
        new InMemoryDetectionStore(),
        fixtureRegistry(fixtureProvider(repo)),
        new FixtureOpener(),
        new RulePackRegistry(CORE_PACKS),
        DEFAULT_SCAN_BUDGET,
      );

      expect(
        validatorFor("RepoDetection")(
          wire(await service.read(DETECTION_WORKSPACE, DETECTION_REPO)),
        ),
      ).toBeUndefined();

      const started = await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);

      expect(validatorFor("RepoDetectionRescan")(wire(started))).toBeUndefined();

      await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

      expect(
        validatorFor("RepoDetection")(
          wire(await service.read(DETECTION_WORKSPACE, DETECTION_REPO)),
        ),
      ).toBeUndefined();
      expect(
        validatorFor("RepoDetection")(
          wire(await service.readScan(DETECTION_WORKSPACE, DETECTION_REPO, 1)),
        ),
      ).toBeUndefined();
    },
  );

  it("describes an undetermined row", async () => {
    const service = new DetectionService(
      new InMemoryDetectionStore(),
      fixtureRegistry(fixtureProvider(ZEPHYR, { remaining: 1 })),
      new FixtureOpener(),
      new RulePackRegistry(CORE_PACKS),
      DEFAULT_SCAN_BUDGET,
    );

    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    const read = await service.read(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(read.rows.some((row) => !row.determined)).toBe(true);
    expect(validatorFor("RepoDetection")(wire(read))).toBeUndefined();
  });
});
