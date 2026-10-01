import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No charting library in the bundle (#442, decision **I4**).
 *
 * The Insights charts are hand-written SVG and CSS on purpose; a library would bring bundle
 * weight, a theming fight with the tokens and a dependency to track, for interaction depth the
 * page does not want. Held in two places: the manifest, so nobody *adds* one, and the build
 * output, so nothing pulls one in transitively. The second half runs wherever a production
 * build exists (`yarn build` before `yarn test`, as CI does) and is skipped where none does.
 */

const ROOT = join(import.meta.dirname, "..", "..");

/** Package names that are charting libraries, or the core of one. */
const CHART_LIBRARIES: readonly string[] = [
  "recharts",
  "chart.js",
  "react-chartjs-2",
  "d3",
  "victory",
  "@nivo/core",
  "@visx/visx",
  "echarts",
  "echarts-for-react",
  "highcharts",
  "plotly.js",
  "react-plotly.js",
  "apexcharts",
  "react-apexcharts",
  "@mui/x-charts",
  "@tremor/react",
  "uplot",
  "lightweight-charts",
  "vega",
];

/** Package-name prefixes that are families of charting packages. */
const CHART_FAMILIES: readonly string[] = ["d3-", "@nivo/", "@visx/", "victory-", "vega-"];

/**
 * Whether a package name is a charting library.
 *
 * @param name The package name.
 * @returns `true` for a listed library or a member of a listed family.
 */
function isChartLibrary(name: string): boolean {
  return CHART_LIBRARIES.includes(name) || CHART_FAMILIES.some((prefix) => name.startsWith(prefix));
}

/**
 * Every file under a directory, recursively.
 *
 * @param dir The directory.
 * @returns Absolute paths.
 */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("the manifest", () => {
  it("depends on no charting library", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    expect(names.filter(isChartLibrary)).toEqual([]);
  });

  it("recognises the libraries it is guarding against", () => {
    // Without this the check above would pass just as well on a predicate that matched nothing.
    expect(isChartLibrary("recharts")).toBe(true);
    expect(isChartLibrary("d3-shape")).toBe(true);
    expect(isChartLibrary("@nivo/line")).toBe(true);
    expect(isChartLibrary("react")).toBe(false);
  });
});

const CHUNKS = join(ROOT, ".next", "static", "chunks");

describe("the build output", () => {
  it.skipIf(!existsSync(CHUNKS))("ships no charting library's code to the browser", () => {
    // Each of these strings is a fingerprint of a library's runtime that survives
    // minification: a package path webpack/turbopack records, or a name the library sets on
    // itself.
    const fingerprints = [
      /node_modules[\\/](?:recharts|chart\.js|d3-[\w-]+|victory[\w-]*|echarts|highcharts|plotly\.js|apexcharts|@nivo|@visx|uplot|vega)[\\/]/,
      /recharts-wrapper/,
      /\bChart\.register\(/,
      /\bHighcharts\b/,
      /\bApexCharts\b/,
      /\bPlotly\.newPlot\b/,
    ];

    for (const file of files(CHUNKS).filter((name) => name.endsWith(".js"))) {
      const source = readFileSync(file, "utf8");

      for (const fingerprint of fingerprints) {
        expect(fingerprint.test(source), `${file} matches ${fingerprint}`).toBe(false);
      }
    }
  });
});
