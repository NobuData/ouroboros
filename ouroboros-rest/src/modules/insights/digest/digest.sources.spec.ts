import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * #440's second acceptance criterion: *"the digest is assembled from #437/#438 — no bespoke
 * metric queries exist in the digest code"*. Review is one half of that; this is the other.
 *
 * The digest's figures may come from exactly one place: the Insights page payload
 * (`page/`). So no file in this directory may import the layers a metric is computed in, and no
 * statement in it may name a table a metric is stored in or derived from.
 */

const DIRECTORY = __dirname;

/** The production sources of the digest: no specs, no fixtures. */
const SOURCES = readdirSync(DIRECTORY)
  .filter((file) => /\.ts$/.test(file) && !/\.(spec|integration-spec|fixture)\.ts$/.test(file))
  .sort();

/**
 * Where metrics are computed. The digest reads their output through `page/`, never these — bar
 * `rollup.types`, which is where the `Day` type lives and holds no code.
 */
const METRIC_LAYERS =
  /from "\.\.\/(rollup\/(?!rollup\.types")|scoreboard|untouched|calibration|interventions)/;

/** `metrics/` is allowed for two names only: a range type and the clock token. */
const METRICS_IMPORT = /from "\.\.\/metrics\/([\w.]+)"/g;
const ALLOWED_METRICS_MODULES = new Set(["metrics.window", "metrics.service"]);

/** The only tables the digest's statements may touch. */
const DIGEST_TABLES = [
  "insights_digest_subscriptions",
  "insights_digest_schedules",
  "insights_digest_runs",
  "insights_digest_sends",
  "organization",
  "member",
  '"user"',
];

describe("the digest's sources (no bespoke metric queries)", () => {
  it("covers the directory's production files", () => {
    expect(SOURCES).toEqual([
      "digest.assembly.ts",
      "digest.controller.ts",
      "digest.copy.ts",
      "digest.dto.ts",
      "digest.errors.ts",
      "digest.html.ts",
      "digest.pages.ts",
      "digest.render.ts",
      "digest.repository.ts",
      "digest.resources.ts",
      "digest.runner.ts",
      "digest.scheduler.ts",
      "digest.service.ts",
      "digest.text.ts",
      "digest.token.ts",
      "digest.unsubscribe.controller.ts",
    ]);
  });

  it.each(SOURCES)("%s imports no layer a metric is computed in", (file) => {
    const source = readFileSync(join(DIRECTORY, file), "utf8");

    expect(source).not.toMatch(METRIC_LAYERS);

    for (const [, module] of source.matchAll(METRICS_IMPORT)) {
      expect(ALLOWED_METRICS_MODULES).toContain(module);
    }
  });

  it("takes only a type and the clock from the metrics service", () => {
    const fromService = SOURCES.flatMap((file) =>
      [
        ...readFileSync(join(DIRECTORY, file), "utf8").matchAll(
          /import (type )?\{([^}]+)\} from "\.\.\/metrics\/metrics\.service"/g,
        ),
      ].map(([, , names]) => names.trim()),
    );

    expect(new Set(fromService)).toEqual(new Set(["METRICS_CLOCK"]));
  });

  it("issues statements over the digest's own tables and the people it mails, and nothing else", () => {
    const repository = readFileSync(join(DIRECTORY, "digest.repository.ts"), "utf8");
    const tables = new Set(
      [...repository.matchAll(/(?:from|join|into|update)\s+ouroboros\.("?\w+"?)/g)].map(
        ([, table]) => table,
      ),
    );

    expect([...tables].sort()).toEqual([...DIGEST_TABLES].sort());

    // Only the repository talks to the database at all.
    for (const file of SOURCES.filter((name) => name !== "digest.repository.ts")) {
      expect(readFileSync(join(DIRECTORY, file), "utf8")).not.toMatch(
        /from "kysely"|DatabaseService/,
      );
    }
  });
});
