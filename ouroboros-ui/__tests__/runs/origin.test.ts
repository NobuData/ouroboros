import { describe, expect, it } from "vitest";

import { BUILD_FARM_PATH, DASHBOARD_PATH, ISSUES_PATH, WORKFLOWS_PATH } from "@/app/paths";
import {
  BUILD_FARM_ORIGIN,
  DASHBOARD_ORIGIN,
  ISSUES_ORIGIN,
  WORKFLOWS_ORIGIN,
  runOrigin,
} from "@/app/runs/origin";

/** Where a run console was opened from (#309) — an allow-list read out of `?from=`. */

describe("runOrigin", () => {
  it("names each module that links to the console", () => {
    expect(runOrigin("dashboard")).toBe(DASHBOARD_ORIGIN);
    expect(runOrigin("build-farm")).toBe(BUILD_FARM_ORIGIN);
    expect(runOrigin("issues")).toBe(ISSUES_ORIGIN);
    expect(runOrigin("workflows")).toBe(WORKFLOWS_ORIGIN);
  });

  it("leads each back to its own route", () => {
    expect(DASHBOARD_ORIGIN.route).toBe(DASHBOARD_PATH);
    expect(BUILD_FARM_ORIGIN.route).toBe(BUILD_FARM_PATH);
    expect(ISSUES_ORIGIN.route).toBe(ISSUES_PATH);
    expect(WORKFLOWS_ORIGIN.route).toBe(WORKFLOWS_PATH);
  });

  it("falls back to the dashboard for nothing, or for anything it does not know", () => {
    expect(runOrigin(undefined)).toBe(DASHBOARD_ORIGIN);
    expect(runOrigin("")).toBe(DASHBOARD_ORIGIN);
    expect(runOrigin("settings")).toBe(DASHBOARD_ORIGIN);
    expect(runOrigin("https://evil.test")).toBe(DASHBOARD_ORIGIN);
    expect(runOrigin("__proto__")).toBe(DASHBOARD_ORIGIN);
  });

  it("reads the first of a repeated parameter", () => {
    expect(runOrigin(["build-farm", "issues"])).toBe(BUILD_FARM_ORIGIN);
    expect(runOrigin([])).toBe(DASHBOARD_ORIGIN);
  });
});
