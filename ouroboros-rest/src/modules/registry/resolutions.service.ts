/**
 * The resolution snapshot read — the chain card's and the run console's one question: *what did
 * the last run through this alias actually do?* ([#589](https://github.com/NobuData/ouroboros/issues/589))
 *
 * Thin by design. The decision was made by `resolve()` and kept by the executor; this service
 * finds the stored row and hands back its resource, and adds nothing a snapshot did not record —
 * no re-resolution, no current health, no fallback to a simulation. The card renders a
 * Simulate-driven preview *labelled as one* when the answer is `null` (decision **R9**), and that
 * labelling is the client's, against a truthful `null` here.
 */

import { Injectable } from "@nestjs/common";

import type { LatestResolutionResource } from "./resolutions.resources";
import { toSnapshotResource } from "./resolutions.resources";
import { ResolutionSnapshotsRepository } from "./resolutions.repository";

@Injectable()
export class ResolutionSnapshotsService {
  /**
   * @param snapshots - The one read.
   */
  constructor(private readonly snapshots: ResolutionSnapshotsRepository) {}

  /**
   * The most recent stored resolution whose chain names an alias.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param alias - The alias's name.
   * @returns The alias and its latest snapshot, or `snapshot: null` when no run has resolved
   *   through it here.
   */
  async latest(organizationId: string, alias: string): Promise<LatestResolutionResource> {
    const row = await this.snapshots.latestNaming(organizationId, alias);

    return { alias, snapshot: row === undefined ? null : toSnapshotResource(row) };
  }
}
