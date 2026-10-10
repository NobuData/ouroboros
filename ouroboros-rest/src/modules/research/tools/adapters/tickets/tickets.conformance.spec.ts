/**
 * The issue & PR history index, through the conformance kit (CL.5, #618).
 *
 * Its one operation reads the workspace's own index, so the recording is a corpus in memory —
 * tickets from two trackers, a PR, and the churn interviews — and the kit holds each answer to the
 * citation contract: `ticket` sources with `issue-index://` locators.
 */

import {
  conformanceContext,
  describeToolConformance,
  type ToolConformance,
} from "../../conformance.fixture";
import { INDEX_ORG, MemoryHistoryIndex } from "../../../history/history-index.store.fixture";
import { TicketsResearchTool } from "./tickets.tool";

const NOW = new Date("2026-09-30T12:00:00Z");

const failing = (failure: Error) =>
  new TicketsResearchTool(
    {
      search: () => Promise.reject(failure),
      get: () => Promise.reject(failure),
      aggregate: () => Promise.reject(failure),
      summary: () => Promise.reject(failure),
    },
    () => NOW,
  );

describeToolConformance("tickets", (): ToolConformance => {
  const context = {
    ...conformanceContext({ config: {}, secret: null }),
    organizationId: INDEX_ORG,
  };
  const tool = new TicketsResearchTool(new MemoryHistoryIndex(), () => NOW);

  return {
    adapter: tool,
    config: {},
    secret: null,
    operations: {
      query: () => tool.query(context, { op: "search", q: "docking abort churn" }),
    },
    failures: {
      network: () =>
        failing(Object.assign(new Error("connect"), { code: "ECONNREFUSED" })).query(context, {
          op: "search",
          q: "docking",
        }),
      upstream: () =>
        failing(Object.assign(new Error("canceling statement"), { code: "57014" })).query(context, {
          op: "search",
          q: "docking",
        }),
      unsupported: () => tool.query(context, { op: "cluster", q: "docking" }),
    },
    health: {
      healthy: () => tool.healthCheck({}, null, INDEX_ORG),
      degraded: () => tool.healthCheck({}, null),
      down: () => failing(new Error("gone")).healthCheck({}, null, INDEX_ORG),
    },
  };
});
