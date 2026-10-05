import { requireWorkspace } from "@/app/api/access";
import { readInbox } from "@/app/inbox/data";
import { InboxScreen } from "@/app/inbox/inbox-screen";

/**
 * `/inbox` — the Needs-You inbox (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)),
 * mounted in the shell's content pane. Every member reads it, a viewer included; what they may do
 * is the service's to decide per action.
 *
 * The reader's id goes with it: whether the resolved list is folded is each person's own choice
 * (BO.3, [#468](https://github.com/NobuData/ouroboros/issues/468)).
 *
 * @returns The screen, drawn from one server read of the queue and of today's resolved list.
 */
export default async function Page() {
  const { session } = await requireWorkspace();

  return <InboxScreen readerId={session.user.id} readings={await readInbox()} />;
}
