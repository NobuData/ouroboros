// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MERMAID_TOKEN_MAP,
  MERMAID_TOKENS,
  brandMermaidConfig,
  brandThemeVariables,
} from "../../src/theme/Mermaid/brandTheme";

// The theme's hook reads Docusaurus' site config; the test hands it the config the site
// declares (`themeConfig.mermaid`), as Docusaurus would in light mode.
vi.mock("@docusaurus/theme-mermaid/client", () => {
  const base = { startOnLoad: false, theme: "base" };
  return { useMermaidConfig: () => base };
});

const { useBrandMermaidConfig } = await import("../../src/theme/Mermaid/useBrandMermaidConfig");

/** Every custom property the synced token sheet defines. */
const TOKENS = new Set(
  [
    ...readFileSync(join(__dirname, "../../src/css/tokens.css"), "utf8").matchAll(
      /(--[\w-]+)\s*:/g,
    ),
  ].map((match) => match[1]),
);

/** A token reader that answers `value-of(--name)`, so each variable's source is visible. */
const echo = (name: string) => `value-of(${name})`;

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

describe("the Mermaid token map", () => {
  it("reads only tokens the token sheet defines", () => {
    expect(MERMAID_TOKENS.filter((token) => !TOKENS.has(token))).toEqual([]);
  });

  it("colours nodes, lines, text and the font from the brand", () => {
    expect(MERMAID_TOKEN_MAP).toMatchObject({
      primaryColor: "--raised",
      primaryBorderColor: "--accent",
      lineColor: "--ink-mut",
      textColor: "--ink",
      background: "--surface",
      fontFamily: "--f-ui",
    });
  });
});

describe("brandThemeVariables", () => {
  it("maps every variable to its token's value and flags the palette", () => {
    const variables = brandThemeVariables(echo, true);
    expect(variables.darkMode).toBe(true);
    for (const [variable, token] of Object.entries(MERMAID_TOKEN_MAP)) {
      expect(variables[variable], variable).toBe(`value-of(${token})`);
    }
  });

  it("trims values and leaves out tokens that read empty", () => {
    const variables = brandThemeVariables(
      (name) => (name === "--accent" ? "  #07708e " : ""),
      false,
    );
    expect(variables).toEqual({
      darkMode: false,
      primaryBorderColor: "#07708e",
      nodeBorder: "#07708e",
      actorBorder: "#07708e",
    });
  });
});

describe("brandMermaidConfig", () => {
  it("switches to the base theme and keeps the rest of the config", () => {
    const config = brandMermaidConfig({ startOnLoad: false, theme: "dark" }, echo, true);
    expect(config.theme).toBe("base");
    expect(config.startOnLoad).toBe(false);
    expect(config.themeVariables).toMatchObject({ primaryColor: "value-of(--raised)" });
  });

  it("lets themeVariables set in the site config win over the tokens", () => {
    const config = brandMermaidConfig(
      { themeVariables: { primaryColor: "explicit" } },
      echo,
      false,
    );
    expect(config.themeVariables).toMatchObject({
      primaryColor: "explicit",
      lineColor: "value-of(--ink-mut)",
    });
  });
});

describe("useBrandMermaidConfig", () => {
  it("reads the tokens off the page and re-reads them when the theme flips", async () => {
    const root = document.documentElement;
    root.dataset.theme = "light";
    root.style.setProperty("--accent", "light-accent");

    const { result } = renderHook(() => useBrandMermaidConfig());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.themeVariables).toMatchObject({
      darkMode: false,
      primaryBorderColor: "light-accent",
    });

    await act(async () => {
      root.style.setProperty("--accent", "dark-accent");
      root.dataset.theme = "dark";
    });
    await waitFor(() =>
      expect(result.current?.themeVariables).toMatchObject({
        darkMode: true,
        primaryBorderColor: "dark-accent",
      }),
    );
  });
});
