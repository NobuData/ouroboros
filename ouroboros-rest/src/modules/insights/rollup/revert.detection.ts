/**
 * Revert detection — what DORA change failure rate counts (BI.2,
 * [#433](https://github.com/NobuData/ouroboros/issues/433)). A **proxy**, flagged as one in the
 * registry: a failure fixed forward rather than reverted is not seen.
 *
 * A revert is recognised by the first line of a synced text — a merged PR's title from the host,
 * or a commit message a loop reported — in one of two shapes, and names the change it undoes by
 * title:
 *
 *   * `Revert "Fix CAN-bus flake"` — what GitHub's revert button and `git revert` write, with an
 *     optional squash suffix: `Revert "Fix CAN-bus flake" (#514)`;
 *   * `revert: Fix CAN-bus flake` — the Conventional Commits type, in any case.
 *
 * Everything else is not a revert, however close: `Reverted docs typo`, `Revert docs typo`
 * without quotes, `revert:` with nothing after it, `Don't revert "x"`. A trailing ` (#n)` on the
 * named title is the reverted commit's squash suffix and is dropped, so the name matches the PR
 * title it came from.
 */

/** `Revert "<title>"`, optionally followed by a squash suffix. */
const QUOTED_REVERT = /^Revert "(.+)"(?: \(#\d+\))?$/;

/** `revert: <title>` — Conventional Commits, any case. */
const CONVENTIONAL_REVERT = /^revert:\s*(.+)$/i;

/** A squash-merge suffix on the reverted title — ` (#514)`. */
const SQUASH_SUFFIX = / \(#\d+\)$/;

/**
 * The title a revert names, or null when the text is not a revert.
 *
 * @param text - A PR title or a commit message. Only its first line is read.
 * @returns The reverted change's title, trimmed and without a squash suffix; null when the text
 *   matches neither revert shape or names nothing.
 */
export function revertedTitle(text: string): string | null {
  const firstLine = text.split("\n", 1)[0].trim();
  const match = QUOTED_REVERT.exec(firstLine) ?? CONVENTIONAL_REVERT.exec(firstLine);

  if (match === null) {
    return null;
  }

  const title = match[1].replace(SQUASH_SUFFIX, "").trim();

  return title === "" ? null : title;
}

/**
 * The repository part of a PR's URL — `https://github.com/acme/helios` for
 * `https://github.com/acme/helios/pull/514` — so a revert PR is only matched to a PR in the same
 * repository. GitLab's `/-/merge_requests/` is understood too.
 *
 * @param url - `pull_requests.external_url`.
 * @returns The URL up to the PR path, or the whole URL when it has no recognisable PR path.
 */
export function repositoryUrl(url: string): string {
  return url.replace(/\/(?:pull|-\/merge_requests)\/\d+.*$/, "");
}
