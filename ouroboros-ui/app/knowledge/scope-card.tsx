"use client";

import { useId } from "react";

import type { EnabledRepo } from "@/app/api/enablement";
import type { FactList } from "@/app/api/facts";
import type { Reading } from "@/app/api/reading";
import type { SkillList, SkillScope } from "@/app/api/skills";
import { Card, CardHead, cx } from "@/app/ui";

import { ManifestPreview } from "./manifest-preview";
import { CURRENT_LABEL, LADDER_ARROW, LADDER_NAME, type LadderStep, SCOPE_CAPTION, SCOPE_COLD, ladderIsCold } from "./scope";
import { SCOPE_REGION_ID, SCOPE_TITLE } from "./view";

import "./knowledge.css";

/**
 * Mockup 14's `SCOPE` card (BG.5, [#421](https://github.com/NobuData/ouroboros/issues/421)): the
 * three-step ladder with its live counts, the caption verbatim, and — in the head —
 * **Preview injection ▾** (`manifest-preview.tsx`).
 *
 * The decisions are `app/knowledge/scope.ts`'s, and the steps arrive already decided: the screen
 * owns the tenant chip's focus and the filter, because the skills table and the facts card are
 * narrowed by the same press. What is here is the drawing:
 *
 * - **Each step is a toggle button.** Its text is the step — level, name, count — so that is its
 *   name; `aria-pressed` says whether it is narrowing the page, `aria-current` marks the scope the
 *   tenant chip is looking at, and the count's footnote describes it.
 * - **The counts are the page's reads.** A switch, a create or an import re-reads the page
 *   (`router.refresh()` in each of those cards), so the steps move without a reload.
 */

/** What the card is told. */
export interface ScopeCardProps {
  /** The three steps, farthest scope first — `ladder()`'s answer. */
  readonly steps: readonly LadderStep[];
  /** The step narrowing the page, or `null` for none. */
  readonly narrowed: SkillScope | null;
  /** Called with the scope to narrow to, or `null` to show every scope. */
  readonly onNarrow: (scope: SkillScope | null) => void;
  /** The workspace's skills as the page read them, or why not. */
  readonly skills: Reading<SkillList>;
  /** The workspace's facts as the page read them, or why not. */
  readonly facts: Reading<FactList>;
  /** The enabled repositories, or why not — the preview's repository choices. */
  readonly repos: Reading<readonly EnabledRepo[]>;
}

/**
 * The card.
 *
 * @param props See {@link ScopeCardProps}.
 * @returns The card, with the ladder in it.
 */
export function ScopeCard({ steps, narrowed, onNarrow, skills, facts, repos }: ScopeCardProps) {
  const ids = useId();
  // The Repo step's filter names the repository the chip is looking at — the preview opens on it.
  const current = steps.find((step) => step.scope === "repo")?.filter.repo ?? null;

  return (
    <Card aria-labelledby={`${SCOPE_REGION_ID}-title`} as="section">
      <CardHead
        title={SCOPE_TITLE}
        titleId={`${SCOPE_REGION_ID}-title`}
        trailing={<ManifestPreview facts={facts} repo={current} repos={repos} skills={skills} />}
      />

      <ol aria-label={LADDER_NAME} className="knowledge-scope__ladder">
        {steps.map((step, index) => {
          const noteId = `${ids}-${step.scope}-note`;

          return (
            <li className="knowledge-scope__rung" key={step.scope}>
              {index > 0 && (
                <span aria-hidden="true" className="knowledge-scope__arrow">
                  {LADDER_ARROW}
                </span>
              )}
              <button
                aria-current={step.current ? "true" : undefined}
                aria-describedby={noteId}
                aria-pressed={narrowed === step.scope}
                className={cx("knowledge-scope__step", step.current && "knowledge-scope__step--current")}
                onClick={() => { onNarrow(narrowed === step.scope ? null : step.scope); }}
                title={step.note}
                type="button"
              >
                <span className="knowledge-scope__level">{step.level}</span>{" "}
                <span className="knowledge-scope__name">{step.name}</span>{" "}
                <span className="knowledge-scope__count">{step.count}</span>
                {step.current && <span className="sr-only"> ({CURRENT_LABEL})</span>}
              </button>
              <span className="sr-only" id={noteId}>
                {step.note}
              </span>
            </li>
          );
        })}
      </ol>

      {ladderIsCold(skills) && <p className="knowledge-scope__state">{SCOPE_COLD}</p>}
      <p className="knowledge-scope__caption">{SCOPE_CAPTION}</p>
    </Card>
  );
}
