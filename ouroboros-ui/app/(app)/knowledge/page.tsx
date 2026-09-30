import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, primaryRole } from "@/app/api/membership";
import { readKnowledge } from "@/app/knowledge/data";
import { KnowledgeScreen } from "@/app/knowledge/knowledge-screen";

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
 * The roles are decided here, once: **+ New skill** and **Import CLAUDE.md / .cursorrules** are
 * drawn for an `owner` or an `admin` and for nobody else; everyone reads. The gates that enforce
 * them are the service's.
 *
 * @returns The knowledge page, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();
  const readings = await readKnowledge(access);
  const { roles } = access.membership;

  return (
    <KnowledgeScreen
      mayAdminister={mayAdminister(roles)}
      readings={readings}
      role={primaryRole(roles)}
      workspaceId={access.membership.id}
    />
  );
}
