/**
 * The weekly Insights email's HTML part (#440).
 *
 * **Email rendering is its own discipline**, so this is deliberately plain: one 600-pixel table,
 * every style inline, no images, no web fonts, no script, nothing a client has to fetch. The
 * `<style>` block holds only what a client may ignore without harm — narrow-screen padding — and
 * the client-profile screenshots (`tests/e2e/email/`) include one with it stripped.
 *
 * **The palette is the product's light tokens** (`docs/design/tokens.css`), written out as
 * literals because a mail cannot read a stylesheet. {@link DIGEST_PALETTE} is the only place a
 * colour is written; the screenshot suite checks each one against the token sheet. The mail
 * declares itself light (`color-scheme: light`): there is no dark palette, and a dark-mode client
 * is asked to leave it as drawn.
 *
 * Every string that came from data goes through `escapeHtml`.
 */

import { escapeHtml } from "../../mail/html";
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
  digestSubject,
  emptyNote,
  reasonNote,
  windowNote,
  type DigestContext,
} from "./digest.copy";

/** The light tokens the mail is drawn in, by token name. */
export const DIGEST_PALETTE = {
  ground: "#f5f8fa",
  surface: "#ffffff",
  line: "#d4dee5",
  ink: "#16232b",
  inkDim: "#33454f",
  inkMut: "#4e626d",
  accent: "#07708e",
  accentInk: "#f4fbfd",
  ok: "#0b7048",
  err: "#b52121",
} as const;

const P = DIGEST_PALETTE;

/** The UI's text stack, minus the web font a mail client would not load. */
const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

/** The width the mail is laid out at. */
const WIDTH = 600;

/**
 * The colour a KPI's move is drawn in.
 *
 * @param kpi - The KPI.
 * @returns Green for an improvement, red for the opposite, muted when there is no judgement.
 */
function deltaColour(kpi: DigestKpi): string {
  return kpi.good === null || kpi.deltaText === null ? P.inkMut : kpi.good ? P.ok : P.err;
}

/**
 * One KPI row: label, figure, move.
 *
 * @param kpi - The KPI.
 * @returns A table row.
 */
function kpiRow(kpi: DigestKpi): string {
  const proxy = kpi.proxy
    ? ` <span style="font-size:12px;color:${P.inkMut};">(${PROXY_MARK})</span>`
    : "";

  return (
    `<tr>` +
    `<td style="padding:10px 0;border-top:1px solid ${P.line};font-size:14px;color:${P.inkDim};">` +
    `${escapeHtml(kpi.label)}${proxy}` +
    `<div style="font-size:12px;color:${deltaColour(kpi)};">${escapeHtml(deltaNote(kpi))}</div>` +
    `</td>` +
    `<td align="right" style="padding:10px 0;border-top:1px solid ${P.line};font-size:20px;font-weight:600;color:${P.ink};white-space:nowrap;">` +
    `${escapeHtml(kpi.valueText)}` +
    `</td>` +
    `</tr>`
  );
}

/**
 * A section: a small heading over its content.
 *
 * @param heading - The heading.
 * @param body - The content, already HTML.
 * @returns A table row.
 */
function section(heading: string, body: string): string {
  return (
    `<tr><td class="pad" style="padding:20px 32px 0 32px;">` +
    `<div style="font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${P.inkMut};">` +
    `${escapeHtml(heading)}</div>` +
    `${body}` +
    `</td></tr>`
  );
}

/**
 * A paragraph of body text.
 *
 * @param text - The text, unescaped.
 * @param colour - Its colour.
 * @returns A block.
 */
function paragraph(text: string, colour: string = P.ink): string {
  return `<div style="padding-top:6px;font-size:14px;line-height:20px;color:${colour};">${escapeHtml(text)}</div>`;
}

/**
 * The figures: KPI row, top cause, flaky movers, cost.
 *
 * @param assembly - The digest.
 * @returns Table rows.
 */
function figures(assembly: DigestAssembly): string {
  const cause =
    assembly.topCause === null
      ? paragraph(NO_INTERVENTIONS, P.inkDim)
      : paragraph(assembly.topCause.text) +
        (assembly.topCause.line === null ? "" : paragraph(assembly.topCause.line, P.inkDim));
  const flaky =
    assembly.flaky.length === 0
      ? paragraph(NO_FLAKY_MOVERS, P.inkDim)
      : assembly.flaky
          .map(
            (mover) =>
              `<div style="padding-top:6px;font-size:14px;line-height:20px;color:${P.ink};">` +
              `${escapeHtml(mover.name)} ` +
              `<span style="color:${P.inkMut};">(${escapeHtml(mover.repository)})</span>` +
              `<div style="font-size:13px;color:${P.inkDim};">${escapeHtml(mover.text)}</div>` +
              `</div>`,
          )
          .join("");

  return (
    section(
      KPI_HEADING,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-bottom:1px solid ${P.line};">` +
        `${assembly.kpis.map(kpiRow).join("")}</table>`,
    ) +
    section(CAUSE_HEADING, cause) +
    section(FLAKY_HEADING, flaky) +
    section(COST_HEADING, paragraph(assembly.cost.text)) +
    `<tr><td class="pad" style="padding:20px 32px 0 32px;font-size:12px;line-height:18px;color:${P.inkMut};">` +
    `${escapeHtml(SOURCE_NOTE)}</td></tr>`
  );
}

/**
 * Render the HTML part.
 *
 * @param assembly - The digest.
 * @param context - Who and where it is for.
 * @returns A complete HTML document.
 */
export function renderDigestHtml(assembly: DigestAssembly, context: DigestContext): string {
  const body = assembly.empty
    ? `<tr><td class="pad" style="padding:12px 32px 0 32px;">${paragraph(emptyNote(context, assembly), P.inkDim)}</td></tr>`
    : figures(assembly);
  const unsubscribe =
    context.unsubscribeUrl === null
      ? ""
      : ` <a href="${escapeHtml(context.unsubscribeUrl)}" style="color:${P.accent};">Unsubscribe</a>`;

  return (
    `<!doctype html>` +
    `<html lang="en"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light">` +
    `<meta name="supported-color-schemes" content="light">` +
    `<title>${escapeHtml(digestSubject(assembly, context.workspaceName))}</title>` +
    `<style>@media (max-width:480px){.pad{padding-left:20px !important;padding-right:20px !important;}}</style>` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:${P.ground};color:${P.ink};font-family:${FONT};">` +
    // The preheader: what an inbox shows beside the subject.
    `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(assembly.headline)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${P.ground};">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="${String(WIDTH)}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${String(WIDTH)}px;background-color:${P.surface};border:1px solid ${P.line};border-radius:8px;font-family:${FONT};">` +
    `<tr><td class="pad" style="padding:28px 32px 0 32px;">` +
    `<div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${P.accent};">${escapeHtml(DIGEST_TITLE)}</div>` +
    `<div style="padding-top:4px;font-size:16px;font-weight:600;color:${P.ink};">${escapeHtml(context.workspaceName)}</div>` +
    `<div style="padding-top:2px;font-size:12px;line-height:18px;color:${P.inkMut};">${escapeHtml(windowNote(assembly))}</div>` +
    `</td></tr>` +
    `<tr><td class="pad" style="padding:20px 32px 0 32px;font-size:22px;line-height:30px;font-weight:600;color:${P.ink};">` +
    `${escapeHtml(assembly.headline)}</td></tr>` +
    body +
    `<tr><td class="pad" style="padding:24px 32px 0 32px;">` +
    `<a href="${escapeHtml(context.insightsUrl)}" style="display:inline-block;padding:10px 18px;border-radius:6px;background-color:${P.accent};color:${P.accentInk};font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(OPEN_INSIGHTS)}</a>` +
    `</td></tr>` +
    `<tr><td class="pad" style="padding:24px 32px 28px 32px;">` +
    `<div style="padding-top:16px;border-top:1px solid ${P.line};font-size:12px;line-height:18px;color:${P.inkMut};">` +
    `${escapeHtml(reasonNote(context))}${unsubscribe}</div>` +
    `</td></tr>` +
    `</table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}
