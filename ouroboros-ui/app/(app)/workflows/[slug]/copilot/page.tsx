import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, mayContribute, primaryRole } from "@/app/api/membership";
import { readStudioCopilot } from "@/app/workflows/copilot/copilot-data";
import { CopilotScreen } from "@/app/workflows/copilot/copilot-screen";

/**
 * The workflow studio's copilot, open on one workflow (CE.1,
 * [#565](https://github.com/NobuData/ouroboros/issues/565)) — `/workflows/security-patch/copilot`,
 * mockup 20.
 *
 * The same three-line shape as the two routes beside it ([`../page.tsx`](../page.tsx),
 * [`../code/page.tsx`](../code/page.tsx)): the gate, the reader, the screen. A **deep link** works
 * on first load for that reason, and so does a switch from either other surface: nothing here
 * depends on where the reader came from, because the draft and the conversation are the
 * service's and are read again on every arrival (decision **W9**). A node dragged on the canvas a
 * moment ago is in the draft this page reads.
 *
 * ### The slug is input
 *
 * It is resolved against the rail before anything else is asked for, so a slug the workspace does
 * not have costs no further request and is drawn as the copilot's own *No such workflow* rather
 * than the framework's not-found page — whose boundary would drop the studio's head, its tab row
 * and the rail, which are what lead a reader who followed a stale link back to the workflows
 * that exist.
 *
 * ### The role is decided here, as it is for Visual and Code
 *
 * The same `mayAdminister` from the same membership, so the gates match the other two surfaces
 * by construction: a member reaches this route, reads what there is, is told once that they may
 * look and not change, and finds **Promote** and **Discard** inert with that reason. The service
 * is what enforces it.
 *
 * @param props.params The route's segments; `slug` is the workflow's.
 * @returns The copilot, open on that workflow — or naming it as missing.
 */
export default async function Page({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const access = await requireWorkspace();
  const { slug } = await params;
  const readings = await readStudioCopilot(access, slug);

  return (
    <CopilotScreen
      mayAdminister={mayAdminister(access.membership.roles)}
      mayContribute={mayContribute(access.membership.roles)}
      readings={readings}
      role={primaryRole(access.membership.roles)}
    />
  );
}
