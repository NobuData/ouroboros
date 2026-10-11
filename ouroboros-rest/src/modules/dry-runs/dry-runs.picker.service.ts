/**
 * The edge-case picker over a workspace's tickets (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562), decision **W8**).
 *
 * `dry-runs.picker.ts` is the scorer; this is the read around it. Exported from the module
 * because the picker has two consumers that must agree: the **Dry-run another issue ▾** menu
 * (`GET …/dry-runs/candidates`) and the copilot's `lookup_tickets`, which is what its
 * `propose_dry_run` is drawn from. One scorer, so the copilot's *"#489 — a useful edge case"*
 * and the menu's first row are the same ticket for the same reason.
 */

import { Injectable } from "@nestjs/common";

import { rankCandidates, type PickerCandidate, type PickerTicket } from "./dry-runs.picker";
import {
  DryRunsRepository,
  MAX_PICKER_CANDIDATES,
  isDryRunSource,
  type DryRunTicketRow,
} from "./dry-runs.repository";

/**
 * A ticket row, as the picker reads it.
 *
 * @param row - The row.
 * @returns The picker's ticket, or `undefined` for a tracker a trigger cannot name.
 */
export function pickerTicket(row: DryRunTicketRow): PickerTicket | undefined {
  if (!isDryRunSource(row.source_kind)) return undefined;

  return {
    id: row.id,
    key: row.external_key,
    title: row.title,
    url: row.external_url,
    source: row.source_kind,
    labels: row.labels,
    effort: row.effort,
    updatedAt: new Date(row.source_updated_at),
  };
}

@Injectable()
export class DryRunPickerService {
  /** @param dryRuns - The statements. */
  constructor(private readonly dryRuns: DryRunsRepository) {}

  /**
   * Rank a workspace's open, sized tickets for a dry run of one draft.
   *
   * @param organizationId - The workspace.
   * @param definition - The draft's document, as stored.
   * @param options - How many to answer with, and an optional filter.
   * @param options.limit - The most candidates to return.
   * @param options.query - A substring of the key, the title or a label; empty for any.
   * @returns The candidates, the most mismatched first, re-ranked from 1 after the filter.
   */
  async rank(
    organizationId: string,
    definition: unknown,
    options: { readonly limit: number; readonly query?: string },
  ): Promise<PickerCandidate[]> {
    const rows = await this.dryRuns.candidates(organizationId, MAX_PICKER_CANDIDATES);
    const wanted = (options.query ?? "").trim().toLowerCase();
    const tickets = rows
      .map(pickerTicket)
      .filter((ticket): ticket is PickerTicket => ticket !== undefined)
      .filter(
        (ticket) =>
          wanted === "" ||
          ticket.key.toLowerCase().includes(wanted) ||
          ticket.title.toLowerCase().includes(wanted) ||
          ticket.labels.some((label) => label.toLowerCase().includes(wanted)),
      );

    return rankCandidates(definition, tickets).slice(0, Math.max(0, options.limit));
  }
}
