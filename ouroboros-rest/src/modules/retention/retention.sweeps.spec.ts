import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **No sweep computes its own cutoff any more** (#482's last acceptance criterion), asserted by
 * reading the sweeps' sources for the constants and arithmetic they used to carry. Each sweep
 * must instead ask `RetentionPolicyService` for its class's cutoffs.
 */

const MODULES = join(__dirname, "..");

/** Every file a sweep's cutoff could be derived in, with the class it must ask for. */
const SWEEPS = [
  { files: ["farm/logs/log.retention.ts", "farm/logs/log.repository.ts"], dataClass: "build_logs" },
  {
    files: ["test-results-read/artifact.retention.ts", "test-results-read/results.repository.ts"],
    dataClass: "artifacts",
  },
  {
    files: ["runs/transcript.retention.ts", "runs/transcript.repository.ts"],
    dataClass: "transcripts",
  },
  {
    files: ["audit-plane/audit-purge.sweeper.ts", "audit-plane/audit-purge.repository.ts"],
    dataClass: "audit",
  },
] as const;

/** What a sweep that derived its own cutoff would contain. */
const FORBIDDEN: readonly RegExp[] = [
  /LOG_RETENTION_DAYS/,
  /DEFAULT_ARTIFACT_RETENTION_DAYS/,
  /retentionDays/,
  /\bDAY_MS\b/,
  /86_?400_?000/,
  /interval\s+'\d+\s+days?'/,
  // The old predicates: a sweep that compares the stamped promise instead of the cutoff.
  /retain_until\s*[<>]=?/,
  /"retained_until",\s*"<=?"/,
];

/** A file's source, with comments removed — a comment may describe what was replaced. */
function code(file: string): string {
  return readFileSync(join(MODULES, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the sweeps", () => {
  it.each(SWEEPS.flatMap((sweep) => sweep.files))("%s derives no cutoff of its own", (file) => {
    const source = code(file);

    for (const pattern of FORBIDDEN) {
      expect({ file, pattern: String(pattern), found: pattern.test(source) }).toEqual({
        file,
        pattern: String(pattern),
        found: false,
      });
    }
  });

  it.each(SWEEPS)(
    "the $dataClass sweep asks the policy service for its cutoffs",
    ({ files, dataClass }) => {
      const sweeper = code(files[0]);

      expect(sweeper).toContain(`this.retention.cutoffs("${dataClass}"`);
      expect(sweeper).toContain(`this.retentionSchedule.swept("${dataClass}"`);
    },
  );
});
