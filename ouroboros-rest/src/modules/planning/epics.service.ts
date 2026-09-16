/**
 * `EpicsService` — the Roadmap card's lanes: create, edit, delete, reorder, link tickets, and the
 * roadmap payload.
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)), decision **N5** (option 4-A): a
 * lane's name, tint, month range, status and order are **planning intent** Ouroboros owns, and
 * `12 issues · 8 done` is **tracker truth**, computed on every read by V036's
 * `planning_epic_progress` view — so no write here touches a count, and none could.
 *
 * **Months** travel as `YYYY-MM` and are nullable **as a pair** — both set, or both null for the
 * dashed `unscoped` lane — and a range runs forwards. Both are checked here, before the write, so a
 * bad range is a `422` naming the rule rather than a constraint violation; V036's CHECKs remain the
 * backstop underneath.
 *
 * **A reorder names every lane exactly once.** Order is a property of the whole roadmap, so a partial
 * list has no single meaning; it is refused rather than guessed at.
 *
 * **Roles** are the controller's: members read, admins mutate.
 */

import { Injectable } from "@nestjs/common";

import type { CreateEpicBody, UpdateEpicBody } from "./planning.dto";
import {
  epicNotFound,
  monthRangeInvalid,
  reorderIncomplete,
  ticketsNotFound,
} from "./planning.errors";
import { PlanningRepository, type EpicFieldsRow, type EpicRow } from "./planning.repository";
import type { EpicResource, RoadmapResource } from "./planning.resources";

@Injectable()
export class EpicsService {
  /**
   * @param repository - Epics and their links.
   */
  constructor(private readonly repository: PlanningRepository) {}

  /**
   * The roadmap — every lane, top first, with computed chips.
   *
   * @param organizationId - The workspace.
   * @returns The roadmap head (the top lane's roadmap name and window) and its lanes.
   */
  async roadmap(organizationId: string): Promise<RoadmapResource> {
    const lanes = (await this.repository.epics(organizationId)).map(epicResource);
    const head = lanes.find((lane) => lane.roadmapName !== null);

    return { name: head?.roadmapName ?? null, window: head?.roadmapWindow ?? null, lanes };
  }

  /**
   * Every lane, top first.
   *
   * @param organizationId - The workspace.
   * @returns The lanes.
   */
  async list(organizationId: string): Promise<EpicResource[]> {
    return (await this.repository.epics(organizationId)).map(epicResource);
  }

  /**
   * One lane.
   *
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @returns The lane.
   * @throws {NotFoundError} `planning_epic_not_found`.
   */
  async read(organizationId: string, epicId: string): Promise<EpicResource> {
    return epicResource(await this.epicIn(organizationId, epicId));
  }

  /**
   * Create a lane at the bottom of the roadmap.
   *
   * @param organizationId - The workspace.
   * @param body - Its fields.
   * @returns The lane.
   * @throws {InvalidRequestError} `epic_month_range_invalid`.
   */
  async create(organizationId: string, body: CreateEpicBody): Promise<EpicResource> {
    const fields = checkedFields({
      name: body.name,
      tint: body.tint ?? "neutral",
      status: body.status ?? "active",
      startMonth: body.startMonth ?? null,
      endMonth: body.endMonth ?? null,
      roadmapName: body.roadmapName ?? null,
      roadmapWindow: body.roadmapWindow ?? null,
    });
    const epicId = await this.repository.createEpic(organizationId, fields);

    return this.read(organizationId, epicId);
  }

  /**
   * Edit a lane — only the fields sent change, and `null` clears a nullable one.
   *
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @param body - What changes.
   * @returns The lane.
   * @throws {NotFoundError} `planning_epic_not_found`.
   * @throws {InvalidRequestError} `epic_month_range_invalid`.
   */
  async update(
    organizationId: string,
    epicId: string,
    body: UpdateEpicBody,
  ): Promise<EpicResource> {
    const current = await this.epicIn(organizationId, epicId);
    const fields = checkedFields({
      name: body.name ?? current.name,
      tint: body.tint ?? current.tint,
      status: body.status ?? current.status,
      startMonth: body.startMonth === undefined ? current.startMonth : body.startMonth,
      endMonth: body.endMonth === undefined ? current.endMonth : body.endMonth,
      roadmapName: body.roadmapName === undefined ? current.roadmapName : body.roadmapName,
      roadmapWindow: body.roadmapWindow === undefined ? current.roadmapWindow : body.roadmapWindow,
    });

    if (!(await this.repository.updateEpic(organizationId, epicId, fields))) {
      throw epicNotFound(epicId);
    }

    return this.read(organizationId, epicId);
  }

  /**
   * Delete a lane. Its ticket links and tracker mirrors go with it; batches that named it keep
   * their drafts and name no epic.
   *
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @throws {NotFoundError} `planning_epic_not_found`.
   */
  async remove(organizationId: string, epicId: string): Promise<void> {
    if (!(await this.repository.deleteEpic(organizationId, epicId))) {
      throw epicNotFound(epicId);
    }
  }

  /**
   * Put the lanes in this order.
   *
   * @param organizationId - The workspace.
   * @param epicIds - Every lane of the workspace, exactly once, top first.
   * @returns The lanes, in their new order.
   * @throws {InvalidRequestError} `epic_reorder_incomplete`.
   */
  async reorder(organizationId: string, epicIds: readonly string[]): Promise<EpicResource[]> {
    const current = await this.repository.epics(organizationId);
    const known = new Set(current.map((epic) => epic.id));

    if (
      epicIds.length !== current.length ||
      new Set(epicIds).size !== epicIds.length ||
      !epicIds.every((id) => known.has(id))
    ) {
      throw reorderIncomplete();
    }

    await this.repository.reorderEpics(organizationId, epicIds);

    return this.list(organizationId);
  }

  /**
   * Link tickets to a lane. A link that exists already is kept, once.
   *
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @param ticketIds - The tickets — every one in this workspace.
   * @returns The lane, with its chip recomputed.
   * @throws {NotFoundError} `planning_epic_not_found`, `planning_tickets_not_found`.
   */
  async link(
    organizationId: string,
    epicId: string,
    ticketIds: readonly string[],
  ): Promise<EpicResource> {
    await this.epicIn(organizationId, epicId);

    const found = new Set(await this.repository.ticketIdsIn(organizationId, ticketIds));
    const missing = ticketIds.filter((id) => !found.has(id));

    if (missing.length > 0) {
      throw ticketsNotFound(missing);
    }

    await this.repository.linkTickets(epicId, ticketIds);

    return this.read(organizationId, epicId);
  }

  /**
   * Unlink tickets from a lane. A ticket that was not linked is not an error.
   *
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @param ticketIds - The tickets.
   * @returns The lane, with its chip recomputed.
   * @throws {NotFoundError} `planning_epic_not_found`.
   */
  async unlink(
    organizationId: string,
    epicId: string,
    ticketIds: readonly string[],
  ): Promise<EpicResource> {
    await this.epicIn(organizationId, epicId);
    await this.repository.unlinkTickets(epicId, ticketIds);

    return this.read(organizationId, epicId);
  }

  /**
   * A lane inside the workspace, or the `404`.
   *
   * @param organizationId - The workspace.
   * @param epicId - The epic.
   * @returns The lane.
   */
  private async epicIn(organizationId: string, epicId: string): Promise<EpicRow> {
    const epic = await this.repository.epic(organizationId, epicId);

    if (epic === undefined) {
      throw epicNotFound(epicId);
    }

    return epic;
  }
}

/**
 * An epic's fields, with the month rules checked.
 *
 * @param fields - The merged fields.
 * @returns The same fields.
 * @throws {InvalidRequestError} `epic_month_range_invalid` — half a range, or one running backwards.
 */
export function checkedFields(fields: EpicFieldsRow): EpicFieldsRow {
  if ((fields.startMonth === null) !== (fields.endMonth === null)) {
    throw monthRangeInvalid("paired");
  }

  // `YYYY-MM` compares as text in calendar order.
  if (
    fields.startMonth !== null &&
    fields.endMonth !== null &&
    fields.startMonth > fields.endMonth
  ) {
    throw monthRangeInvalid("ordered");
  }

  return fields;
}

/**
 * A lane as the API answers it.
 *
 * @param epic - The row.
 * @returns The resource.
 */
export function epicResource(epic: EpicRow): EpicResource {
  return {
    id: epic.id,
    name: epic.name,
    tint: epic.tint,
    status: epic.status,
    startMonth: epic.startMonth,
    endMonth: epic.endMonth,
    sortOrder: epic.sortOrder,
    roadmapName: epic.roadmapName,
    roadmapWindow: epic.roadmapWindow,
    chips: { issues: epic.ticketCount, done: epic.doneCount },
  };
}
