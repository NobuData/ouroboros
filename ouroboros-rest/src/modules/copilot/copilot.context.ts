/**
 * What grounds a turn — assembled from the services that own each piece, so the copilot
 * proposes what exists.
 *
 * The stage catalog (R.3, #145) and decision P7's catalogue of skills and task routes come from
 * `WorkflowCatalogService`, the same reads the canvas and the code view make; the guard vocabulary
 * is the org policy's. Nothing here is invented, and a name outside these lists is exactly what
 * W7 warns on.
 */

import { Injectable } from "@nestjs/common";

import type { EngineCatalogEntry, EngineCopilotContext } from "../engine/engine.copilot";
import { WorkflowCatalogService } from "../workflows/catalog.service";
import type { DslCatalogue } from "../workflows/dsl.references";
import { GUARD_VOCABULARY } from "./copilot.guards";

/** A turn's grounding, and the catalogue the loop checks references against. */
export interface CopilotGrounding {
  /** What the engine is sent, with the draft left for the loop to fill in per turn. */
  readonly context: Omit<EngineCopilotContext, "draft" | "draftLabel">;
  /** The names that exist, for W7. */
  readonly catalogue: DslCatalogue;
}

@Injectable()
export class CopilotContextService {
  /**
   * @param catalog - The stage catalog and P7's catalogue (R.3).
   */
  constructor(private readonly catalog: WorkflowCatalogService) {}

  /**
   * Assemble one workspace's grounding.
   *
   * @param organizationId - The workspace.
   * @returns The context and the catalogue.
   */
  async grounding(organizationId: string): Promise<CopilotGrounding> {
    const [stages, catalogue] = await Promise.all([
      this.catalog.catalog(organizationId),
      this.catalog.dslCatalogue(organizationId),
    ]);

    const catalog: EngineCatalogEntry[] = stages.nodeTypes.map((entry) => ({
      type: entry.type as EngineCatalogEntry["type"],
      label: entry.label,
      summary: "",
    }));

    return {
      context: {
        catalog,
        skills: catalogue.skills ?? [],
        tasks: catalogue.tasks ?? [],
        guards: GUARD_VOCABULARY,
      },
      catalogue,
    };
  }

  /**
   * The catalogue a promotion is read against (#1745): P7's skills and task routes, and the
   * registry's model aliases — the names the publish gate holds a pinned model to, so an alias
   * it will refuse is reported as blocking before **Promote** is pressed.
   *
   * @param organizationId - The workspace.
   * @returns The catalogue, aliases included.
   */
  async promotionCatalogue(organizationId: string): Promise<DslCatalogue> {
    const [catalogue, aliases] = await Promise.all([
      this.catalog.dslCatalogue(organizationId),
      this.catalog.aliasNames(organizationId),
    ]);

    return { ...catalogue, aliases };
  }
}
