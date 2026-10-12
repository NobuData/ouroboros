import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, primaryRole } from "@/app/api/membership";
import { WORKFLOW_NODE_PARAM } from "@/app/paths";
import { readStudio } from "@/app/workflows/data";
import { StudioScreen } from "@/app/workflows/studio-screen";

/**
 * The workflow studio, open on one workflow (S.1,
 * [#147](https://github.com/NobuData/ouroboros/issues/147)) — `/workflows/standard-fix`.
 *
 * The ticket's *routing* criterion: a workflow is linkable. The rail links here, a run that
 * names a workflow will link here, and the segmented control's **Visual** segment links here
 * so pressing it keeps the workflow selected. The screen is the landing's
 * ([`../page.tsx`](../page.tsx)); what differs is that the slug comes from the URL rather than
 * from the rail's first entry.
 *
 * ### The slug is input
 *
 * It is read from the path and handed to the reader, which resolves it against the rail the
 * service just listed — so a slug the workspace does not have is answered from that listing as
 * *missing* rather than sent to the service, and never reaches a URL of its own. The screen
 * prints it back in the head's subline as text, which is the one thing it does with it.
 *
 * No `notFound()` for a missing slug, deliberately: the framework's not-found boundary would
 * replace the shell's content pane with a page that has no rail on it, and the rail is exactly
 * what a reader who followed a stale link needs next. The studio draws its own *No such
 * workflow* state with the rail beside it (`app/workflows/states.ts`).
 *
 * ### `?node=` is where the canvas starts looking
 *
 * The copilot's stage list links each row's **edit** here with the stage's node id
 * (`app/paths.ts`' `workflowNodePath`, CE.3 #567). It is input like the slug: handed to the
 * screen as a string, which opens the canvas focused on that stage only if the draft holds one
 * with that id, and ignores it otherwise.
 *
 * `requireWorkspace()` is called here for the reason `app/(app)/layout.tsx` gives, and the role
 * is decided here for the reason the landing gives — see that file.
 *
 * @param props.params The route's segments; `slug` is the workflow's.
 * @param props.searchParams The query; `node` is the stage to open focused on, when given once.
 * @returns The studio, open on that workflow — or on the rail with the slug named as missing.
 */
export default async function Page({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}>) {
  const access = await requireWorkspace();
  const { slug } = await params;
  const node = (await searchParams)?.[WORKFLOW_NODE_PARAM];
  const readings = await readStudio(access, slug);

  return (
    <StudioScreen
      // Given twice, it names no one stage, and is ignored like an id the draft does not hold.
      focusNode={typeof node === "string" ? node : null}
      mayAdminister={mayAdminister(access.membership.roles)}
      readings={readings}
      role={primaryRole(access.membership.roles)}
    />
  );
}
