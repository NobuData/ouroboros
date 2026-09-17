import { Test } from "@nestjs/testing";

import { AuditService } from "../audit/audit.service";
import { ConfigurationModule } from "../config/config.module";
import { testConfiguration } from "../config/configuration.fixture";
import { DatabaseService } from "../db/db.service";
import { type OctokitLike } from "./github.client";
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
  async function build(environment: NodeJS.ProcessEnv = {}) {
    return Test.createTestingModule({
      imports: [ConfigurationModule.forRoot(testConfiguration(environment)), GithubModule],
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

  // #288. `github.octokit.ts` has carried a `baseUrl` parameter since K.3 for GitHub
  // Enterprise Server, and until this binding nothing could reach it — a deployment behind
  // GHES had a parameter and no setting. The seam is where the two meet, so it is where the
  // wiring is asserted; that the parameter itself works is `github.octokit.spec.ts`'s.
  it("points the client wherever the deployment says GitHub is", async () => {
    const elsewhere = await build({
      OURO_GITHUB_API_BASE_URL: "https://github.example.com/api/v3",
    });
    const publicApi = await build();

    expect(baseUrlOf(elsewhere.get<OctokitFactory>(OCTOKIT_FACTORY)(FIXTURE_TOKEN))).toBe(
      "https://github.example.com/api/v3",
    );
    // Unset is every deployment that talks to github.com, and it must still be the default.
    expect(baseUrlOf(publicApi.get<OctokitFactory>(OCTOKIT_FACTORY)(FIXTURE_TOKEN))).toBe(
      "https://api.github.com",
    );
  });
});

/**
 * Where a built client will send its requests.
 *
 * Read off the library's own endpoint defaults rather than by sending a request: the seam
 * builds a real `Octokit` with the runtime's `fetch`, and a suite that starts nothing must
 * not be the first thing to open a socket.
 *
 * @param octokit - A client the seam produced.
 * @returns Its base URL.
 */
function baseUrlOf(octokit: OctokitLike): string {
  const { endpoint } = octokit.request as unknown as {
    endpoint: { DEFAULTS: { baseUrl: string } };
  };

  return endpoint.DEFAULTS.baseUrl;
}
