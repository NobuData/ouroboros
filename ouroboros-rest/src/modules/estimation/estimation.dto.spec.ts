import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { EstimateParams } from "./estimation.dto";

/**
 * The one thing `POST /api/v1/backlog/{id}/estimate` takes from its caller, validated the way
 * the pipe validates it — through `class-transformer`, so what the decorators judge is the
 * string a path segment actually carries.
 *
 * The case that matters is **an issue number**. The ticket's own diagram writes
 * `POST /backlog/485/estimate`, and a reader could reasonably transcribe that into a path; it
 * has to be refused before a statement is issued, because `github_issues` is unique on
 * `(repository, number)` and a workspace watching two repositories has two issue `#485`s.
 */

/**
 * Validate a path the way the pipe would.
 *
 * @param params - What the router parsed out of the path.
 * @returns The failing property names.
 */
async function violations(params: Record<string, unknown>): Promise<string[]> {
  const failures = await validate(plainToInstance(EstimateParams, params));

  return failures.map((failure) => failure.property);
}

describe("the issue a re-estimate names", () => {
  it("admits a uuid", async () => {
    expect(await violations({ id: "5eed0018-0000-4000-8000-000000000485" })).toEqual([]);
  });

  it("refuses GitHub's issue number, which cannot address a row", async () => {
    expect(await violations({ id: "485" })).toEqual(["id"]);
  });

  it("refuses anything that is not an id at all", async () => {
    // A `422` before a statement is issued, rather than a round trip to answer `404` — and a
    // caller cannot use this path to send arbitrary text into a `where` clause's parameter.
    expect(await violations({ id: "helios-firmware" })).toEqual(["id"]);
    expect(await violations({ id: "" })).toEqual(["id"]);
  });

  it("requires it", async () => {
    expect(await violations({})).toEqual(["id"]);
  });
});
