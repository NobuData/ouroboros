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
 * in memory. The tools card's health dot (CN.3, #629) is the other question, *does this
 * workspace's configuration of it work?*, which `healthCheck()` answers per workspace — so the
 * same read carries both, with the sub-line's counts and what the row's **enable** opens.
 *
 * **Nothing here rejects because a tool is unwell.** An adapter's `counts()` and `healthCheck()`
 * promise not to; one that breaks the promise is drawn `down`, not allowed to take the card with
 * it.
 */

import { Injectable } from "@nestjs/common";

import { ResearchRepository, type ToolRow } from "./research.repository";
import {
  ANSWERING_STATES,
  BUILT_IN_KIND_ORDER,
  BUILT_IN_TOOL_ORDER,
  type InvestigationKindCatalogResource,
  PLANNED_TOOLS,
  type ResearchToolCatalogEntryResource,
  type ResearchToolCatalogResource,
  orderCatalog,
} from "./resources";
import type { ResearchToolAdapter } from "./tools/research-tool.adapter";
import {
  partitionToolSubmission,
  type ResearchToolConfig,
  toToolFormFields,
  toolConfigViolations,
} from "./tools/research-tool.config";
import { toolConfigInvalid, toolNotFound } from "./tools/research-tool.errors";
import {
  healthDot,
  NOT_CONFIGURED_HEALTH,
  renderSubLine,
  type ToolHealth,
} from "./tools/research-tool.health";
import { ResearchToolRegistry } from "./tools/research-tool.registry";
import type { ToolSettings } from "./tools/research-tool.settings";
import { StoredToolSettings } from "./tools/research-tool.settings.store";

/** What a tool whose adapter broke its never-reject promise is drawn as. */
const BROKEN_HEALTH: ToolHealth = { state: "down", detail: "the tool's health check failed" };

@Injectable()
export class ResearchCatalogService {
  /**
   * @param research - The kinds and the tool table.
   * @param registry - The adapters this build registered.
   * @param settings - Each workspace's stored settings for a tool.
   */
  constructor(
    private readonly research: ResearchRepository,
    private readonly registry: ResearchToolRegistry,
    private readonly settings: StoredToolSettings,
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
   * The research tools this installation answers to, as one workspace sees them.
   *
   * @param organizationId - The workspace whose settings, counts and health are read.
   * @returns Every `research_tools` row, in the mockup's order — named and glyphed by its
   *   adapter where one is registered — with its live sub-line, its health and what **enable**
   *   opens; and how many of them answer.
   */
  async tools(organizationId: string): Promise<ResearchToolCatalogResource> {
    const rows = await this.research.listTools();
    const tools = orderCatalog(
      await Promise.all(rows.map((row) => this.entry(organizationId, row))),
      BUILT_IN_TOOL_ORDER,
    );

    return {
      tools,
      connectedCount: tools.filter((tool) => ANSWERING_STATES.includes(tool.health.state)).length,
    };
  }

  /**
   * Store a workspace's settings for a tool — the enable flow's save.
   *
   * @param organizationId - The workspace.
   * @param slug - The tool.
   * @param values - The submitted form, credential included.
   * @param userId - Who is saving.
   * @returns The tool's row as it now reads, health re-asked with the new settings.
   * @throws {NotFoundError} `research_tool_not_found` — no such tool.
   * @throws {NotImplementedError} `research_tool_not_registered` — this build has no adapter
   *   for it (the planned `docs` tool).
   * @throws {InvalidRequestError} `research_tool_config_invalid` — the tool's schema refused
   *   the submission; `details.fields` names every field.
   */
  async enable(
    organizationId: string,
    slug: string,
    values: Readonly<Record<string, unknown>>,
    userId: string,
  ): Promise<ResearchToolCatalogEntryResource> {
    const row = (await this.research.listTools()).find((tool) => tool.slug === slug);

    if (row === undefined) throw toolNotFound(slug);

    const schema = this.registry.get(slug).configSchema();
    const violations = toolConfigViolations(schema, values);

    if (Object.keys(violations).length > 0) throw toolConfigInvalid(slug, violations);

    const submission = partitionToolSubmission(schema, values);

    await this.settings.store(organizationId, slug, {
      config: submission.config,
      secret: submission.secret,
      userId,
    });

    return this.entry(organizationId, row);
  }

  /**
   * One tool's row.
   *
   * @param organizationId - The workspace.
   * @param row - The tool's `research_tools` row.
   * @returns The row as the composer and the tools card draw it.
   */
  private async entry(
    organizationId: string,
    row: ToolRow,
  ): Promise<ResearchToolCatalogEntryResource> {
    const adapter = this.registry.find(row.slug);

    if (adapter === undefined) {
      const planned = PLANNED_TOOLS[row.slug];

      return {
        slug: row.slug,
        name: row.displayName,
        glyph: planned?.glyph ?? null,
        connected: false,
        subLine: planned?.subLine ?? null,
        health: { ...NOT_CONFIGURED_HEALTH, dot: healthDot(NOT_CONFIGURED_HEALTH) },
        configured: false,
        hasCredential: false,
        enable:
          planned === undefined
            ? null
            : { kind: "planned", release: planned.release, issue: planned.issue },
      };
    }

    const stored = await this.stored(organizationId, row.slug);
    const config = stored?.config ?? null;
    const meta = adapter.displayMeta();
    const schema = adapter.configSchema();
    const [subLine, health] = await Promise.all([
      this.subLine(adapter, organizationId, config, meta.subLine),
      this.health(adapter, organizationId, stored),
    ]);

    return {
      slug: row.slug,
      name: meta.name,
      glyph: meta.glyph,
      connected: true,
      subLine,
      health: { ...health, dot: healthDot(health) },
      configured: stored !== null,
      hasCredential: stored !== null && stored.secret !== null,
      enable: {
        kind: "form",
        title: schema.title,
        fields: toToolFormFields(schema),
        values: config ?? {},
      },
    };
  }

  /**
   * The workspace's stored settings for a tool, a failed read drawn as *none*.
   *
   * @param organizationId - The workspace.
   * @param slug - The tool.
   * @returns The settings, or null.
   */
  private async stored(organizationId: string, slug: string): Promise<ToolSettings | null> {
    try {
      return await this.settings.settingsFor(organizationId, slug);
    } catch {
      return null;
    }
  }

  /**
   * A tool's sub-line with this workspace's counts.
   *
   * @param adapter - The tool.
   * @param organizationId - The workspace.
   * @param config - Its configuration of the tool, or null.
   * @param template - The adapter's sub-line template.
   * @returns The rendered line; every slot an em dash when the counts could not be read.
   */
  private async subLine(
    adapter: ResearchToolAdapter,
    organizationId: string,
    config: ResearchToolConfig | null,
    template: string,
  ): Promise<string> {
    try {
      return renderSubLine(template, await adapter.counts(organizationId, config));
    } catch {
      return renderSubLine(template, {});
    }
  }

  /**
   * A tool's health under this workspace's settings.
   *
   * @param adapter - The tool.
   * @param organizationId - The workspace.
   * @param stored - Its settings, or null.
   * @returns What `healthCheck()` answered; `down` if it rejected.
   */
  private async health(
    adapter: ResearchToolAdapter,
    organizationId: string,
    stored: ToolSettings | null,
  ): Promise<ToolHealth> {
    try {
      return await adapter.healthCheck(
        stored?.config ?? null,
        stored?.secret ?? null,
        organizationId,
      );
    } catch {
      return BROKEN_HEALTH;
    }
  }
}
