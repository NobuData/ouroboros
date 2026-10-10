"use client";

import { Button, Eyebrow } from "@/app/ui";

import {
  LIBRARY_LABEL,
  NEW_INVESTIGATION_LABEL,
  RESEARCH_EYEBROW,
  RESEARCH_HEADLINE,
  RESEARCH_LIBRARY_PATH,
  RESEARCH_SUBLINE,
  VIEWER_START_REASON,
} from "./view";

/** What the head takes. */
export interface ResearchHeadProps {
  /** Whether this reader may start an investigation — `owner`, `admin` or `member`. */
  readonly mayStart: boolean;
  /** Put the reader in the composer. Called by **New investigation**. */
  readonly onNewInvestigation: () => void;
}

/**
 * The Research page head — mockup 22's eyebrow, headline, subline and two actions
 * (CN.1, [#627](https://github.com/NobuData/ouroboros/issues/627)).
 *
 * **The copy is verbatim** (`app/research/view.ts`): the headline is the page's thesis, and the
 * regions under it are what prove it.
 *
 * **Both actions go somewhere.** *Research library* is a link to the library's address
 * (`RESEARCH_LIBRARY_PATH`), which lands on the investigations region. *New investigation* acts
 * on this page rather than opening a modal — the composer is the page's front door — so it is a
 * button, and what it does is the screen's (`onNewInvestigation`). For a reader who may not start
 * one it is inert and says why.
 *
 * @param props See {@link ResearchHeadProps}.
 * @returns The head.
 */
export function ResearchHead({ mayStart, onNewInvestigation }: ResearchHeadProps) {
  return (
    <div className="research__head">
      <div className="research__headings">
        <Eyebrow>{RESEARCH_EYEBROW}</Eyebrow>
        <h1 className="research__title">{RESEARCH_HEADLINE}</h1>
        <p className="research__sub">{RESEARCH_SUBLINE}</p>
      </div>
      <div className="research__actions">
        <Button href={RESEARCH_LIBRARY_PATH} tone="ghost">
          {LIBRARY_LABEL}
        </Button>
        <Button
          onClick={onNewInvestigation}
          reason={mayStart ? undefined : VIEWER_START_REASON}
          tone="primary"
        >
          {NEW_INVESTIGATION_LABEL}
        </Button>
      </div>
    </div>
  );
}
