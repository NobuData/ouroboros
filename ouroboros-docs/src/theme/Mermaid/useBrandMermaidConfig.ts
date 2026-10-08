import { useEffect, useState } from "react";
import { useMermaidConfig } from "@docusaurus/theme-mermaid/client";

import { brandMermaidConfig, type MermaidConfig } from "./brandTheme";

/**
 * Reads a token's current value from the page root.
 *
 * @param name the custom property, e.g. `--accent`.
 * @returns its computed value, or an empty string when it is not defined.
 */
function readRootToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

/**
 * Whether the page currently shows the dark palette.
 *
 * @returns true when `<html data-theme="dark">`.
 */
function isDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

/**
 * The Mermaid config for the active theme, coloured from the brand tokens.
 *
 * The tokens switch with `<html data-theme>`, which Docusaurus stamps after React has
 * rendered the new colour mode, so the values are re-read whenever that attribute changes
 * rather than when the colour mode does — reading earlier would catch the old palette.
 *
 * @returns the config to render with, or `null` before the first read (on the server and
 *   during the first client render), when nothing should be drawn yet.
 */
export function useBrandMermaidConfig(): MermaidConfig | null {
  const base = useMermaidConfig();
  const [config, setConfig] = useState<MermaidConfig | null>(null);

  useEffect(() => {
    const update = () => setConfig(brandMermaidConfig(base, readRootToken, isDark()));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [base]);

  return config;
}
