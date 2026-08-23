import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import { ALLOW_ANONYMOUS } from "../auth/anonymous";
import { CredentialsController } from "./credentials.controller";
import { INTERNAL_ONLY } from "./internal.decorators";
import { CREDENTIALS_PATH, LEASE_ROUTE } from "./internal.paths";
import { LEASE_TTL_SECONDS, type Lease, type LeaseService } from "./lease";

/**
 * The route, which is thin — so what is asserted is the four things a controller can get
 * wrong on its own.
 *
 * The policy is `lease.spec.ts`'s and the shape is `lease.resources.spec.ts`'s. What only
 * this file can check is that the handler hands the request through unchanged, that it
 * publishes the *resource* rather than the internal record, that it answers `200` rather than
 * Nest's default `201` for a `POST`, and that it carries the three decorators the boundary
 * depends on — because a missing `@InternalOnly()` is an unauthenticated internal endpoint,
 * and a missing `@AllowAnonymous()` is a route the session guard refuses before its own guard
 * ever runs.
 */

const RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

/** A lease, as the service would grant one. */
const LEASE: Lease = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  provider: "ollama",
  run: RUN,
  organizationId: "aBcD1234eFgH5678iJkL9012mNoP3456",
  baseUrl: "http://localhost:11434",
  grantedAt: new Date("2026-08-22T18:04:11.000Z"),
  expiresAt: new Date("2026-08-22T18:19:11.000Z"),
  ttlSeconds: LEASE_TTL_SECONDS,
};

describe("the handler", () => {
  it("passes the request through unchanged", async () => {
    // A controller that reinterpreted the body — defaulted a provider, coerced a run — would
    // be a second place the request means something, and the policy would be applied to a
    // request the caller did not send.
    const grant = jest.fn(() => Promise.resolve(LEASE));
    const controller = new CredentialsController({ grant } as unknown as LeaseService);

    await controller.lease({ provider: "ollama", run: RUN });

    expect(grant).toHaveBeenCalledWith({ provider: "ollama", run: RUN });
  });

  it("answers with the resource, not the internal record", async () => {
    const controller = new CredentialsController({
      grant: () => Promise.resolve(LEASE),
    } as unknown as LeaseService);

    const answer = await controller.lease({ provider: "ollama", run: RUN });

    expect(answer.grantedAt).toBe("2026-08-22T18:04:11.000Z");
    expect(answer.baseUrl).toBe("http://localhost:11434");
  });

  it("lets a refusal travel, rather than turning it into an answer", async () => {
    // A `403` the controller swallowed into a `200 {granted: false}` would be a refusal a
    // client's success path handles.
    const controller = new CredentialsController({
      grant: () => Promise.reject(new Error("refused")),
    } as unknown as LeaseService);

    await expect(controller.lease({ provider: "anthropic", run: RUN })).rejects.toThrow("refused");
  });
});

describe("how the route is declared", () => {
  it("sits at the path the engine calls", () => {
    expect(Reflect.getMetadata(PATH_METADATA, CredentialsController)).toBe(CREDENTIALS_PATH);
    expect(Reflect.getMetadata(PATH_METADATA, CredentialsController.prototype.lease)).toBe(
      LEASE_ROUTE,
    );
  });

  it("is a POST", () => {
    // Nest's `RequestMethod.POST` is 1.
    expect(Reflect.getMetadata(METHOD_METADATA, CredentialsController.prototype.lease)).toBe(1);
  });

  it("answers 200, because nothing was created", () => {
    // Nest's default for a `POST` is `201 Created`, which would be a promise about a
    // resource that now exists at a URL. Nothing stores a lease and there is nothing to
    // `GET` afterwards.
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, CredentialsController.prototype.lease)).toBe(
      HttpStatus.OK,
    );
  });

  it("is marked internal, which is what the guard reads", () => {
    expect(Reflect.getMetadata(INTERNAL_ONLY, CredentialsController)).toBe(true);
  });

  it("is exempt from the session, because its caller cannot hold one", () => {
    // Not the same as public: `internal.guard.spec.ts` is what refuses a caller without the
    // key, and `guard.surface.spec.ts` asserts this route is in neither the public list nor
    // the protected one.
    expect(Reflect.getMetadata(ALLOW_ANONYMOUS, CredentialsController)).toBe(true);
  });

  it("declares exactly one handler", () => {
    // Restraint, asserted. A second route here would be a second thing a worker can ask the
    // control plane for, and the whole argument of this module is that there is one.
    const handlers = Object.getOwnPropertyNames(CredentialsController.prototype).filter(
      (name) =>
        name !== "constructor" &&
        Reflect.getMetadata(METHOD_METADATA, CredentialsController.prototype[name as "lease"]) !==
          undefined,
    );

    expect(handlers).toEqual(["lease"]);
  });

  it("sits under the segment the specification names", () => {
    expect(CREDENTIALS_PATH).toBe("internal/credentials");
  });
});
