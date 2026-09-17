/**
 * Planning — what mockup 09 reads and writes through `ouroboros-rest`.
 *
 * AM.1 ([#283](https://github.com/NobuData/ouroboros/issues/283)) needs two of AL.4's operations
 * ([#280](https://github.com/NobuData/ouroboros/issues/280)): the roadmap read, which the page's
 * roadmap region heads itself with, and the lane create, which **New roadmap** is. AM.2
 * ([#284](https://github.com/NobuData/ouroboros/issues/284)) adds the generator card's seven: generate,
 * read, regenerate, the per-draft patch, push, resume, and a source's milestones. AM.4's gantt
 * ([#286](https://github.com/NobuData/ouroboros/issues/286)) adds the lane patch — a drag, a
 * stepper, the epic editor's save — and the editor's ticket management: the lane's links and
 * mirrors, the link picker's search, link and unlink. Reorder and delete are not drawn anywhere yet,
 * so they are not here.
 *
 * ### A roadmap is not an entity
 *
 * There is no `POST /roadmaps`. AK.3 ([#274](https://github.com/NobuData/ouroboros/issues/274))
 * stores `roadmap_name` and `roadmap_window` **on each lane**, and the roadmap read's head is the
 * top named lane's. So *creating a roadmap* is creating its first lane with the name on it — which
 * is exactly what {@link planning.createEpic} is asked to do by the dialog.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in these paths and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why). Any member may read the roadmap; creating a lane is `owner` or
 * `admin`, and the service is what enforces it.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The roadmap: its head (name and window, both nullable) and every lane, top first. */
export type PlanningRoadmap = components["schemas"]["PlanningRoadmap"];

/** One roadmap lane, with its computed `12 issues · 8 done` chip. */
export type PlanningEpic = components["schemas"]["PlanningEpic"];

/**
 * What a lane create sends. Only `name` is required; months are paired — both, or both `null` for
 * the dashed unscoped lane — and run forwards (`epic_month_range_invalid` otherwise).
 */
export type PlanningEpicCreate = components["schemas"]["PlanningEpicCreate"];

/** What a lane edit sends — only what changes; `null` clears a nullable field. */
export type PlanningEpicPatch = components["schemas"]["PlanningEpicPatch"];

/** A lane's linked tickets and tracker mirrors — the epic editor's two lists. */
export type PlanningEpicLinks = components["schemas"]["PlanningEpicLinks"];

/** One canonical ticket, linked to a lane or a candidate to link. */
export type PlanningTicket = components["schemas"]["PlanningTicket"];

/** What a lane became in one tracker when a push filed it. */
export type PlanningEpicMirror = components["schemas"]["PlanningEpicMirror"];

/** The link picker's matches. */
export type PlanningTicketSearch = components["schemas"]["PlanningTicketSearch"];

/** A stored batch of drafts, its footer, and every draft's push state and estimate. */
export type PlanningBatch = components["schemas"]["PlanningBatch"];

/** A batch as a generation or regeneration answers it — with the planner's guidance `notes`. */
export type GeneratedPlanningBatch = components["schemas"]["GeneratedPlanningBatch"];

/** One draft row. */
export type PlanningDraft = components["schemas"]["PlanningDraft"];

/** What **Draft tickets ⟳** sends. */
export type PlanningBatchCreate = components["schemas"]["PlanningBatchCreate"];

/** What changes about one draft — its checkbox, its title and body. An absent field is left alone. */
export type PlanningDraftPatch = components["schemas"]["PlanningDraftPatch"];

/** What one push or resume did, and the queue-small outcome. */
export type PlanningPushResult = components["schemas"]["PlanningPushResult"];

/** A source's open milestones, and whether its tracker has milestones at all. */
export type PlanningMilestones = components["schemas"]["PlanningMilestones"];

/** Planning, as `ouroboros-rest` serves it. */
export const planning = {
  /**
   * The roadmap — every lane with its computed chip, and the head.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The roadmap. A workspace that has planned nothing answers `name: null` and no
   *   lanes — the empty roadmap, not a failure.
   * @throws {ApiError} What the service answered. A `401` redirects to login before this rejects.
   */
  async roadmap(client: ApiClient = api()): Promise<PlanningRoadmap> {
    return unwrap(await client.GET("/api/v1/planning/roadmap", {}));
  },

  /**
   * Create one lane at the bottom of the roadmap.
   *
   * @param body The lane, as the caller composed it — forwarded as it is.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The stored lane.
   * @throws {ApiError} What the service answered — `403 forbidden` for a role below `admin`,
   *   `422 epic_month_range_invalid` for a half or backwards range, `422 validation_failed` for a
   *   body whose shape is wrong.
   */
  async createEpic(body: PlanningEpicCreate, client: ApiClient = api()): Promise<PlanningEpic> {
    return unwrap(await client.POST("/api/v1/planning/epics", { body }));
  },

  /**
   * Edit one lane — a drag, a month stepper, or the epic editor's save.
   *
   * @param id The lane's id.
   * @param body What changes. The merged month range must still be paired and forwards.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The stored lane, its chip recomputed.
   * @throws {ApiError} `403 forbidden` below `admin`, `404 planning_epic_not_found`,
   *   `422 epic_month_range_invalid` or `validation_failed`.
   */
  async updateEpic(
    id: string,
    body: PlanningEpicPatch,
    client: ApiClient = api(),
  ): Promise<PlanningEpic> {
    return unwrap(
      await client.PATCH("/api/v1/planning/epics/{epic}", { params: { path: { epic: id } }, body }),
    );
  },

  /**
   * A lane's linked tickets and tracker mirrors. Any member.
   *
   * @param id The lane's id.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The tickets, open first, and the mirrors.
   * @throws {ApiError} `404 planning_epic_not_found`.
   */
  async epicLinks(id: string, client: ApiClient = api()): Promise<PlanningEpicLinks> {
    return unwrap(
      await client.GET("/api/v1/planning/epics/{epic}/tickets", { params: { path: { epic: id } } }),
    );
  },

  /**
   * Link canonical tickets to a lane; a link that exists is kept once.
   *
   * @param id The lane's id.
   * @param ticketIds The tickets.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The lane, chip recomputed.
   * @throws {ApiError} `403 forbidden` below `admin`, `404 planning_epic_not_found` or
   *   `planning_tickets_not_found`.
   */
  async linkTickets(
    id: string,
    ticketIds: string[],
    client: ApiClient = api(),
  ): Promise<PlanningEpic> {
    return unwrap(
      await client.POST("/api/v1/planning/epics/{epic}/tickets", {
        params: { path: { epic: id } },
        body: { ticketIds },
      }),
    );
  },

  /**
   * Unlink tickets from a lane; a ticket that was not linked is not an error.
   *
   * @param id The lane's id.
   * @param ticketIds The tickets.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The lane, chip recomputed.
   * @throws {ApiError} `403 forbidden` below `admin`, `404 planning_epic_not_found`.
   */
  async unlinkTickets(
    id: string,
    ticketIds: string[],
    client: ApiClient = api(),
  ): Promise<PlanningEpic> {
    return unwrap(
      await client.DELETE("/api/v1/planning/epics/{epic}/tickets", {
        params: { path: { epic: id } },
        body: { ticketIds },
      }),
    );
  },

  /**
   * The workspace's canonical tickets whose title or key contains a term — the link picker.
   *
   * @param q What was typed; blank answers the most recently updated tickets.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns At most twenty matches.
   * @throws {ApiError} `422 validation_failed` for a term over 200 characters.
   */
  async searchTickets(q: string, client: ApiClient = api()): Promise<PlanningTicketSearch> {
    return unwrap(await client.GET("/api/v1/planning/tickets", { params: { query: { q } } }));
  },

  /**
   * Generate a batch of drafts — **Draft tickets ⟳**. The batch is stored; with `autoSize` on it
   * answers `drafting` and is sized behind the answer, so the caller polls {@link planning.batch}.
   *
   * @param body What the card composed.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The stored batch and the planner's notes.
   * @throws {ApiError} `403 forbidden` for a viewer, `404 planning_source_not_found`,
   *   `409 planning_target_read_only`, `422 dependency_cycle` naming the cycle, `502` when the
   *   planner could not be reached.
   */
  async generate(
    body: PlanningBatchCreate,
    client: ApiClient = api(),
  ): Promise<GeneratedPlanningBatch> {
    return unwrap(await client.POST("/api/v1/planning/batches", { body }));
  },

  /**
   * One batch, as it stands.
   *
   * @param id The batch's id.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal A way to give up on the read — the route handler answering the card's poll
   *   passes its deadline.
   * @returns The batch.
   * @throws {ApiError} `404 planning_batch_not_found`, `422 validation_failed` for an id that is not
   *   a uuid.
   */
  async batch(id: string, client: ApiClient = api(), signal?: AbortSignal): Promise<PlanningBatch> {
    return unwrap(
      await client.GET("/api/v1/planning/batches/{batch}", { params: { path: { batch: id } }, signal }),
    );
  },

  /**
   * Regenerate a batch's unpushed drafts, preserving selections by local key.
   *
   * @param id The batch's id.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The batch as it now stands, and the planner's notes.
   * @throws {ApiError} `409 batch_not_editable` while a push is in flight or after it finished.
   */
  async regenerate(id: string, client: ApiClient = api()): Promise<GeneratedPlanningBatch> {
    return unwrap(
      await client.POST("/api/v1/planning/batches/{batch}/regenerate", {
        params: { path: { batch: id } },
      }),
    );
  },

  /**
   * Select, deselect or edit one draft.
   *
   * @param id The batch's id.
   * @param key The draft's local key — `OTA-3`.
   * @param body What changes.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The batch as it now stands — the footer moves with a selection.
   * @throws {ApiError} `409 draft_already_pushed` for an edit to a pushed draft,
   *   `409 batch_not_editable`, `422 validation_failed`.
   */
  async patchDraft(
    id: string,
    key: string,
    body: PlanningDraftPatch,
    client: ApiClient = api(),
  ): Promise<PlanningBatch> {
    return unwrap(
      await client.PATCH("/api/v1/planning/batches/{batch}/drafts/{key}", {
        params: { path: { batch: id, key } },
        body,
      }),
    );
  },

  /**
   * Push a batch's selected drafts to its tracker.
   *
   * @param id The batch's id.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns AL.3's report and the queue-small outcome.
   * @throws {ApiError} `403 forbidden` below `admin`; `409 push_in_progress`, `batch_not_pushable`,
   *   `push_nothing_selected` or `push_target_read_only`.
   */
  async push(id: string, client: ApiClient = api()): Promise<PlanningPushResult> {
    return unwrap(
      await client.POST("/api/v1/planning/batches/{batch}/push", { params: { path: { batch: id } } }),
    );
  },

  /**
   * **Resume push** — re-run only the drafts that did not land.
   *
   * @param id The batch's id.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns AL.3's report and the queue-small outcome.
   * @throws {ApiError} `409 push_nothing_to_resume` besides {@link planning.push}'s refusals.
   */
  async resumePush(id: string, client: ApiClient = api()): Promise<PlanningPushResult> {
    return unwrap(
      await client.POST("/api/v1/planning/batches/{batch}/push/resume", {
        params: { path: { batch: id } },
      }),
    );
  },

  /**
   * A source's open milestones — the **Milestone ▾** options.
   *
   * @param sourceId The ticket source.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The milestones; `supported: false` for a tracker without milestones.
   * @throws {ApiError} `409 planning_target_read_only`, `502` when the tracker could not be asked.
   */
  async milestones(sourceId: string, client: ApiClient = api()): Promise<PlanningMilestones> {
    return unwrap(
      await client.GET("/api/v1/planning/sources/{source}/milestones", {
        params: { path: { source: sourceId } },
      }),
    );
  },
};
