/**
 * The durable case identity (decision **T2**, V051's `ouroboros.test_case_key()`), computed here so
 * the parser knows each case's key before it writes — the upsert that keeps case ids stable across
 * a re-parse is keyed on it.
 *
 * The recipe is V051's letter for letter: sha256 over the repository id, the suite name, the
 * classname (empty when null) and the name, joined by U+001F, as 64 lowercase hex digits. The
 * database still derives it and refuses a disagreement (`test_cases_derive_case_key`), so this
 * function drifting from the SQL is a failed write, never a second identity.
 */

import { createHash } from "node:crypto";

/** U+001F, the unit separator — no JUnit name contains it, so `("a b", "c")` ≠ `("a", "b c")`. */
const SEPARATOR = "\u001f";

/**
 * A case's durable key.
 *
 * @param githubRepoId - The run's repository (`runs.github_repo_id`).
 * @param suite - The suite's name, as stored.
 * @param classname - The case's classname, as stored, or null.
 * @param name - The case's name, as stored.
 * @returns 64 lowercase hex digits.
 */
export function testCaseKey(
  githubRepoId: string,
  suite: string,
  classname: string | null,
  name: string,
): string {
  return createHash("sha256")
    .update([githubRepoId, suite, classname ?? "", name].join(SEPARATOR), "utf8")
    .digest("hex");
}
