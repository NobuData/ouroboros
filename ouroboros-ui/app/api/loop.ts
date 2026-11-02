/**
 * `GET /api/v1/loop/capabilities` — which stages of the loop this deployment and workspace can run
 * for real, and why not (DG.2, [#1300](https://github.com/NobuData/ouroboros/issues/1300)).
 *
 * The UI reads it to say what is true about the product as a whole — DG.3
 * ([#1301](https://github.com/NobuData/ouroboros/issues/1301)) — rather than asserting that runs
 * are simulated. Read through the shell's shared poll (`app/shell/loop-capabilities.ts`).
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The whole report. */
export type LoopCapabilities = components["schemas"]["LoopCapabilities"];

/** One stage's answer. */
export type LoopStageCapability = components["schemas"]["LoopStageCapability"];

/** The five stages the report names. */
export type LoopStage = keyof LoopCapabilities["stages"];

/** Why a stage is not live — DG.2's stable vocabulary. */
export type LoopReason = NonNullable<LoopStageCapability["reason"]>;

/** `GET /api/v1/loop/readiness` — the live-loop readiness preflight (DK.1, #1318). */
export type LoopReadiness = components["schemas"]["LoopReadiness"];

/** One readiness check. */
export type LoopReadinessCheck = components["schemas"]["LoopReadinessCheck"];

/** What the preflight is asked about. */
export interface LoopReadinessQuery {
  /** `owner/name`. */
  readonly repository: string;
  /** The workflow's slug. */
  readonly workflow: string;
  /** The issue to ask about; absent, the wizard's pick. */
  readonly issue?: number;
}

export const loop = {
  /**
   * Read the capability report.
   *
   * @param client The client to read through. A poll passes `anonymousApi()`.
   * @param signal A way to give up on the read — a poll's deadline.
   * @returns The report, as served.
   * @throws {ApiError} When the service refuses.
   */
  async capabilities(client: ApiClient = api(), signal?: AbortSignal): Promise<LoopCapabilities> {
    return unwrap(await client.GET("/api/v1/loop/capabilities", { signal }));
  },

  /**
   * The readiness preflight for one repository and workflow (DK.1, #1318).
   *
   * @param query The repository, the workflow and, optionally, the issue.
   * @param client The API client — the session's by default.
   * @param signal Aborts the read.
   * @returns The ordered checks, `ready`, and the estimate.
   */
  async readiness(
    query: LoopReadinessQuery,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<LoopReadiness> {
    return unwrap(await client.GET("/api/v1/loop/readiness", { params: { query }, signal }));
  },
};
