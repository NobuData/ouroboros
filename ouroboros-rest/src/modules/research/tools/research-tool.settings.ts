/**
 * Where a workspace's configuration of a research tool — and its credential — come from.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)). This is the seam every
 * caller reads through. The class itself answers *nothing configured* — what a unit test wants —
 * and the module binds `StoredToolSettings` (`research-tool.settings.store.ts`, #629), which
 * reads V127's `research_tool_settings` and opens the credential.
 *
 * **The credential is opened here and handed to an adapter for one call** — it never reaches the
 * engine, never appears in a response, and never enters the stored configuration.
 */

import { Injectable } from "@nestjs/common";

import type { ResearchToolConfig } from "./research-tool.config";

/** A workspace's settings for one tool, opened for one call. */
export interface ToolSettings {
  /** The stored configuration, in the tool's schema vocabulary. */
  readonly config: ResearchToolConfig;
  /** The opened credential, or null when the tool needs none. */
  readonly secret: string | null;
}

@Injectable()
export class ResearchToolSettings {
  /**
   * The workspace's settings for a tool.
   *
   * @param organizationId - The workspace.
   * @param slug - The tool.
   * @returns The settings, or null when the workspace has not configured the tool. This base
   *   class answers null for everything; the stored binding overrides it.
   */
  settingsFor(organizationId: string, slug: string): Promise<ToolSettings | null> {
    void organizationId;
    void slug;
    return Promise.resolve(null);
  }
}
