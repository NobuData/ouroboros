import { HttpStatus } from "@nestjs/common";

import { INTERNAL_ERRORS } from "./internal.errors";
import type { InternalRepository } from "./internal.repository";
import { LEASE_TTL_SECONDS, LeaseService } from "./lease";
import type { LeaseAudit, LeaseGrantedEvent } from "./lease.audit";
import type { LocalProviders } from "./local.providers";
import { CLOUD_PROVIDER_KINDS, LOCAL_PROVIDER_KINDS, type ProviderKind } from "./providers";

/**
 * **The policy** — decision **P3**, and the suite [#224](https://github.com/NobuData/ouroboros/issues/224)'s
 * second acceptance criterion asks for by name: *a lease for a cloud provider returns 403 by
 * policy, tested for each cloud adapter kind.* It is run once per kind rather than on a
 * representative one, because "we tested Anthropic" is exactly how Copilot ends up leasable.
 *
 * Three other properties are asserted here because this is the only layer that can:
 *
 *   * **The refusal is unconditional.** A cloud kind is refused with the address of every
 *     provider in the world configured and the run in front of it — so no state and no
 *     configuration produces a grant.
 *   * **The order of the checks.** Policy, then the deployment, then the run. Asserted
 *     through what was *not* called: a refused cloud lease must not reach the database, or
 *     the policy would be one query away from depending on data.
 *   * **Exactly one audit event per grant, and none per refusal.**
 */

const RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";
const WORKSPACE = "aBcD1234eFgH5678iJkL9012mNoP3456";
const OLLAMA = "http://localhost:11434";

/** What a test built. */
interface Harness {
  readonly leases: LeaseService;
  readonly addressOf: jest.Mock<string | undefined, [string]>;
  readonly organizationOfRun: jest.Mock<Promise<string | undefined>, [string]>;
  readonly granted: jest.Mock<void, [LeaseGrantedEvent]>;
}

/**
 * A lease service over stubs.
 *
 * @param options - What the deployment declares, and whether the run exists.
 * @returns The service and the three doubles, so a test can assert on what was *not* asked.
 */
function harness(
  options: { addresses?: Partial<Record<string, string>>; run?: string } = {},
): Harness {
  const addresses = options.addresses ?? { ollama: OLLAMA };
  const addressOf = jest.fn((kind: string) => addresses[kind]);
  const organizationOfRun = jest.fn((_run: string) =>
    Promise.resolve(options.run === undefined ? WORKSPACE : options.run || undefined),
  );
  const granted = jest.fn((_event: LeaseGrantedEvent) => {});

  return {
    leases: new LeaseService(
      { addressOf } as unknown as LocalProviders,
      { organizationOfRun } as unknown as InternalRepository,
      { granted } as unknown as LeaseAudit,
    ),
    addressOf,
    organizationOfRun,
    granted,
  };
}

describe("a cloud provider", () => {
  it.each([...CLOUD_PROVIDER_KINDS])("is refused with 403 by policy: %s", async (provider) => {
    const { leases } = harness();

    await expect(leases.grant({ provider, run: RUN })).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      code: INTERNAL_ERRORS.providerNotLeasable,
    });
  });

  it.each([...CLOUD_PROVIDER_KINDS])(
    "is refused even where the deployment declares an address for it: %s",
    async (provider) => {
      // The half that makes it *policy* rather than configuration. An operator cannot
      // configure their way into leasing a cloud provider — and `configuration.spec.ts`
      // asserts the other half, that a process given such a variable refuses to start.
      const { leases } = harness({
        addresses: { ollama: OLLAMA, [provider]: "https://api.example.invalid" },
      });

      await expect(leases.grant({ provider, run: RUN })).rejects.toMatchObject({
        code: INTERNAL_ERRORS.providerNotLeasable,
      });
    },
  );

  it("is refused before anything is looked up", async () => {
    // The order, asserted through absence: a refusal that had first asked the database
    // whether the run exists would be a policy one query away from depending on data — and
    // one that leaked *this run does not exist* to a caller whose request was never going to
    // be granted.
    const { leases, addressOf, organizationOfRun } = harness();

    await expect(leases.grant({ provider: "anthropic", run: RUN })).rejects.toThrow();

    expect(addressOf).not.toHaveBeenCalled();
    expect(organizationOfRun).not.toHaveBeenCalled();
  });

  it("writes no audit event", async () => {
    const { leases, granted } = harness();

    await expect(leases.grant({ provider: "cursor", run: RUN })).rejects.toThrow();

    expect(granted).not.toHaveBeenCalled();
  });
});

describe("a leasable provider this deployment has not declared", () => {
  it.each([...LOCAL_PROVIDER_KINDS])("answers 404 naming the kind: %s", async (provider) => {
    const { leases } = harness({ addresses: {} });

    await expect(leases.grant({ provider, run: RUN })).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      code: INTERNAL_ERRORS.localProviderNotConfigured,
    });
  });

  it("does not reach the database", async () => {
    // Cheapest first, and it is also the right answer: a caller that named a provider this
    // installation does not have has a problem the run cannot fix.
    const { leases, organizationOfRun } = harness({ addresses: {} });

    await expect(leases.grant({ provider: "ollama", run: RUN })).rejects.toThrow();

    expect(organizationOfRun).not.toHaveBeenCalled();
  });
});

describe("a run that does not exist", () => {
  it("answers 404", async () => {
    const { leases } = harness({ run: "" });

    await expect(leases.grant({ provider: "ollama", run: RUN })).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      code: INTERNAL_ERRORS.runNotFound,
    });
  });

  it("writes no audit event", async () => {
    const { leases, granted } = harness({ run: "" });

    await expect(leases.grant({ provider: "ollama", run: RUN })).rejects.toThrow();

    expect(granted).not.toHaveBeenCalled();
  });
});

describe("a granted lease", () => {
  it("carries the address the deployment declared", async () => {
    const { leases } = harness();

    await expect(leases.grant({ provider: "ollama", run: RUN })).resolves.toMatchObject({
      provider: "ollama",
      run: RUN,
      baseUrl: OLLAMA,
    });
  });

  it("is scoped to the workspace the run belongs to, not to one the caller named", async () => {
    // The whole of *scoped*: a worker naming its own workspace would be a worker choosing
    // which one to be audited against. The request carries no workspace at all, and this is
    // what proves the answer came from the run.
    const { leases, organizationOfRun } = harness();

    const lease = await leases.grant({ provider: "ollama", run: RUN });

    expect(organizationOfRun).toHaveBeenCalledWith(RUN);
    expect(lease.organizationId).toBe(WORKSPACE);
  });

  it("expires fifteen minutes after it was granted", async () => {
    const { leases } = harness();

    const lease = await leases.grant({ provider: "ollama", run: RUN });

    expect(lease.ttlSeconds).toBe(LEASE_TTL_SECONDS);
    expect(lease.expiresAt.getTime() - lease.grantedAt.getTime()).toBe(LEASE_TTL_SECONDS * 1000);
  });

  it("is fifteen minutes, as the mockup's own copy says", () => {
    expect(LEASE_TTL_SECONDS).toBe(900);
  });

  it("has an id of its own, and a different one each time", async () => {
    // What ties an answer to its line in the audit trail. Two grants of the same provider
    // for the same run are two events, and a shared id would make them one.
    const { leases } = harness();

    const first = await leases.grant({ provider: "ollama", run: RUN });
    const second = await leases.grant({ provider: "ollama", run: RUN });

    expect(first.id).not.toBe(second.id);
  });

  it("writes exactly one audit event, carrying the lease itself", async () => {
    const { leases, granted } = harness();

    const lease = await leases.grant({ provider: "ollama", run: RUN });

    expect(granted).toHaveBeenCalledTimes(1);
    expect(granted).toHaveBeenCalledWith(expect.objectContaining({ id: lease.id }));
  });

  it("is audited before it is returned", async () => {
    // Synchronously, and before the answer: a grant that reached a worker without leaving a
    // trace is the failure the criterion is about, and an emission scheduled for later is one
    // a crash can lose.
    const { leases, granted } = harness();
    let auditedFirst = false;

    granted.mockImplementation(() => {
      auditedFirst = true;
    });

    await leases.grant({ provider: "ollama", run: RUN });

    expect(auditedFirst).toBe(true);
  });

  it("carries no field that could hold a credential", async () => {
    // The record `lease.ts` builds, not merely the resource that is published from it. A
    // secret placed here would be one `lease.resources.ts` is the only thing stopping.
    const { leases } = harness();

    const lease = await leases.grant({ provider: "ollama", run: RUN });

    for (const key of Object.keys(lease)) {
      expect(key).not.toMatch(/key|token|secret|credential|password/i);
    }
  });
});

describe("the vocabulary the policy is written over", () => {
  it("refuses a kind nobody has classified", async () => {
    // Unreachable through the route — the DTO refuses anything outside the five — and
    // asserted anyway, because the property being protected is *fail closed*: a kind added
    // to the request vocabulary without being classified must not be leasable by default.
    const { leases } = harness();

    await expect(
      leases.grant({ provider: "some_new_vendor" as ProviderKind, run: RUN }),
    ).rejects.toMatchObject({ code: INTERNAL_ERRORS.providerNotLeasable });
  });
});
