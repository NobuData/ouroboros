"use client";

import type { BriefCite, BriefParagraph, BriefSpan } from "@/app/api/research";
import { cx } from "@/app/ui";

import { DEMOTED_MARK, FINDING_MARK, OPEN_QUESTIONS_HEADING, OPEN_QUESTION_MARK, sourceRowId } from "./brief";

/** What the text takes. */
export interface BriefTextProps {
  /** The brief's paragraphs. */
  readonly paragraphs: readonly BriefParagraph[];
  /** Told a marker pressed. */
  readonly onCite: (cite: BriefCite) => void;
}

/**
 * One span: its runs of text — prose, or a code reference drawn mono and linked to the file at
 * its commit — then the markers that back it.
 *
 * @param props.span The span.
 * @param props.onCite Told a marker pressed.
 * @returns The span.
 */
function Span({ span, onCite }: Readonly<{ span: BriefSpan; onCite: (cite: BriefCite) => void }>) {
  const open = span.claim?.type === "open_question";

  return (
    <span className={cx("research__claim", open && "research__claim--open")}>
      {span.segments.map((segment, index) =>
        segment.kind === "code" ? (
          segment.href === null ? (
            <code className="research__code" key={index}>
              {segment.text}
            </code>
          ) : (
            <a className="research__code" href={segment.href} key={index} rel="noreferrer" target="_blank">
              {segment.text}
            </a>
          )
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
      {span.cites.map((cite) => (
        <a
          className="research__ref"
          href={`#${sourceRowId(cite)}`}
          key={cite.sourceId}
          onClick={(event) => {
            event.preventDefault();
            onCite(cite);
          }}
        >
          {cite.label}
        </a>
      ))}
      {open && (
        <span className="research__claim-mark">{span.claim?.demoted ? DEMOTED_MARK : OPEN_QUESTION_MARK}</span>
      )}
    </span>
  );
}

/**
 * The brief's text (CN.4, [#630](https://github.com/NobuData/ouroboros/issues/630)) — mockup 22's
 * `.brief` block: findings with their markers, and open questions drawn apart from them.
 *
 * **A marker is usable.** Each `[07]` is a link to the source's row in the panel; pressing it
 * scrolls there and lights the row (`brief-card.tsx`). A code reference is mono and, where the
 * service resolved the repository, a link to the file at the cited commit.
 *
 * **An open question is never dressed as a finding.** A paragraph of open questions carries its
 * own heading, and every open-question claim its mark — `demoted` where the investigation
 * offered it as a finding and could cite nothing.
 *
 * @param props See {@link BriefTextProps}.
 * @returns The paragraphs.
 */
export function BriefText({ paragraphs, onCite }: BriefTextProps) {
  return (
    <div className="research__brief-text">
      {paragraphs.map((paragraph, index) => (
        <p
          className={cx("research__brief-para", paragraph.kind === "open_questions" && "research__brief-para--open")}
          key={index}
        >
          {paragraph.kind === "findings" && <strong className="research__brief-mark">{FINDING_MARK}</strong>}
          {paragraph.kind === "open_questions" && (
            <strong className="research__brief-mark">{OPEN_QUESTIONS_HEADING}</strong>
          )}
          {paragraph.spans.map((span, at) => (
            <Span key={at} onCite={onCite} span={span} />
          ))}
        </p>
      ))}
    </div>
  );
}
