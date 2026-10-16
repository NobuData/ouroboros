/**
 * The source credential a build runner checks a private repository out with (AG.7,
 * [#991](https://github.com/NobuData/ouroboros/issues/991), decision **L9**): the ticket
 * minted with an offer, and the one route that redeems it.
 *
 * **It exports the minter and nothing below it.** `FarmDispatchModule` imports
 * {@link FARM_OFFER_SOURCE_CREDENTIALS} to put a ticket on each offer, the way it imports the
 * artifact upload's; the redemption route is this module's own. `GithubModule` is where the
 * workspace's token lives, and this is the one module outside `github/` that opens it for
 * something other than a GitHub API call — which is the whole of what § 4.8 of the security
 * model documents.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../../audit/audit.module";
import { DbModule } from "../../db/db.module";
import { GithubModule } from "../../github/github.module";
import { FarmGatewayModule } from "../gateway/gateway.module";
import { SourceCredentialController } from "./source-credential.controller";
import { SourceCredentialRepository } from "./source-credential.repository";
import {
  FARM_OFFER_SOURCE_CREDENTIALS,
  SourceCredentialService,
} from "./source-credential.service";

@Module({
  imports: [DbModule, AuditModule, GithubModule, FarmGatewayModule],
  controllers: [SourceCredentialController],
  providers: [
    SourceCredentialRepository,
    SourceCredentialService,
    { provide: FARM_OFFER_SOURCE_CREDENTIALS, useExisting: SourceCredentialService },
  ],
  exports: [FARM_OFFER_SOURCE_CREDENTIALS],
})
export class FarmSourceModule {}
