import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { IssueDetailParams } from "./detail.dto";

/**
 * The path parameter, validated the way the pipe does it.
 *
 * Two properties, and both are about what happens *before* a statement is issued: an id that
 * could not name a row is a `422` rather than a round trip that answers `404`, and a path
 * segment that is not a uuid never reaches a `where` clause's parameter. The second is why the
 * check is a uuid rather than a non-empty string — `estimation.dto.ts` makes the same call for
 * the path directly beside this one.
 */

/**
 * Run a path through the pipe's own two steps.
 *
 * @param params - The path, as Express parsed it.
 * @returns The properties that failed validation.
 */
async function failures(params: Record<string, unknown>): Promise<string[]> {
  const value = plainToInstance(IssueDetailParams, params);

  return (await validate(value)).map((failure) => failure.property);
}

describe("the issue detail path", () => {
  it("accepts a uuid, which is what `github_issues.id` is", async () => {
    expect(await failures({ id: "5eed0018-0000-4000-8000-000000000485" })).toEqual([]);
  });

  it("refuses GitHub's issue number, which cannot address a row here", async () => {
    // `github_issues` is unique on `(github_repo_id, number)`: a workspace watching two
    // repositories has two issue `#485`s, so `485` would name neither.
    expect(await failures({ id: "485" })).toEqual(["id"]);
  });

  it("refuses a literal path segment, so a neighbouring route cannot be reached by mistake", async () => {
    // `GET /backlog/sync-status` is registered ahead of this route and can never fall through to
    // it — but if the controller order were ever changed, this is the second line of defence.
    expect(await failures({ id: "sync-status" })).toEqual(["id"]);
  });

  it("refuses text that would otherwise reach a statement's parameter", async () => {
    expect(await failures({ id: "'; drop table ouroboros.github_issues; --" })).toEqual(["id"]);
  });

  it("refuses a missing id", async () => {
    expect(await failures({})).toEqual(["id"]);
  });

  it("takes nothing but the id", () => {
    // There is no query string on this operation: the panel is one shape, and a `?fields=` that
    // let a caller ask for less would be a contract with a different shape per request.
    const value = plainToInstance(IssueDetailParams, {
      id: "5eed0018-0000-4000-8000-000000000485",
    });

    expect(Object.keys(value)).toEqual(["id"]);
  });
});
