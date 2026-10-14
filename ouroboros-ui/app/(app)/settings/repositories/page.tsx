import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import { readRepositories } from "@/app/repositories/data";
import { RepositoriesScreen } from "@/app/repositories/repositories-screen";

/**
 * Settings → Repositories: where the workspace's repositories are, which ticket source names
 * each one, whether each is switched on, and whether their issues are being scanned.
 */
export default async function Page() {
  const access = await requireWorkspace();
  const readings = await readRepositories(access);

  return (
    <RepositoriesScreen
      mayAdminister={mayAdminister(access.membership.roles)}
      mayContribute={mayContribute(access.membership.roles)}
      readings={readings}
      workspaceName={access.membership.name}
    />
  );
}
