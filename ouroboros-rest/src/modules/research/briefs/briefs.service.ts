/**
 * The brief, made readable (CM.2, [#621](https://github.com/NobuData/ouroboros/issues/621)): the
 * read model behind the featured card, its sources panel and full ledger, its matrix, the
 * proposed-from-gaps summary, and the Markdown export.
 *
 * Everything is composed once, in {@link BriefsService.document}, from the stored rows — and
 * every route and the export read that composition. So a citation's label is the same in the
 * body, the panel, a matrix cell and the exported file, and it is the ledger's own stored number:
 * reading a brief twice cannot renumber it.
 *
 * {@link BriefsService.proposed} and {@link BriefsService.export} are the contracts #624 builds
 * on — the draft-epic action creates what the first returns, and feeds the second to the
 * `create-roadmap` skill.
 */

import { Injectable } from "@nestjs/common";

import { investigationNotFound } from "../research.errors";
import { repositoryResolver } from "./brief.citations";
import { exportBrief, exportFilename } from "./brief.export";
import { briefParagraphs } from "./brief.read-model";
import {
  ledgerSourceResource,
  matrixResource,
  sourceResource,
  type BriefDocument,
  type BriefLedgerResource,
  type BriefResource,
} from "./brief.resources";
import { briefNotFound } from "./briefs.errors";
import { BriefsRepository, type BriefInvestigation, type BriefStore } from "./briefs.repository";
import { proposeFromGaps, type GapProposals } from "./gap-proposals";

/** An exported brief. */
export interface BriefExport {
  /** `RS-127-brief.md`. */
  readonly filename: string;
  readonly markdown: string;
}

@Injectable()
export class BriefsService {
  private readonly store: BriefStore;

  /** @param repository - The investigation, its ledger, brief and matrix. */
  constructor(repository: BriefsRepository) {
    this.store = repository;
  }

  /**
   * An investigation's current brief, as the card draws it.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The brief, its sources panel, matrix and proposal.
   * @throws {NotFoundError} `investigation_not_found` or `brief_not_found`.
   */
  async brief(organizationId: string, investigationId: string): Promise<BriefResource> {
    return (await this.document(organizationId, investigationId)).brief;
  }

  /**
   * An investigation's whole ledger — the listing behind `all ↗`.
   *
   * Readable as soon as the investigation has archived anything: the ledger does not wait for
   * the brief.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns Every record, numbered, with its archived excerpt and retrieval time.
   * @throws {NotFoundError} `investigation_not_found`.
   */
  async sources(organizationId: string, investigationId: string): Promise<BriefLedgerResource> {
    const investigation = await this.investigation(organizationId, investigationId);
    const [ledger, repositories] = await Promise.all([
      this.store.ledger(investigationId),
      this.store.repositories(organizationId),
    ]);
    const resolve = repositoryResolver(repositories);

    return {
      investigation: investigation.displayId,
      total: ledger.length,
      items: ledger.map((row) => ledgerSourceResource(row, resolve)),
    };
  }

  /**
   * What an investigation proposes from its gaps — the chip row, and what #624 drafts.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The epic, ticket stubs and effort roll-up; null when it proposes nothing.
   * @throws {NotFoundError} `investigation_not_found` or `brief_not_found`.
   */
  async proposed(organizationId: string, investigationId: string): Promise<GapProposals | null> {
    return (await this.brief(organizationId, investigationId)).proposed;
  }

  /**
   * An investigation's brief as a Markdown document.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The file name and the document.
   * @throws {NotFoundError} `investigation_not_found` or `brief_not_found`.
   */
  async export(organizationId: string, investigationId: string): Promise<BriefExport> {
    const document = await this.document(organizationId, investigationId);

    return { filename: document.brief.exportFilename, markdown: exportBrief(document) };
  }

  /**
   * Compose a brief and its ledger from the stored rows.
   *
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The one view every surface is rendered from.
   * @throws {NotFoundError} `investigation_not_found` or `brief_not_found`.
   */
  async document(organizationId: string, investigationId: string): Promise<BriefDocument> {
    const investigation = await this.investigation(organizationId, investigationId);
    const stored = await this.store.latestBrief(investigationId);
    if (stored === undefined) throw briefNotFound(investigation.displayId);

    const [claims, rows, matrix, input, repositories] = await Promise.all([
      this.store.claims(stored.id),
      this.store.ledger(investigationId),
      this.store.matrix(investigationId),
      this.store.matrixInput(investigationId),
      this.store.repositories(organizationId),
    ]);

    const resolve = repositoryResolver(repositories);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ledger = rows.map((row) => ledgerSourceResource(row, resolve));
    const cited = new Set(claims.flatMap((claim) => claim.sources));

    return {
      ledger,
      brief: {
        investigation: {
          id: investigation.id,
          displayId: investigation.displayId,
          question: investigation.question,
          kind: investigation.kind,
          kindLabel: investigation.kindLabel,
          tintKey: investigation.tintKey,
          depth: investigation.depth,
          status: investigation.status,
        },
        brief: {
          id: stored.id,
          version: stored.version,
          createdAt: stored.createdAt.toISOString(),
          paragraphs: briefParagraphs(stored.body, claims, byId, resolve),
        },
        sources: {
          cited: ledger.length,
          panel: ledger.filter((source) => cited.has(source.sourceId)).map(sourceResource),
        },
        matrix: matrix === undefined ? null : matrixResource(matrix, byId),
        proposed:
          matrix === undefined
            ? null
            : proposeFromGaps(
                input ?? null,
                matrix.rows.map((row) => ({ capability: row.capability, severity: row.severity })),
              ),
        provenance: {
          researcher: investigation.provenance?.researcher ?? null,
          alias: investigation.provenance?.alias ?? null,
        },
        exportFilename: exportFilename(investigation.displayId),
      },
    };
  }

  /**
   * @param organizationId - The workspace.
   * @param investigationId - The investigation.
   * @returns The workspace's investigation.
   * @throws {NotFoundError} `investigation_not_found`.
   */
  private async investigation(
    organizationId: string,
    investigationId: string,
  ): Promise<BriefInvestigation> {
    const investigation = await this.store.findInvestigation(organizationId, investigationId);
    if (investigation === undefined) throw investigationNotFound(investigationId);

    return investigation;
  }
}
