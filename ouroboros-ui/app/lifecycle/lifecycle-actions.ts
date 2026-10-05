"use server";

/**
 * The workspace lifecycle's reads and writes, as Server Actions
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * One module for the three surfaces that move a workspace through its lifecycle — the Danger
 * zone card, the shell's paused banner, and the recovery screen — so *pause* is one call whoever
 * presses it. Each turns the service's refusal into a value (`app/lifecycle/outcome.ts`);
 * anything that is not the service refusing — a redirect to sign in above all — keeps travelling.
 *
 * **Every landed write re-reads the page** (`refresh()`): the lifecycle is drawn in the shell on
 * every screen, so whatever page the reader is on is now out of date.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in any call.** Each acts on the workspace the caller's own session is
 *   acting in, resolved by `ouroboros-rest` from the cookie the request carries.
 * - **The gates are the service's**: `owner` or `admin` to pause, resume, preview and
 *   disconnect; `owner` alone to delete and restore; the typed name compared byte for byte and
 *   the step-up verified there. Nothing here repeats a rule that could then drift.
 * - **A password passes through and is kept nowhere** — it is the delete's step-up, sent once.
 */

import { refresh } from "next/cache";

import { isApiError } from "@/app/api/errors";
import {
  type DisconnectPreview,
  type WorkspaceLifecycle,
  settingsLifecycle,
} from "@/app/api/settings-lifecycle";

import { LIFECYCLE_FAILED, type LifecycleOutcome } from "./outcome";

/**
 * Run one call, keeping a refusal as a value.
 *
 * @param call The call.
 * @param changes Whether a landed call changed the workspace, so the page must be re-read.
 * @returns Its outcome.
 * @throws Anything that is not the service refusing.
 */
async function answered<T>(call: () => Promise<T>, changes: boolean): Promise<LifecycleOutcome<T>> {
  try {
    const value = await call();
    if (changes) refresh();

    return { ok: true, value };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: error.message || LIFECYCLE_FAILED, code: error.code };
  }
}

/**
 * Where the workspace stands.
 *
 * @returns The lifecycle and its banner, or why it could not be read.
 */
export async function readLifecycle(): Promise<LifecycleOutcome<WorkspaceLifecycle>> {
  return answered(() => settingsLifecycle.read(), false);
}

/**
 * Pause all loops.
 *
 * @returns The lifecycle, now paused, or why not.
 */
export async function pauseWorkspace(): Promise<LifecycleOutcome<WorkspaceLifecycle>> {
  return answered(() => settingsLifecycle.pause(), true);
}

/**
 * Resume all loops.
 *
 * @returns The lifecycle, now active, or why not.
 */
export async function resumeWorkspace(): Promise<LifecycleOutcome<WorkspaceLifecycle>> {
  return answered(() => settingsLifecycle.resume(), true);
}

/**
 * What disconnecting GitHub would do, as of now — and how many runs are in flight, which is
 * what the pause confirmation reads from it.
 *
 * @returns The preview, or why it could not be read.
 */
export async function readDisconnectPreview(): Promise<LifecycleOutcome<DisconnectPreview>> {
  return answered(() => settingsLifecycle.disconnectPreview(), false);
}

/**
 * Disconnect GitHub.
 *
 * @returns The counts as they stood when the disconnect ran, or why not.
 */
export async function disconnectWorkspace(): Promise<LifecycleOutcome<DisconnectPreview>> {
  return answered(() => settingsLifecycle.disconnect(), true);
}

/**
 * Delete the workspace — the start of its recovery window.
 *
 * @param confirmName The workspace's name, as the reader typed it.
 * @param password The step-up, when the service asked for one.
 * @returns The lifecycle, now pending deletion, or why not — `step_up_required` when the
 *   password is needed, `workspace_name_mismatch` when the name is not exact.
 */
export async function deleteWorkspace(
  confirmName: string,
  password?: string,
): Promise<LifecycleOutcome<WorkspaceLifecycle>> {
  // No `refresh()`: the page this was pressed on is about to be frozen, and the caller leaves
  // for the recovery screen instead.
  return answered(() => settingsLifecycle.remove(confirmName, password), false);
}

/**
 * Restore a workspace pending deletion.
 *
 * @returns The lifecycle, now active, or why not.
 */
export async function restoreWorkspace(): Promise<LifecycleOutcome<WorkspaceLifecycle>> {
  return answered(() => settingsLifecycle.restore(), true);
}
