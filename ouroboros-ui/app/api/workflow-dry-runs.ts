import "server-only";

/**
 * A workflow's deep dry runs, read for the copilot's dry-run card (CE.4,
 * [#568](https://github.com/NobuData/ouroboros/issues/568)) — over CD.4's
 * `GET /api/v1/workflows/{id}/dry-runs` and `…/dry-runs/{dryRunId}`
 * ([#562](https://github.com/NobuData/ouroboros/issues/562)) and CD.5's
 * `…/dry-runs/{dryRunId}/suggestions` ([#563](https://github.com/NobuData/ouroboros/issues/563)).
 *
 * The route reads three things on the server: the history (which names the newest run and the
 * draft as it stands), that run in full, and its suggestions. Everything else the card does —
 * following a run, starting one, applying a suggestion — goes through this origin's pass-through
 * routes (`app/api/workflow-dry-run-pass.ts`), because those happen in the browser.
 *
 * No workspace travels: the service resolves it from the session, as everywhere under
 * `/api/v1/workflows`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** A workflow's dry-run history — the footer's line, and which run is newest. */
export type DryRunHistory = components["schemas"]["DryRunHistory"];

/** One dry run, in full. */
export type DryRun = components["schemas"]["DryRun"];

/** A dry run's suggestions. */
export type DryRunSuggestions = components["schemas"]["DryRunSuggestions"];

/** The safety strip, as data — three claims, each with the mechanism that backs it. */
export type DryRunSafety = components["schemas"]["DryRunSafety"];

/** One column of the safety strip. */
export type DryRunSafetyColumn = components["schemas"]["DryRunSafetyColumn"];

/** The reads behind the card, and the safety strip's. */
export const workflowDryRuns = {
  /**
   * Read a workflow's dry-run history.
   *
   * @param id The workflow.
   * @param client The API client; the request's own by default.
   * @returns The history, newest run first.
   */
  async history(id: string, client: ApiClient = api()): Promise<DryRunHistory> {
    return unwrap(await client.GET("/api/v1/workflows/{id}/dry-runs", { params: { path: { id } } }));
  },

  /**
   * Read one dry run.
   *
   * @param id The workflow.
   * @param dryRunId The dry run.
   * @param client The API client; the request's own by default.
   * @returns The run with its rows and artifacts.
   */
  async read(id: string, dryRunId: string, client: ApiClient = api()): Promise<DryRun> {
    return unwrap(
      await client.GET("/api/v1/workflows/{id}/dry-runs/{dryRunId}", { params: { path: { id, dryRunId } } }),
    );
  },

  /**
   * Read one dry run's suggestions.
   *
   * @param id The workflow.
   * @param dryRunId The dry run.
   * @param client The API client; the request's own by default.
   * @returns The suggestions, in card order.
   */
  async suggestions(id: string, dryRunId: string, client: ApiClient = api()): Promise<DryRunSuggestions> {
    return unwrap(
      await client.GET("/api/v1/workflows/{id}/dry-runs/{dryRunId}/suggestions", {
        params: { path: { id, dryRunId } },
      }),
    );
  },

  /**
   * Read the safety strip (CE.5, [#569](https://github.com/NobuData/ouroboros/issues/569)) —
   * the three claims, each derived by the service from the harness's own configuration.
   *
   * @param id The workflow.
   * @param client The API client; the request's own by default.
   * @returns The columns, each saying whether its mechanism is in place.
   */
  async safety(id: string, client: ApiClient = api()): Promise<DryRunSafety> {
    return unwrap(await client.GET("/api/v1/workflows/{id}/dry-runs/safety", { params: { path: { id } } }));
  },
};
