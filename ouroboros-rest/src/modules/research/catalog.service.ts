/**
 * The composer's two catalogs (CN.2, [#628](https://github.com/NobuData/ouroboros/issues/628)):
 * the workspace's investigation kinds, and the research tools this installation answers to.
 *
 * Both are reads of registries that already exist — V106's `investigation_kinds` and
 * `research_tools` tables, and CL.1's adapter registry — published so the composer draws its
 * segmented control and its chips from them rather than from constants. #629's tools card and
 * #632's kind facets read the same two.
 *
 * **A tool is connected when an adapter is registered for its slug.** That is the question the
 * composer asks — *can an investigation call this?* — and it needs no network: the registry is
 * in memory. The tools card's health dot (#629) is the other question, *does this workspace's
 * configuration of it work?*, which `healthCheck()` answers per workspace.
 */

import { Injectable } from "@nestjs/common";

import { ResearchRepository } from "./research.repository";
import {
  BUILT_IN_KIND_ORDER,
  BUILT_IN_TOOL_ORDER,
  type InvestigationKindCatalogResource,
  type ResearchToolCatalogResource,
  orderCatalog,
} from "./resources";
import { ResearchToolRegistry } from "./tools/research-tool.registry";

@Injectable()
export class ResearchCatalogService {
  /**
   * @param research - The kinds and the tool table.
   * @param registry - The adapters this build registered.
   */
  constructor(
    private readonly research: ResearchRepository,
    private readonly registry: ResearchToolRegistry,
  ) {}

  /**
   * A workspace's investigation kinds.
   *
   * @param organizationId - The workspace.
   * @returns Every kind, the built-in four first in the mockup's order, then the workspace's
   *   own by name. Empty only for a workspace V106's seed never reached.
   */
  async kinds(organizationId: string): Promise<InvestigationKindCatalogResource> {
    const rows = await this.research.listKinds(organizationId);

    return {
      kinds: orderCatalog(
        rows.map((row) => ({
          slug: row.slug,
          name: row.displayName,
          tint: row.tintKey,
          playbook: {
            version: row.playbook.version,
            defaultTools: [...row.playbook.default_tools],
            deliverables: [...row.playbook.deliverables],
          },
        })),
        BUILT_IN_KIND_ORDER,
      ),
    };
  }

  /**
   * The research tools this installation answers to.
   *
   * @returns Every `research_tools` row, in the mockup's order, each saying whether an adapter
   *   is registered for it — named and glyphed by the adapter where one is.
   */
  async tools(): Promise<ResearchToolCatalogResource> {
    const rows = await this.research.listTools();

    return {
      tools: orderCatalog(
        rows.map((row) => {
          const adapter = this.registry.find(row.slug);
          const meta = adapter?.displayMeta();

          return {
            slug: row.slug,
            name: meta?.name ?? row.displayName,
            glyph: meta?.glyph ?? null,
            connected: adapter !== undefined,
          };
        }),
        BUILT_IN_TOOL_ORDER,
      ),
    };
  }
}
