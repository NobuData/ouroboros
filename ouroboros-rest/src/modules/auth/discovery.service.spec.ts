import type { DiscoverBody } from "./discovery.dto";
import type { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService, NO_SSO_MESSAGE, type DiscoveryResource } from "./discovery.service";
import { DISCOVERY_FLOOR_MS } from "./discovery.timing";

/**
 * The rules, and they are all one rule: **an anonymous caller learns nothing about which
 * domains are ours.**
 *
 * The issue's first two acceptance criteria are a pair — *known domain → well-formed
 * response; unknown domain → indistinguishable-shape "no SSO configured" response* — and
 * "indistinguishable" is the word these assertions are written against. Not *similar*, not
 * *the same fields*: deep-equal, for both branches, in one assertion that would fail on any
 * difference including one nobody thought to check for.
 *
 * The other half is that the lookup happens anyway. It is the seam
 * [#722](https://github.com/NobuData/ouroboros/issues/722) fills, and an MVP that skipped it
 * would ship a query, an index and a normalisation that nothing had ever exercised — so a
 * test asserts it is issued, precisely because the answer does not depend on it and nothing
 * else would notice if it stopped being.
 */

/** A repository that answers whatever a test says, and records what it was asked. */
function repositoryDouble(known: boolean) {
  const exists = jest.fn((_domain: string) => Promise.resolve(known));

  return { exists } as unknown as DiscoveryRepository & { exists: jest.Mock };
}

/** A validated body, as the pipe would hand one over. */
function body(domain: string): DiscoverBody {
  return { domain };
}

describe("discovering a domain", () => {
  it("answers that SSO is unavailable, with the sentence the card renders", async () => {
    const service = new DiscoveryService(repositoryDouble(true));

    expect(await service.discover(body("acme.ouroboros.dev"))).toEqual({
      ssoAvailable: false,
      message: NO_SSO_MESSAGE,
    });
  });

  it("answers a domain nobody holds identically", async () => {
    // The acceptance criterion, as one assertion. Deep equality rather than a field-by-field
    // comparison: a difference this file never thought to look for is exactly the difference
    // an enumerator would find.
    const known = await new DiscoveryService(repositoryDouble(true)).discover(
      body("acme.ouroboros.dev"),
    );
    const unknown = await new DiscoveryService(repositoryDouble(false)).discover(
      body("nobody.example"),
    );

    expect(unknown).toEqual(known);
  });

  it("names no workspace, no count and no identifier", async () => {
    // The rest of the anti-enumeration rule: the shape being uniform is only half of it if
    // the shape itself carries what the caller was fishing for.
    const answer: DiscoveryResource = await new DiscoveryService(repositoryDouble(true)).discover(
      body("acme.ouroboros.dev"),
    );

    expect(Object.keys(answer).toSorted()).toEqual(["message", "ssoAvailable"]);
    expect(JSON.stringify(answer)).not.toContain("acme");
  });

  it("sends no redirect in this release", async () => {
    // `redirectUrl` is published in the contract and never filled until #722. A value here
    // would be a browser sent somewhere that does not exist yet.
    const answer = await new DiscoveryService(repositoryDouble(true)).discover(
      body("acme.ouroboros.dev"),
    );

    expect(answer.redirectUrl).toBeUndefined();
  });

  it("looks the domain up, though the answer does not depend on it", async () => {
    // Deliberately asserted, because nothing else would notice if the query stopped being
    // issued: the response is the same either way. It is the statement #722 builds on and
    // this is the release in which it is exercised at all.
    const domains = repositoryDouble(false);

    await new DiscoveryService(domains).discover(body("acme.ouroboros.dev"));

    expect(domains.exists).toHaveBeenCalledWith("acme.ouroboros.dev");
  });

  it("looks it up exactly once", async () => {
    const domains = repositoryDouble(true);

    await new DiscoveryService(domains).discover(body("acme.ouroboros.dev"));

    expect(domains.exists).toHaveBeenCalledTimes(1);
  });

  it("takes the timing floor, so the lookup is not measurable", async () => {
    // The service's half of the third acceptance criterion — that it applies the floor at
    // all. What the floor itself guarantees is `discovery.timing.spec.ts`.
    const started = performance.now();

    await new DiscoveryService(repositoryDouble(true)).discover(body("acme.ouroboros.dev"));

    // Two milliseconds of slack for the event loop's own timer resolution, which is far
    // below the difference the floor exists to hide.
    expect(performance.now() - started).toBeGreaterThan(DISCOVERY_FLOOR_MS - 2);
  });

  it("takes it for a domain nobody holds too", async () => {
    const started = performance.now();

    await new DiscoveryService(repositoryDouble(false)).discover(body("nobody.example"));

    expect(performance.now() - started).toBeGreaterThan(DISCOVERY_FLOOR_MS - 2);
  });

  it("passes the domain on exactly as the DTO normalised it", async () => {
    // The service does not normalise, and must not: doing it twice is how two rules drift
    // apart. What arrives is what `discovery.dto.ts` produced.
    const domains = repositoryDouble(false);

    await new DiscoveryService(domains).discover(body("acme.ouroboros.dev"));

    expect(domains.exists).toHaveBeenCalledWith("acme.ouroboros.dev");
  });
});

describe("the message", () => {
  it("is the one the login page already shows beside the disabled button", () => {
    // `ouroboros-ui`'s `SSO_UNAVAILABLE`, word for word. #718 replaces its hard-coded copy
    // with this field, and two different apologies for the same thing would be visible to
    // anybody who typed a domain.
    expect(NO_SSO_MESSAGE).toBe(
      "Enterprise SSO is not configured yet — sign in with GitHub for now.",
    );
  });

  it("tells a person what to do instead", () => {
    expect(NO_SSO_MESSAGE).toContain("GitHub");
  });
});
