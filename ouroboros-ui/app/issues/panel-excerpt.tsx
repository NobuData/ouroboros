"use client";

import { useState } from "react";

import { Button } from "@/app/ui";

import { NO_BODY, READ_MORE, SHOW_LESS, excerpt, quoted } from "./panel";

/**
 * The mockup's `.panel-body-excerpt`: the issue's description as a left-ruled italic
 * quotation, cut for the panel and expandable to the whole
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * The body arrives raw and untruncated — Markdown as GitHub stores it — because the contract
 * says the client cuts it: a server-side cut would be deciding a line count for a panel whose
 * width it cannot see, and would make *read more* a second request. So the cut is
 * `app/issues/panel.ts`'s {@link excerpt}, the quotation marks are the panel's own
 * presentation rather than characters GitHub holds, and the affordance under a cut body
 * shows the rest in place. An issue opened with no description says so rather than quoting
 * nothing.
 *
 * The text is drawn as text, not rendered as Markdown: a `#` heading or a `-` list reads as
 * the author typed it, which is honest about what the panel is — an excerpt, with the issue
 * itself one click away.
 *
 * @param props.body The description, or `null` for an issue opened with a title alone.
 * @returns The quotation, with its affordance when there is more to show.
 */
export function PanelExcerpt({ body }: Readonly<{ body: string | null }>) {
  const [expanded, setExpanded] = useState(false);

  if (body === null) return <p className="issues-panel__note">{NO_BODY}</p>;

  const cut = excerpt(body);
  const shown = expanded ? body.trim() : cut.text;

  return (
    <>
      <blockquote className="issues-panel__excerpt">
        <p>{quoted(shown)}</p>
      </blockquote>
      {cut.truncated && (
        <Button
          aria-expanded={expanded}
          className="issues-panel__expand"
          onClick={() => setExpanded((open) => !open)}
          size="sm"
          tone="ghost"
        >
          {expanded ? SHOW_LESS : READ_MORE}
        </Button>
      )}
    </>
  );
}
