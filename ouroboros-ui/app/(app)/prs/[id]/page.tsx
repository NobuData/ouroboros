import { notFound } from "next/navigation";

import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import { PR_HUNK_PARAM, PR_REVISION_PARAM, RUN_ORIGIN_PARAM } from "@/app/paths";
import { readEpics, readPr } from "@/app/prs/data";
import { hunkParam } from "@/app/prs/hunk";
import { PrScreen } from "@/app/prs/pr-screen";
import { revisionParam } from "@/app/prs/strip";
import { runOrigin } from "@/app/runs/origin";

/**
 * `/prs/:id` — the PR verification page ([#363](https://github.com/NobuData/ouroboros/issues/363)),
 * mockup 12.
 *
 * **A contextual surface with no sidebar entry**: it opens from the run console, test results and
 * the dashboard's rows, renders in the shell's content pane, and `?from=` names the module the
 * reader came from, which stays lit (`app/runs/origin.ts`).
 *
 * **Roles decide what is drawn.** *Request human review* and *Return to loop* are drawn for an
 * owner, admin or member — `mayContribute`, the rule the service applies to a head action (#361).
 * *Merge when all gates green* is drawn for an owner or admin only — `mayAdminister` — so a member
 * sees no arm affordance. The screen is handed two booleans rather than a role, and the service
 * checks again on every press.
 *
 * **The Merge plan card is drawn for every reader** (#369): reading a plan is every member's. An
 * owner or admin edits, arms and merges it; a member may disarm it; a viewer reads. The roadmap's
 * epics are read beside the page for the card's picker, and a roadmap that cannot be read costs
 * the picker, never the page.
 *
 * **`?rev=` scopes the gates** to one revision's snapshot (#364), so a revision view is linkable.
 * A value that is not a revision's ordinal is ignored, and the page follows the latest.
 *
 * **`?hunk=` cites a hunk** of the changed files (#366), so a hunk reference of the criteria
 * matrix is linkable. A value that is not a path and a line range is ignored. Waiving a claim is
 * drawn for an owner or admin only, as arming is.
 *
 * **A member reads, contributes and answers nothing**
 * ([#370](https://github.com/NobuData/ouroboros/issues/370)): arming, waiving and answering an
 * approval are an owner's or admin's, so a member is drawn none of the three. The read's own
 * instant is handed on as the sync-lag banner's first clock, so the first paint and its
 * hydration agree.
 *
 * @param props.params The PR's id.
 * @param props.searchParams The query — `?from=`, `?rev=` and `?hunk=`.
 * @returns The screen, or the not-found page for a PR this workspace cannot see.
 */
export default async function Page({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { membership } = await requireWorkspace();
  const { id } = await params;
  const query = await searchParams;
  const origin = runOrigin(query[RUN_ORIGIN_PARAM]);
  const [reading, epics] = await Promise.all([readPr(id), readEpics()]);

  if (reading.state === "missing") notFound();

  return (
    <PrScreen
      epics={epics}
      initial={reading.state === "found" ? reading.value : null}
      initialError={reading.state === "failed" ? reading.reason : null}
      initialHunk={hunkParam(query[PR_HUNK_PARAM])}
      initialRevision={revisionParam(query[PR_REVISION_PARAM])}
      mayApprove={mayAdminister(membership.roles)}
      mayArm={mayAdminister(membership.roles)}
      mayWaive={mayAdminister(membership.roles)}
      mayContribute={mayContribute(membership.roles)}
      origin={origin}
      prId={id}
      readAt={reading.state === "found" ? reading.readAt : null}
    />
  );
}
