/**
 * The repository a roadmap is projected into, as the pipeline reaches it (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * {@link RepoGateway.open} opens a ticket source's credential for the length of one piece of
 * work and hands that work a {@link RoadmapRepo}: the six things the pipeline does to a
 * repository. The services are written against the interface; {@link ProviderRepoGateway} is the
 * provider SPI's repository-document family (`ticket-source.repo-doc.ts`).
 */

import { Injectable } from "@nestjs/common";

import type { CreatePrInput, HostPrState, PrRef } from "../../ticket-sources/ticket-source.pr";
import { supportsWrites } from "../../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../../ticket-sources/ticket-source.registry";
import {
  supportsRepoDocs,
  type CommitFileInput,
  type CommitFileResult,
  type RepoDocState,
  type UpdatePrInput,
} from "../../ticket-sources/ticket-source.repo-doc";
import { TicketSourceError } from "../../ticket-sources/ticket-source.errors";
import type { SyncSource } from "../../ticket-sources/ticket-sources.repository";
import { TicketSourcesService } from "../../ticket-sources/ticket-sources.service";

/** What the pipeline does to one repository, credential already open. */
export interface RoadmapRepo {
  /** @returns The default branch — where the document lands. */
  defaultBranch(): Promise<string>;
  /**
   * @param path - The file.
   * @param ref - A branch or commit.
   * @returns The file as that ref holds it, or null.
   */
  fileAt(path: string, ref: string): Promise<RepoDocState | null>;
  /**
   * @param input - The file, its text, the message and the branches.
   * @returns The commit holding the content, and whether anything was written.
   */
  commitFile(input: CommitFileInput): Promise<CommitFileResult>;
  /**
   * @param input - The branches, title and description.
   * @returns The PR — the open one for this branch and base when there is one.
   */
  openPR(input: CreatePrInput): Promise<PrRef>;
  /**
   * @param prNumber - The PR.
   * @param input - The fields to change.
   */
  updatePR(prNumber: number, input: UpdatePrInput): Promise<void>;
  /**
   * @param prNumber - The PR.
   * @returns Where it stands on the host.
   */
  prState(prNumber: number): Promise<HostPrState>;
}

/** Opens a source's repository for one piece of work. */
export interface RepoGateway {
  /**
   * @param source - The ticket source whose push target holds the document.
   * @param work - What to do with the repository.
   * @returns What the work answered; `undefined` when the source's host cannot hold a document
   *   (a tracker with no repository) — the work is not run.
   * @throws {TicketSourceError} The host's refusal, classified by the provider.
   */
  open<T>(source: SyncSource, work: (repo: RoadmapRepo) => Promise<T>): Promise<T | undefined>;
  /**
   * Where a reader opens the source's repository in a browser (#631). Reads the stored
   * configuration only — no credential is opened and the host is not called.
   *
   * @param source - The ticket source whose push target holds the document.
   * @returns `https://github.com/acme-robotics/helios-firmware`; null for a host whose address
   *   the pipeline cannot compose, or a configuration that names no repository.
   */
  webUrl(source: SyncSource): string | null;
}

/** The web origin of each host a roadmap document's address can be composed for. */
const WEB_ORIGINS: Partial<Record<SyncSource["kind"], string>> = { github: "https://github.com" };

@Injectable()
export class ProviderRepoGateway implements RepoGateway {
  /**
   * @param registry - Finds a source's provider.
   * @param sources - Opens a source's credential for one call.
   */
  constructor(
    private readonly registry: TicketSourceRegistry,
    private readonly sources: TicketSourcesService,
  ) {}

  /** @inheritdoc */
  async open<T>(
    source: SyncSource,
    work: (repo: RoadmapRepo) => Promise<T>,
  ): Promise<T | undefined> {
    const provider = this.registry.find(source.kind);

    if (provider === undefined || !supportsRepoDocs(provider)) return undefined;

    return this.sources.withCredentials(source, (context) =>
      work({
        defaultBranch: () => provider.defaultBranch(context),
        fileAt: (path, ref) => provider.fileAt(context, path, ref),
        commitFile: (input) => provider.commitFile(context, input),
        openPR: async (input) => {
          const pr = await provider.createPR(context, input);

          // `supportsRepoDocs` has already asked for `pr.pullRequests`; a provider that still
          // answers null has declared something it does not do.
          if (pr === null) throw new Error(`${source.kind} declared pull requests and opened none`);

          return pr;
        },
        updatePR: (prNumber, input) => provider.updatePR(context, prNumber, input),
        prState: async (prNumber) => (await provider.getPR(context, prNumber)).state,
      }),
    );
  }

  /** @inheritdoc */
  webUrl(source: SyncSource): string | null {
    const origin = WEB_ORIGINS[source.kind];
    const provider = this.registry.find(source.kind);

    // The document lives where a push lands, so only a host that both holds documents and names
    // its push target has an address here.
    if (origin === undefined || provider === undefined) return null;
    if (!supportsRepoDocs(provider) || !supportsWrites(provider)) return null;

    try {
      return `${origin}/${provider.pushTargetName(source.config)}`;
    } catch (error) {
      // A configuration that names no repository has no address; anything else is a defect.
      if (!TicketSourceError.is(error)) throw error;

      return null;
    }
  }
}
