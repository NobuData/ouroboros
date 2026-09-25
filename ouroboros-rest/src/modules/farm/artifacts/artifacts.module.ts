/**
 * The job-scoped artifact upload (AT.2, [#330](https://github.com/NobuData/ouroboros/issues/330)):
 * the store the bytes go to, the token dispatch mints with each offer, and the route the agent
 * uploads through.
 *
 * Exports {@link FARM_OFFER_UPLOADS} for `FarmDispatchModule`, which mints a token with every
 * offer, and {@link ARTIFACT_STORE} for the read and retention work that follows (#333).
 */

import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/config.service";
import { DbModule } from "../../db/db.module";
import { TestResultsModule } from "../../test-results/test-results.module";
import { FarmGatewayModule } from "../gateway/gateway.module";
import { ARTIFACT_STORE, createArtifactStore } from "./artifact.store.factory";
import { ArtifactUploadController } from "./upload.controller";
import { UploadRepository } from "./upload.repository";
import { ArtifactUploadService, FARM_OFFER_UPLOADS } from "./upload.service";

@Module({
  imports: [DbModule, TestResultsModule, FarmGatewayModule],
  controllers: [ArtifactUploadController],
  providers: [
    {
      provide: ARTIFACT_STORE,
      useFactory: (config: AppConfigService) => createArtifactStore(config.artifacts),
      inject: [AppConfigService],
    },
    UploadRepository,
    ArtifactUploadService,
    { provide: FARM_OFFER_UPLOADS, useExisting: ArtifactUploadService },
  ],
  exports: [FARM_OFFER_UPLOADS, ARTIFACT_STORE],
})
export class FarmArtifactsModule {}
