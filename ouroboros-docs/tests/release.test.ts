import { describe, expect, it } from "vitest";
import type * as Preset from "@docusaurus/preset-classic";

import { RELEASE } from "../site.constants";

describe("the release the site names", () => {
  it("is RC1", () => {
    expect(RELEASE).toBe("RC1");
  });

  it("closes the navbar on every page, and is exposed to the pages", async () => {
    const { default: config } = await import("../docusaurus.config");
    const items = (config.themeConfig as Preset.ThemeConfig).navbar?.items ?? [];
    expect(items.at(-1)).toMatchObject({ type: "html", position: "right" });
    expect(String(items.at(-1)?.value)).toContain(`>${RELEASE}<`);
    expect(config.customFields?.release).toBe(RELEASE);
  });
});
