import "server-only";

/**
 * Everything the code route reads (V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169)).
 *
 * Two calls — the rail, then the workflow's file — composed the way `app/workflows/data.ts`
 * composes the visual editor's: the route stays three lines, and **one failed read is one
 * degraded region**. The rail first, although `GET …/{slug}/code` takes the slug the URL already
 * carries, for two reasons: a slug the workspace does not have is answered from the listing and
 * costs no request, and the rail carries the version in force, which the head's **Publish vN+1**
 * counts from whether or not the file could be read.
 *
 * ### One draft, two editors
 *
 * The file is the **draft's** (decision **C3**): its `etag` is the token the visual editor's
 * `GET /api/v1/workflows/{id}` hands the canvas. Neither route keeps a copy — each reads the
 * draft slot when it renders — so switching between them converts nothing and cannot drift.
 *
 * ### Three ways the file read ends
 *
 * The file, a `409 workflow_code_unprojectable` for a draft with no faithful spelling as code
 * (kept apart, with its findings, because it is a state to guide out of rather than a failure to
 * retry), or any other `ApiError`. Anything that is not an `ApiError` keeps travelling — Next.js's
 * redirect signal above all, which is how a session that expired mid-render reaches the login
 * screen.
 */

import type { Workspace } from "@/app/api/access";
import { isApiError } from "@/app/api/errors";
import { attempt } from "@/app/api/reading";
import { WORKFLOW_CODE_UNPROJECTABLE, workflows } from "@/app/api/workflows";

import { type CodeReadings, type FileReading, readFindings } from "./code-view";

/**
 * Read one workflow's file.
 *
 * @param slug The workflow's slug, resolved against the rail by the caller.
 * @returns The file, or why it could not be shown.
 * @throws Whatever is not an `ApiError`.
 */
async function readFile(slug: string): Promise<FileReading> {
  try {
    return { kind: "file", file: await workflows.code(slug) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.code === WORKFLOW_CODE_UNPROJECTABLE) {
      return {
        kind: "unprojectable",
        reason: error.message,
        findings: readFindings(error.details),
      };
    }

    return { kind: "failed", reason: error.message };
  }
}

/**
 * Read the code route: the rail, and the file of the workflow the URL names.
 *
 * @param access The workspace the gate returned — a precondition made visible in the type, for
 *   the reason `readStudio` gives, and not read.
 * @param slug The workflow the URL named.
 * @returns Everything the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError`.
 */
export async function readStudioCode(access: Workspace, slug: string): Promise<CodeReadings> {
  // Held, not read — see the parameter's note.
  void access;

  const rail = await attempt(async () => workflows.list());
  if (!rail.ok) return { rail, requested: slug, selected: null };

  const entry = rail.value.find((candidate) => candidate.slug === slug);
  if (entry === undefined) return { rail, requested: slug, selected: null };

  return { rail, requested: slug, selected: { entry, file: await readFile(entry.slug) } };
}
