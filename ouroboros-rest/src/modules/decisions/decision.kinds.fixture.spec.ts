/**
 * The unit suites' declarations and the migrations that ship them say the same thing (#461).
 *
 * `decision.kinds.fixture.ts` copies V093's and V097's templates so rendering can be tested without
 * a database; this reads the migration text and fails when a template, a tag or an action label
 * there no longer matches the copy — the integration suite asks the database itself.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SHIPPED_KINDS } from "./decision.kinds.fixture";

/** Both migrations, concatenated — every shipped declaration is in one of them. */
const MIGRATIONS = ["V093__decision_kinds_items.sql", "V097__decision_kinds_mvp_source_resolved.sql"]
  .map((file) => readFileSync(join(__dirname, "../../../../ouroboros-db/migrations", file), "utf8"))
  .join("\n");

/**
 * A text as an SQL string literal writes it.
 *
 * @param text - The text.
 * @returns It, with `'` doubled.
 */
function sqlText(text: string): string {
  return text.replaceAll("'", "''");
}

describe("the shipped kinds fixture", () => {
  it.each(Object.values(SHIPPED_KINDS))(
    "$kindId's templates and tags are the migration's",
    (kind) => {
      expect(MIGRATIONS).toContain(`'${sqlText(kind.questionTemplate)}'`);
      expect(MIGRATIONS).toContain(`'${sqlText(kind.whyTemplate)}'`);
      expect(MIGRATIONS).toContain(`'${kind.kindId}', 1, '${kind.severityDefault}'`);

      for (const tag of kind.refShape.tags) {
        expect(MIGRATIONS).toContain(`"${tag}"`);
      }
    },
  );

  it.each(Object.values(SHIPPED_KINDS))("$kindId's action labels are the migration's", (kind) => {
    for (const action of kind.actions) {
      expect(MIGRATIONS).toContain(`"label": "${sqlText(action.label)}"`);
      expect(MIGRATIONS).toContain(`"handler_binding": "${action.handler_binding}"`);
    }
  });

  it("covers the nine MVP kinds, merge_approval alone merge-class and resize_review alone auto-resolvable", () => {
    const kinds = Object.values(SHIPPED_KINDS);

    expect(kinds.map((kind) => kind.kindId).sort()).toEqual([
      "claim_waiver",
      "fact_review",
      "merge_approval",
      "plan_sign_off",
      "protected_path_allow_once",
      "resize_review",
      "run_needs_human",
      "spend_approval",
      "split_approval",
    ]);
    expect(kinds.filter((kind) => kind.mergeClass).map((kind) => kind.kindId)).toEqual([
      "merge_approval",
    ]);
    expect(
      kinds.filter((kind) => kind.resolutionSemantics.auto_resolvable).map((kind) => kind.kindId),
    ).toEqual(["resize_review"]);
  });
});
