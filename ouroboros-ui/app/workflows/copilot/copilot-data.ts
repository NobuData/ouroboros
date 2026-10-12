import "server-only";

/**
 * Everything the copilot route reads (CE.1,
 * [#565](https://github.com/NobuData/ouroboros/issues/565)).
 *
 * The rail, then four reads of the workflow the URL names — composed the way
 * `app/workflows/code/code-data.ts` composes the code view's: the route stays three lines, and
 * **one failed read is one degraded region**. The rail first, for that module's two reasons: a
 * slug the workspace does not have is answered from the listing and costs no further request,
 * and the rail is what turns the slug into the id the copilot's endpoints take.
 *
 * ### One draft, three surfaces — and nothing kept between them
 *
 * Decision **W9**: the draft and the conversation are the service's. This reader asks for both
 * on every render, so arriving from the canvas after dragging a node, or from the code view
 * after a save, shows the draft as it now is and the conversation where it was left. There is
 * no client state to carry across a switch and so none to lose.
 *
 * ### The four reads
 *
 * - **the workflow** (`GET /api/v1/workflows/{id}`), as the visual editor reads it — its draft's
 *   document is what a refused promote's findings are anchored in;
 * - **the promotion** (`GET …/copilot/promotion`) — what **Promote draft** would publish, the
 *   guards with where each is enforced, the unresolved references, and whether it is blocked;
 * - **the conversation** (`GET …/copilot/conversation`) — the active one, else the most recently
 *   closed one. A workflow that never had one answers `404 copilot_session_not_found`, which
 *   `app/api/workflow-copilot.ts` hands back as `null`: *no conversation yet* is a successful
 *   reading of a fact, not a failure to retry;
 * - **the readiness** (`GET …/copilot/readiness`, CE.2, #566) — whether a message sent now could
 *   be answered: the deployment's gateway, the copilot's route, and the dry run in the way. The
 *   composer's reasons come from it rather than from constants here. A failed read gates
 *   nothing.
 *
 * They are made in parallel, and each is kept as its own reading. Anything that is not an
 * `ApiError` keeps travelling — Next.js's redirect signal above all, which is how a session that
 * expired mid-render reaches the login screen.
 */

import type { Workspace } from "@/app/api/access";
import { attempt } from "@/app/api/reading";
import { workflowCopilot } from "@/app/api/workflow-copilot";
import { workflows } from "@/app/api/workflows";

import type { CopilotReadings } from "./copilot-view";

/**
 * Read the copilot route: the rail, and for the workflow the URL names, the workflow, its
 * promotion summary, its conversation and its readiness.
 *
 * @param access The workspace the gate returned — a precondition made visible in the type, for
 *   the reason `readStudio` gives, and not read.
 * @param slug The workflow the URL named.
 * @returns Everything the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError`.
 */
export async function readStudioCopilot(access: Workspace, slug: string): Promise<CopilotReadings> {
  // Held, not read — see the parameter's note.
  void access;

  // Stamped before the reads, so no message can be dated after the page that shows it.
  const now = new Date().toISOString();

  const rail = await attempt(async () => workflows.list());
  if (!rail.ok) return { rail, requested: slug, selected: null, now };

  const entry = rail.value.find((candidate) => candidate.slug === slug);
  if (entry === undefined) return { rail, requested: slug, selected: null, now };

  const [detail, promotion, conversation, readiness] = await Promise.all([
    attempt(async () => workflows.read(entry.id)),
    attempt(async () => workflowCopilot.promotion(entry.id)),
    attempt(async () => workflowCopilot.conversation(entry.id)),
    attempt(async () => workflowCopilot.readiness(entry.id)),
  ]);

  return { rail, requested: slug, selected: { entry, detail, promotion, conversation, readiness }, now };
}
