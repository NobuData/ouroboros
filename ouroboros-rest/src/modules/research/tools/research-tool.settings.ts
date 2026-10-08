/**
 * Where a workspace's configuration of a research tool — and its credential — come from.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)). The enable flow that stores
 * them is #629's, and its storage is that ticket's to design; this is the seam the internal
 * surface reads through until then. It is injectable for the reason `tool-pricing.ts` (#622)
 * is: the default answers *nothing configured*, and #629 binds the real reader without touching
 * a caller.
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
   * @returns The settings, or null when the workspace has not configured the tool. The default
   *   binding answers null for everything until #629's enable flow stores settings.
   */
  settingsFor(organizationId: string, slug: string): Promise<ToolSettings | null> {
    void organizationId;
    void slug;
    return Promise.resolve(null);
  }
}
