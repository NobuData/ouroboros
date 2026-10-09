/**
 * `EngineClient.code()` — the code & git mining tool's engine calls (#617): an answer parsed into
 * this service's names, a `code_*` refusal returned rather than thrown, everything else
 * `engine_unavailable`.
 */

import { Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import { BLAME_WIRE } from "../research/tools/adapters/code/code.recordings.fixture";
import { blameSchema } from "./engine.code.contract";
import { EngineClient } from "./engine.client";
import { ENGINE_ERRORS } from "./engine.errors";
import { alwaysAnswering, engineError, type FakeFetch } from "./engine.fixture";

const ENGINE_URL = "http://engine-7f4c.svc.cluster.local:8000";

function clientWith(fetchImpl: FakeFetch): EngineClient {
  const configuration = testConfiguration({
    OURO_ENGINE_URL: ENGINE_URL,
    OURO_ENGINE_SHARED_SECRET: "a-shared-secret-nobody-should-see",
  });
  const config = new AppConfigService({
    get: (key: string) => configuration[key as keyof typeof configuration],
    getOrThrow: (key: string) => configuration[key as keyof typeof configuration],
  } as never);
  return new EngineClient(config, fetchImpl);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BODY = {
  repository: { workspace: "w", slug: "a/b", remote: "https://x/a/b.git", token: "t" },
};

describe("the engine client's code calls", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("posts to /v0/code/<op> with its deadline and parses the answer into camelCase", async () => {
    const engine = alwaysAnswering(() => json(200, BLAME_WIRE));

    const answer = await clientWith(engine).code("blame", BODY, blameSchema, 120_000);

    expect(engine.calls[0]?.url).toBe(`${ENGINE_URL}/v0/code/blame`);
    expect(engine.calls[0]?.method).toBe("POST");
    expect(JSON.parse(engine.calls[0]?.body ?? "{}")).toEqual(BODY);
    expect(answer.ok && answer.data.lastChange.summary).toBe("Tune approach controller gains");
    expect(answer.ok && answer.data.unchanged.phrase).toBe("unchanged in 14 months");
  });

  it.each([
    [404, "code_ref_not_found"],
    [409, "code_not_ancestor"],
    [422, "code_range_outside_file"],
    [502, "code_remote_auth"],
  ])("returns a %i %s refusal rather than throwing it", async (status, code) => {
    const engine = alwaysAnswering(() => json(status, { code, message: "said so", details: {} }));

    expect(await clientWith(engine).code("blame", BODY, blameSchema, 1000)).toEqual({
      ok: false,
      refusal: { status, code, message: "said so" },
    });
  });

  it.each([
    ["a 401", () => engineError(401)],
    [
      "a validation failure",
      () => json(422, { code: "validation_failed", message: "m", details: {} }),
    ],
    ["a 500", () => json(500, { code: "internal_error", message: "m", details: {} })],
    ["an answer outside the contract", () => json(200, { sha: "nope" })],
  ])("answers engine_unavailable for %s", async (_label, response) => {
    await expect(
      clientWith(alwaysAnswering(response)).code("blame", BODY, blameSchema, 1000),
    ).rejects.toMatchObject({ code: ENGINE_ERRORS.unavailable });
  });
});
