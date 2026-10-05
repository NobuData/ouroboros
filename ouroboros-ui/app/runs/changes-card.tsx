import { useId } from "react";

import { RUN_CHANGES_HASH } from "@/app/paths";
import { Card, CardHead, Tag } from "@/app/ui";

import { CHANGES_TITLE, COMMITS_LABEL, type ChangesView, FILES_LABEL, NO_COMMITS, NO_FILES } from "./cards";

/**
 * Mockup 10's *Changes so far* ([#313](https://github.com/NobuData/ouroboros/issues/313)) — the
 * files the loop has touched with their `+`/`−` counts, its commits, and how the pull request
 * will land.
 *
 * **It is an address.** The card carries {@link RUN_CHANGES_HASH} as its id, so a link that means
 * *the diff* — a decision card's path chip and its *View diff →*
 * ([#467](https://github.com/NobuData/ouroboros/issues/467)) — lands on it rather than at the top
 * of the console.
 *
 * **Long lists scroll inside the card, never the pane.** The files and the commits each sit in
 * their own keyboard-focusable region with a height cap, and a long path wraps rather than
 * pushing the column wider.
 *
 * @param props.view The card, from `changesView`.
 * @returns The card.
 */
export function ChangesCard({ view }: Readonly<{ view: ChangesView }>) {
  const titleId = useId();

  return (
    <Card aria-labelledby={titleId} as="section" className="run-changes" id={RUN_CHANGES_HASH}>
      <CardHead
        title={CHANGES_TITLE}
        titleId={titleId}
        trailing={<Tag title={view.totalsLabel}>{view.countLabel}</Tag>}
      />

      {view.files.length === 0 ? (
        <p className="run-card__empty">{NO_FILES}</p>
      ) : (
        <div aria-label={FILES_LABEL} className="run-changes__scroll" role="region" tabIndex={0}>
          <ul className="run-changes__list">
            {view.files.map((file) => (
              <li aria-label={file.accessibleName} className="run-changes__file" key={file.key}>
                <span className="run-changes__path">{file.path}</span>
                <span aria-hidden className="run-changes__plus">
                  {file.additions}
                </span>
                <span aria-hidden className="run-changes__minus">
                  {file.deletions}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <hr className="run-card__divider" />

      {view.commits.length === 0 ? (
        <p className="run-card__empty">{NO_COMMITS}</p>
      ) : (
        <div aria-label={COMMITS_LABEL} className="run-changes__scroll" role="region" tabIndex={0}>
          <ul className="run-changes__list">
            {view.commits.map((commit) => (
              <li className="run-changes__commit" key={commit.key}>
                {commit.href === null ? (
                  <span className="run-changes__sha">{commit.shortSha}</span>
                ) : (
                  <a className="run-changes__sha" href={commit.href} rel="noopener noreferrer" target="_blank">
                    {commit.shortSha}
                  </a>
                )}
                <span className="run-changes__subject">{commit.subject}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.mergeTag !== null && (
        <p className="run-changes__merge">
          <Tag>{view.mergeTag}</Tag>
        </p>
      )}
    </Card>
  );
}
