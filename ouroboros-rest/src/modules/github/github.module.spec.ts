import { Test } from "@nestjs/testing";

import { AuditService } from "../audit/audit.service";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { GithubClientFactory, OCTOKIT_FACTORY, type OctokitFactory } from "./github.client.factory";
import { GithubTokenController } from "./github.controller";
import { GithubCredentialsRepository } from "./github.credentials.repository";
import { GithubCredentialsService } from "./github.credentials.service";
import { GithubModule } from "./github.module";
import { GithubRateLimiter } from "./github.rate-limit";
import { FIXTURE_TOKEN } from "./github.fixture";

/**
 * The wiring, which is where two of this module's decisions live.
 *
 * `OCTOKIT_FACTORY` is the single line that connects the library to the product: everything
 * downstream of it is written against `OctokitLike`, which is what lets
 * `.dependency-cruiser.cjs` refuse an `@octokit/*` import anywhere else. And
 * `GithubRateLimiter` is provided **once**, because a limiter per client would be a limiter
 * that never had enough evidence to refuse anything.
 *
 * Built with a stand-in `DatabaseService`, because constructing the real one opens a pool —
 * which is precisely what a suite that starts nothing must not do.
 */

describe("the GitHub module", () => {
  /**
   * Build the module over a validated configuration and a database that never connects.
   *
   * @returns The compiled testing module.
   */
  async function build() {
    return Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration()), GithubModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({})
      .overrideProvider(AuditService)
      .useValue({ record: jest.fn() })
      .compile();
  }

  it("provides the credential lifecycle and the client factory", async () => {
    const module = await build();

    expect(module.get(GithubCredentialsRepository)).toBeInstanceOf(GithubCredentialsRepository);
    expect(module.get(GithubCredentialsService)).toBeInstanceOf(GithubCredentialsService);
    expect(module.get(GithubClientFactory)).toBeInstanceOf(GithubClientFactory);
  });

  it("serves the settings surface and nothing else", async () => {
    const module = await build();

    expect(module.get(GithubTokenController)).toBeInstanceOf(GithubTokenController);
  });

  it("shares one rate guard, so what the sync learns is what the next call is measured against", async () => {
    const module = await build();

    expect(module.get(GithubRateLimiter)).toBe(module.get(GithubRateLimiter));
  });

  it("binds the real Octokit constructor behind the one injectable seam", async () => {
    const module = await build();
    const octokit = module.get<OctokitFactory>(OCTOKIT_FACTORY)(FIXTURE_TOKEN);

    // The library, reached through the interface: if this ever stopped producing something
    // shaped like `OctokitLike`, every caller downstream would fail at run time instead.
    expect(typeof octokit.request).toBe("function");
    expect(typeof octokit.paginate.iterator).toBe("function");
  });
});
