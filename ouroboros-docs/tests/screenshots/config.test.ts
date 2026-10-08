import { describe, expect, it } from "vitest";

import config from "../../screenshots/playwright.config.ts";
import { BASE_URL } from "../../screenshots/settings.ts";

describe("screenshots/playwright.config.ts", () => {
  it("has one Chromium project per theme, named for it", () => {
    expect(config.projects?.map((project) => [project.name, project.use?.colorScheme])).toEqual([
      ["light", "light"],
      ["dark", "dark"],
    ]);
    expect(config.use?.browserName).toBe("chromium");
  });

  it("captures at 1440×900 and device scale 2", () => {
    expect(config.use?.viewport).toEqual({ width: 1440, height: 900 });
    expect(config.use?.deviceScaleFactor).toBe(2);
  });

  it("runs one capture at a time, never retrying", () => {
    expect(config.workers).toBe(1);
    expect(config.fullyParallel).toBe(false);
    expect(config.retries).toBe(0);
  });

  it("signs in once and reuses the session", () => {
    expect(config.globalSetup).toBe("./global-setup.ts");
    expect(config.use?.storageState).toMatch(/screenshots\/\.auth\/state\.json$/);
  });

  it("points at the app OURO_DOCS_CAPTURE_BASE_URL names, localhost:3000 by default", () => {
    expect(config.use?.baseURL).toBe(BASE_URL);
    if (!process.env.OURO_DOCS_CAPTURE_BASE_URL) expect(BASE_URL).toBe("http://localhost:3000");
  });

  it("pins the locale and time zone, so dates render the same on every machine", () => {
    expect(config.use).toMatchObject({ locale: "en-US", timezoneId: "UTC" });
  });
});
