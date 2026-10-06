import { requireWorkspace } from "@/app/api/access";
import { readGetStarted } from "@/app/get-started/data";
import { GetStartedScreen } from "@/app/get-started/get-started-screen";
import { REPO_PARAM } from "@/app/get-started/view";

/**
 * `/get-started` — the Get Started wizard (BC.1, [#390](https://github.com/NobuData/ouroboros/issues/390),
 * mockup 13), standalone outside the shell. `?repo=owner/name` names the repository; without it
 * the wizard opens on the workspace's first mirrored one.
 *
 * Retires the get-started stub #49 planned (its amendment): the route is real from here on.
 *
 * @param props.searchParams The request's query.
 * @returns The wizard, drawn from one server read of its rail.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const access = await requireWorkspace();
  const query = await searchParams;
  const readings = await readGetStarted(access, query[REPO_PARAM]);

  return (
    <GetStartedScreen
      abilities={readings.abilities}
      detection={readings.detection}
      reposFailure={readings.reposFailure}
      repo={readings.repo}
      wizard={readings.wizard}
    />
  );
}
