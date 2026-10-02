"use client";

import Link from "next/link";

import { Sparkline } from "@/app/charts";
import { Button, Chip, cx } from "@/app/ui";

import {
  type ContextPart,
  FLAKY_TITLE,
  type FlakyPlaybook,
  type FlakyRowView,
  flakyView,
  playbookLink,
} from "./flaky-view";
import { useInsights } from "./insights-store";
import { SeriesCard, SeriesEmptyState, SeriesSkeleton } from "./series-card";

/**
 * Mockup 15's **FLAKY TESTS** card (BK.5, [#446](https://github.com/NobuData/ouroboros/issues/446)).
 *
 * AT.3's ([#331](https://github.com/NobuData/ouroboros/issues/331)) cases as rows — a mono path,
 * the state pill, the `Sparkline` of the case's real daily flake rate, the rate, and a context line
 * whose links resolve: the run that fixed it, the rig it flaked on. Under them, *Open playbook:
 * Flaky test hunt →* to the workspace's real recipe (#415), or a plain sentence that there is
 * none. Every decision is `flaky-view.ts`'s.
 *
 * @param props.playbook The flaky-test recipe, `null` when the workspace has none, or `undefined`
 *   when the playbooks could not be read — then the card draws no playbook line at all.
 * @returns The card.
 */
export function FlakyCard({ playbook }: Readonly<{ playbook: FlakyPlaybook | null | undefined }>) {
  const { page } = useInsights();

  if (page === null) {
    return (
      <SeriesCard busy tag={null} title={FLAKY_TITLE} width="third">
        <SeriesSkeleton width="third" />
      </SeriesCard>
    );
  }

  const view = flakyView(page.flaky, page.range);
  const link = playbookLink(playbook);

  return (
    <SeriesCard tag={view.tag} title={FLAKY_TITLE} width="third">
      {view.empty !== null ? (
        <SeriesEmptyState empty={view.empty} />
      ) : (
        <ul className="insights-flaky">
          {view.rows.map((row) => (
            <FlakyRow key={row.key} row={row} />
          ))}
        </ul>
      )}
      {view.more !== null && <p className="insights-flaky__more">{view.more}</p>}
      {link !== null && (
        <div className="insights-flaky__playbook">
          {link.kind === "link" ? (
            <Button href={link.href} size="sm" tone="ghost">
              {link.label}
            </Button>
          ) : (
            <p className="insights-flaky__absent">
              {link.note}{" "}
              <Link className="insights-link" href={link.href}>
                {link.label}
              </Link>
            </p>
          )}
        </div>
      )}
    </SeriesCard>
  );
}

/**
 * One case.
 *
 * @param props.row The row.
 * @returns The row — its sentence for a screen reader, its geometry for the eye.
 */
function FlakyRow({ row }: Readonly<{ row: FlakyRowView }>) {
  return (
    <li className="insights-flaky__row">
      <span className="sr-only">{row.summary}</span>
      <div className="insights-flaky__head" aria-hidden="true">
        <span className="insights-flaky__name" title={row.where === "" ? row.name : `${row.name} — ${row.where}`}>
          {row.name}
        </span>
        <Chip tone={row.state.tone}>{row.state.label}</Chip>
      </div>
      <div className="insights-flaky__line">
        <Sparkline dim={row.dim} values={row.history} />
        <span
          aria-hidden="true"
          className={cx("insights-flaky__rate", row.rateWarn && "insights-flaky__rate--warn")}
        >
          {row.rate}
        </span>
        <span className="insights-flaky__context">
          {row.context.map((part, index) => (
            <ContextText key={index} part={part} />
          ))}
        </span>
      </div>
    </li>
  );
}

/**
 * A piece of a context line — words, or a link that resolves.
 *
 * @param props.part The piece.
 * @returns It. A plain piece is hidden from a screen reader, which heard it in the row's
 *   summary; a link stays reachable, since it is a way out of the page.
 */
function ContextText({ part }: Readonly<{ part: ContextPart }>) {
  if (part.href === undefined) return <span aria-hidden="true">{part.text}</span>;

  return (
    <Link className="insights-link" href={part.href}>
      {part.text}
    </Link>
  );
}
