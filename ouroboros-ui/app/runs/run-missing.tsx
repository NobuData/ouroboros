import { Button, Card, EmptyState, Eyebrow } from "@/app/ui";

import { DASHBOARD_ORIGIN } from "./origin";
import { RUN_EYEBROW } from "./view";

import "./runs.css";

/** The missing run's heading. */
export const RUN_MISSING_TITLE = "This run does not exist.";

/** Why it may be missing — never which, since the service answers both the same way. */
export const RUN_MISSING_NOTE =
  "No run with this id belongs to this workspace. The link may be mistyped, or the run may " +
  "belong to another workspace.";

/** The way back. */
export const RUN_MISSING_BACK = "Back to the dashboard";

/**
 * The run console for a run that does not exist
 * ([#314](https://github.com/NobuData/ouroboros/issues/314)) — what `/runs/:id`'s `notFound()`
 * renders.
 *
 * The service answers `404 run_not_found` for another workspace's run exactly as for no run at
 * all, and `400` for an id that is not a uuid (`data.ts`), so this cannot say which it was and
 * does not try. It renders inside the shell like the console does, under the console's own
 * eyebrow, with the way back the dashboard — where a pasted link's console belongs
 * (`origin.ts`).
 *
 * @returns The page.
 */
export function RunMissing() {
  return (
    <main className="run">
      <div className="run-head">
        <div className="run-head__main">
          <Eyebrow>{RUN_EYEBROW}</Eyebrow>
          <h1 className="run-head__title">{RUN_MISSING_TITLE}</h1>
        </div>
      </div>

      <Card>
        <EmptyState note={RUN_MISSING_NOTE}>
          <Button href={DASHBOARD_ORIGIN.route} size="sm">
            {RUN_MISSING_BACK}
          </Button>
        </EmptyState>
      </Card>
    </main>
  );
}
