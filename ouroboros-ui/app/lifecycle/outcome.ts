/**
 * What a lifecycle read or write answers the browser with
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * The danger zone's dialogs, the shell's banner and the recovery screen all call the same Server
 * Actions (`app/lifecycle/lifecycle-actions.ts`), and a `"use server"` module may export nothing
 * but async functions — so the shape those functions answer with lives here.
 *
 * A refusal is a **value**: every one of these surfaces is drawn over a page the reader is still
 * entitled to be on, and a thrown action would replace it with an error screen. The service's
 * `code` travels with the sentence because two refusals change what the surface does next rather
 * than only what it says — `step_up_required` asks for the password, and
 * `workspace_name_mismatch` belongs under the name field.
 *
 * Framework-free and pure.
 */

/** A lifecycle call's outcome: the value, or why not. */
export type LifecycleOutcome<T> =
  /** It landed. */
  | { readonly ok: true; readonly value: T }
  /** The service refused, with its sentence and its code. */
  | { readonly ok: false; readonly reason: string; readonly code: string };

/** What is said when the service refused and gave no sentence of its own. */
export const LIFECYCLE_FAILED = "The workspace could not be changed. Try again.";
