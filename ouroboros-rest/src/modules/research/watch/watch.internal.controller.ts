/**
 * `/internal/research/regression-watch/releases` — a release, announced (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623)).
 *
 * Nothing in the product notices a release tag by itself. A CI step that tags a release — or a
 * webhook receiver, when one exists — posts the repository and the tag here with the internal
 * key, and every workspace that watches a metric of that repository captures its baselines.
 * The call names no workspace: which ones watch the repository is the control plane's to know.
 */

import { Body, Controller, HttpCode, HttpStatus, Post, VERSION_NEUTRAL } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "../../internal/internal.decorators";
import {
  REGRESSION_WATCH_PATH,
  REGRESSION_WATCH_RELEASES_ROUTE,
} from "../../internal/internal.paths";
import { CaptureBaselinesDto } from "./watch.dto";
import { RegressionWatchService } from "./watch.service";

/** What an announcement answers. */
export interface ReleaseAnnouncedResource {
  readonly repository: string;
  readonly releaseTag: string;
  /** How many workspaces watch a metric of the repository. */
  readonly workspaces: number;
  /** How many baselines were captured across them. */
  readonly captured: number;
}

@InternalOnly()
@AllowAnonymous()
@Controller({ path: REGRESSION_WATCH_PATH, version: VERSION_NEUTRAL })
export class RegressionWatchInternalController {
  /** @param watch - The capture. */
  constructor(private readonly watch: RegressionWatchService) {}

  /**
   * Announce a release.
   *
   * @param body - The repository and the tag.
   * @returns How many workspaces watch it and how many baselines were captured.
   */
  @Post(REGRESSION_WATCH_RELEASES_ROUTE)
  @HttpCode(HttpStatus.OK)
  async released(@Body() body: CaptureBaselinesDto): Promise<ReleaseAnnouncedResource> {
    const outcome = await this.watch.released(body.repository, body.releaseTag);

    return { repository: body.repository, releaseTag: body.releaseTag, ...outcome };
  }
}
