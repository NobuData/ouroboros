/**
 * `/api/v1/workflows/{id}/dry-runs/{dryRunId}/suggestions…` — the callouts under a dry run
 * (CD.5, [#563](https://github.com/NobuData/ouroboros/issues/563)).
 *
 * ```
 * GET   …/suggestions                           the callouts, in card order
 * GET   …/suggestions/{suggestionId}/explanation   Explain: rule, version, evidence, scoring
 * POST  …/suggestions/{suggestionId}/apply         Apply to draft — a new draft revision
 * POST  …/suggestions/{suggestionId}/ignore        Ignore — remembered for this draft revision
 * ```
 *
 * The reads are every member's, as the dry run's own are. Apply and Ignore are a contributor's:
 * Apply edits the draft exactly as a canvas edit does, and Ignore decides what the next run of
 * this revision may propose.
 */

import { Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { Session } from "@thallesp/nestjs-better-auth";

import type { Principal } from "../auth/principal";
import type { Organization } from "../db/schema";
import { CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { DryRunParams, DryRunSuggestionParams } from "./dry-runs.dto";
import type {
  DryRunSuggestionAppliedResource,
  DryRunSuggestionExplanationResource,
  DryRunSuggestionResource,
  DryRunSuggestionsResource,
} from "./suggestions.resources";
import { DryRunSuggestionsService } from "./suggestions.service";

@Controller("workflows/:id/dry-runs/:dryRunId/suggestions")
export class DryRunSuggestionsController {
  /** @param suggestions - Filing, and Apply / Explain / Ignore. */
  constructor(private readonly suggestions: DryRunSuggestionsService) {}

  /**
   * `GET …/suggestions` — the dry run's callouts: rule-derived ones with their confidence and
   * basis, and the copilot's, labelled `source: llm` and unscored.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param params - The workflow and the dry run.
   * @returns The suggestions, in card order.
   */
  @Get()
  list(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunParams,
  ): Promise<DryRunSuggestionsResource> {
    return this.suggestions.list(tenant.id, params.id, params.dryRunId);
  }

  /**
   * `GET …/suggestions/{suggestionId}/explanation` — the derivation: the rule and its version,
   * the evidence it computed and the scoring inputs behind the confidence.
   *
   * @param tenant - The workspace.
   * @param params - The workflow, the dry run and the suggestion.
   * @returns The explanation.
   */
  @Get(":suggestionId/explanation")
  explain(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunSuggestionParams,
  ): Promise<DryRunSuggestionExplanationResource> {
    return this.suggestions.explain(tenant.id, params.id, params.dryRunId, params.suggestionId);
  }

  /**
   * `POST …/suggestions/{suggestionId}/apply` — apply the suggestion's operations to the draft
   * as one batch (`actor: suggestion`). Answers the new draft revision; `409` when the draft
   * moved on and an operation no longer fits, in which case nothing was written.
   *
   * @param tenant - The workspace.
   * @param params - The workflow, the dry run and the suggestion.
   * @param principal - Who is applying it.
   * @returns The suggestion, applied, with the draft's new revision, label and etag, `200`.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":suggestionId/apply")
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunSuggestionParams,
    @Session() principal: Principal,
  ): Promise<DryRunSuggestionAppliedResource> {
    return this.suggestions.apply(
      tenant.id,
      params.id,
      params.dryRunId,
      params.suggestionId,
      principal.user.id,
    );
  }

  /**
   * `POST …/suggestions/{suggestionId}/ignore` — ignore the suggestion. It stays in the record,
   * and the same rule does not propose it again on a later dry run of this draft revision.
   *
   * @param tenant - The workspace.
   * @param params - The workflow, the dry run and the suggestion.
   * @param principal - Who is ignoring it.
   * @returns The suggestion, ignored, `200`.
   */
  @Roles(...CONTRIBUTORS)
  @Post(":suggestionId/ignore")
  @HttpCode(HttpStatus.OK)
  ignore(
    @CurrentTenant() tenant: Organization,
    @Param() params: DryRunSuggestionParams,
    @Session() principal: Principal,
  ): Promise<DryRunSuggestionResource> {
    return this.suggestions.ignore(
      tenant.id,
      params.id,
      params.dryRunId,
      params.suggestionId,
      principal.user.id,
    );
  }
}
