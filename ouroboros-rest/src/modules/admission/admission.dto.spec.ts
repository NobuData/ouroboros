import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { PatchLiveExecutionDto, QueueItemIdParams } from "./admission.dto";

/** Validate a body the way the pipe would, and report which fields were refused. */
async function refusalsOf<T extends object>(shape: new () => T, value: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(shape, value));

  return errors.map((error) => error.property).sort();
}

describe("the confirm route's item id", () => {
  it("accepts a uuid", async () => {
    await expect(
      refusalsOf(QueueItemIdParams, { id: "a1312000-0000-4000-8000-000000000001" }),
    ).resolves.toEqual([]);
  });

  it.each([["not-a-uuid"], [""], [42]])("refuses %p", async (id) => {
    await expect(refusalsOf(QueueItemIdParams, { id })).resolves.toEqual(["id"]);
  });
});

describe("the live-execution patch", () => {
  it.each([1, 4, 100])("accepts a ceiling of %p", async (ceiling) => {
    await expect(refusalsOf(PatchLiveExecutionDto, { ceiling })).resolves.toEqual([]);
  });

  it.each([[0], [101], [1.5], ["2"], [undefined]])("refuses a ceiling of %p", async (ceiling) => {
    await expect(refusalsOf(PatchLiveExecutionDto, { ceiling })).resolves.toEqual(["ceiling"]);
  });
});
