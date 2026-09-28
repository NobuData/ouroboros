import { workflowPath } from "@/app/paths";
import { Button, Card, EmptyState } from "@/app/ui";

import {
  type EmptyKind,
  NO_RESULTS_NOTE,
  NO_RESULTS_TITLE,
  NO_TEST_STAGE_TITLE,
  OPEN_RUN_CONSOLE,
  OPEN_WORKFLOW,
  noTestStageNote,
} from "./states";

/**
 * The test-results page for a run with no attempt to show
 * ([#342](https://github.com/NobuData/ouroboros/issues/342)).
 *
 * Two different runs get here, and the page says which. **A workflow with no test stage**: not
 * every workflow tests, so the page says this one does not and links to the workflow, rather than
 * drawing an empty shell that reads as breakage. **A run without results**: its workflow tests,
 * or its stages could not be read, and no build has reported yet — the way on is the run console,
 * where the build is.
 *
 * @param props.kind Which of the two, from `emptyKind`.
 * @param props.workflow The workflow's caption — `standard-fix v14`.
 * @param props.workflowSlug The workflow's slug, which the run stores as its tag.
 * @param props.consoleHref The run's console.
 * @returns The empty state.
 */
export function TestsEmpty({
  kind,
  workflow,
  workflowSlug,
  consoleHref,
}: Readonly<{
  kind: EmptyKind;
  workflow: string;
  workflowSlug: string;
  consoleHref: string;
}>) {
  return (
    <Card className="tests__empty-card">
      {kind === "no-test-stage" ? (
        <EmptyState note={noTestStageNote(workflow)} title={NO_TEST_STAGE_TITLE}>
          <Button href={workflowPath(workflowSlug)} size="sm">
            {OPEN_WORKFLOW}
          </Button>
        </EmptyState>
      ) : (
        <EmptyState note={NO_RESULTS_NOTE} title={NO_RESULTS_TITLE}>
          <Button href={consoleHref} size="sm">
            {OPEN_RUN_CONSOLE}
          </Button>
        </EmptyState>
      )}
    </Card>
  );
}
