/**
 * Build the issue & PR history index tool — the one place its store meets the adapter, called by
 * `research-tools.module.ts`.
 */

import type { HistoryIndexRepository } from "../../../history/history-index.repository";
import { TicketsResearchTool } from "./tickets.tool";

/**
 * The production tool.
 *
 * @param index - The history index.
 * @returns The adapter.
 */
export function buildTicketsTool(index: HistoryIndexRepository): TicketsResearchTool {
  return new TicketsResearchTool(index);
}
