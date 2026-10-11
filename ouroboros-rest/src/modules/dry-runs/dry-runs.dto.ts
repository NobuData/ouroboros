/**
 * The bodies, params and queries of the dry-run routes (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * Every property is `!`-asserted or optional rather than initialised, for `tenancy.dto.ts`'
 * reason: `class-transformer` constructs these objects and assigns to them.
 */

import { Type } from "class-transformer";
import { IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

/** How many candidates the picker answers with when the caller names no limit. */
export const DEFAULT_CANDIDATE_LIMIT = 10;

/** The most candidates one picker read may ask for. */
export const MAX_CANDIDATE_LIMIT = 50;

/** The path of the workflow-level routes — `/workflows/{id}/dry-runs…`. */
export class DryRunWorkflowParams {
  /** The workflow — `workflows.id`. */
  @IsUUID()
  id!: string;
}

/** The path of one dry run — `/workflows/{id}/dry-runs/{dryRunId}…`. */
export class DryRunParams extends DryRunWorkflowParams {
  /** The dry run — `dry_runs.id`. */
  @IsUUID()
  dryRunId!: string;
}

/** The body of `POST /api/v1/workflows/{id}/dry-runs`. */
export class StartDryRunBody {
  /** The canonical ticket to run against — `tickets.id`. */
  @IsUUID()
  ticketId!: string;

  /**
   * The draft revision the caller is looking at — the `3` of `v0.3`. A dry run tests the stored
   * draft; naming the revision is what turns *the draft moved under me* into a `409` instead of
   * a result about a document the caller never saw.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  draftRev!: number;

  /** The copilot session that proposed the dry run, when one did. */
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}

/** The query of `GET /api/v1/workflows/{id}/dry-runs/candidates`. */
export class DryRunCandidatesQuery {
  /** How many ranked candidates to answer with — 1 to 50, default 10. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CANDIDATE_LIMIT)
  limit?: number;
}
