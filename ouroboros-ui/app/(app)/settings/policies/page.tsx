import { requireWorkspace } from "@/app/api/access";
import { mayAdminister } from "@/app/api/membership";
import { dryRunPolicy } from "@/app/api/policies";
import { PoliciesScreen } from "@/app/policies/policies-screen";

/**
 * Settings → Policies (BA.3, [#382](https://github.com/NobuData/ouroboros/issues/382)) — the
 * workspace's dry-run policy, at `/settings/policies`.
 *
 * Thin, the shape the other settings tabs take: the gate returns the workspace, the policy is read
 * through the one read every surface uses, and `app/policies/policies-screen.tsx` draws it. The
 * read is every member's; whether this reader may flip is answered once, here, through
 * `mayAdminister` — and the gate that **enforces** is the service's.
 *
 * @returns The Policies page, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();

  return (
    <PoliciesScreen
      mayAdminister={mayAdminister(access.membership.roles)}
      policy={await dryRunPolicy.read()}
      workspaceName={access.membership.name}
    />
  );
}
