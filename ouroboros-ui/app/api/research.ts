import "server-only";

/**
 * The research plane, as the composer calls it (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)) — one page's calls to one tag,
 * kept together the way `app/api/sources.ts` keeps the ticket sources'.
 *
 * Seven operations: the two **catalogs** the composer is drawn from (the workspace's
 * investigation kinds and the installation's research tools, #628's own routes), the
 * **setting** that says who may start (#625), the **estimate** every change of kind, depth or
 * tool asks for (#622, decision **V5**), and the lifecycle's **start**, **cancel** and one
 * **read** (#625). The progress stream is not here: it is a `text/event-stream`, and
 * `app/api/research-progress.ts` passes it through to the browser as bytes.
 *
 * ### The estimate is the service's sentence
 * `ScopeEstimate.label` is composed once, in the service, so every surface prints the same
 * words — and the honesty rule is structural there: with an unpriced researcher `costCents` is
 * null and the label carries no `$`. Nothing here, and nothing in the composer, composes a
 * dollar figure of its own.
 *
 * ### The workspace is the session's
 * No call names a workspace. Every member reads the catalogs, the setting and an estimate;
 * starting follows the workspace's setting and cancelling is the starter's or an admin's — both
 * decided by the service, whose `403` the composer renders rather than pre-empts.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components, paths } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One investigation kind — `openapi.yaml` § `InvestigationKind`. */
export type InvestigationKind = components["schemas"]["InvestigationKind"];

/** The workspace's kinds, in the composer's order. */
export type InvestigationKindCatalog = components["schemas"]["InvestigationKindCatalog"];

/** One research tool and whether an adapter is registered for it. */
export type ResearchToolCatalogEntry = components["schemas"]["ResearchToolCatalogEntry"];

/** Every tool the installation answers to, in the composer's order. */
export type ResearchToolCatalog = components["schemas"]["ResearchToolCatalog"];

/** Who may start an investigation — `member` or `admin`. */
export type ResearchSettings = components["schemas"]["ResearchSettings"];

/** What the composer has chosen so far — kind, depth and the chips that are on. */
export type InvestigationEstimateRequest = components["schemas"]["InvestigationEstimateRequest"];

/** The estimate, the researcher and the composer's line. */
export type ScopeEstimate = components["schemas"]["ScopeEstimate"];

/** The alias routing resolved `research` to — the pill. */
export type Researcher = components["schemas"]["Researcher"];

/** The Depth menu's three values. */
export type InvestigationDepth = ScopeEstimate["depth"];

/** An investigation's status. */
export type InvestigationStatus = components["schemas"]["InvestigationStatus"];

/** What a start sends. */
export type InvestigationStart = components["schemas"]["InvestigationStart"];

/** An investigation, opened. */
export type InvestigationDetail = components["schemas"]["InvestigationDetail"];

/** A reading of a run's progress — one stream event, and the detail's `progress`. */
export type InvestigationProgress = components["schemas"]["InvestigationProgress"];

/** What a start answers: the investigation, dispatched, and the estimate stored on it. */
export type StartedInvestigation = components["schemas"]["StartedInvestigation"];

/** What a cancel answers. */
export type CancelledInvestigation = components["schemas"]["CancelledInvestigation"];

/** A page of investigations under the card's two counts. */
export type InvestigationList = components["schemas"]["InvestigationList"];

/** The list's filters and page. */
export type InvestigationListQuery = NonNullable<
  paths["/api/v1/research/investigations"]["get"]["parameters"]["query"]
>;

/** A brief: its paragraphs and cites, the sources panel, the matrix and the proposals (#621). */
export type InvestigationBrief = components["schemas"]["InvestigationBrief"];

/** One paragraph of a brief. */
export type BriefParagraph = components["schemas"]["BriefParagraph"];

/** One span of a paragraph — a claim, or connective prose. */
export type BriefSpan = components["schemas"]["BriefSpan"];

/** A marker after a claim — `[07]`. */
export type BriefCite = components["schemas"]["BriefCite"];

/** A source, as the panel lists it. */
export type BriefSource = components["schemas"]["BriefSource"];

/** A source with what was archived of it, as the full ledger lists it. */
export type BriefLedgerSource = components["schemas"]["BriefLedgerSource"];

/** An investigation's whole ledger. */
export type BriefLedger = components["schemas"]["BriefLedger"];

/** A gap analysis's matrix. */
export type CapabilityMatrix = components["schemas"]["CapabilityMatrix"];

/** One row of a matrix. */
export type MatrixRow = components["schemas"]["MatrixRow"];

/** One cell of a matrix. */
export type MatrixCell = components["schemas"]["MatrixCell"];

/** The epic and tickets a brief proposes from its gaps. */
export type GapProposals = components["schemas"]["GapProposals"];

/** What **Draft epic from gaps →** sends. */
export type DraftEpicRequest = components["schemas"]["ResearchDraftEpicRequest"];

/** What it answers: the epic, the batch and where to review it. */
export type DraftEpic = components["schemas"]["ResearchDraftEpic"];

/** The research calls. Each takes the client to use, defaulting to the request's own. */
export const research = {
  /**
   * The workspace's investigation kinds.
   *
   * @param client The client to call through.
   * @returns The kinds, in the composer's order.
   */
  async kinds(client: ApiClient = api()): Promise<InvestigationKindCatalog> {
    return unwrap(await client.GET("/api/v1/research/kinds"));
  },

  /**
   * The research tools this installation answers to.
   *
   * @param client The client to call through.
   * @returns Every tool, connected or idle, in the composer's order.
   */
  async tools(client: ApiClient = api()): Promise<ResearchToolCatalog> {
    return unwrap(await client.GET("/api/v1/research/tools"));
  },

  /**
   * Who may start an investigation here.
   *
   * @param client The client to call through.
   * @returns The setting.
   */
  async settings(client: ApiClient = api()): Promise<ResearchSettings> {
    return unwrap(await client.GET("/api/v1/research/settings"));
  },

  /**
   * Estimate a prospective investigation.
   *
   * @param body Kind, depth and the enabled tools.
   * @param client The client to call through.
   * @returns The estimate — a `POST` for a read; nothing is created.
   */
  async estimate(
    body: InvestigationEstimateRequest,
    client: ApiClient = api(),
  ): Promise<ScopeEstimate> {
    return unwrap(await client.POST("/api/v1/research/estimates", { body }));
  },

  /**
   * Start an investigation.
   *
   * @param body The composer's payload.
   * @param client The client to call through.
   * @returns The investigation, dispatched, with its estimate.
   */
  async start(body: InvestigationStart, client: ApiClient = api()): Promise<StartedInvestigation> {
    return unwrap(await client.POST("/api/v1/research/investigations", { body }));
  },

  /**
   * One investigation, opened.
   *
   * @param investigationId The investigation.
   * @param client The client to call through.
   * @returns The detail.
   */
  async investigation(
    investigationId: string,
    client: ApiClient = api(),
  ): Promise<InvestigationDetail> {
    return unwrap(
      await client.GET("/api/v1/research/investigations/{investigationId}", {
        params: { path: { investigationId } },
      }),
    );
  },

  /**
   * Stop an investigation; what it gathered is kept.
   *
   * @param investigationId The investigation.
   * @param client The client to call through.
   * @returns `cancelled` or `cancelling`, and the investigation as it stands.
   */
  async cancel(investigationId: string, client: ApiClient = api()): Promise<CancelledInvestigation> {
    return unwrap(
      await client.POST("/api/v1/research/investigations/{investigationId}/cancel", {
        params: { path: { investigationId } },
      }),
    );
  },

  /**
   * The investigations list — the card, History and the library.
   *
   * @param query Filters and the page; every filter given must hold.
   * @param client The client to call through.
   * @returns One page of rows, newest first, under the two counts.
   */
  async investigations(
    query: InvestigationListQuery = {},
    client: ApiClient = api(),
  ): Promise<InvestigationList> {
    return unwrap(await client.GET("/api/v1/research/investigations", { params: { query } }));
  },

  /**
   * An investigation's brief.
   *
   * @param investigationId The investigation.
   * @param client The client to call through.
   * @returns The brief — `404 brief_not_found` until the investigation has delivered one.
   */
  async brief(investigationId: string, client: ApiClient = api()): Promise<InvestigationBrief> {
    return unwrap(
      await client.GET("/api/v1/research/investigations/{investigationId}/brief", {
        params: { path: { investigationId } },
      }),
    );
  },

  /**
   * An investigation's whole ledger — every record read, with its excerpt and retrieval time.
   *
   * @param investigationId The investigation.
   * @param client The client to call through.
   * @returns The ledger, in cite-number order.
   */
  async sources(investigationId: string, client: ApiClient = api()): Promise<BriefLedger> {
    return unwrap(
      await client.GET("/api/v1/research/investigations/{investigationId}/sources", {
        params: { path: { investigationId } },
      }),
    );
  },

  /**
   * **Draft epic from gaps →** — the brief's proposals as a Planning batch. Nothing is filed.
   *
   * @param investigationId The investigation.
   * @param body The tracker the drafts are for; empty when the workspace has exactly one.
   * @param client The client to call through.
   * @returns The epic, the batch and where to review it.
   */
  async draftEpic(
    investigationId: string,
    body: DraftEpicRequest = {},
    client: ApiClient = api(),
  ): Promise<DraftEpic> {
    return unwrap(
      await client.POST("/api/v1/research/investigations/{investigationId}/draft-epic", {
        params: { path: { investigationId } },
        body,
      }),
    );
  },
};
