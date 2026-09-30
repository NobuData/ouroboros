import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, mayContribute, primaryRole } from "@/app/api/membership";
import { readKnowledge } from "@/app/knowledge/data";
import { KnowledgeScreen } from "@/app/knowledge/knowledge-screen";
import { REPO_PARAM } from "@/app/knowledge/profile";

/**
 * Knowledge ([#417](https://github.com/NobuData/ouroboros/issues/417)) — mockup 14's `/knowledge`.
 *
 * Thin on purpose, the shape every screen in `(app)` takes: the gate returns the workspace this
 * request may render, the reader turns it into what the screen draws, and a component draws it.
 * The decisions are in [`app/knowledge/view.ts`](../../knowledge/view.ts),
 * [`app/knowledge/create.ts`](../../knowledge/create.ts) and
 * [`app/knowledge/import.ts`](../../knowledge/import.ts).
 *
 * **This retires the `/knowledge` placeholder** #49 was to build — an amendment the knowledge
 * roadmap recorded, which needed no deletion because the placeholder was never built. The
 * sidebar's **Knowledge** entry stops being a *soon* row on the same commit
 * (`app/shell/nav-modules.ts`).
 *
 * The roles are decided here, once: **+ New skill**, **Import CLAUDE.md / .cursorrules**,
 * **+ New playbook from a past run…** and the Environment block's edit are drawn for an `owner`
 * or an `admin` and for nobody else; a fact is decided — confirmed, rejected, expired, re-learned,
 * added — and a playbook is run on an issue by an `owner`, an `admin` or a `member` (BF.2's and
 * the queue write's rule), and a viewer reads. The gates that enforce them are the service's.
 *
 * The address's `?repo=owner/name` names the repository the profile card draws (BG.4,
 * [#420](https://github.com/NobuData/ouroboros/issues/420)); absent or not enabled, the card
 * draws the first enabled one.
 *
 * @param props.searchParams The address's query.
 * @returns The knowledge page, for the workspace this request is operating in.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams?: Promise<Record<string, string | string[] | undefined>> }> = {}) {
  const access = await requireWorkspace();
  const params = (await searchParams) ?? {};
  const requested = params[REPO_PARAM];
  const readings = await readKnowledge(access, new Date(), typeof requested === "string" ? requested : undefined);
  const { roles } = access.membership;

  return (
    <KnowledgeScreen
      mayAdminister={mayAdminister(roles)}
      mayDecide={mayContribute(roles)}
      readings={readings}
      role={primaryRole(roles)}
      workspaceId={access.membership.id}
    />
  );
}
