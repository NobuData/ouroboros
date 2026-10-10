import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  MAX_COMMAND,
  MAX_POOL_NAME,
  MAX_SUITES,
  MAX_SUITE_NAME,
  ReplayEstimateDto,
} from "./replay.dto";

/**
 * The body's properties that fail validation, as the global pipe would find them.
 *
 * @param body - The request body.
 * @returns The failing properties.
 */
async function failures(body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(ReplayEstimateDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errors.map((error) => error.property);
}

describe("the replay estimate request", () => {
  it("accepts the seeded draft's build stage — a pool and nothing else", async () => {
    expect(await failures({ kind: "build", runnerPool: "pool-a" })).toEqual([]);
  });

  it("accepts a build stage with its own command", async () => {
    expect(
      await failures({
        kind: "build",
        runnerPool: "pool-a",
        command: "west build -b helios_mainboard app",
      }),
    ).toEqual([]);
  });

  it("accepts a test stage with and without a suite set", async () => {
    expect(await failures({ kind: "test" })).toEqual([]);
    expect(
      await failures({ kind: "test", suites: ["unit · drivers", "PHYSICAL · HIL rig"] }),
    ).toEqual([]);
  });

  it.each([undefined, "deploy", "", 1])("refuses a kind of %p", async (kind) => {
    expect(await failures({ kind, runnerPool: "pool-a" })).toEqual(["kind"]);
  });

  it("refuses an empty or oversized pool name and command", async () => {
    expect(await failures({ kind: "build", runnerPool: "" })).toEqual(["runnerPool"]);
    expect(await failures({ kind: "build", runnerPool: "p".repeat(MAX_POOL_NAME + 1) })).toEqual([
      "runnerPool",
    ]);
    expect(await failures({ kind: "build", runnerPool: "pool-a", command: "" })).toEqual([
      "command",
    ]);
    expect(
      await failures({ kind: "build", runnerPool: "pool-a", command: "x".repeat(MAX_COMMAND + 1) }),
    ).toEqual(["command"]);
    expect(
      await failures({ kind: "build", runnerPool: "pool-a", command: "x".repeat(MAX_COMMAND) }),
    ).toEqual([]);
  });

  it("refuses a suite set that is empty, too large, or holds a blank or non-text name", async () => {
    expect(await failures({ kind: "test", suites: [] })).toEqual(["suites"]);
    expect(await failures({ kind: "test", suites: "unit" })).toEqual(["suites"]);
    expect(await failures({ kind: "test", suites: ["unit", ""] })).toEqual(["suites"]);
    expect(await failures({ kind: "test", suites: ["unit", 7] })).toEqual(["suites"]);
    expect(await failures({ kind: "test", suites: ["s".repeat(MAX_SUITE_NAME + 1)] })).toEqual([
      "suites",
    ]);
    expect(
      await failures({
        kind: "test",
        suites: Array.from({ length: MAX_SUITES + 1 }, (_, n) => `suite-${String(n)}`),
      }),
    ).toEqual(["suites"]);
  });

  it("refuses a workspace or repository in the body — both are the dry run's, never the caller's", async () => {
    expect(await failures({ kind: "build", runnerPool: "pool-a", organizationId: "org" })).toEqual([
      "organizationId",
    ]);
    expect(
      await failures({ kind: "build", runnerPool: "pool-a", repository: "acme/helios" }),
    ).toEqual(["repository"]);
  });
});
