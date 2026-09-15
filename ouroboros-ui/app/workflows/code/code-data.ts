import "server-only";

/**
 * Everything the code route reads (V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169); the explorer, V.3,
 * [#171](https://github.com/NobuData/ouroboros/issues/171)).
 *
 * The rail, then the workflow's file beside the explorer's two reads — composed the way
 * `app/workflows/data.ts` composes the visual editor's: the route stays three lines, and **one
 * failed read is one degraded region**. The rail first, although `GET …/{slug}/code` takes the
 * slug the URL already carries, for two reasons: a slug the workspace does not have is answered
 * from the listing and costs no file request, and the rail carries the version in force, which the
 * head's **Publish vN+1** counts from whether or not the file could be read.
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
 *
 * ### The explorer is read whenever it is drawn
 *
 * The file list (`GET …/code-tree`) and `ouroboros.config.ts` (`GET …/code-config`) are read in
 * parallel with the file, and for a slug the rail lacks too — the explorer is how a reader who
 * followed a stale link reaches a file that exists. They are not read for a refused or an empty
 * rail, whose pages draw no explorer. The configuration is read with the page rather than when its
 * tab is opened: it is small, and a tab that opens on a pending read would be one more state.
 */

import type { Workspace } from "@/app/api/access";
import { isApiError } from "@/app/api/errors";
import { attempt } from "@/app/api/reading";
import { WORKFLOW_CODE_UNPROJECTABLE, workflows } from "@/app/api/workflows";

import {
  type CodeReadings,
  type ExplorerReadings,
  type FileReading,
  readFindings,
} from "./code-view";

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
 * Read the explorer: the file list and the configuration, in parallel, each kept as its own
 * reading.
 *
 * @returns Both readings.
 * @throws Whatever is not an `ApiError`.
 */
async function readExplorer(): Promise<ExplorerReadings> {
  const [tree, config] = await Promise.all([
    attempt(async () => workflows.tree()),
    attempt(async () => workflows.config()),
  ]);

  return { tree, config };
}

/**
 * Read the code route: the rail, the file of the workflow the URL names, and the explorer.
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
  if (!rail.ok || rail.value.length === 0) {
    return { rail, requested: slug, selected: null, explorer: null };
  }

  const entry = rail.value.find((candidate) => candidate.slug === slug);
  const [explorer, file] = await Promise.all([
    readExplorer(),
    entry === undefined ? null : readFile(entry.slug),
  ]);

  return {
    rail,
    requested: slug,
    selected: entry === undefined || file === null ? null : { entry, file },
    explorer,
  };
}
