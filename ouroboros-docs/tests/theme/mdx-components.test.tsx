// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import EnvVar from "../../src/components/EnvVar";
import Screenshot from "../../src/components/Screenshot";
import SectionCards from "../../src/components/SectionCards";
import Since from "../../src/components/Since";
import UiPath from "../../src/components/UiPath";
// Docusaurus' own map is tests/support/MDXComponents.ts here (vitest.config.mts aliases it).

import components from "../../src/theme/MDXComponents";

describe("MDXComponents", () => {
  it("offers the shared components to every page without an import", () => {
    expect(components).toMatchObject({ EnvVar, Screenshot, SectionCards, Since, UiPath });
  });

  it("keeps Docusaurus' own components", () => {
    expect(components).toMatchObject({ h1: "h1", code: "code" });
  });
});
