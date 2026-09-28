import { notFound, redirect } from "next/navigation";

import { requireWorkspace } from "@/app/api/access";
import { RUN_ORIGIN_PARAM } from "@/app/paths";
import { evidenceTargetPath } from "@/app/prs/evidence-target";
import { runOrigin } from "@/app/runs/origin";

/**
 * `/prs/:id/evidence/:evidenceId` — where one citation of the criteria matrix leads
 * ([#366](https://github.com/NobuData/ouroboros/issues/366)).
 *
 * It draws nothing: it resolves the test case or the measurement the citation names to the
 * attempt that ran it (`app/prs/evidence-target.ts`) and redirects to the test-results page with
 * the row selected. `?from=` is carried across, so the module the PR page was opened from stays
 * lit there too.
 *
 * @param props.params The PR's id and the citation's.
 * @param props.searchParams The query — `?from=`.
 * @returns Never: a redirect, or the not-found page for a citation that cannot be resolved.
 */
export default async function Page({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string; evidenceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await requireWorkspace();

  const { id, evidenceId } = await params;
  const origin = runOrigin((await searchParams)[RUN_ORIGIN_PARAM]);
  const target = await evidenceTargetPath(id, evidenceId, origin.id);

  if (target === null) notFound();

  redirect(target);
}
