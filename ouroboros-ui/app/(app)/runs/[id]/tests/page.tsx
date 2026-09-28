import { notFound } from "next/navigation";

import { requireWorkspace } from "@/app/api/access";
import { mayContribute } from "@/app/api/membership";
import {
  RUN_ORIGIN_PARAM,
  TESTS_ATTEMPT_PARAM,
  TESTS_CASE_PARAM,
  TESTS_SUITE_PARAM,
} from "@/app/paths";
import { runOrigin } from "@/app/runs/origin";
import { readTests } from "@/app/test-results/data";
import { caseParam } from "@/app/test-results/physical";
import { suiteParam } from "@/app/test-results/suites";
import { TestsScreen } from "@/app/test-results/tests-screen";
import { attemptParam } from "@/app/test-results/view";

/**
 * `/runs/:id/tests` — the test-results page ([#335](https://github.com/NobuData/ouroboros/issues/335)),
 * mockup 11.
 *
 * **A contextual surface with no sidebar entry**, like the run console it hangs off: it opens from
 * the console's Test stage and the build farm's job cells, renders in the shell's content pane, and
 * `?from=` names the module the reader came from, which stays lit (`app/runs/origin.ts`).
 * `?attempt=` names the build it reads; absent, the latest. `?suite=` names the suite it has
 * selected ([#337](https://github.com/NobuData/ouroboros/issues/337)) and `?case=` the physical
 * case ([#338](https://github.com/NobuData/ouroboros/issues/338)); absent, none.
 *
 * *Re-run failed* and *Re-run full suite* are drawn switched on only for an owner, admin or member
 * — `mayContribute`, the rule the service applies to a re-run — and the screen is handed a boolean
 * rather than a role. The service checks again on every press.
 *
 * @param props.params The run's id.
 * @param props.searchParams The query — `?from=`, `?attempt=`, `?suite=` and `?case=`.
 * @returns The screen, or the not-found page (`not-found.tsx`,
 *   [#342](https://github.com/NobuData/ouroboros/issues/342)) for a run this workspace cannot see.
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
  const attempt = attemptParam(query[TESTS_ATTEMPT_PARAM]);
  const reading = await readTests(id, attempt);

  if (reading.state === "missing") notFound();

  const found = reading.state === "found" ? reading.value : null;

  return (
    <TestsScreen
      commitSource={found?.commitSource ?? null}
      hasTestStage={found?.hasTestStage ?? null}
      initial={found?.timeline ?? null}
      initialAttempt={attempt}
      initialCase={caseParam(query[TESTS_CASE_PARAM])}
      initialError={reading.state === "failed" ? reading.reason : null}
      initialGate={found?.gate ?? null}
      initialPage={found?.page ?? null}
      initialSuite={suiteParam(query[TESTS_SUITE_PARAM])}
      mayContribute={mayContribute(membership.roles)}
      origin={origin}
      pullRequest={found?.pullRequest ?? null}
      readAt={found?.readAt ?? null}
      runId={id}
      trackerUrl={found?.trackerUrl ?? null}
    />
  );
}
