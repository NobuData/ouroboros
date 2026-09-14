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
 *
 * **The code view's symbol table is served from here too** (W.1,
 * [#177](https://github.com/NobuData/ouroboros/issues/177)), because it has the same two halves
 * with the same two lifetimes: completions and hover cards read from the grammar and the schema
 * once, and the same workspace suggestions per request. One read of `task_kinds` answers both, so
 * the inspector and the editor cannot suggest different task routes.
 *
 * **So is the catalogue the code view's reference checks answer from** (W.2,
 * [#178](https://github.com/NobuData/ouroboros/issues/178)): the same suggestions, as decision
 * **P7**'s catalogue, so a name the editor suggests is a name its diagnostics accept.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { WorkflowCatalogRepository } from "./catalog.repository";
import {
  stageCatalog,
  stageCatalogEntries,
  toDslCatalogue,
  type StageCatalog,
  type StageCatalogEntry,
  type StageSuggestions,
} from "./catalog.resources";
import { nodeTypeSchemas, publishedSchemaId, type JsonSchema } from "./catalog.schema";
import { buildCodeSymbols, codeSymbolTable, type CodeSymbolTable } from "./code.symbols";
import type { DslCatalogue } from "./dsl.references";

/** The injection token the published workflow DSL schema is provided under. */
export const PUBLISHED_DSL_SCHEMA = Symbol("PUBLISHED_DSL_SCHEMA");

@Injectable()
export class WorkflowCatalogService {
  /** The published schema's `$id`, for {@link StageCatalog.schemaId}. */
  private readonly schemaId: string;

  /** Every node type, built once. Frozen, so no answer can edit the next one. */
  private readonly nodeTypes: readonly StageCatalogEntry[];

  /** The code view's symbol table without suggestions — built once, frozen the same way. */
  private readonly staticSymbols: CodeSymbolTable;

  /**
   * @param repository - The workspace's task kinds.
   * @param config - `OURO_WORKFLOW_SKILL_SUGGESTIONS`.
   * @param schema - The published workflow DSL schema.
   * @throws {DslSchemaError} If the schema lacks the node-type dispatch the catalog reads, or a
   *   location `code.grammar.ts` points at — at boot, where a schema edit the reader was not told
   *   about is cheap to find.
   */
  constructor(
    private readonly repository: WorkflowCatalogRepository,
    private readonly config: AppConfigService,
    @Inject(PUBLISHED_DSL_SCHEMA) schema: JsonSchema,
  ) {
    this.schemaId = publishedSchemaId(schema);
    this.nodeTypes = stageCatalogEntries(nodeTypeSchemas(schema));
    this.staticSymbols = buildCodeSymbols(schema);
  }

  /**
   * The catalog one workspace's studio renders from.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Every node type, and this workspace's suggestions.
   */
  async catalog(organizationId: string): Promise<StageCatalog> {
    return stageCatalog(this.schemaId, this.nodeTypes, await this.suggestions(organizationId));
  }

  /**
   * The symbol table one workspace's code editor completes and documents from (W.1).
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The static table, with this workspace's task routes and the configured skills
   *   offered as suggestions.
   */
  async codeSymbols(organizationId: string): Promise<CodeSymbolTable> {
    return codeSymbolTable(this.staticSymbols, await this.suggestions(organizationId));
  }

  /**
   * The names one workspace's code view checks references against (W.2).
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns The suggestions as decision **P7**'s catalogue: an empty list is left out, so it is
   *   *not checked* rather than *nothing exists*.
   */
  async dslCatalogue(organizationId: string): Promise<DslCatalogue> {
    return toDslCatalogue(await this.suggestions(organizationId));
  }

  /**
   * What this workspace is advised to name — the one read every answer shares.
   *
   * @param organizationId - The workspace.
   * @returns The configured skills and the workspace's task kinds, in matrix order.
   */
  private async suggestions(organizationId: string): Promise<StageSuggestions> {
    return {
      skills: this.config.workflowSkillSuggestions,
      taskRoutes: await this.repository.taskKindNames(organizationId),
    };
  }
}
