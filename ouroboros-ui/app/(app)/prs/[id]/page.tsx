import { notFound } from "next/navigation";

import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import { PR_REVISION_PARAM, RUN_ORIGIN_PARAM } from "@/app/paths";
import { readPr } from "@/app/prs/data";
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
 * **`?rev=` scopes the gates** to one revision's snapshot (#364), so a revision view is linkable.
 * A value that is not a revision's ordinal is ignored, and the page follows the latest.
 *
 * @param props.params The PR's id.
 * @param props.searchParams The query — `?from=` and `?rev=`.
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
  const reading = await readPr(id);

  if (reading.state === "missing") notFound();

  return (
    <PrScreen
      initial={reading.state === "found" ? reading.value : null}
      initialError={reading.state === "failed" ? reading.reason : null}
      initialRevision={revisionParam(query[PR_REVISION_PARAM])}
      mayArm={mayAdminister(membership.roles)}
      mayContribute={mayContribute(membership.roles)}
      origin={origin}
      prId={id}
    />
  );
}
