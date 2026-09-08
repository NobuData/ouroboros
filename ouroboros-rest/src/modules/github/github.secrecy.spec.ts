import { Logger } from "@nestjs/common";

import { recordingAudit, type RecordingAudit } from "../audit/audit.fixture";
import { LOG_METHODS } from "../vault/no-secret-logging";
import { inMemoryVault } from "../vault/vault.fixture";
import { GithubClient } from "./github.client";
import type { GithubCredentialsRepository } from "./github.credentials.repository";
import { GithubCredentialsService } from "./github.credentials.service";
import { GithubClientFactory } from "./github.client.factory";
import {
  FIXTURE_ROTATED_TOKEN,
  FIXTURE_TOKEN,
  FIXTURE_WORKSPACE,
  budgetHeaders,
  credentialRow,
  fakeOctokit,
  fixtureActor,
  httpError,
  response,
} from "./github.fixture";
import { GithubRateLimiter, RETRY_AFTER_HEADER } from "./github.rate-limit";

/**
 * **The grep test.** K.3's second acceptance criterion in the form the issue asks for: *the
 * token is absent from every API response and every log line — **asserted by test, not by
 * inspection***.
 *
 * The distinction that makes this suite worth having, and it is `audit.secrecy.spec.ts`'s:
 * every other suite here asserts what one method returns, which is a claim about that method.
 * This drives the **real** service — a real vault sealing a real-shaped token, the real client
 * failing in every way it can — through a whole credential lifecycle, captures everything that
 * came out of any sink, and greps it. A resource builder that started copying the plaintext
 * into a field would pass its own suite by construction and fail this one.
 *
 * Three sinks are watched, because there are three ways a credential leaves this process:
 *
 *   * **what a route answers** — every resource the service returned, serialized;
 *   * **what the trail stores** — every audit record, serialized;
 *   * **what anything logged** — Nest's `Logger` and `console`, both, on every level
 *     `no-secret-logging.mjs` knows about, so a sink added to that rule is a sink watched here.
 *
 * And it greps for **fragments** rather than for the whole token. A leak that printed the last
 * thirty characters would not contain the token, and would be a leak.
 */

/** How long a run of the token has to appear before this suite calls it a leak. */
const FRAGMENT = 8;

/** Every run of {@link FRAGMENT} characters from a secret — what a partial leak looks like. */
function fragmentsOf(secret: string): string[] {
  const runs: string[] = [];

  for (let at = 0; at + FRAGMENT <= secret.length; at += 1) {
    runs.push(secret.slice(at, at + FRAGMENT));
  }

  return runs;
}

/** Assert that nothing in `haystack` contains any recognisable piece of `secret`. */
function expectNoTrace(haystack: string, secret: string): void {
  for (const fragment of fragmentsOf(secret)) {
    expect(haystack).not.toContain(fragment);
  }
}

describe("what leaves the process when a GitHub token is handled", () => {
  let audit: RecordingAudit;
  let service: GithubCredentialsService;
  let logged: unknown[];
  let stored: string | undefined;

  beforeEach(() => {
    stored = undefined;
    logged = [];
    audit = recordingAudit();

    const repository = {
      find: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(stored === undefined ? undefined : credentialRow(stored)),
        ),
      exists: jest.fn().mockImplementation(() => Promise.resolve(stored !== undefined)),
      upsert: jest.fn().mockImplementation((_workspace: string, envelope: string) => {
        stored = envelope;
        return Promise.resolve(credentialRow(envelope));
      }),
      remove: jest.fn().mockImplementation(() => {
        stored = undefined;
        return Promise.resolve(true);
      }),
      reseal: jest.fn(),
    } as unknown as jest.Mocked<GithubCredentialsRepository>;

    service = new GithubCredentialsService(
      repository,
      inMemoryVault().vault,
      new GithubRateLimiter(),
      audit.service,
    );

    // Every level the lint rule knows about, on both sinks — so a module that acquires a
    // second logger is watched here without this file being edited.
    for (const method of LOG_METHODS) {
      const sinks = [Logger.prototype, console] as unknown as Record<string, unknown>[];

      for (const sink of sinks) {
        if (typeof sink[method] === "function") {
          jest
            .spyOn(sink as unknown as Record<string, () => void>, method as never)
            .mockImplementation(((...args: unknown[]) => {
              logged.push(...args);
            }) as never);
        }
      }
    }
  });

  /** Everything any sink saw, as one string to grep. */
  function everythingLogged(): string {
    return logged
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join(" ");
  }

  /** Everything the trail stored, as one string to grep. */
  function everythingAudited(): string {
    return JSON.stringify(audit.records);
  }

  it("leaks nothing through a whole set → read → rotate → clear lifecycle", async () => {
    const answers = [
      await service.set(fixtureActor(), FIXTURE_TOKEN),
      await service.read(FIXTURE_WORKSPACE),
      await service.set(fixtureActor(), FIXTURE_ROTATED_TOKEN),
      await service.read(FIXTURE_WORKSPACE),
      await service.clear(fixtureActor()),
    ];

    for (const secret of [FIXTURE_TOKEN, FIXTURE_ROTATED_TOKEN]) {
      expectNoTrace(JSON.stringify(answers), secret);
      expectNoTrace(everythingAudited(), secret);
      expectNoTrace(everythingLogged(), secret);
    }
  });

  it("shows the last four characters and no more, which is the mask working", async () => {
    const answer = await service.set(fixtureActor(), FIXTURE_TOKEN);

    // The one deliberate exception to the rule above, stated so that "leaks nothing" is not
    // quietly satisfied by a mask that had stopped showing anything either.
    expect(answer.masked).toContain(FIXTURE_TOKEN.slice(-4));
    expect(answer.masked).toBe("ghp_••••6789");
  });

  it("keeps the token out of the stored ciphertext's own text", async () => {
    await service.set(fixtureActor(), FIXTURE_TOKEN);

    // Trivially true of AES-GCM and asserted anyway: an "encrypt" that base64'd the input
    // would satisfy the column's CHECK and every other test in this directory.
    expectNoTrace(stored ?? "", FIXTURE_TOKEN);
  });

  it("leaks nothing when the vault refuses to open a stored value", async () => {
    await service.set(fixtureActor(), FIXTURE_TOKEN);
    stored = "ouro.v1.1.dGFtcGVyZWQ.dGFtcGVyZWQ";

    await expect(service.read(FIXTURE_WORKSPACE)).rejects.toThrow();

    expectNoTrace(everythingLogged(), FIXTURE_TOKEN);
  });

  it("leaks nothing when the trail refuses the write", async () => {
    audit.failWith(new Error("audit_events is unavailable"));

    await expect(service.set(fixtureActor(), FIXTURE_TOKEN)).rejects.toThrow();

    expectNoTrace(everythingLogged(), FIXTURE_TOKEN);
    expectNoTrace(everythingAudited(), FIXTURE_TOKEN);
  });

  it("leaks nothing through the client, whatever GitHub answers", async () => {
    const refusals = [
      httpError(401, budgetHeaders({ remaining: 4999 })),
      httpError(404, budgetHeaders({ remaining: 4998 })),
      httpError(403, { ...budgetHeaders({ remaining: 0 }), [RETRY_AFTER_HEADER]: "60" }),
      httpError(500, budgetHeaders({ remaining: 4997 })),
      new Error("getaddrinfo ENOTFOUND api.github.com"),
    ];
    const thrown: string[] = [];

    for (const refusal of refusals) {
      const limiter = new GithubRateLimiter();
      const client = new GithubClient(
        FIXTURE_WORKSPACE,
        fakeOctokit([refusal, response({}, budgetHeaders({ remaining: 4996 }))]),
        limiter,
      );

      try {
        await client.request("GET /repos/{owner}/{repo}/issues");
      } catch (error: unknown) {
        // The *message* is the log line — it names a route, a status and a workspace, and it
        // is the string an operator will end up reading. It is the most likely place for a
        // token to be interpolated by somebody debugging.
        thrown.push(error instanceof Error ? error.message : String(error));
      }
    }

    expect(thrown).toHaveLength(refusals.length);
    expectNoTrace(thrown.join(" "), FIXTURE_TOKEN);
    expectNoTrace(everythingLogged(), FIXTURE_TOKEN);
  });

  it("keeps the token out of anything the factory hands back", async () => {
    await service.set(fixtureActor(), FIXTURE_TOKEN);

    const factory = new GithubClientFactory(service, new GithubRateLimiter(), () =>
      fakeOctokit([]),
    );
    const client = await factory.forOrganization(FIXTURE_WORKSPACE);

    // The client is constructed *with* the token and must not carry it anywhere a reader can
    // reach — a field, a getter, or the string a template literal would produce.
    expectNoTrace(JSON.stringify(client), FIXTURE_TOKEN);
    // Own properties as well as the JSON: a field holding a token would show up in both, and
    // one behind a getter that `JSON.stringify` skips would show up only here.
    expectNoTrace(
      Object.values(client)
        .map((value) => JSON.stringify(value))
        .join(" "),
      FIXTURE_TOKEN,
    );
    expectNoTrace(everythingLogged(), FIXTURE_TOKEN);
  });
});
