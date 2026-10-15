import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { CLAIM_INVENTORY, RETIRED_CLAIMS } from "@/app/loop/copy-inventory";

/**
 * DG.3's inventory (#1301) holds: every string it lists is still written where it says, every
 * one has an owner, and the strings DG.3 retired are gone from the whole application.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const APP = join(ROOT, "app");

/**
 * Every source file under `app/`.
 *
 * @param dir Where to start.
 * @returns Absolute paths.
 */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return sources(path);

    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

describe("the loop-copy inventory", () => {
  it.each(CLAIM_INVENTORY.map((entry) => [entry.surface, entry] as const))(
    "%s — its text is where it says",
    (_surface, entry) => {
      expect(readFileSync(join(ROOT, entry.file), "utf8")).toContain(entry.text);
    },
  );

  it("names an owner for every string — none is unowned", () => {
    for (const entry of CLAIM_INVENTORY) {
      expect(Number.isInteger(entry.owner) && entry.owner > 0, entry.text).toBe(true);
    }
  });

  it("leaves to DG.2's report only what DG.3 owns", () => {
    for (const entry of CLAIM_INVENTORY.filter((claim) => claim.handling === "capability")) {
      expect(entry.owner, entry.text).toBe(1301);
      expect(["run-origin", "feature"], entry.text).not.toContain(entry.falsifiedBy);
    }
  });

  it("keys the simulated-run banner to the run, not the deployment", () => {
    const banner = CLAIM_INVENTORY.filter((entry) => entry.file === "app/runs/view.ts");

    expect(banner.length).toBeGreaterThan(0);
    expect(banner.every((entry) => entry.handling === "per-run")).toBe(true);
  });

  it("finds no retired claim anywhere in the application", () => {
    const inventory = join(APP, "loop", "copy-inventory.ts");
    const offenders = sources(APP)
      .filter((path) => path !== inventory)
      .flatMap((path) => {
        const text = readFileSync(path, "utf8");

        return RETIRED_CLAIMS.filter((claim) => text.includes(claim)).map(
          (claim) => `${relative(ROOT, path)}: ${claim}`,
        );
      });

    expect(offenders).toEqual([]);
  });
});
