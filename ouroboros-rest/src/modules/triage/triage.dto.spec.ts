import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { RunIntentsDto } from "./triage.dto";

/**
 * What `PUT /api/v1/runs/{id}/pr-intents` accepts (AU.6,
 * [#340](https://github.com/NobuData/ouroboros/issues/340)), checked the way the global pipe
 * checks it. That a request names at least one toggle is the service's rule
 * (`triage.service.spec.ts`), because a decorator sees one field.
 */

/**
 * The properties a body fails on.
 *
 * @param body - The body.
 * @returns The failing property names, sorted.
 */
async function failing(body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(RunIntentsDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errors.map((error) => error.property).sort();
}

describe("RunIntentsDto", () => {
  it("accepts each toggle on its own, on or off, and both together", async () => {
    for (const body of [
      { blockUntilGreen: true },
      { blockUntilGreen: false },
      { autoRerunPhysical: true },
      { autoRerunPhysical: false },
      { blockUntilGreen: true, autoRerunPhysical: false },
    ]) {
      expect(await failing(body)).toEqual([]);
    }
  });

  it("refuses null, which is neither on nor off", async () => {
    expect(await failing({ blockUntilGreen: null })).toEqual(["blockUntilGreen"]);
    expect(await failing({ autoRerunPhysical: null })).toEqual(["autoRerunPhysical"]);
  });

  it.each(["true", 1, 0, "on", {}, []])("refuses %p, which is not a boolean", async (value) => {
    expect(await failing({ blockUntilGreen: value })).toEqual(["blockUntilGreen"]);
    expect(await failing({ autoRerunPhysical: value })).toEqual(["autoRerunPhysical"]);
  });

  it("refuses a field it does not declare — the classification's requeue included", async () => {
    expect(await failing({ blockUntilGreen: true, requeue: true })).toEqual(["requeue"]);
    expect(await failing({ runId: "5eed0009-0000-4000-8000-000000000482" })).toEqual(["runId"]);
  });
});
