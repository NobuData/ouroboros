import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **Sealed, never echoed — grep-tested** (#487 acceptance criterion 8). These checks read the
 * schema and this module's source, so a later change that started returning, logging or storing
 * the signing secret fails here before it reaches a database or a response.
 */

const MIGRATIONS = join(__dirname, "../../../../ouroboros-db/migrations");
const V094 = readFileSync(
  join(MIGRATIONS, "V094__retention_webhooks_notification_routes.sql"),
  "utf8",
);
const V098 = readFileSync(join(MIGRATIONS, "V098__webhook_delivery_pipeline.sql"), "utf8");

/** This module's non-test sources. */
const SOURCES = readdirSync(__dirname)
  .filter((file) => file.endsWith(".ts") && !/(spec|fixture)\.ts$/.test(file))
  .map((file) => ({ file, text: readFileSync(join(__dirname, file), "utf8") }));

/** One source by name. */
const source = (file: string) => SOURCES.find((entry) => entry.file === file)?.text ?? "";

describe("where a webhook signing secret can live", () => {
  it("is stored only as hmac_key_sealed, which V094 holds to an ouro.v1. envelope", () => {
    expect(V094).toMatch(
      /hmac_key_sealed text\s+not null[\s\S]*?check \(hmac_key_sealed like 'ouro\.v1\.%'\)/,
    );
    // V098 adds columns, and none of them can hold a key.
    expect(V098).not.toMatch(/add column\s+(secret|signing|hmac|key)/i);
  });

  it("is never selected by an endpoint reader — only the dispatcher's claim and the ping read it", () => {
    const repository = source("webhooks.repository.ts");
    const columns = /const ENDPOINT_COLUMNS = \[([\s\S]*?)\] as const;/.exec(repository)?.[1] ?? "";

    expect(columns).not.toContain("hmac_key_sealed");
    expect(repository).not.toMatch(
      /selectAll\(\)[^;]*webhook_endpoints|webhook_endpoints[^;]*selectAll\(\)/,
    );
    expect([...repository.matchAll(/select\([^)]*"hmac_key_sealed"/g)]).toHaveLength(2);
  });

  it("appears in a response only as the create and rotate answers' secret field", () => {
    const service = source("webhooks.service.ts");
    const returned = [...service.matchAll(/return \{ endpoint: [^}]*, secret \}/g)];

    expect(returned).toHaveLength(2);
    // The resources never name the envelope.
    expect(source("webhooks.resources.ts")).not.toContain("hmac_key_sealed");
  });

  it("cannot reach an error: no refusal takes a secret", () => {
    const errors = source("webhooks.errors.ts");

    expect(errors).not.toMatch(/secret: string|sealed/);
  });

  it("is never logged from this module", () => {
    for (const { file, text } of SOURCES) {
      if (file === "webhook.scheduler.ts") {
        // The loop logs only that a tick failed, through describeForLog.
        expect(text).not.toMatch(/console\.(log|error|warn|info|debug)|\.log\(/);
        continue;
      }
      expect(text).not.toMatch(/console\.(log|error|warn|info|debug)|Logger|\.log\(/);
    }
  });

  it("has no request field to arrive in", () => {
    expect(source("webhooks.dto.ts")).not.toMatch(/^\s+(secret|hmacKey|signingSecret)[?!]?:/m);
  });
});
