import { DASHBOARD_ORIGIN } from "@/app/runs/origin";
import { Button, Card, EmptyState, Eyebrow } from "@/app/ui";

import { TESTS_EYEBROW } from "./view";

import "./tests.css";

/** The missing page's heading. */
export const TESTS_MISSING_TITLE = "These test results do not exist.";

/** Why they may be missing — never which, since the service answers both the same way. */
export const TESTS_MISSING_NOTE =
  "No run with this id belongs to this workspace, so there are no test results to show. The " +
  "link may be mistyped, or the run may belong to another workspace.";

/** The way back. */
export const TESTS_MISSING_BACK = "Back to the dashboard";

/**
 * The test-results page for a run that does not exist
 * ([#342](https://github.com/NobuData/ouroboros/issues/342)) — what `/runs/:id/tests`'s
 * `notFound()` renders, in place of the run console's page the parent segment would lend it.
 *
 * The service answers `404` for another workspace's run exactly as for no run at all, and `400`
 * for an id that is not a uuid (`data.ts`), so this cannot say which it was and does not try. It
 * renders inside the shell under the page's own eyebrow, with the way back the dashboard.
 *
 * @returns The page.
 */
export function TestsMissing() {
  return (
    <main className="tests">
      <div className="tests-head">
        <div className="tests-head__main">
          <Eyebrow>{TESTS_EYEBROW}</Eyebrow>
          <h1 className="tests-head__title">{TESTS_MISSING_TITLE}</h1>
        </div>
      </div>

      <Card>
        <EmptyState note={TESTS_MISSING_NOTE}>
          <Button href={DASHBOARD_ORIGIN.route} size="sm">
            {TESTS_MISSING_BACK}
          </Button>
        </EmptyState>
      </Card>
    </main>
  );
}
