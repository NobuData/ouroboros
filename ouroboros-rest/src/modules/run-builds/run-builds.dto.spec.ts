import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { SubmitRunBuildDto } from "./run-builds.dto";

/**
 * The pool a run's build submission may name (AJ.3, #265; FE.1, #1834): a pool name, or the
 * reserved `$default` — the workspace default pool, which the service resolves and pins.
 */

/** The field names a body fails on, or an empty list. */
function errorsOn(body: Record<string, unknown>): string[] {
  const dto = plainToInstance(SubmitRunBuildDto, {
    idempotencyKey: "run-482-build-1",
    stageKey: "build",
    attempt: 1,
    pool: "pool-a",
    commit: "3f9c2ae0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6",
    ...body,
  });

  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).map(
    (error) => error.property,
  );
}

describe("a run's build submission names its pool", () => {
  it("by name", () => {
    expect(errorsOn({ pool: "pool-a" })).toEqual([]);
  });

  it("or as $default, the workspace default pool", () => {
    expect(errorsOn({ pool: "$default" })).toEqual([]);
  });

  it.each(["Pool-A", "$Default", "$default-x", "x$default", "$", "-pool"])(
    "and refuses %s",
    (pool) => {
      expect(errorsOn({ pool })).toEqual(["pool"]);
    },
  );
});
