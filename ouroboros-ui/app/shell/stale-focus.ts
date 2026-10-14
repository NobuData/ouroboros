"use client";

import { focusRepoIn, focusRepoState, setFocusRepo } from "./focus-repo";
import { type FocusRepoReading, readFocusRepos } from "./repo-actions";

/**
 * Keeping the stored focus repository honest.
 *
 * The focus is a name this browser holds per workspace (`app/shell/focus-repo.ts`), and the
 * chip paints it without reading anything. So when a repository stops being offered — it was
 * disabled, or the ticket source covering it was removed — something has to clear the stored
 * choice, or the chip keeps naming it and every listing it filters narrows to nothing.
 *
 * The chip does it each time its menu reads the list. The Sources screen's Remove dialog does
 * it straight after a removal, because that is the moment a focused repository can drop out
 * while the chip's menu is shut.
 */

/**
 * Clear the stored focus of the workspace a listing describes, if the listing no longer
 * offers it.
 *
 * Read from the store rather than from a caller's closure: somebody may have chosen while the
 * listing was being read.
 *
 * @param answer What {@link readFocusRepos} answered. A refusal changes nothing — it says
 *   nothing about which repositories are offered.
 */
export function dropStaleFocus(answer: FocusRepoReading): void {
  if (!answer.ok) return;

  const held = focusRepoIn(focusRepoState(), answer.organizationId);
  if (held !== null && !answer.repos.some((one) => one.id === held.id)) {
    setFocusRepo(answer.organizationId, null);
  }
}

/**
 * Read the chip's list again and clear a focus it no longer offers.
 *
 * Best effort: a read that fails leaves the focus as it was, which the chip corrects the next
 * time its menu opens.
 *
 * @returns Once the read has settled.
 */
export async function reconcileFocusRepo(): Promise<void> {
  try {
    dropStaleFocus(await readFocusRepos());
  } catch {
    // Nothing to tell anybody: the removal this follows has already succeeded.
  }
}
