import { cruiseFixture } from "../../testing/depcruise.fixture";

/**
 * BV.1's last acceptance criterion, as a lint rule: *"no corpus data leaves the tenant — dispatch
 * targets the local engine only (asserted, and documented in the security model)"*
 * ([#510](https://github.com/NobuData/ouroboros/issues/510); `docs/SECURITY_MODEL.md` § 6.6).
 *
 * The orchestrator's suite asserts the corpus goes to `EngineClient` and the client's suite that
 * `EngineClient` sends it to `OURO_ENGINE_URL` and nowhere else. This is the third leg: the
 * analyzer module cannot grow a second way out. Each case builds a tree with exactly the violation
 * it names and cruises it with the service's real `.dependency-cruiser.cjs`; a rule nobody has
 * watched fail is a rule that passes everything.
 */

const RULE = "analyzer-corpus-stays-on-tenant";

describe("the analyzer's network boundary", () => {
  it.each([
    ["node:https", 'import { request } from "node:https";\nexport const a = request;\n'],
    ["http", 'import { request } from "http";\nexport const a = request;\n'],
    ["node:net", 'import { connect } from "node:net";\nexport const a = connect;\n'],
  ])("fails the build on the analyzer importing %s", (_name, source) => {
    const result = cruiseFixture({ "src/modules/analyzer/corpus/exfiltrate.ts": source });

    expect(result.output).toContain(RULE);
    expect(result.exitCode).not.toBe(0);
  });

  it("fails the build on the analyzer reaching for another module's outbound client", () => {
    const result = cruiseFixture({
      "src/modules/mail/mailer.ts": "export const mailer = {};\n",
      "src/modules/analyzer/analysis.export.ts":
        'import { mailer } from "../mail/mailer";\nexport const a = mailer;\n',
    });

    expect(result.output).toContain(RULE);
    expect(result.exitCode).not.toBe(0);
  });

  it("allows the engine client, which is the one way out", () => {
    const result = cruiseFixture({
      "src/modules/engine/engine.client.ts": "export class EngineClient {}\n",
      "src/modules/analyzer/analysis.orchestrator.ts":
        'import { EngineClient } from "../engine/engine.client";\nexport const a = EngineClient;\n',
    });

    expect(result.output).not.toContain(RULE);
    expect(result.exitCode).toBe(0);
  });
});
