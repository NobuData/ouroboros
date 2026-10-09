/* eslint-disable @typescript-eslint/require-await -- fakes answer at once; async keeps the real signatures */
/**
 * The code & git mining tool, through the conformance kit (CL.4, #617).
 *
 * Its operations read the engine's clones, so the recordings are the engine's own documented
 * answers over its seeded fixture repository (`code.recordings.fixture.ts`), and the kit holds each
 * answer to the citation contract: a `git://owner/name@sha/…` source at the commit read.
 */

import { CodeRefusal } from "../../../code/code.reader";
import {
  conformanceContext,
  describeToolConformance,
  type ToolConformance,
} from "../../conformance.fixture";
import { CodeResearchTool } from "./code.tool";
import { HELIOS, ORG, recordedReader } from "./code.recordings.fixture";

/**
 * The tool over a reader.
 *
 * @param reader - What it reads through.
 * @param engineUp - Whether the engine answers.
 * @returns The adapter.
 */
function over(reader = recordedReader(), engineUp = true): CodeResearchTool {
  return new CodeResearchTool({
    reader,
    bisects: {
      start: () => Promise.reject(new Error("not recorded")),
      get: async () => undefined,
      cancel: async () => undefined,
    },
    workspace: {
      enabled: async () => [HELIOS],
      stack: async () => ({ stack: "c", language: "C" }),
    },
    engineUp: async () => engineUp,
  });
}

const BLAME = {
  op: "blame",
  repo: "helios-firmware",
  path: "src/dock/dock_ctrl.c",
  range: "213-215",
};

describeToolConformance("code", (): ToolConformance => {
  const context = { ...conformanceContext({ config: {}, secret: null }), organizationId: ORG };
  const tool = over();

  return {
    adapter: tool,
    config: {},
    secret: null,
    operations: {
      query: () => tool.query(context, BLAME),
    },
    failures: {
      network: () =>
        over(
          recordedReader({ blame: new CodeRefusal("network", "the engine could not be reached") }),
        ).query(context, BLAME),
      upstream: () => over(recordedReader({ blame: new Error("boom") })).query(context, BLAME),
      auth: () =>
        over(
          recordedReader({
            blame: new CodeRefusal("auth", "GitHub refused the workspace's token"),
          }),
        ).query(context, BLAME),
      unsupported: () => tool.query(context, { op: "grep" }),
    },
    health: {
      healthy: () => tool.healthCheck({}, null, ORG),
      degraded: () => tool.healthCheck({}, null),
      down: () => over(recordedReader(), false).healthCheck({}, null, ORG),
    },
  };
});
