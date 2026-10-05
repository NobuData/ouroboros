import { requireWorkspace } from "@/app/api/access";
import { readInbox } from "@/app/inbox/data";
import { InboxScreen } from "@/app/inbox/inbox-screen";

/**
 * `/inbox` — the Needs-You inbox (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)),
 * mounted in the shell's content pane. Every member reads it, a viewer included; what they may do
 * is the service's to decide per action.
 *
 * @returns The screen, drawn from one server read of the queue.
 */
export default async function Page() {
  await requireWorkspace();

  return <InboxScreen readings={await readInbox()} />;
}
