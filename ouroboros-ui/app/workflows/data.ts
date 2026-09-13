import "server-only";

/**
 * Everything the workflow studio reads (S.1,
 * [#147](https://github.com/NobuData/ouroboros/issues/147)).
 *
 * Two calls — the rail, then the selected workflow — composed here for the reason
 * `app/models/data.ts` exists: the route stays three lines, the composition is a function that
 * can be tested against a stub, and the screen is handed one object rather than issuing calls
 * of its own. The property every reader in this module keeps is **one failed read is one
 * degraded region, never a blank page**, and it is kept here with one difference worth
 * stating.
 *
 * ### The two reads are sequential, and that is not an oversight
 *
 * `GET /api/v1/workflows/{id}` takes an **id**, and the URL carries a **slug**. The rail is
 * what turns one into the other — it is the only listing the contract offers, and it already
 * carries every id — so the second read cannot start until the first has answered. That is
 * also what makes a slug the workspace does not have cost nothing: it is answered from the
 * rail as *missing*, and no request is made for a workflow that is not there.
 *
 * Each read is an {@link attempt}, so a refusal becomes a value rather than a throw and the
 * page degrades in place: a refused rail is the whole frame's failure (there is nothing to
 * select from), a refused workflow leaves the rail standing and the head printing the rail's
 * own facts. `attempt` catches an `ApiError` and nothing else, deliberately — a `401` reaches
 * this layer as Next.js's redirect signal and must keep travelling to the login screen.
 */

import type { Workspace } from "@/app/api/access";
import { attempt } from "@/app/api/reading";
import { workflows } from "@/app/api/workflows";

import type { StudioReadings } from "./view";

/**
 * Read the studio: the rail, and the workflow the URL asks for.
 *
 * @param access The workspace the gate returned. **A precondition made visible in the type
 *   rather than a source of values**: none of its fields is read, because both calls are
 *   scoped to the session's own active organization and this client sends no tenant header
 *   (`app/api/server.ts`). Taking it anyway is what makes the page's authorization and the
 *   page's data one decision — there is no way to reach this read without having been through
 *   the gate, which is the property `app/(app)/layout.tsx` argues a layout cannot provide.
 * @param slug The workflow the URL named, or `null` for the section's landing — which opens
 *   on the rail's first entry, the way the mockup opens on `standard-fix`.
 * @param now The instant to measure *Last edited 2h ago* from. Defaults to the clock; a suite
 *   holds it still.
 * @returns Everything the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how
 *   a session that expired between the gate and this call still reaches the login screen.
 */
export async function readStudio(
  access: Workspace,
  slug: string | null,
  now: Date = new Date(),
): Promise<StudioReadings> {
  // Held, not read — see the parameter's note. The statement is what says so in code, so
  // nobody deletes an argument that is carrying a proof.
  void access;

  const rail = await attempt(async () => workflows.list());
  const readAt = now.toISOString();

  if (!rail.ok) return { rail, requested: slug, selected: null, now: readAt };

  const entry =
    slug === null ? rail.value[0] : rail.value.find((candidate) => candidate.slug === slug);

  if (entry === undefined) return { rail, requested: slug, selected: null, now: readAt };

  const detail = await attempt(async () => workflows.read(entry.id));

  return { rail, requested: slug, selected: { entry, detail }, now: readAt };
}
