/**
 * Build the code & git mining tool from its core (CL.4, #617) — called by
 * `research-tools.module.ts`, the one place an adapter is registered.
 */

import type { EngineClient } from "../../../../engine/engine.client";
import type { CodeBisectService } from "../../../code/code-bisect.service";
import type { CodeReader } from "../../../code/code.reader";
import type { CodeWorkspace } from "../../../code/code.workspace";
import { CodeResearchTool } from "./code.tool";

/**
 * The production tool.
 *
 * @param reader - Engine reads over the workspace's repositories.
 * @param bisects - The bisect primitive.
 * @param workspace - The workspace's repositories and their detected stacks.
 * @param engine - The engine, asked whether it answers for health.
 * @returns The adapter.
 */
export function buildCodeTool(
  reader: CodeReader,
  bisects: CodeBisectService,
  workspace: CodeWorkspace,
  engine: EngineClient,
): CodeResearchTool {
  return new CodeResearchTool({
    reader,
    bisects,
    workspace,
    engineUp: async () => {
      try {
        await engine.status();
        return true;
      } catch {
        return false;
      }
    },
  });
}
