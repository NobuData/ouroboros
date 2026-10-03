"use client";

import { Button, Eyebrow } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import { ScheduleAction } from "./schedule-sheet";
import {
  ANALYZER_SUBLINE,
  CHOSEN_REPO_HINT,
  NO_REPOSITORY,
  RUN_GLYPH,
  RUN_LABEL,
  RUN_MEMBER_REASON,
  RUN_STARTING_REASON,
  RUN_UNREAD_REASON,
  analyzerEyebrow,
  analyzerHeadline,
} from "./view";

/**
 * Mockup 18's page head (BW.1, [#516](https://github.com/NobuData/ouroboros/issues/516)): the
 * eyebrow from the real repository, the headline slot-filled from the corpus manifest, the
 * subline, and the two actions — **Schedule ▾** and **Run analysis now ⟳**.
 *
 * *Run analysis now* is an administrator's: a member is given the same control, inert, with the
 * reason. It stays pressable while an analysis runs, because the service is the guard: a press
 * then answers *an analysis is already running* and starts nothing (`run-progress.tsx`).
 *
 * @returns The head.
 */
export function AnalyzerHead() {
  const { chosen, page, mayAdminister, starting, start } = useAnalyzer();
  const repo = chosen?.repo.ref ?? null;

  const reason = !mayAdminister
    ? RUN_MEMBER_REASON
    : starting
      ? RUN_STARTING_REASON
      : page === null
        ? RUN_UNREAD_REASON
        : undefined;

  return (
    <div className="analyzer__head">
      <div className="analyzer__headings">
        <Eyebrow>{analyzerEyebrow(repo)}</Eyebrow>
        <h1 className="analyzer__title">{repo === null ? NO_REPOSITORY : analyzerHeadline(page?.run ?? null)}</h1>
        <p className="analyzer__sub">{ANALYZER_SUBLINE}</p>
        {chosen !== null && !chosen.focused && <p className="analyzer__hint">{CHOSEN_REPO_HINT}</p>}
      </div>
      {repo !== null && (
        <div className="analyzer__actions">
          <ScheduleAction />
          <Button onClick={start} reason={reason} tone="primary">
            {RUN_LABEL} <span aria-hidden="true">{RUN_GLYPH}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
