"use client";

import type { RepoMapStatusList } from "@/app/api/repo-map";
import type { Reading } from "@/app/api/reading";
import { Button, Chip, cx } from "@/app/ui";

import { MEMBER_REGENERATE_REASON, REGENERATE_GLYPH, REGENERATING } from "./skills";
import { REPO_MAPS_NAME, generateName, mapsUnreadNote, pendingMapsNote, repoMapNotices } from "./states";

import "./knowledge.css";

/**
 * The maps that have no row in the skills table yet
 * (BG.6, [#422](https://github.com/NobuData/ouroboros/issues/422)).
 *
 * `repo-map` is a skill a job owns, and a repository gets its row on the first generation that
 * publishes. Until then the table has nothing to draw for it — and *nothing* is what a map that
 * was never attempted and a map that is refused every night have in common. This list is where
 * the page says which: a row per enabled repository whose map is **pending its first
 * generation** (a neutral ring — nobody has reported anything, and nothing is wrong) or whose
 * **generation failed** (the error hue, with why, when and what happens next).
 *
 * The decisions are `app/knowledge/states.ts`'s; the state is the service's
 * (`GET /api/v1/knowledge/repo-map`), never inferred here from the absence of a row. Each row's
 * `↻` runs the same generator the table's own regenerate does, so the press, the toast and the
 * wait are the card's (`skills-table.tsx`); it is inert with the reason for anyone but an
 * administrator.
 *
 * A row is one line — the repository, its state, the action — so a workspace with many
 * repositories reads as a list and not as a wall. What *pending* means is the same for every
 * pending row and is said once, under the list; why a generation failed is each row's own and
 * is said in that row.
 *
 * It draws nothing when every map is generated, and one sentence when the status could not be
 * read — which claims neither state.
 */

/** What the list is told. */
export interface RepoMapsProps {
  /** Each enabled repository's map status, or why it could not be read. */
  readonly maps: Reading<RepoMapStatusList>;
  /** The instant the page was read. */
  readonly now: Date;
  /** Whether this reader is an `owner` or an `admin` — who may generate. */
  readonly mayAdminister: boolean;
  /** The repository a generation is in flight for, or `null`. */
  readonly regenerating: string | null;
  /** The last generation's refusal and the repository it was for, or `null`. */
  readonly refusal: Readonly<{ repo: string; message: string }> | null;
  /** Called with the repository to generate. */
  readonly onRegenerate: (repo: string) => void;
}

/**
 * The list.
 *
 * @param props See {@link RepoMapsProps}.
 * @returns The rows, the unread sentence, or nothing.
 */
export function RepoMaps({ maps, now, mayAdminister, regenerating, refusal, onRegenerate }: RepoMapsProps) {
  const unread = mapsUnreadNote(maps);

  if (unread !== null) {
    return (
      <p className="knowledge-maps__unread" role="note">
        {unread}
      </p>
    );
  }

  const notices = repoMapNotices(maps, now);

  if (notices.length === 0) return null;

  const pending = pendingMapsNote(notices, mayAdminister);

  return (
    <div className="knowledge-maps">
      <ul aria-label={REPO_MAPS_NAME} className="knowledge-maps__list">
        {notices.map((notice) => {
          const busy = regenerating === notice.repo;
          const reason = busy ? REGENERATING : mayAdminister ? undefined : MEMBER_REGENERATE_REASON;

          return (
            <li
              className={cx("knowledge-maps__row", notice.state === "failed" && "knowledge-maps__row--failed")}
              key={notice.repo}
            >
              <div className="knowledge-maps__body">
                <p className="knowledge-maps__name">
                  <span className="knowledge-maps__slug">repo-map</span>
                  <span className="knowledge-maps__repo">{notice.repo}</span>
                </p>
                {notice.detail !== null && <p className="knowledge-maps__detail">{notice.detail}</p>}
                {refusal?.repo === notice.repo && (
                  <p className="knowledge-maps__refusal" role="alert">
                    {refusal.message}
                  </p>
                )}
              </div>
              <div className="knowledge-maps__state">
                <Chip dot={notice.dot} tone={notice.tone}>
                  {notice.chip}
                </Chip>
                <Button
                  aria-label={generateName(notice.repo)}
                  onClick={() => { onRegenerate(notice.repo); }}
                  reason={reason}
                  size="sm"
                  tone="ghost"
                >
                  <span aria-hidden="true">{busy ? "…" : REGENERATE_GLYPH}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {pending !== null && <p className="knowledge-maps__note">{pending}</p>}
    </div>
  );
}
