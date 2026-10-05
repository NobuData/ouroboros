/**
 * `PathPreviewModule` — `POST /api/v1/policies/path-preview`, the `protected_paths` glob editor's
 * match preview (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * ```
 * path-preview             the grammar check and the matching (pure)
 * path-preview.service     enabled repositories ─▶ trees (cached 60 s) ─▶ matches
 * path-preview.controller  POST /policies/path-preview
 * ```
 *
 * Separate from `PoliciesModule` on purpose: this reads repositories through `DetectionModule`
 * (#384, over the provider SPI #140), and `PoliciesModule` imports no plane so that every plane
 * may import it. `RepoMapRepository` is provided here for its one statement — which repositories
 * a workspace has enabled — as `RepoMapModule` provides `SkillsRepository`.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { DetectionModule } from "../detection/detection.module";
import { RepoMapRepository } from "../repo-map/repo-map.repository";
import { PathPreviewController } from "./path-preview.controller";
import { PathPreviewService } from "./path-preview.service";

@Module({
  imports: [DbModule, DetectionModule],
  controllers: [PathPreviewController],
  providers: [PathPreviewService, RepoMapRepository],
})
export class PathPreviewModule {}
