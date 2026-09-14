/**
 * The one row `resolutions.repository.ts` selects — a snapshot, and the run number it served.
 *
 * Declared apart from the repository for the reason `registry-read.rows.ts` gives: the resources
 * and their spec import the row type, and a type that lived in the repository would make the
 * repository a dependency of everything that renders it.
 */

import type { ResolutionSnapshotHopDocument, ResolutionSnapshotRuleDocument } from "../db/schema";

/** One snapshot, joined to its run. */
export interface ResolutionSnapshotRow {
  /** `resolution_snapshots.id`. */
  id: string;
  /** `runs.id`. */
  run_id: string;
  /** `runs.issue_number` — the card's `run #482`. */
  issue_number: number;
  /** The shape the documents are written in. */
  shape_version: number;
  /** The task kind, by name. */
  task_kind: string;
  /** The route, by tag. */
  route_tag: string;
  /** `resolved` or `fail_run`. */
  outcome: "resolved" | "fail_run";
  /** The whole resolution's duration, or null. */
  duration_ms: number | null;
  /** The chain, parsed. */
  chain: ResolutionSnapshotHopDocument[];
  /** The rules, parsed. */
  rules: ResolutionSnapshotRuleDocument[];
  /** When the resolution was made. */
  resolved_at: Date;
}
