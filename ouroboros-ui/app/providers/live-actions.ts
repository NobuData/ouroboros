"use server";

/**
 * The server hops for the card's live surfaces
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)): test, refresh, pull.
 *
 * Each is `card-actions.ts`'s shape — a call, and a refusal handed back as a sentence rather
 * than a throw, because every one of these happens on a card the reader is still entitled to
 * be on. The role gate is the service's; a member who reaches one anyway gets the service's
 * `403`, handed back as the same sentence the read-only control already shows. The one throw
 * that must travel is Next.js's redirect signal.
 *
 * **Reading progress is not here.** A poll is a `GET` a browser repeats, and a Server Action
 * is a `POST` that cannot be cached, deduplicated or cancelled — `app/api/dashboard/route.ts`
 * argues the case for the dashboard's summary, and `app/api/providers/[id]/pulls/route.ts`
 * is the same route handler for a pull-list.
 */

import { isApiError } from "@/app/api/errors";
import { type ModelPull, type ProviderDiscovery, type ProviderTest, providers } from "@/app/api/providers";
import type { Reading } from "@/app/api/reading";

import { discoverRefusal, pullRefusal, testRefusal } from "./live";

/** What one press of **Test connection** produced. */
export type TestOutcome =
  /**
   * The provider answered — well or badly, both are here — and, after a pass, what the
   * chips' refresh produced or why it did not.
   */
  | { readonly ok: true; readonly result: ProviderTest; readonly models: Reading<ProviderDiscovery> | null }
  /** The test itself could not run. */
  | { readonly ok: false; readonly reason: string };

/** What one refresh produced. */
export type RefreshOutcome =
  | { readonly ok: true; readonly discovery: ProviderDiscovery }
  | { readonly ok: false; readonly reason: string };

/** What one press of **Pull latest** produced. */
export type PullOutcome =
  | { readonly ok: true; readonly pull: ModelPull }
  | { readonly ok: false; readonly reason: string };

/**
 * Test a connection, and refresh its chips when it passed.
 *
 * Two calls in one hop, because the issue asks for chips that re-fetch after a successful
 * test and a browser should not pay two round trips for one press. A refresh that failed
 * after a pass is reported beside the pass rather than replacing it: the test's answer is the
 * fact the button exists to show.
 *
 * @param id The connection.
 * @returns What the provider said, or why nothing could be asked.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function testConnection(id: string): Promise<TestOutcome> {
  let result: ProviderTest;

  try {
    result = await providers.test(id);
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: testRefusal(error) };
  }

  if (result.status !== "active") return { ok: true, result, models: null };

  try {
    return { ok: true, result, models: { ok: true, value: await providers.discover(id) } };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: true, result, models: { ok: false, reason: discoverRefusal(error) } };
  }
}

/**
 * Ask the provider what it serves, and store it.
 *
 * @param id The connection.
 * @returns The catalog as it now stands, or why it is unchanged.
 * @throws Whatever is not an `ApiError`.
 */
export async function refreshModels(id: string): Promise<RefreshOutcome> {
  try {
    return { ok: true, discovery: await providers.discover(id) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: discoverRefusal(error) };
  }
}

/**
 * Ask the host to pull a model.
 *
 * @param id The connection.
 * @param modelId The model, in the daemon's own spelling.
 * @returns The record as it stands, or why nothing was asked.
 * @throws Whatever is not an `ApiError`.
 */
export async function startPull(id: string, modelId: string): Promise<PullOutcome> {
  try {
    return { ok: true, pull: await providers.pull(id, modelId) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: pullRefusal(error) };
  }
}
