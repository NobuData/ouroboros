import { FIXTURE_MASK, FIXTURE_TOKEN, credentialRow } from "./github.fixture";
import { githubTokenResource, noGithubToken } from "./github.resources";

/**
 * One claim, and it is structural rather than behavioural: **the resource cannot be given a
 * token.** {@link githubTokenResource} takes a mask and two stamps, so the only way to build
 * one is to have already reduced the credential to something safe to send — which is what
 * makes *the token is absent from every API response* a property of the shape rather than of
 * every future edit.
 *
 * The rest is the surface's contract: absence is a state with stamps of `null`, not a `404`,
 * and the two stamps are what let a reader tell a token that has been rotated from one that
 * has not.
 */

describe("the GitHub token resource", () => {
  it("carries the mask and the stamps, and nothing else at all", () => {
    const row = credentialRow("ouro.v1.1.bm9uY2U.Y2lwaGVy", {
      created_at: new Date("2026-03-01T08:00:00.000Z"),
      updated_at: new Date("2026-09-01T09:00:00.000Z"),
    });

    expect(githubTokenResource(FIXTURE_MASK, row)).toEqual({
      configured: true,
      masked: FIXTURE_MASK,
      createdAt: "2026-03-01T08:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
    });
  });

  it("says a workspace has no token without a 404", () => {
    // The settings surface always has something to render, and the intake page's no-token
    // guidance is this `false` rather than a missing resource it would have to interpret.
    expect(noGithubToken()).toEqual({
      configured: false,
      masked: null,
      createdAt: null,
      updatedAt: null,
    });
  });

  it("lets a reader tell a rotated token from one that has never changed", () => {
    const never = credentialRow("ouro.v1.1.bm9uY2U.Y2lwaGVy", {
      created_at: new Date("2026-03-01T08:00:00.000Z"),
      updated_at: new Date("2026-03-01T08:00:00.000Z"),
    });
    const rotated = credentialRow("ouro.v1.1.bm9uY2U.Y2lwaGVy", {
      created_at: new Date("2026-03-01T08:00:00.000Z"),
      updated_at: new Date("2026-09-01T09:00:00.000Z"),
    });

    expect(githubTokenResource(FIXTURE_MASK, never).createdAt).toBe(
      githubTokenResource(FIXTURE_MASK, never).updatedAt,
    );
    expect(githubTokenResource(FIXTURE_MASK, rotated).createdAt).not.toBe(
      githubTokenResource(FIXTURE_MASK, rotated).updatedAt,
    );
  });

  it("has no field a token could be put in", () => {
    const resource = githubTokenResource(FIXTURE_MASK, credentialRow("ouro.v1.1.a.b"));

    expect(Object.keys(resource).sort()).toEqual([
      "configured",
      "createdAt",
      "masked",
      "updatedAt",
    ]);
    expect(JSON.stringify(resource)).not.toContain(FIXTURE_TOKEN);
  });
});
