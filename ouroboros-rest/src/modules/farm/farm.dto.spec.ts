import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { validationPipe } from "../errors/validation";

import {
  MintEnrollmentTokenDto,
  RegisterRunnerDto,
  RenewCertificateDto,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
  RUNNER_ARCHITECTURES,
} from "./farm.dto";
import { MAX_TOKEN_USES } from "./farm.policy";
import { MAX_REQUEST_BYTES } from "./x509/csr";
import { certificationRequest } from "./farm.fixture";
import { document } from "../../openapi/specification";

/**
 * What a body may contain — and, for the registration, what an unauthenticated caller may
 * make this service spend effort on before anything has authenticated it.
 *
 * Every bound here restates a rule the schema also keeps. That is deliberate: the schema is
 * the guarantee, and these are what turn a violation into a `422` naming the field instead of
 * a `500` naming a constraint.
 */

/**
 * Validate a body.
 *
 * @param dto - The class.
 * @param body - The plain object.
 * @returns The property names that failed.
 */
function failures<T extends object>(dto: new () => T, body: unknown): string[] {
  return validateSync(plainToInstance(dto, body)).map((error) => error.property);
}

/**
 * Put a body through the service's own pipe, which is what a handler actually receives.
 *
 * `plainToInstance` alone keeps whatever the client sent; the pipe is configured
 * `forbidNonWhitelisted`, so a field the DTO does not declare is a refusal rather than a
 * property nobody reads — see `errors/validation.ts`.
 *
 * @param dto - The class.
 * @param body - The plain object.
 * @returns What the handler would see.
 */
async function throughPipe<T extends object>(dto: new () => T, body: unknown): Promise<T> {
  return (await validationPipe().transform(body, {
    type: "body",
    metatype: dto,
  })) as T;
}

describe("a mint request", () => {
  it("requires a pool, which is the whole of what scoped means", () => {
    expect(failures(MintEnrollmentTokenDto, {})).toEqual(["pool"]);
  });

  it("requires the pool to be the slug the schema stores", () => {
    expect(failures(MintEnrollmentTokenDto, { pool: "Pool A" })).toEqual(["pool"]);
    expect(failures(MintEnrollmentTokenDto, { pool: "-leading" })).toEqual(["pool"]);
    expect(failures(MintEnrollmentTokenDto, { pool: "pool-a" })).toEqual([]);
  });

  it("bounds the TTL at both ends", () => {
    expect(
      failures(MintEnrollmentTokenDto, { pool: "a", ttlSeconds: MIN_TTL_SECONDS - 1 }),
    ).toEqual(["ttlSeconds"]);
    expect(
      failures(MintEnrollmentTokenDto, { pool: "a", ttlSeconds: MAX_TTL_SECONDS + 1 }),
    ).toEqual(["ttlSeconds"]);
    expect(failures(MintEnrollmentTokenDto, { pool: "a", ttlSeconds: MAX_TTL_SECONDS })).toEqual(
      [],
    );
  });

  it("bounds the use count, because an unlimited token is a password", () => {
    expect(failures(MintEnrollmentTokenDto, { pool: "a", maxUses: 0 })).toEqual(["maxUses"]);
    expect(failures(MintEnrollmentTokenDto, { pool: "a", maxUses: MAX_TOKEN_USES + 1 })).toEqual([
      "maxUses",
    ]);
  });
});

describe("a registration", () => {
  const csr = certificationRequest();

  it("HAS NO WORKSPACE FIELD, which is the isolation criterion", async () => {
    // A body that could name a workspace would be a body that could name somebody else's, and
    // the check that this is not happening would then be something a service has to remember.
    // The pipe is `forbidNonWhitelisted`, so trying is a 422 rather than a field nobody reads.
    await expect(
      throughPipe(RegisterRunnerDto, {
        token: "orb_enroll_x",
        name: "forge-01",
        arch: "linux/arm64",
        csr,
        organizationId: "org_somebody_else",
      }),
    ).rejects.toThrow();

    expect(
      Object.keys(
        await throughPipe(RegisterRunnerDto, {
          token: "orb_enroll_x",
          name: "forge-01",
          arch: "linux/arm64",
          csr,
        }),
      ),
    ).not.toContain("organizationId");
  });

  it("requires a token, a name and an architecture", () => {
    expect(failures(RegisterRunnerDto, {}).sort()).toEqual(["arch", "csr", "name", "token"]);
  });

  it("requires the token to look like one", () => {
    expect(
      failures(RegisterRunnerDto, { token: "hunter2", name: "a", arch: "linux/arm64", csr }),
    ).toEqual(["token"]);
  });

  it("requires the name to be the slug V040 stores", () => {
    expect(
      failures(RegisterRunnerDto, {
        token: "orb_enroll_x",
        name: "Forge 01",
        arch: "linux/arm64",
        csr,
      }),
    ).toEqual(["name"]);
  });

  it("accepts the three architectures the agent is built for and nothing else", () => {
    for (const arch of RUNNER_ARCHITECTURES) {
      expect(failures(RegisterRunnerDto, { token: "orb_enroll_x", name: "a", arch, csr })).toEqual(
        [],
      );
    }

    expect(
      failures(RegisterRunnerDto, { token: "orb_enroll_x", name: "a", arch: "windows/amd64", csr }),
    ).toEqual(["arch"]);
  });

  it("requires a certificate request unless the fallback was asked for", () => {
    expect(
      failures(RegisterRunnerDto, { token: "orb_enroll_x", name: "a", arch: "linux/arm64" }),
    ).toEqual(["csr"]);
    expect(
      failures(RegisterRunnerDto, {
        token: "orb_enroll_x",
        name: "a",
        arch: "linux/arm64",
        securityMode: "bearer_fallback",
      }),
    ).toEqual([]);
  });

  it("caps the certificate request, which bounds the parsing an unauthenticated caller buys", () => {
    expect(
      failures(RegisterRunnerDto, {
        token: "orb_enroll_x",
        name: "a",
        arch: "linux/arm64",
        csr: "x".repeat(MAX_REQUEST_BYTES + 1),
      }),
    ).toEqual(["csr"]);
  });

  it("bounds the capability numbers it will carry into a jsonb column", () => {
    // V040's `farm_capabilities_valid` refuses a `cpu_count` below one; restating it here is
    // what makes that a 422 rather than a 500.
    expect(
      failures(RegisterRunnerDto, {
        token: "orb_enroll_x",
        name: "a",
        arch: "linux/arm64",
        csr,
        cpuCount: 0,
      }),
    ).toEqual(["cpuCount"]);
    expect(
      failures(RegisterRunnerDto, {
        token: "orb_enroll_x",
        name: "a",
        arch: "linux/arm64",
        csr,
        docker: "yes",
      }),
    ).toEqual(["docker"]);
  });
});

describe("a renewal", () => {
  it("HAS NO TOKEN FIELD — the identity is the client certificate", async () => {
    // A renewal therefore cannot be performed by anything holding only a token.
    await expect(
      throughPipe(RenewCertificateDto, { csr: "x", token: "orb_enroll_x" }),
    ).rejects.toThrow();

    expect(Object.keys(await throughPipe(RenewCertificateDto, { csr: "x" }))).toEqual(["csr"]);
  });

  it("requires a certificate request", () => {
    expect(failures(RenewCertificateDto, {})).toEqual(["csr"]);
  });
});

describe("the contract and these classes", () => {
  /** The published request schemas, so a bound cannot drift from what a client was promised. */
  const schemas = document().components?.schemas ?? {};

  it("publishes the same architecture list", () => {
    expect(
      (schemas.RegisterRunnerRequest as { properties: { arch: { enum: string[] } } }).properties
        .arch.enum,
    ).toEqual([...RUNNER_ARCHITECTURES]);
  });

  it("publishes the same TTL bounds", () => {
    const ttl = (
      schemas.MintEnrollmentTokenRequest as {
        properties: { ttlSeconds: { minimum: number; maximum: number } };
      }
    ).properties.ttlSeconds;

    expect(ttl.minimum).toBe(MIN_TTL_SECONDS);
    expect(ttl.maximum).toBe(MAX_TTL_SECONDS);
  });

  it("publishes the same use-count ceiling", () => {
    expect(
      (schemas.MintEnrollmentTokenRequest as { properties: { maxUses: { maximum: number } } })
        .properties.maxUses.maximum,
    ).toBe(MAX_TOKEN_USES);
  });

  it("declares no workspace field on a registration", () => {
    const published = schemas.RegisterRunnerRequest as { properties: Record<string, unknown> };

    expect(Object.keys(published.properties)).not.toContain("organizationId");
  });
});
