/**
 * Audit plane test fixtures — the mockup's five rows, and an in-memory repository with the real
 * one's filter and keyset semantics (BR.2, [#486](https://github.com/NobuData/ouroboros/issues/486)).
 *
 * The five rows are `R__dev_seed_workspace_settings.sql`'s, fact for fact, so the unit specs and
 * the seeded database render the same card.
 */

import type { AuditCursor } from "./audit-plane.cursor";
import type { AuditPlaneFilter } from "./audit-plane.filter";
import type { AuditPlaneRepository, AuditPlaneRow } from "./audit-plane.repository";

/** The workspace every fixture row belongs to. */
export const PLANE_ORG = "5eed0001-0000-4000-8000-000000000001";

/**
 * A row of the plane, with defaults for every column a test does not care about.
 *
 * @param overrides - The columns that matter.
 * @returns The row; `cursor_at` and `plane` follow `occurred_at` and `action` unless overridden.
 */
export function planeRow(overrides: Partial<AuditPlaneRow> = {}): AuditPlaneRow {
  const occurredAt = overrides.occurred_at ?? new Date("2026-10-05T14:31:00.000Z");
  const action = overrides.action ?? "provider.rotated";

  return {
    id: "a0000000-0000-4000-8000-000000000001",
    actor_id: null,
    actor_name: null,
    actor_service: null,
    actor_kind: "system",
    action,
    plane: action.split(".", 1)[0],
    subject_type: "workspace",
    subject_id: null,
    ip: null,
    detail: {},
    occurred_at: occurredAt,
    cursor_at: occurredAt.toISOString().replace("Z", "000Z"),
    ...overrides,
  };
}

/** Mockup 17's Audit Log card, as the seed stores it — newest first. */
export const MOCKUP_ROWS: readonly AuditPlaneRow[] = [
  planeRow({
    id: "5eed0074-0000-4000-8000-000000000001",
    actor_service: "ouroboros-app",
    actor_kind: "bot",
    action: "pr_revision.pushed",
    subject_type: "pr_revision",
    detail: { pr_number: 514, revision: 2, head_sha: "b7e41d0" },
    occurred_at: new Date("2026-10-05T14:31:00.000Z"),
  }),
  planeRow({
    id: "5eed0074-0000-4000-8000-000000000002",
    actor_id: "user-ken",
    actor_name: "Ken Suenobu",
    actor_kind: "human",
    action: "provider.rotated",
    subject_type: "provider_connection",
    ip: "198.51.100.24",
    detail: { kind: "anthropic", outcome: "success" },
    occurred_at: new Date("2026-10-05T14:12:00.000Z"),
  }),
  planeRow({
    id: "5eed0074-0000-4000-8000-000000000003",
    actor_id: "user-ken",
    actor_name: "Ken Suenobu",
    actor_kind: "human",
    action: "policy.published",
    subject_type: "org_policy",
    ip: "198.51.100.24",
    detail: { version: 7, previous_version: 6, changes: "auto_merge:enabled" },
    occurred_at: new Date("2026-10-05T13:48:00.000Z"),
  }),
  planeRow({
    id: "5eed0074-0000-4000-8000-000000000004",
    actor_id: "user-maya",
    actor_name: "Maya Chen",
    actor_kind: "human",
    action: "triage.waived",
    subject_type: "run",
    ip: "198.51.100.61",
    detail: { pr_number: 509 },
    occurred_at: new Date("2026-10-05T13:22:00.000Z"),
  }),
  planeRow({
    id: "5eed0074-0000-4000-8000-000000000005",
    action: "runner.marked_offline",
    subject_type: "runner",
    detail: { runner: "forge-03" },
    occurred_at: new Date("2026-10-05T12:04:00.000Z"),
  }),
];

/**
 * Whether a row passes a filter — the repository's predicates, in JavaScript.
 *
 * @param row - The row.
 * @param filter - The filter.
 * @returns Whether it matches.
 */
function matches(row: AuditPlaneRow, filter: AuditPlaneFilter): boolean {
  const ref = filter.ref;
  const refMatches =
    ref === undefined ||
    (ref.kind === "pr" && row.detail.pr_number === ref.number) ||
    (ref.kind === "run" && (row.subject_id === ref.value || row.detail.run_id === ref.value)) ||
    (ref.kind === "repo" && (row.subject_id === ref.value || row.detail.repo === ref.value)) ||
    (ref.kind === "subject" && row.subject_id === ref.value);

  return (
    (filter.from === undefined || row.occurred_at >= filter.from) &&
    (filter.to === undefined || row.occurred_at < filter.to) &&
    (filter.actorKind === undefined || row.actor_kind === filter.actorKind) &&
    (filter.actorId === undefined || row.actor_id === filter.actorId) &&
    (filter.actorService === undefined || row.actor_service === filter.actorService) &&
    (filter.plane === undefined || row.plane === filter.plane) &&
    (filter.action === undefined || row.action === filter.action) &&
    refMatches
  );
}

/**
 * Page order: `occurred_at desc, id desc`, compared on the microsecond text as the database does.
 *
 * @param a - One row.
 * @param b - Another.
 * @returns The comparison.
 */
function newestFirst(
  a: Pick<AuditPlaneRow, "cursor_at" | "id">,
  b: AuditCursor | AuditPlaneRow,
): number {
  const at = "cursor_at" in b ? b.cursor_at : b.at;
  if (a.cursor_at !== at) return a.cursor_at < at ? 1 : -1;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/** `audit_events`, in memory, with the plane repository's two reads. */
export class InMemoryAuditPlaneRepository implements Pick<AuditPlaneRepository, "page" | "count"> {
  /** Every row, any workspace. */
  readonly rows: (AuditPlaneRow & { organization_id: string })[] = [];

  /** Every `page` call's arguments — what a spec inspects. */
  readonly pages: { filter: AuditPlaneFilter; after?: AuditCursor; limit: number }[] = [];

  /**
   * @param rows - Rows of {@link PLANE_ORG} to start with.
   */
  constructor(rows: readonly AuditPlaneRow[] = []) {
    for (const row of rows) this.add(row);
  }

  /**
   * Store a row.
   *
   * @param row - The row.
   * @param organizationId - Its workspace.
   */
  add(row: AuditPlaneRow, organizationId: string = PLANE_ORG): void {
    this.rows.push({ ...row, organization_id: organizationId });
  }

  page(
    organizationId: string,
    filter: AuditPlaneFilter,
    after: AuditCursor | undefined,
    limit: number,
  ): Promise<AuditPlaneRow[]> {
    this.pages.push({ filter, after, limit });

    return Promise.resolve(
      this.scoped(organizationId, filter)
        .filter((row) => after === undefined || newestFirst(row, after) > 0)
        .slice(0, limit)
        .map(({ organization_id: _organization, ...row }) => row),
    );
  }

  count(organizationId: string, filter: AuditPlaneFilter): Promise<number> {
    return Promise.resolve(this.scoped(organizationId, filter).length);
  }

  /**
   * A workspace's matching rows, in page order.
   *
   * @param organizationId - The workspace.
   * @param filter - The filter.
   * @returns The rows.
   */
  private scoped(organizationId: string, filter: AuditPlaneFilter) {
    return this.rows
      .filter((row) => row.organization_id === organizationId && matches(row, filter))
      .sort(newestFirst);
  }
}

/**
 * The repository, as the service's constructor wants it.
 *
 * @param repository - The in-memory one.
 * @returns It, typed as the real one.
 */
export function asPlaneRepository(repository: InMemoryAuditPlaneRepository): AuditPlaneRepository {
  return repository as unknown as AuditPlaneRepository;
}
