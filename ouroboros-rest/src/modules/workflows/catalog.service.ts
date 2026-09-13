/**
 * `WorkflowCatalogService` — the stage catalog, assembled — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * Two halves with two lifetimes. The node types — config schemas, glyphs, defaults — are a
 * property of the build: they are read from the published schema once, at construction, and
 * the same frozen entries answer every request. The suggestions are a property of the
 * workspace and are read per request: `task_kinds` changes when an operator edits the routing
 * matrix, and the next Add-stage menu should know.
 *
 * The published schema is **injected** rather than read here, under
 * {@link PUBLISHED_DSL_SCHEMA}. `workflows.module.ts` provides the committed file; a suite
 * provides a clone with a synthetic node type, and the service serves it exactly as it would
 * serve a type added to `v1.json` — which is the ticket's *zero UI changes*, proven one layer
 * above the pure functions.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { WorkflowCatalogRepository } from "./catalog.repository";
import {
  stageCatalog,
  stageCatalogEntries,
  type StageCatalog,
  type StageCatalogEntry,
} from "./catalog.resources";
import { nodeTypeSchemas, publishedSchemaId, type JsonSchema } from "./catalog.schema";

/** The injection token the published workflow DSL schema is provided under. */
export const PUBLISHED_DSL_SCHEMA = Symbol("PUBLISHED_DSL_SCHEMA");

@Injectable()
export class WorkflowCatalogService {
  /** The published schema's `$id`, for {@link StageCatalog.schemaId}. */
  private readonly schemaId: string;

  /** Every node type, built once. Frozen, so no answer can edit the next one. */
  private readonly nodeTypes: readonly StageCatalogEntry[];

  /**
   * @param repository - The workspace's task kinds.
   * @param config - `OURO_WORKFLOW_SKILL_SUGGESTIONS`.
   * @param schema - The published workflow DSL schema.
   * @throws {DslSchemaError} If the schema lacks the node-type dispatch the catalog reads —
   *   at boot, where a schema edit the reader was not told about is cheap to find.
   */
  constructor(
    private readonly repository: WorkflowCatalogRepository,
    private readonly config: AppConfigService,
    @Inject(PUBLISHED_DSL_SCHEMA) schema: JsonSchema,
  ) {
    this.schemaId = publishedSchemaId(schema);
    this.nodeTypes = stageCatalogEntries(nodeTypeSchemas(schema));
  }

  /**
   * The catalog one workspace's studio renders from.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Every node type, and this workspace's suggestions.
   */
  async catalog(organizationId: string): Promise<StageCatalog> {
    const taskRoutes = await this.repository.taskKindNames(organizationId);

    return stageCatalog(this.schemaId, this.nodeTypes, {
      skills: this.config.workflowSkillSuggestions,
      taskRoutes,
    });
  }
}
