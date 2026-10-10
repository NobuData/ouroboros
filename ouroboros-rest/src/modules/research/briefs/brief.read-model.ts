/**
 * The brief read model — a stored brief body turned into paragraphs a page can draw (CM.2,
 * [#621](https://github.com/NobuData/ouroboros/issues/621)).
 *
 * V108 stores a body as paragraphs of spans, a span optionally naming the claim it states, and
 * the claims and their sources beside it. This joins the three:
 *
 *   span "… match Skylink's published spec."   claim finding   cites [07]
 *   span " It is control — … the final 2 m"    claim finding   cites [12][31]
 *   span " while ours is PID … (dock_ctrl.c:214, unchanged in 14 months)."
 *                                              claim finding   cites [git]
 *                                              segments  text · code `dock_ctrl.c:214` → repo · text
 *
 * **Cites follow the span that states the claim**, in ledger order, labelled by
 * {@link citeLabel}. **A code reference is recognised, never guessed:** a span is searched only
 * for the paths of the `code` sources its own claim cites, so `dock_ctrl.c:214` becomes a mono
 * segment linked to the file at the cited commit, and prose that merely looks like a filename
 * stays prose. **An open question is typed as one** — on its span and on its paragraph — so a
 * page never draws it as a finding.
 */

import type { BriefBodyDocument, BriefClaimType, SourceRecordKindColumn } from "../../db/schema";
import {
  citeLabel,
  parseGitLocator,
  repositoryHref,
  type RepositoryResolver,
} from "./brief.citations";

/** A ledger record, as the read model needs it. */
export interface BriefSource {
  readonly id: string;
  readonly citeNo: number;
  readonly citeKey: string | null;
  readonly kind: SourceRecordKindColumn;
  readonly locator: string;
}

/** A stored claim and the sources that back it. */
export interface BriefClaim {
  /** The span that states it. */
  readonly ref: string;
  readonly type: BriefClaimType;
  readonly text: string;
  /** Offered as a finding, cited nothing, written as an open question. */
  readonly demoted: boolean;
  /** `source_records` ids. */
  readonly sources: readonly string[];
}

/** One citation marker. */
export interface CiteResource {
  /** `[07]`, `[git]` — the same label in the body, the panel and the export. */
  readonly label: string;
  readonly citeNo: number;
  readonly citeKey: string | null;
  /** The `source_records` id the marker resolves to. */
  readonly sourceId: string;
}

/** A run of a span's text: prose, or a code reference drawn mono. */
export interface SegmentResource {
  readonly kind: "text" | "code";
  readonly text: string;
  /** The file at the cited commit, for a code reference whose repository resolves. */
  readonly href: string | null;
}

/** The claim a span states. */
export interface SpanClaimResource {
  readonly ref: string;
  readonly type: BriefClaimType;
  readonly demoted: boolean;
}

/** One span of a paragraph. */
export interface SpanResource {
  readonly text: string;
  readonly segments: readonly SegmentResource[];
  /** Null for connective prose that states no claim. */
  readonly claim: SpanClaimResource | null;
  /** The markers that follow the span; empty for prose and for an open question. */
  readonly cites: readonly CiteResource[];
}

/**
 * What a paragraph is made of: `findings` when it states any finding, `open_questions` when
 * every claim it states is an open question, `text` when it states no claim.
 */
export type ParagraphKind = "findings" | "open_questions" | "text";

/** One paragraph. */
export interface ParagraphResource {
  readonly kind: ParagraphKind;
  readonly spans: readonly SpanResource[];
}

/**
 * The marker for a ledger record.
 *
 * @param source - The record.
 * @returns Its label, number, key and id.
 */
export function citeOf(source: BriefSource): CiteResource {
  return {
    label: citeLabel(source),
    citeNo: source.citeNo,
    citeKey: source.citeKey,
    sourceId: source.id,
  };
}

/**
 * The markers for a set of cited records, in ledger order.
 *
 * @param ids - `source_records` ids; one not in `sources` is skipped.
 * @param sources - The ledger, by id.
 * @returns One marker per distinct record, ascending by cite number.
 */
export function citesOf(
  ids: readonly string[],
  sources: ReadonlyMap<string, BriefSource>,
): CiteResource[] {
  return [...new Set(ids)]
    .map((id) => sources.get(id))
    .filter((source): source is BriefSource => source !== undefined)
    .sort((a, b) => a.citeNo - b.citeNo)
    .map(citeOf);
}

/**
 * Build the renderable paragraphs of a brief.
 *
 * @param body - The stored body.
 * @param claims - The brief's claims.
 * @param sources - The investigation's ledger, by id.
 * @param resolve - The workspace's repositories, for code references.
 * @returns The paragraphs, in reading order.
 */
export function briefParagraphs(
  body: BriefBodyDocument,
  claims: readonly BriefClaim[],
  sources: ReadonlyMap<string, BriefSource>,
  resolve: RepositoryResolver,
): ParagraphResource[] {
  const byRef = new Map(claims.map((claim) => [claim.ref, claim]));

  return body.paragraphs.map((paragraph) => {
    const spans = paragraph.spans.map((span): SpanResource => {
      const claim = span.claim === undefined ? undefined : byRef.get(span.claim);
      const cited = claim === undefined ? [] : citesOf(claim.sources, sources);
      const code = cited
        .map((cite) => sources.get(cite.sourceId))
        .filter((source): source is BriefSource => source?.kind === "code");

      return {
        text: span.text,
        segments: segmentsOf(span.text, code, resolve),
        claim:
          claim === undefined ? null : { ref: claim.ref, type: claim.type, demoted: claim.demoted },
        cites: cited,
      };
    });

    return { kind: paragraphKind(spans), spans };
  });
}

/**
 * @param spans - A paragraph's spans.
 * @returns What the paragraph is made of.
 */
function paragraphKind(spans: readonly SpanResource[]): ParagraphKind {
  const types = spans.flatMap((span) => (span.claim === null ? [] : [span.claim.type]));
  if (types.includes("finding")) return "findings";
  return types.length > 0 ? "open_questions" : "text";
}

/**
 * Split a span's text around the code references it makes to its own cited sources.
 *
 * A reference is a cited file's path or base name, optionally followed by `:<line>` or
 * `:<line>-<line>`, standing as a whole token.
 *
 * @param text - The span's text.
 * @param code - The `code` sources the span's claim cites.
 * @param resolve - The workspace's repositories.
 * @returns The segments, concatenating back to `text`.
 */
export function segmentsOf(
  text: string,
  code: readonly BriefSource[],
  resolve: RepositoryResolver,
): SegmentResource[] {
  const files = new Map<string, { slug: string | null; sha: string; path: string }>();
  for (const source of code) {
    const git = parseGitLocator(source.locator);
    if (git?.path === null || git === null) continue;

    const file = { slug: resolve(git.repository), sha: git.sha, path: git.path };
    const base = git.path.split("/").pop() ?? git.path;
    if (!files.has(git.path)) files.set(git.path, file);
    if (!files.has(base)) files.set(base, file);
  }
  if (files.size === 0) return [{ kind: "text", text, href: null }];

  // Longest name first, so a path wins over the base name it ends with.
  const names = [...files.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const reference = new RegExp(
    `(?<![\\w/.-])(${names.join("|")})(?::(\\d+)(?:-(\\d+))?)?(?![\\w/-])`,
    "g",
  );

  const segments: SegmentResource[] = [];
  let cursor = 0;
  for (const match of text.matchAll(reference)) {
    const file = files.get(match[1]);
    if (file === undefined) continue;
    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index), href: null });
    }

    const first = match[2] as string | undefined;
    const last = match[3] as string | undefined;
    const lines: [number, number] | null =
      first === undefined ? null : [Number(first), Number(last ?? first)];
    segments.push({
      kind: "code",
      text: match[0],
      href: file.slug === null ? null : repositoryHref(file.slug, file.sha, file.path, lines),
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor), href: null });

  return segments;
}

/**
 * @param literal - Text to match exactly.
 * @returns It, with every regular-expression metacharacter escaped.
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
