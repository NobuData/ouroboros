import { DASHBOARD_ORIGIN } from "@/app/runs/origin";
import { Button, Card, EmptyState, Eyebrow } from "@/app/ui";

import { PR_EYEBROW } from "./view";

import "./prs.css";

/** The missing PR's heading. */
export const PR_MISSING_TITLE = "This pull request does not exist.";

/** Why it may be missing — never which, since the service answers each the same way. */
export const PR_MISSING_NOTE =
  "No pull request with this id belongs to this workspace. The link may be mistyped, or the pull " +
  "request may belong to another workspace.";

/** The way back. */
export const PR_MISSING_BACK = "Back to the dashboard";

/**
 * The PR verification page for a PR that does not exist
 * ([#363](https://github.com/NobuData/ouroboros/issues/363)) — what `/prs/:id`'s `notFound()`
 * renders.
 *
 * The service answers `404` for another workspace's PR exactly as for no PR at all, so this cannot
 * say which it was and does not try.
 *
 * @returns The page.
 */
export function PrMissing() {
  return (
    <main className="prv">
      <div className="prv-head">
        <div className="prv-head__main">
          <Eyebrow>{PR_EYEBROW}</Eyebrow>
          <h1 className="prv-head__title">{PR_MISSING_TITLE}</h1>
        </div>
      </div>

      <Card>
        <EmptyState note={PR_MISSING_NOTE}>
          <Button href={DASHBOARD_ORIGIN.route} size="sm">
            {PR_MISSING_BACK}
          </Button>
        </EmptyState>
      </Card>
    </main>
  );
}
