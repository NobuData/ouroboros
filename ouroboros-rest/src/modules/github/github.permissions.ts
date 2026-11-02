/**
 * What GitHub's repository answer says a token's account may do (DK.1,
 * [#1318](https://github.com/NobuData/ouroboros/issues/1318)).
 *
 * `GET /repos/{owner}/{repo}` carries a `permissions` object (`admin`, `maintain`, `push`,
 * `triage`, `pull`) for the authenticated account. It is the account's access to the repository,
 * not the token's scopes — a fine-grained token without `contents: write` still reports its
 * owner's `push: true` — so it confirms a permission the account has and is silent on the rest.
 * An answer without the object (an installation token) says nothing.
 */

/** The route both readiness probes ask — a read, never a write. */
export const REPOSITORY_ROUTE = "GET /repos/{owner}/{repo}";

/**
 * The account's push permission in a repository answer.
 *
 * @param body - The parsed response body.
 * @returns `true` or `false` as GitHub said it, or `null` when the answer carries no
 *   `permissions.push` boolean.
 */
export function pushPermission(body: unknown): boolean | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const permissions = (body as { permissions?: unknown }).permissions;

  if (typeof permissions !== "object" || permissions === null) {
    return null;
  }

  const push = (permissions as { push?: unknown }).push;

  return typeof push === "boolean" ? push : null;
}
