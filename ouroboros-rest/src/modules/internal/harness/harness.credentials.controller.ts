/**
 * The run-scoped credential routes — DH.2 ([#1303](https://github.com/NobuData/ouroboros/issues/1303)).
 *
 * ```
 * POST   /internal/harness/credentials               mint   {run, stage, alias, attempt?} → token, once
 * DELETE /internal/harness/credentials/{id}          revoke at stage end                   → 204
 * POST   /internal/harness/credentials/{id}/reconcile  the harness's totals → the comparison
 * ```
 *
 * Behind the internal key like the rest of the surface: the control plane's own worker mints
 * a credential for the harness it is about to start, and revokes it when the stage ends.
 */

import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "../internal.decorators";
import {
  HARNESS_CREDENTIAL_ROUTE,
  HARNESS_CREDENTIALS_PATH,
  HARNESS_RECONCILE_ROUTE,
} from "../internal.paths";
import type { MintedCredential } from "./harness.credential";
import { HarnessCredentialsService, type Reconciliation } from "./harness.credentials.service";
import { MintCredentialDto, ReconcileDto, reportedModels } from "./harness.dto";

/**
 * The id pipe: a malformed id is `422`, as `RunId` documents for every id on this surface — an
 * engine should not branch on two statuses for *"your request is the wrong shape"*.
 */
const UUID = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

@InternalOnly()
@AllowAnonymous()
@Controller({ path: HARNESS_CREDENTIALS_PATH, version: VERSION_NEUTRAL })
export class HarnessCredentialsController {
  constructor(private readonly credentials: HarnessCredentialsService) {}

  /**
   * Mint a credential for one stage attempt of one live run.
   *
   * @param body - The run, stage, alias and attempt.
   * @returns The credential, with its token — the only time it is shown.
   */
  @Post()
  async mint(@Body() body: MintCredentialDto): Promise<MintedCredential> {
    return this.credentials.mint(body);
  }

  /**
   * Revoke a credential when its stage ends.
   *
   * @param id - The credential.
   */
  @Delete(HARNESS_CREDENTIAL_ROUTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param("id", UUID) id: string): Promise<void> {
    await this.credentials.revoke(id);
  }

  /**
   * Compare the harness's per-model totals with what the credential's calls recorded.
   *
   * @param id - The credential.
   * @param body - The harness's totals.
   * @returns The comparison, also stored.
   */
  @Post(HARNESS_RECONCILE_ROUTE)
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @Param("id", UUID) id: string,
    @Body() body: ReconcileDto,
  ): Promise<Reconciliation> {
    return this.credentials.reconcile(id, reportedModels(body.models));
  }
}
