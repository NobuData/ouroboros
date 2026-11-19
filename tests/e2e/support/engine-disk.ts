/**
 * What the engine's disk holds — the one place a leg looks at the engine container's files
 * (#1817): a write the workspace refused must have left nothing outside the run's tree.
 *
 * It goes through `compose.ts`, as `farm-runner.ts` does, and names one service and one
 * read-only command; a spec imports this module rather than `compose`.
 */

import { compose } from "./compose";

/** The compose service the engine runs as. */
const ENGINE_SERVICE = "engine";

/**
 * The paths on the engine container's own filesystem with a given file name.
 *
 * @param name - A bare file name, with no path and no glob (`planted-outside-the-tree.txt`).
 * @returns Each path found, one per entry; empty when there is none.
 * @throws {Error} If compose could not run the command — see `support/compose.ts`.
 */
export async function engineFilesNamed(name: string): Promise<string[]> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`engineFilesNamed takes a bare file name, not ${JSON.stringify(name)}`);
  }

  const out = await compose(
    "exec",
    "-T",
    ENGINE_SERVICE,
    "find",
    "/",
    "-xdev",
    "-name",
    name,
    "-not",
    "-path",
    "/proc/*",
  );

  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
