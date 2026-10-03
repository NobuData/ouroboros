import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { cruiseFixture } from "../../../testing/depcruise.fixture";

/**
 * BV.5's architectural criterion, asserted: *"the analyzer performs no direct writes to farm,
 * workflow or tracker tables — every mutation goes through the owning plane's API"*
 * ([#514](https://github.com/NobuData/ouroboros/issues/514), decision A4).
 *
 * Two legs, because either alone has a hole:
 *
 *   * **module boundaries** — `.dependency-cruiser.cjs`'s
 *     `analyzer-composes-planes-through-their-services` refuses any import of another plane's
 *     repository from the analyzer. Each case plants exactly the violation it names, because a rule
 *     nobody has watched fail is a rule that passes everything;
 *   * **its own SQL** — the analyzer writes with raw `sql` (its tables are not in `db/schema.ts`), so
 *     a write to a farm table would need no import at all. Every write target in the analyzer's
 *     source is collected and held to the analyzer's own tables.
 */

const RULE = "analyzer-composes-planes-through-their-services";

/** The tables the analyzer owns — the only ones it may write. */
const ANALYZER_TABLES = new Set([
  "analysis_runs",
  "analysis_schedules",
  "analysis_findings",
  "analysis_suggestions",
  "analysis_suggestion_findings",
  "analysis_suggestion_applications",
  "suggestion_measurements",
  "analyzer_measurement_policies",
  "analyzer_calibration",
  "analyzer_calibration_history",
]);

/**
 * Every non-test `.ts` file under a directory.
 *
 * @param dir - The directory.
 * @returns Absolute paths.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/(spec|fixture)\.ts$/.test(name) ? [path] : [];
  });
}

/**
 * The tables a source writes — raw SQL and Kysely's builders both.
 *
 * @param text - The source.
 * @returns Table names.
 */
export function writeTargets(text: string): string[] {
  const patterns = [
    /\binsert\s+into\s+(?:ouroboros\.)?"?([a-z_]+)"?/gi,
    /\bupdate\s+(?:ouroboros\.)?"?([a-z_]+)"?\s+(?:as\s+\w+\s+|\w+\s+)?set\b/gi,
    /\bdelete\s+from\s+(?:ouroboros\.)?"?([a-z_]+)"?/gi,
    /\.(?:insertInto|updateTable|deleteFrom)\(\s*"([a-z_]+)"/g,
  ];
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]));
}

describe("the analyzer's plane boundary", () => {
  it.each([
    ["the farm's", "src/modules/farm/config/farm-config.repository.ts", "FarmConfigRepository"],
    ["the workflows'", "src/modules/workflows/workflows.repository.ts", "WorkflowsRepository"],
    ["planning's", "src/modules/planning/planning.repository.ts", "PlanningRepository"],
  ])("fails the build on the analyzer importing %s repository", (_name, path, name) => {
    const target = path.replace(/^src\/modules\//, "../../");
    const result = cruiseFixture({
      [path]: `export class ${name} {}\n`,
      "src/modules/analyzer/actions/shortcut.ts": `import { ${name} } from "${target.replace(/\.ts$/, "")}";\nexport const a = ${name};\n`,
    });

    expect(result.output).toContain(RULE);
    expect(result.exitCode).not.toBe(0);
  });

  it("allows the planes' services, which are the way in", () => {
    const result = cruiseFixture({
      "src/modules/farm/config/pool-windows.service.ts": "export class PoolWindowsService {}\n",
      "src/modules/analyzer/actions/actions.service.ts":
        'import { PoolWindowsService } from "../../farm/config/pool-windows.service";\n' +
        "export const a = PoolWindowsService;\n",
    });

    expect(result.output).not.toContain(RULE);
    expect(result.exitCode).toBe(0);
  });

  it("writes no table but its own anywhere in its source", () => {
    const written = sources(join(__dirname, "..")).flatMap((path) =>
      writeTargets(readFileSync(path, "utf8")).map((table) => ({ path, table })),
    );

    expect(written.length).toBeGreaterThan(0);
    expect(written.filter(({ table }) => !ANALYZER_TABLES.has(table))).toEqual([]);
  });

  it.each([
    ["insert into ouroboros.runner_pool_windows (id) values (1)", ["runner_pool_windows"]],
    ["update ouroboros.workflow_versions set definition = 1", ["workflow_versions"]],
    ["delete from ouroboros.ticket_drafts where", ["ticket_drafts"]],
    ['db.insertInto("farm_job_hooks")', ["farm_job_hooks"]],
  ])("would notice %s", (text, tables) => {
    expect(writeTargets(text)).toEqual(tables);
  });
});
