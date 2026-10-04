/**
 * `InboxPoliciesModule` — the Needs-You *What Needs A Human* card (BN.4,
 * [#464](https://github.com/NobuData/ouroboros/issues/464), decision **X7**).
 *
 * A module of its own because it composes the planes whose configs enforce each rule — the gate
 * engine's org policy reader, BA.3's dry-run policy, the decision registry — and nothing imports
 * it, so it can import them all without a cycle.
 */

import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module";
import { DecisionsModule } from "../decisions/decisions.module";
import { PoliciesModule } from "../policies/policies.module";
import { GatesModule } from "../pull-requests/gates/gates.module";
import { InboxPoliciesController } from "./inbox-policies.controller";
import { InboxPoliciesRepository } from "./inbox-policies.repository";
import { InboxPoliciesService } from "./inbox-policies.service";

@Module({
  imports: [DbModule, GatesModule, PoliciesModule, DecisionsModule],
  controllers: [InboxPoliciesController],
  providers: [InboxPoliciesRepository, InboxPoliciesService],
})
export class InboxPoliciesModule {}
