import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, primaryRole } from "@/app/api/membership";
import { readStudioCode } from "@/app/workflows/code/code-data";
import { CodeScreen } from "@/app/workflows/code/code-screen";

/**
 * The workflow studio's code view, open on one workflow (V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169)) — `/workflows/standard-fix/code`,
 * mockup 05.
 *
 * The same three-line shape as the visual editor's route beside it
 * ([`../page.tsx`](../page.tsx)): the gate, the reader, the screen. A **deep link** works on
 * first load for that reason — nothing here depends on having arrived from the Visual tab. The
 * page reads the draft slot the visual editor reads (decision **C3**), so whichever route a
 * reader opens first, both show the one draft.
 *
 * ### The slug is input
 *
 * It is resolved against the rail before any file is asked for, so a slug the workspace does not
 * have costs no request and is drawn as the code view's own *No such workflow* rather than the
 * framework's not-found page — whose boundary would drop the studio's head and tab row, which
 * are what lead a reader who followed a stale link back to the workflows that exist.
 *
 * ### The role is decided here, as it is for Visual
 *
 * The same `mayAdminister` from the same membership, so the gates match the visual editor by
 * construction: a member reaches this route, reads the file, is told once that they may look and
 * not change, and is offered no **Publish**. The service is what enforces it.
 *
 * @param props.params The route's segments; `slug` is the workflow's.
 * @returns The code view, open on that workflow — or naming it as missing.
 */
export default async function Page({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const access = await requireWorkspace();
  const { slug } = await params;
  const readings = await readStudioCode(access, slug);

  return (
    <CodeScreen
      mayAdminister={mayAdminister(access.membership.roles)}
      readings={readings}
      role={primaryRole(access.membership.roles)}
    />
  );
}
