import { notFound } from "next/navigation";

import { requireWorkspace } from "@/app/api/access";
import { mayAdminister } from "@/app/api/membership";
import { RUN_ORIGIN_PARAM } from "@/app/paths";
import { readRun } from "@/app/runs/data";
import { runOrigin } from "@/app/runs/origin";
import { RunScreen } from "@/app/runs/run-screen";

/**
 * `/runs/:id` — the run console ([#309](https://github.com/NobuData/ouroboros/issues/309)),
 * mockup 10.
 *
 * **This retires the run-detail placeholder** #49 was to build — the amendment the run console
 * roadmap recorded. The dashboard's active-loops rows (#82) and the build farm's current-job
 * cells (#257) link here through `runPath`.
 *
 * A contextual surface: no sidebar entry of its own, and `?from=` names the module the reader
 * came from, which stays lit (`app/runs/origin.ts`).
 *
 * The head's controls (#310) are drawn for an owner or admin — `mayAdminister`, the rule the
 * service applies to pause, resume and abort — and the screen is handed a boolean rather than
 * a role. The service checks again on every press.
 *
 * @param props.params The run's id.
 * @param props.searchParams The query — only `?from=` is read.
 * @returns The screen, or the not-found page for a run this workspace cannot see.
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
  const origin = runOrigin((await searchParams)[RUN_ORIGIN_PARAM]);
  const reading = await readRun(id);

  if (reading.state === "missing") notFound();

  return (
    <RunScreen
      id={id}
      initial={reading.state === "found" ? reading.value : null}
      initialError={reading.state === "failed" ? reading.reason : null}
      mayControl={mayAdminister(membership.roles)}
      origin={origin}
    />
  );
}
