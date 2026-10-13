import { requireWorkspace } from "@/app/api/access";
import { mayAdminister } from "@/app/api/membership";
import { readChatOps } from "@/app/chatops/chatops-data";
import { ChatOpsScreen } from "@/app/chatops/chatops-screen";
import { MIRROR_PARAM } from "@/app/chatops/view";

/**
 * Chat Ops (CA.1, [#541](https://github.com/NobuData/ouroboros/issues/541)) — mockup 19's
 * `/chatops`.
 *
 * Thin on purpose, the shape every screen in `(app)` takes: the gate returns the workspace this
 * request may render, the page's two reads — the Slack connection and the workspace's channels
 * (`app/chatops/chatops-data.ts`) — are made here, once and together, and a component draws
 * them. The decisions are in [`app/chatops/view.ts`](../../chatops/view.ts).
 *
 * **This retires the `/chatops` placeholder** #49 was to build — an amendment the Chat Ops
 * roadmap recorded, which needed no deletion because the placeholder was never built. **No
 * sidebar entry is added** (`app/shell/nav-modules.ts` is unchanged): the page is reached from
 * the inbox's *Answer from anywhere* card, the Insights head and the Settings integrations tile.
 *
 * Every member may read the page. Installing the app, verifying the connection, and binding or
 * unbinding a channel are an `owner`'s or an `admin`'s; everyone else sees what is missing and
 * who can fix it.
 *
 * **`?channel=<id>` names the channel whose mirror shows** (CA.2,
 * [#542](https://github.com/NobuData/ouroboros/issues/542)). It is only passed on: which channel
 * that turns out to be — the named one when it is bound, else the first bound — is
 * `mirrorChannel`'s to decide, from the channels the page actually read.
 *
 * @param props.searchParams The address's query.
 * @returns The Chat Ops page, for the workspace this request is operating in.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams?: Promise<Record<string, string | string[] | undefined>> }> = {}) {
  const access = await requireWorkspace();
  const [{ page, readAt }, params] = await Promise.all([readChatOps(), searchParams]);
  const named = params?.[MIRROR_PARAM];

  return (
    <ChatOpsScreen
      channel={typeof named === "string" && named !== "" ? named : null}
      mayAdminister={mayAdminister(access.membership.roles)}
      page={page}
      readAt={readAt}
    />
  );
}
