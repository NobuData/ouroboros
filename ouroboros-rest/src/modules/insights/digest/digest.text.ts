/**
 * The weekly Insights email's plain-text part (#440).
 *
 * The same assembly `digest.html.ts` renders, in the same order, with the same strings — for
 * the clients that show no HTML and the people who ask theirs not to.
 */

import {
  NO_FLAKY_MOVERS,
  NO_INTERVENTIONS,
  type DigestAssembly,
  type DigestKpi,
} from "./digest.assembly";
import {
  CAUSE_HEADING,
  COST_HEADING,
  DIGEST_TITLE,
  FLAKY_HEADING,
  KPI_HEADING,
  OPEN_INSIGHTS,
  PROXY_MARK,
  SOURCE_NOTE,
  deltaNote,
  emptyNote,
  reasonNote,
  windowNote,
  type DigestContext,
} from "./digest.copy";

/**
 * One KPI line: `Autonomous merge rate: 92% (▲ 3pts vs prior week, better)`.
 *
 * @param kpi - The KPI.
 * @returns The line.
 */
function kpiLine(kpi: DigestKpi): string {
  const label = kpi.proxy ? `${kpi.label} (${PROXY_MARK})` : kpi.label;
  const note = deltaNote(kpi);

  return `  ${label}: ${kpi.valueText}${note === "" ? "" : ` (${note})`}`;
}

/**
 * A heading, underlined.
 *
 * @param heading - The heading.
 * @returns Two lines.
 */
function section(heading: string): string[] {
  return [heading.toUpperCase(), "-".repeat(heading.length)];
}

/**
 * Render the plain-text part.
 *
 * @param assembly - The digest.
 * @param context - Who and where it is for.
 * @returns The text, lines ending `\n`.
 */
export function renderDigestText(assembly: DigestAssembly, context: DigestContext): string {
  const lines: string[] = [
    `${DIGEST_TITLE} — ${context.workspaceName}`,
    windowNote(assembly),
    "",
    assembly.headline,
    "",
  ];

  if (assembly.empty) {
    lines.push(emptyNote(context, assembly), "");
  } else {
    lines.push(...section(KPI_HEADING), ...assembly.kpis.map(kpiLine), "");

    lines.push(...section(CAUSE_HEADING));
    if (assembly.topCause === null) {
      lines.push(`  ${NO_INTERVENTIONS}`);
    } else {
      lines.push(`  ${assembly.topCause.text}`);
      if (assembly.topCause.line !== null) {
        lines.push(`  ${assembly.topCause.line}`);
      }
    }
    lines.push("");

    lines.push(...section(FLAKY_HEADING));
    if (assembly.flaky.length === 0) {
      lines.push(`  ${NO_FLAKY_MOVERS}`);
    } else {
      for (const mover of assembly.flaky) {
        lines.push(`  ${mover.name} (${mover.repository}) — ${mover.text}`);
      }
    }
    lines.push("");

    lines.push(...section(COST_HEADING), `  ${assembly.cost.text}`, "");
    lines.push(SOURCE_NOTE, "");
  }

  lines.push(`${OPEN_INSIGHTS}: ${context.insightsUrl}`, "", reasonNote(context));

  if (context.unsubscribeUrl !== null) {
    lines.push(`Unsubscribe: ${context.unsubscribeUrl}`);
  }

  return `${lines.join("\n")}\n`;
}
