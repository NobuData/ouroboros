/**
 * `InboxPoliciesController` — `GET /api/v1/inbox/policies`, the *What Needs A Human* card (BN.4,
 * [#464](https://github.com/NobuData/ouroboros/issues/464)). Every member reads it.
 */

import { Controller, Get } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import type { PolicyCardResource } from "./inbox-policies.compose";
import { InboxPoliciesService } from "./inbox-policies.service";

@Controller("inbox")
export class InboxPoliciesController {
  /**
   * @param policies - The card's composer.
   */
  constructor(private readonly policies: InboxPoliciesService) {}

  /**
   * `GET /api/v1/inbox/policies` — the rules that send a decision to a person, each from the config
   * that enforces it.
   *
   * @param tenant - The workspace.
   * @returns The rows and the caption.
   */
  @Get("policies")
  read(@CurrentTenant() tenant: Organization): Promise<PolicyCardResource> {
    return this.policies.card(tenant.id);
  }
}
