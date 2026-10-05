/**
 * `POST /api/v1/policies/path-preview` — the glob editor's match preview (BS.4,
 * [#494](https://github.com/NobuData/ouroboros/issues/494)).
 *
 * ```
 * POST /policies/path-preview   owner/admin — what each glob covers in each enabled repository's tree
 * ```
 *
 * **`owner`/`admin`** (`@Roles(...ADMINISTRATORS)`), like the publish it precedes: only somebody
 * who may edit the `protected_paths` rule has a glob to preview, and each uncached answer spends a
 * request against the repository host. A `POST` because the globs are a body, not because it
 * writes — it writes nothing and audits nothing.
 *
 * Its own controller and module (`PathPreviewModule`) rather than a route of `PolicyController`:
 * the preview reads repositories through `DetectionModule`, and `PoliciesModule` is imported by
 * the enforcement planes precisely because it imports none of them.
 *
 * **The workspace is the session's, never the request's** — no `{orgId}` in the path.
 */

import { Body, Controller, HttpCode, Post } from "@nestjs/common";

import { ADMINISTRATORS, Roles } from "../tenancy/roles.guard";
import type { ActiveMembership } from "../tenancy/tenant.context";
import { CurrentMember } from "../tenancy/tenant.decorators";
import { PathPreviewDto } from "./org-policy.dto";
import { PathPreviewService, type PathPreviewResource } from "./path-preview.service";

@Controller("policies")
export class PathPreviewController {
  /** @param previews - The preview. */
  constructor(private readonly previews: PathPreviewService) {}

  /**
   * What each glob covers in each enabled repository — writes nothing.
   *
   * @param member - The membership.
   * @param body - The globs.
   * @returns Per repository, each glob's match count and a few matching paths.
   */
  @Post("path-preview")
  @HttpCode(200)
  @Roles(...ADMINISTRATORS)
  preview(
    @CurrentMember() member: ActiveMembership,
    @Body() body: PathPreviewDto,
  ): Promise<PathPreviewResource> {
    return this.previews.preview(member.tenant.id, body.globs);
  }
}
