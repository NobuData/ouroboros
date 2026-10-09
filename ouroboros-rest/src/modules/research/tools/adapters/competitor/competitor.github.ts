/**
 * GitHub releases, read into the lines a watch diffs (CL.3,
 * [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * Read through the workspace's GitHub client (K.3, #101) — its token, its rate guard — rather than
 * scraped from the releases page: the API is what GitHub publishes for this, and it costs one
 * request per check. Drafts are never visible to another account's token, and pre-releases are
 * kept and marked, since a rival's beta is news.
 */

/** A release, as the API answers it — only what the snapshot keeps. */
export interface GithubRelease {
  readonly tag_name?: unknown;
  readonly name?: unknown;
  readonly published_at?: unknown;
  readonly prerelease?: unknown;
  readonly draft?: unknown;
  readonly body?: unknown;
  readonly html_url?: unknown;
}

/** The releases a snapshot keeps — the most recent page. */
export const RELEASES_PER_CHECK = 30;

/** The longest release body kept, in characters. */
const MAX_BODY_CHARS = 4000;

/**
 * Releases as the lines a snapshot archives.
 *
 * @param releases - The API's answer, newest first.
 * @returns One block per published release: `tag — name (pre-release)`, the date, the link, the body.
 */
export function releasesText(releases: readonly GithubRelease[]): string {
  return releases
    .filter((release) => release.draft !== true)
    .slice(0, RELEASES_PER_CHECK)
    .map((release) => {
      const tag = text(release.tag_name);
      const name = text(release.name);
      const heading = [tag, name !== "" && name !== tag ? name : ""]
        .filter((part) => part !== "")
        .join(" — ");
      const body = text(release.body);

      return [
        `${heading === "" ? "untitled release" : heading}${release.prerelease === true ? " (pre-release)" : ""}`,
        text(release.published_at),
        text(release.html_url),
        body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}…` : body,
      ]
        .filter((line) => line !== "")
        .join("\n");
    })
    .join("\n\n");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
