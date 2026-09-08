/**
 * GitHub credentials and the API client — K.3
 * ([#101](https://github.com/NobuData/ouroboros/issues/101)), Epic K's other Phase 1 entry
 * point.
 *
 * ```
 * github.token.ts             what a token looks like, and its mask
 * github.dto.ts               the one body this surface accepts
 * github.resources.ts         row → resource, and the resource cannot hold a token
 * github.credentials.*.ts     the credential's life: store, replace, clear, open
 * github.controller.ts        PUT / DELETE / GET /settings/github-token — owner & admin only
 * github.secrets.ts           the sealed column, seen from the vault's sweep
 * github.errors.ts            five reasons, and what each becomes at an HTTP boundary
 * github.rate-limit.ts        back off before exhaustion, not after a 403
 * github.client.ts            one call: guard, send, observe, classify
 * github.octokit.ts           the only file that imports @octokit/rest
 * ```
 *
 * **What this module exports is deliberately not a route.** `GithubCredentialsService` and
 * `GithubClientFactory` are for K.4's sync
 * ([#102](https://github.com/NobuData/ouroboros/issues/102)) — the thing that will actually
 * call GitHub — and `GithubRateLimiter` so that a caller reporting a paused state reads the
 * same budget the client enforces rather than a second opinion about it.
 *
 * **`GithubCredentialStore` is not provided here**, and that is the one piece of wiring worth
 * explaining. The vault's re-encryption sweep needs it, `VAULT_SECRET_STORES` is bound in
 * `vault.module.ts`, and this module imports `VaultModule` — so exporting the store from here
 * the way `RegistryModule` does would close a cycle. The class needs nothing but
 * `DatabaseService`, which `VaultModule` already has, so it is named in that module's own
 * `providers`. `github.secrets.ts` carries the same note from the other side.
 *
 * **`OCTOKIT_FACTORY` is bound here and nowhere else.** It is the single line that connects
 * the library to the product: everything downstream of it is written against `OctokitLike`,
 * which is what lets `.dependency-cruiser.cjs` refuse an `@octokit/*` import anywhere but
 * `github.octokit.ts`. When Q.3 ([#140](https://github.com/NobuData/ouroboros/issues/140))
 * moves this behind the ticket-source SPI, this binding is what moves.
 */

import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { DbModule } from "../db/db.module";
import { VaultModule } from "../vault/vault.module";
import { GithubClientFactory, OCTOKIT_FACTORY, type OctokitFactory } from "./github.client.factory";
import { GithubTokenController } from "./github.controller";
import { GithubCredentialsRepository } from "./github.credentials.repository";
import { GithubCredentialsService } from "./github.credentials.service";
import { createOctokit } from "./github.octokit";
import { GithubRateLimiter } from "./github.rate-limit";

@Module({
  imports: [DbModule, VaultModule, AuditModule],
  controllers: [GithubTokenController],
  providers: [
    GithubCredentialsRepository,
    GithubCredentialsService,
    // One instance for the service, so that what the sync learns about a workspace's budget
    // is what the next request is measured against. A limiter per client would be a limiter
    // that never had enough evidence to refuse anything.
    GithubRateLimiter,
    GithubClientFactory,
    {
      provide: OCTOKIT_FACTORY,
      // `useValue` rather than `useFactory`: there is nothing to inject, and the deadline,
      // the user agent and the base URL are `github.octokit.ts`'s decisions rather than this
      // module's. A GitHub Enterprise Server deployment changes that file's default, not
      // this line.
      useValue: ((token: string) => createOctokit({ token })) satisfies OctokitFactory,
    },
  ],
  exports: [GithubCredentialsService, GithubClientFactory, GithubRateLimiter],
})
export class GithubModule {}
