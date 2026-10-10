/**
 * The regression watch's storage (CM.4, [#623](https://github.com/NobuData/ouroboros/issues/623)):
 * V115's baselines, watch items and thresholds, V124's configuration, and the few reads of other
 * planes a watch item's journey depends on.
 *
 * **Every statement is scoped to one workspace**, and every change of an item's status names
 * the status it expects to leave (`where status = …`), so two passes of the scheduler — or the
 * scheduler and a person dismissing — cannot both move one item. The lifecycle's edges and what
 * each state must carry are the database's (V115's transition trigger); a statement that would
 * break one fails there, loudly.
 *
 * The cross-plane reads are read-only: a fix draft's batch and pushed ticket (Planning), the run
 * and pull request on that ticket (the run plane, the PR mirror), the workspace's ticket sources.
 */

import { Injectable } from "@nestjs/common";
import { sql, type RawBuilder } from "kysely";

import { DatabaseService } from "../../db/db.service";
import { ACTIVE_RUN_STATUSES, SCHEMA_NAME } from "../../db/schema";
import type { MetricClass, ThresholdRule, WindowStats } from "./watch.drift";

/** Where a metric's samples come from. */
export type MetricSource = "bi_metric" | "case_metric";

/** A metric's replayable test: what one bisect step runs, and where. */
export interface ReplayTest {
  /** The farm pool every step builds in. */
  readonly pool: string;
  /** The argv a step runs; null for the pool's default. Success marks the commit good. */
  readonly command: readonly string[] | null;
}

/** One watched metric — an entry of `regression_watch_settings.metrics`, as stored. */
export interface StoredMetric {
  readonly repo: string;
  readonly source: MetricSource;
  readonly key: string;
  readonly class: MetricClass;
  readonly window_days: number;
  readonly replay: ReplayTest | null;
  readonly nightly_ref: string;
}

/** A partial threshold rule, as a workspace overrides one. */
export type ThresholdOverride = Partial<ThresholdRule>;

/** `regression_watch_settings.thresholds`. */
export interface StoredThresholds {
  readonly classes: Readonly<Partial<Record<MetricClass, ThresholdOverride>>>;
  readonly metrics: Readonly<Record<string, ThresholdOverride>>;
}

/** A workspace's watch settings; the defaults when it has stored none. */
export interface WatchSettingsRow {
  readonly thresholds: StoredThresholds;
  readonly metrics: readonly StoredMetric[];
  readonly autoBisect: boolean;
  readonly autoFile: boolean;
  readonly fixSourceId: string | null;
  readonly lastComparedAt: Date | null;
}

/** What a settings save may change; an absent field keeps what is stored. */
export interface WatchSettingsPatch {
  readonly thresholds?: StoredThresholds;
  readonly metrics?: readonly StoredMetric[];
  readonly autoBisect?: boolean;
  readonly autoFile?: boolean;
  readonly fixSourceId?: string | null;
}

/** A captured baseline. */
export interface BaselineRow {
  readonly id: string;
  readonly organizationId: string;
  readonly repo: string;
  readonly releaseTag: string;
  readonly metricSource: MetricSource;
  readonly metricKey: string;
  readonly metricClass: MetricClass;
  readonly window: WindowStats;
  readonly capturedAt: Date;
  readonly capturedVia: "release" | "manual";
}

/** What a capture writes. */
export interface NewBaseline {
  readonly organizationId: string;
  readonly repo: string;
  readonly releaseTag: string;
  readonly metricSource: MetricSource;
  readonly metricKey: string;
  readonly metricClass: MetricClass;
  readonly window: WindowStats;
  readonly capturedVia: "release" | "manual";
  readonly capturedBy: string | null;
}

/** A watch item's status — V115's lifecycle. */
export type WatchStatus =
  | "detected"
  | "bisecting"
  | "bisected"
  | "investigation_open"
  | "fix_drafted"
  | "fix_running"
  | "fixed_merged"
  | "dismissed";

/** The statuses an item can still leave. */
export const OPEN_STATUSES: readonly WatchStatus[] = [
  "detected",
  "bisecting",
  "bisected",
  "investigation_open",
  "fix_drafted",
  "fix_running",
];

/** A bisect's recorded outcome — V115's `bisect_result`. */
export interface StoredBisectResult {
  readonly culprit_sha: string;
  readonly farm_job_ids: readonly string[];
  readonly steps: number;
  readonly confidence_basis: { readonly method: string; readonly inputs: Record<string, unknown> };
}

/** The fix ticket an item points at — a Planning draft until it is pushed, then a ticket. */
export interface FixTicketRef {
  readonly kind: "ticket" | "draft";
  readonly id: string;
  readonly key: string;
}

/** The pull request that merged a fix. */
export interface PrRef {
  readonly pull_request_id: string;
  readonly key: string;
}

/** A watch item, with the baseline it drifted from. */
export interface WatchItemRow {
  readonly id: string;
  readonly organizationId: string;
  readonly baseline: BaselineRow;
  readonly current: WindowStats;
  readonly driftValue: number;
  readonly driftUnit: string;
  /** `+14%` — generated by the database from the two columns above. */
  readonly driftDisplay: string;
  readonly severity: "err" | "warn" | "ok";
  readonly status: WatchStatus;
  readonly bisectId: string | null;
  readonly bisectResult: StoredBisectResult | null;
  readonly investigationId: string | null;
  /** `RS-131`, when an investigation was opened. */
  readonly investigationDisplayId: string | null;
  readonly fixTicketRef: FixTicketRef | null;
  readonly prRef: PrRef | null;
  readonly note: string | null;
  readonly detectedAt: Date;
  readonly statusChangedAt: Date;
}

/** What a comparison writes onto an item. */
export interface ItemReading {
  readonly current: WindowStats;
  readonly driftValue: number;
  readonly driftUnit: string;
  readonly severity: "err" | "warn" | "ok";
}

/** What moving an item may set. */
export interface ItemChange {
  readonly status?: WatchStatus;
  readonly note?: string | null;
  readonly bisectId?: string;
  readonly bisectResult?: StoredBisectResult;
  readonly investigationId?: string;
  readonly fixTicketRef?: FixTicketRef;
  readonly prRef?: PrRef;
}

/** Where a fix draft stands in Planning. */
export interface DraftState {
  readonly draftId: string;
  readonly localKey: string;
  readonly batchId: string;
  readonly batchStatus: string;
  /** The canonical ticket the draft was pushed as, with the key it is shown by. */
  readonly ticket: { readonly id: string; readonly key: string } | null;
}

/** Where a fix ticket stands in the run plane and the PR mirror. */
export interface FixProgress {
  /** The mirrored GitHub issue, once the backlog sync has it. */
  readonly issueId: string | null;
  /** Whether the queue already holds that issue. */
  readonly queued: boolean;
  /** A run on the ticket that is still in flight. */
  readonly activeRunId: string | null;
  /** Whether any run was ever recorded on the ticket — so "no run in flight" can mean "it ended". */
  readonly ranBefore: boolean;
  /** The merged pull request on the ticket. */
  readonly mergedPr: { readonly id: string; readonly number: number } | null;
}

/** The storage the watch's services are written against; tests substitute an in-memory one. */
export interface WatchStore {
  /** @returns The workspace's settings, defaults where it stored none. */
  settings(organizationId: string): Promise<WatchSettingsRow>;
  /** Save settings. @returns The settings as stored. */
  saveSettings(
    organizationId: string,
    patch: WatchSettingsPatch,
    userId: string,
  ): Promise<WatchSettingsRow>;
  /** Record that the nightly comparison ran. */
  markCompared(organizationId: string, at: Date): Promise<void>;
  /** @returns Workspaces with a baseline whose last comparison is before `since` (or never). */
  workspacesDue(since: Date): Promise<string[]>;
  /** @returns Workspaces whose settings watch a metric of this repository. */
  workspacesWatching(repo: string): Promise<string[]>;
  /** @returns The effective threshold rule of a metric. */
  threshold(
    organizationId: string,
    metricKey: string,
    metricClass: MetricClass,
  ): Promise<ThresholdRule>;
  /** Store a baseline. @returns It, or undefined when that release already has one for the metric. */
  insertBaseline(baseline: NewBaseline): Promise<BaselineRow | undefined>;
  /** @returns The newest baseline of each repository and metric. */
  latestBaselines(organizationId: string): Promise<BaselineRow[]>;
  /** @returns The open item of a baseline, if there is one. */
  openItem(organizationId: string, baselineId: string): Promise<WatchItemRow | undefined>;
  /** Open a `detected` item. @returns It. */
  insertItem(
    organizationId: string,
    baselineId: string,
    reading: ItemReading,
  ): Promise<WatchItemRow>;
  /** Refresh an open item's reading. */
  updateReading(organizationId: string, itemId: string, reading: ItemReading): Promise<void>;
  /** @returns Every item of the workspace, open ones first, newest first. */
  items(organizationId: string, limit: number): Promise<WatchItemRow[]>;
  /** @returns One item. */
  item(organizationId: string, itemId: string): Promise<WatchItemRow | undefined>;
  /** @returns Open items across every workspace, least recently touched first. */
  openItems(limit: number): Promise<WatchItemRow[]>;
  /** Change an item that is still in `from`. @returns Whether it was. */
  move(
    organizationId: string,
    itemId: string,
    from: WatchStatus,
    change: ItemChange,
  ): Promise<boolean>;
  /** Dismiss an open item. @returns Whether it was open. */
  dismiss(organizationId: string, itemId: string, userId: string, reason: string): Promise<boolean>;
  /** Open a queued `regression_forensics` investigation. @returns Its id and `RS-###`. */
  openInvestigation(
    organizationId: string,
    question: string,
    tools: readonly string[],
  ): Promise<{ readonly id: string; readonly displayId: string } | undefined>;
  /** @returns The insights metric ids among these that the catalogue does not have. */
  unknownMetrics(metricIds: readonly string[]): Promise<string[]>;
  /** @returns The workspace's ticket sources, oldest first. */
  ticketSources(organizationId: string): Promise<string[]>;
  /** @returns Where a fix draft stands, or undefined when it is gone. */
  draftState(organizationId: string, draftId: string): Promise<DraftState | undefined>;
  /** @returns Where a fix ticket stands. */
  fixProgress(organizationId: string, ticketId: string): Promise<FixProgress>;
}

const schema = sql.id(SCHEMA_NAME);

/** The defaults a workspace with no settings row reads. */
export const DEFAULT_SETTINGS: WatchSettingsRow = Object.freeze({
  thresholds: { classes: {}, metrics: {} },
  metrics: [],
  autoBisect: true,
  autoFile: false,
  fixSourceId: null,
  lastComparedAt: null,
});

interface SettingsRecord {
  thresholds: StoredThresholds;
  metrics: StoredMetric[];
  auto_bisect: boolean;
  auto_file: boolean;
  fix_source_id: string | null;
  last_compared_at: Date | null;
}

interface BaselineRecord {
  baseline_id: string;
  organization_id: string;
  repo_ref: string;
  release_tag: string;
  metric_source: MetricSource;
  metric_key: string;
  metric_class: MetricClass;
  baseline_window: WindowStats;
  captured_at: Date;
  captured_via: "release" | "manual";
}

interface ItemRecord extends BaselineRecord {
  id: string;
  current: WindowStats;
  drift_value: string;
  drift_unit: string;
  drift_display: string;
  severity: "err" | "warn" | "ok";
  status: WatchStatus;
  bisect_id: string | null;
  bisect_result: StoredBisectResult | null;
  investigation_id: string | null;
  investigation_display_id: string | null;
  fix_ticket_ref: FixTicketRef | null;
  pr_ref: PrRef | null;
  note: string | null;
  detected_at: Date;
  status_changed_at: Date;
}

/** A baseline's columns, aliased so an item query can carry them too. */
const BASELINE_COLUMNS = sql`
  b.id as baseline_id, b.organization_id, b.repo_ref::text as repo_ref, b.release_tag,
  b.metric_source, b.metric_key, b.metric_class, b."window" as baseline_window,
  b.captured_at, b.captured_via`;

/** An item with its baseline and its investigation's display id. */
const ITEM_SELECT = sql`
  select w.id, w.current, w.drift_value, w.drift_unit, w.drift_display, w.severity, w.status,
         w.bisect_id, w.bisect_result, w.investigation_id, i.display_id as investigation_display_id,
         w.fix_ticket_ref, w.pr_ref, w.note, w.detected_at, w.status_changed_at,
         ${BASELINE_COLUMNS}
    from ${schema}.regression_watch_items w
    join ${schema}.regression_baselines b
      on b.id = w.baseline_id and b.organization_id = w.organization_id
    left join ${schema}.investigations i
      on i.id = w.investigation_id and i.organization_id = w.organization_id`;

@Injectable()
export class WatchRepository implements WatchStore {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async settings(organizationId: string): Promise<WatchSettingsRow> {
    const { rows } = await sql<SettingsRecord>`
      select s.thresholds, s.metrics, s.auto_bisect, s.auto_file, s.fix_source_id,
             s.last_compared_at
        from ${schema}.regression_watch_settings s
       where s.organization_id = ${organizationId}
    `.execute(this.database.db);

    return rows[0] === undefined ? DEFAULT_SETTINGS : settingsOf(rows[0]);
  }

  /** @inheritdoc */
  async saveSettings(
    organizationId: string,
    patch: WatchSettingsPatch,
    userId: string,
  ): Promise<WatchSettingsRow> {
    const thresholds = patch.thresholds === undefined ? null : JSON.stringify(patch.thresholds);
    const metrics = patch.metrics === undefined ? null : JSON.stringify(patch.metrics);
    const fixSource = patch.fixSourceId ?? null;
    const { rows } = await sql<SettingsRecord>`
      insert into ${schema}.regression_watch_settings as s
        (organization_id, thresholds, metrics, auto_bisect, auto_file, fix_source_id, updated_by)
      values (${organizationId},
              coalesce(${thresholds}::jsonb, '{"classes": {}, "metrics": {}}'::jsonb),
              coalesce(${metrics}::jsonb, '[]'::jsonb),
              coalesce(${patch.autoBisect ?? null}::boolean, true),
              coalesce(${patch.autoFile ?? null}::boolean, false),
              ${fixSource}::uuid, ${userId})
      on conflict (organization_id) do update
         set thresholds = coalesce(${thresholds}::jsonb, s.thresholds),
             metrics = coalesce(${metrics}::jsonb, s.metrics),
             auto_bisect = coalesce(${patch.autoBisect ?? null}::boolean, s.auto_bisect),
             auto_file = coalesce(${patch.autoFile ?? null}::boolean, s.auto_file),
             fix_source_id = case when ${patch.fixSourceId !== undefined}::boolean
                                  then ${fixSource}::uuid else s.fix_source_id end,
             updated_by = ${userId}
      returning thresholds, metrics, auto_bisect, auto_file, fix_source_id, last_compared_at
    `.execute(this.database.db);

    return settingsOf(rows[0]);
  }

  /** @inheritdoc */
  async markCompared(organizationId: string, at: Date): Promise<void> {
    await sql`
      insert into ${schema}.regression_watch_settings as s (organization_id, last_compared_at)
      values (${organizationId}, ${at})
      on conflict (organization_id) do update set last_compared_at = ${at}
    `.execute(this.database.db);
  }

  /** @inheritdoc */
  async workspacesDue(since: Date): Promise<string[]> {
    const { rows } = await sql<{ organization_id: string }>`
      select distinct b.organization_id
        from ${schema}.regression_baselines b
        left join ${schema}.regression_watch_settings s on s.organization_id = b.organization_id
       where s.last_compared_at is null or s.last_compared_at < ${since}
       order by b.organization_id
    `.execute(this.database.db);

    return rows.map((row) => row.organization_id);
  }

  /** @inheritdoc */
  async workspacesWatching(repo: string): Promise<string[]> {
    const { rows } = await sql<{ organization_id: string }>`
      select s.organization_id
        from ${schema}.regression_watch_settings s
       where exists (select 1 from jsonb_array_elements(s.metrics) m
                      where lower(m ->> 'repo') = lower(${repo}))
       order by s.organization_id
    `.execute(this.database.db);

    return rows.map((row) => row.organization_id);
  }

  /** @inheritdoc */
  async threshold(
    organizationId: string,
    metricKey: string,
    metricClass: MetricClass,
  ): Promise<ThresholdRule> {
    const { rows } = await sql<{ rule: ThresholdRule }>`
      select ${schema}.regression_threshold(${organizationId}, ${metricKey}, ${metricClass}) as rule
    `.execute(this.database.db);

    return rows[0].rule;
  }

  /** @inheritdoc */
  async insertBaseline(baseline: NewBaseline): Promise<BaselineRow | undefined> {
    const { rows } = await sql<BaselineRecord>`
      insert into ${schema}.regression_baselines as b
        (organization_id, repo_ref, release_tag, metric_source, metric_key, metric_class,
         "window", captured_via, captured_by)
      values (${baseline.organizationId}, ${baseline.repo}, ${baseline.releaseTag},
              ${baseline.metricSource}, ${baseline.metricKey}, ${baseline.metricClass},
              ${JSON.stringify(baseline.window)}::jsonb, ${baseline.capturedVia},
              ${baseline.capturedBy})
      on conflict (organization_id, repo_ref, release_tag, metric_key) do nothing
      returning ${BASELINE_COLUMNS}
    `.execute(this.database.db);

    return rows[0] === undefined ? undefined : baselineOf(rows[0]);
  }

  /** @inheritdoc */
  async latestBaselines(organizationId: string): Promise<BaselineRow[]> {
    const { rows } = await sql<BaselineRecord>`
      select distinct on (b.repo_ref, b.metric_key) ${BASELINE_COLUMNS}
        from ${schema}.regression_baselines b
       where b.organization_id = ${organizationId}
       order by b.repo_ref, b.metric_key, b.captured_at desc, b.id
    `.execute(this.database.db);

    return rows.map(baselineOf);
  }

  /** @inheritdoc */
  async openItem(organizationId: string, baselineId: string): Promise<WatchItemRow | undefined> {
    return this
      .one(sql`w.organization_id = ${organizationId} and w.baseline_id = ${baselineId}::uuid
                        and w.status in (${sql.join(OPEN_STATUSES)})`);
  }

  /** @inheritdoc */
  async insertItem(
    organizationId: string,
    baselineId: string,
    reading: ItemReading,
  ): Promise<WatchItemRow> {
    const { rows } = await sql<{ id: string }>`
      insert into ${schema}.regression_watch_items
        (organization_id, baseline_id, current, drift_value, drift_unit, severity)
      values (${organizationId}, ${baselineId}::uuid, ${JSON.stringify(reading.current)}::jsonb,
              ${reading.driftValue}, ${reading.driftUnit}, ${reading.severity})
      returning id
    `.execute(this.database.db);
    const inserted = await this.item(organizationId, rows[0].id);

    if (inserted === undefined) throw new Error("the watch item just inserted could not be read");
    return inserted;
  }

  /** @inheritdoc */
  async updateReading(organizationId: string, itemId: string, reading: ItemReading): Promise<void> {
    await sql`
      update ${schema}.regression_watch_items
         set current = ${JSON.stringify(reading.current)}::jsonb,
             drift_value = ${reading.driftValue}, drift_unit = ${reading.driftUnit},
             severity = ${reading.severity}
       where organization_id = ${organizationId} and id = ${itemId}::uuid
         and status in (${sql.join(OPEN_STATUSES)})
    `.execute(this.database.db);
  }

  /** @inheritdoc */
  async items(organizationId: string, limit: number): Promise<WatchItemRow[]> {
    const { rows } = await sql<ItemRecord>`
      ${ITEM_SELECT}
       where w.organization_id = ${organizationId}
       order by (w.status in ('fixed_merged', 'dismissed')), w.detected_at desc, w.id
       limit ${limit}
    `.execute(this.database.db);

    return rows.map(itemOf);
  }

  /** @inheritdoc */
  async item(organizationId: string, itemId: string): Promise<WatchItemRow | undefined> {
    return this.one(sql`w.organization_id = ${organizationId} and w.id = ${itemId}::uuid`);
  }

  /** @inheritdoc */
  async openItems(limit: number): Promise<WatchItemRow[]> {
    const { rows } = await sql<ItemRecord>`
      ${ITEM_SELECT}
       where w.status in (${sql.join(OPEN_STATUSES)})
       order by w.updated_at, w.id
       limit ${limit}
    `.execute(this.database.db);

    return rows.map(itemOf);
  }

  /** @inheritdoc */
  async move(
    organizationId: string,
    itemId: string,
    from: WatchStatus,
    change: ItemChange,
  ): Promise<boolean> {
    const sets: RawBuilder<unknown>[] = [sql`updated_at = now()`];

    if (change.status !== undefined) sets.push(sql`status = ${change.status}`);
    if (change.note !== undefined) sets.push(sql`note = ${change.note}`);
    if (change.bisectId !== undefined) sets.push(sql`bisect_id = ${change.bisectId}::uuid`);
    if (change.bisectResult !== undefined) {
      sets.push(sql`bisect_result = ${JSON.stringify(change.bisectResult)}::jsonb`);
    }
    if (change.investigationId !== undefined) {
      sets.push(sql`investigation_id = ${change.investigationId}::uuid`);
    }
    if (change.fixTicketRef !== undefined) {
      sets.push(sql`fix_ticket_ref = ${JSON.stringify(change.fixTicketRef)}::jsonb`);
    }
    if (change.prRef !== undefined) sets.push(sql`pr_ref = ${JSON.stringify(change.prRef)}::jsonb`);

    const { rows } = await sql<{ id: string }>`
      update ${schema}.regression_watch_items
         set ${sql.join(sets)}
       where organization_id = ${organizationId} and id = ${itemId}::uuid and status = ${from}
      returning id
    `.execute(this.database.db);

    return rows.length > 0;
  }

  /** @inheritdoc */
  async dismiss(
    organizationId: string,
    itemId: string,
    userId: string,
    reason: string,
  ): Promise<boolean> {
    const { rows } = await sql<{ id: string }>`
      update ${schema}.regression_watch_items
         set status = 'dismissed', dismissed_by = ${userId}, dismissed_at = now(),
             dismiss_reason = ${reason}
       where organization_id = ${organizationId} and id = ${itemId}::uuid
         and status in (${sql.join(OPEN_STATUSES)})
      returning id
    `.execute(this.database.db);

    return rows.length > 0;
  }

  /** @inheritdoc */
  async openInvestigation(
    organizationId: string,
    question: string,
    tools: readonly string[],
  ): Promise<{ readonly id: string; readonly displayId: string } | undefined> {
    // The kind's own default tools when none were given; either way only registered ones.
    const { rows } = await sql<{ id: string; display_id: string }>`
      insert into ${schema}.investigations
        (organization_id, kind_id, question, depth, tools_enabled, status, origin)
      select ${organizationId}, k.id, ${question}, 'standard',
             case when ${tools.length}::int > 0 then ${JSON.stringify(tools)}::jsonb
                  else k.playbook -> 'default_tools' end,
             'queued', 'regression_watch'
        from ${schema}.investigation_kinds k
       where k.organization_id = ${organizationId} and k.slug = 'regression_forensics'
      returning id, display_id
    `.execute(this.database.db);

    return rows[0] === undefined ? undefined : { id: rows[0].id, displayId: rows[0].display_id };
  }

  /** @inheritdoc */
  async unknownMetrics(metricIds: readonly string[]): Promise<string[]> {
    if (metricIds.length === 0) return [];

    const { rows } = await sql<{ metric_id: string }>`
      select d.metric_id from ${schema}.metric_definitions d
       where d.metric_id in (${sql.join([...metricIds])})
    `.execute(this.database.db);
    const known = new Set(rows.map((row) => row.metric_id));

    return metricIds.filter((id) => !known.has(id));
  }

  /** @inheritdoc */
  async ticketSources(organizationId: string): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      select s.id from ${schema}.ticket_sources s
       where s.organization_id = ${organizationId}
       order by s.created_at, s.id
    `.execute(this.database.db);

    return rows.map((row) => row.id);
  }

  /** @inheritdoc */
  async draftState(organizationId: string, draftId: string): Promise<DraftState | undefined> {
    const { rows } = await sql<{
      id: string;
      local_key: string;
      batch_id: string;
      status: string;
      ticket_id: string | null;
      external_key: string | null;
    }>`
      select d.id, d.local_key, d.batch_id, b.status, t.id as ticket_id, t.external_key
        from ${schema}.ticket_drafts d
        join ${schema}.draft_batches b on b.id = d.batch_id
        left join ${schema}.tickets t
          on t.id = d.pushed_ticket_id and t.organization_id = b.organization_id
       where b.organization_id = ${organizationId} and d.id = ${draftId}::uuid
    `.execute(this.database.db);
    const row = rows[0];

    if (row === undefined) return undefined;
    return {
      draftId: row.id,
      localKey: row.local_key,
      batchId: row.batch_id,
      batchStatus: row.status,
      ticket:
        row.ticket_id === null || row.external_key === null
          ? null
          : { id: row.ticket_id, key: row.external_key },
    };
  }

  /** @inheritdoc */
  async fixProgress(organizationId: string, ticketId: string): Promise<FixProgress> {
    // The ticket names its repository and number (`meta.github`, `external_id`); the mirrored
    // issue, a run on that issue, and a pull request on the ticket are each looked up from it.
    const { rows } = await sql<{
      issue_id: string | null;
      queued: boolean;
      active_run_id: string | null;
      ran_before: boolean;
      pr_id: string | null;
      pr_number: number | null;
    }>`
      with ticket as (
        select t.id, t.organization_id, t.external_id,
               (select gi.id
                  from ${schema}.github_issues gi
                  join ${schema}.github_repos gr on gr.id = gi.github_repo_id
                  join ${schema}.github_orgs go on go.id = gr.org_id
                 where gi.organization_id = t.organization_id
                   and lower(go.login) = lower(t.meta #>> '{github,owner}')
                   and lower(gr.name) = lower(t.meta #>> '{github,repo}')
                   and gi.number::text = t.external_id
                 limit 1) as issue_id
          from ${schema}.tickets t
         where t.organization_id = ${organizationId} and t.id = ${ticketId}::uuid)
      select ticket.issue_id,
             exists (select 1
                       from ${schema}.github_issues gi
                       join ${schema}.queue_items q
                         on q.organization_id = gi.organization_id
                        and q.github_repo_id = gi.github_repo_id and q.issue_number = gi.number
                      where gi.id = ticket.issue_id) as queued,
             coalesce(
               (select r.id
                  from ${schema}.pull_requests p
                  join ${schema}.runs r on r.id = p.run_id and r.organization_id = p.organization_id
                 where p.organization_id = ticket.organization_id and p.ticket_id = ticket.id
                   and r.status in (${sql.join(ACTIVE_RUN_STATUSES)})
                 order by r.started_at desc, r.id limit 1),
               (select r.id
                  from ${schema}.github_issues gi
                  join ${schema}.runs r
                    on r.organization_id = gi.organization_id
                   and r.github_repo_id = gi.github_repo_id and r.issue_number = gi.number
                 where gi.id = ticket.issue_id
                   and r.status in (${sql.join(ACTIVE_RUN_STATUSES)})
                 order by r.started_at desc, r.id limit 1)) as active_run_id,
             (exists (select 1
                        from ${schema}.pull_requests p
                       where p.organization_id = ticket.organization_id
                         and p.ticket_id = ticket.id and p.run_id is not null)
              or exists (select 1
                           from ${schema}.github_issues gi
                           join ${schema}.runs r
                             on r.organization_id = gi.organization_id
                            and r.github_repo_id = gi.github_repo_id
                            and r.issue_number = gi.number
                          where gi.id = ticket.issue_id)) as ran_before,
             merged.id as pr_id, merged.external_number as pr_number
        from ticket
        left join lateral (
          select p.id, p.external_number
            from ${schema}.pull_requests p
           where p.organization_id = ticket.organization_id and p.ticket_id = ticket.id
             and p.state = 'merged'
           order by p.merged_at desc nulls last, p.id
           limit 1) merged on true
    `.execute(this.database.db);
    const row = rows[0];

    return {
      issueId: row?.issue_id ?? null,
      queued: row?.queued ?? false,
      activeRunId: row?.active_run_id ?? null,
      ranBefore: row?.ran_before ?? false,
      mergedPr:
        row?.pr_id == null || row.pr_number === null
          ? null
          : { id: row.pr_id, number: row.pr_number },
    };
  }

  /**
   * Read one item by a condition.
   *
   * @param condition - What it must satisfy.
   * @returns The item, or undefined.
   */
  private async one(condition: RawBuilder<unknown>): Promise<WatchItemRow | undefined> {
    const { rows } = await sql<ItemRecord>`
      ${ITEM_SELECT}
       where ${condition}
       order by w.detected_at desc
       limit 1
    `.execute(this.database.db);

    return rows[0] === undefined ? undefined : itemOf(rows[0]);
  }
}

/**
 * A settings row, published.
 *
 * @param row - The row.
 * @returns The settings.
 */
function settingsOf(row: SettingsRecord): WatchSettingsRow {
  return {
    thresholds: row.thresholds,
    metrics: row.metrics,
    autoBisect: row.auto_bisect,
    autoFile: row.auto_file,
    fixSourceId: row.fix_source_id,
    lastComparedAt: row.last_compared_at,
  };
}

/**
 * A baseline's columns as a baseline.
 *
 * @param row - The row.
 * @returns The baseline.
 */
export function baselineOf(row: BaselineRecord): BaselineRow {
  return {
    id: row.baseline_id,
    organizationId: row.organization_id,
    repo: row.repo_ref,
    releaseTag: row.release_tag,
    metricSource: row.metric_source,
    metricKey: row.metric_key,
    metricClass: row.metric_class,
    window: row.baseline_window,
    capturedAt: row.captured_at,
    capturedVia: row.captured_via,
  };
}

/**
 * An item row as an item.
 *
 * @param row - The row.
 * @returns The item with its baseline.
 */
export function itemOf(row: ItemRecord): WatchItemRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    baseline: baselineOf(row),
    current: row.current,
    driftValue: Number(row.drift_value),
    driftUnit: row.drift_unit,
    driftDisplay: row.drift_display,
    severity: row.severity,
    status: row.status,
    bisectId: row.bisect_id,
    bisectResult: row.bisect_result,
    investigationId: row.investigation_id,
    investigationDisplayId: row.investigation_display_id,
    fixTicketRef: row.fix_ticket_ref,
    prRef: row.pr_ref,
    note: row.note,
    detectedAt: row.detected_at,
    statusChangedAt: row.status_changed_at,
  };
}
