/**
 * An in-memory {@link DetectionStore} and a probe-capable provider over a fixture repository — the
 * detection service's world, without a database or a host
 * ([#384](https://github.com/NobuData/ouroboros/issues/384)).
 *
 * The store keeps V067's rules that matter to the service: `scan_seq` is per `(workspace, repo)`
 * and counts from 1, a suggested glob never overwrites an existing one, and the only update is the
 * tests row's relabel.
 */

import type { ProtectedPathSource, RepoDetection, RepoDetectionScan } from "../db/schema";
import type {
  ProbeCapableProvider,
  TicketSyncContext,
} from "../ticket-sources/ticket-source.provider";
import type { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import { fixtureProber, type FixtureProberOptions, type FixtureRepo } from "./detection.fixture";
import type { MeasuredTests } from "./detection.reconcile";
import type { DetectionStore, PolicyRow, ScanRecord, StoredScan } from "./detection.repository";
import type { DetectionRow } from "./detection.scan";
import type { DetectionSourceOpener } from "./detection.service";

/** The workspace the fixtures scan in. */
export const DETECTION_WORKSPACE = "org-detection";

/** The repository the fixtures scan. */
export const DETECTION_REPO = "acme-robotics/helios-firmware";

/** The fixture clock's start. */
export const DETECTION_NOW = new Date("2026-09-29T12:00:00.000Z");

/**
 * A GitHub source of the fixture workspace.
 *
 * @param overrides - What to change.
 * @returns The source.
 */
export function detectionSource(overrides: Partial<SyncSource> = {}): SyncSource {
  return {
    sourceId: "d3700000-0000-0000-0000-000000000001",
    organizationId: DETECTION_WORKSPACE,
    kind: "github",
    displayName: "acme-robotics",
    config: { login: "acme-robotics", repos: ["helios-firmware"] },
    cursor: null,
    syncedAt: null,
    ...overrides,
  };
}

/** The in-memory store, and what was written to it. */
export class InMemoryDetectionStore implements DetectionStore {
  /** Every scan recorded, in order. */
  readonly records: (ScanRecord & { scanSeq: number })[] = [];
  /** Every relabel, in order. */
  readonly relabels: { repo: string; scanSeq: number; row: DetectionRow }[] = [];
  /** The protected-path policies, by `workspace|repo`. */
  readonly policyRows = new Map<string, PolicyRow[]>();
  /** The repositories whose list a person saved (V105), by `workspace|repo` — scans suggest none. */
  readonly edited = new Set<string>();
  /** The sources `candidateSources` answers. */
  sources: SyncSource[] = [detectionSource()];
  /** The measurement `measuredTests` answers. */
  measured: MeasuredTests | undefined;

  candidateSources(organizationId: string): Promise<SyncSource[]> {
    return Promise.resolve(
      this.sources.filter((source) => source.organizationId === organizationId),
    );
  }

  recordScan(record: ScanRecord): Promise<number> {
    const scanSeq =
      this.records.filter(
        (stored) => stored.organizationId === record.organizationId && stored.repo === record.repo,
      ).length + 1;
    const key = `${record.organizationId}|${record.repo}`;
    const policies = this.policyRows.get(key) ?? [];

    for (const glob of this.edited.has(key) ? [] : record.protectedPaths) {
      if (!policies.some((policy) => policy.path_glob === glob)) {
        policies.push({ path_glob: glob, source: "suggested" });
      }
    }

    this.policyRows.set(key, policies);
    this.records.push({ ...record, scanSeq });

    return Promise.resolve(scanSeq);
  }

  scan(organizationId: string, repo: string, scanSeq?: number): Promise<StoredScan | undefined> {
    const candidates = this.records.filter(
      (stored) => stored.organizationId === organizationId && stored.repo === repo,
    );
    const record =
      scanSeq === undefined
        ? candidates.at(-1)
        : candidates.find((stored) => stored.scanSeq === scanSeq);

    if (record === undefined) {
      return Promise.resolve(undefined);
    }

    const scan: RepoDetectionScan = {
      id: `scan-${String(record.scanSeq)}`,
      organization_id: organizationId,
      repo_ref: repo,
      scan_seq: record.scanSeq,
      scanned_at: DETECTION_NOW,
      duration_ms: record.durationMs,
      pack_versions: record.packVersions,
      probe_budget_used: record.probesUsed,
    };
    const rows: RepoDetection[] = record.rows.map((row, index) => {
      const relabel = this.relabels
        .filter((stored) => stored.scanSeq === record.scanSeq && row.rowKey === "tests")
        .at(-1)?.row;
      const effective = relabel ?? row;

      return {
        id: `row-${String(record.scanSeq)}-${String(index)}`,
        organization_id: organizationId,
        repo_ref: repo,
        scan_seq: record.scanSeq,
        row_key: effective.rowKey,
        verdict: effective.verdict,
        value: effective.value,
        evidence: effective.evidence,
        label: effective.label,
        created_at: DETECTION_NOW,
        updated_at: DETECTION_NOW,
      };
    });

    return Promise.resolve({ scan, rows });
  }

  measuredTests(): Promise<MeasuredTests | undefined> {
    return Promise.resolve(this.measured);
  }

  relabelTests(
    _organizationId: string,
    repo: string,
    scanSeq: number,
    row: DetectionRow,
  ): Promise<void> {
    this.relabels.push({ repo, scanSeq, row });

    return Promise.resolve();
  }

  policies(organizationId: string, repo: string): Promise<PolicyRow[]> {
    return Promise.resolve([...(this.policyRows.get(`${organizationId}|${repo}`) ?? [])]);
  }

  /** @inheritdoc */
  replacePolicies(
    organizationId: string,
    repo: string,
    globs: readonly string[],
  ): Promise<PolicyRow[]> {
    const key = `${organizationId}|${repo}`;
    const rows = [...globs].sort().map((glob) => ({ path_glob: glob, source: "edited" as const }));

    this.edited.add(key);
    this.policyRows.set(key, rows);

    return Promise.resolve(rows);
  }

  /**
   * Mark a glob as a person's.
   *
   * @param repo - The repository.
   * @param glob - The glob.
   * @param source - Its provenance.
   */
  setPolicy(repo: string, glob: string, source: ProtectedPathSource): void {
    const key = `${DETECTION_WORKSPACE}|${repo}`;
    const policies = (this.policyRows.get(key) ?? []).filter((policy) => policy.path_glob !== glob);

    this.policyRows.set(key, [...policies, { path_glob: glob, source }]);
  }
}

/**
 * A probe-capable provider answering from a fixture repository.
 *
 * @param repo - The fixture.
 * @param options - Constraints on the prober.
 * @returns The provider, cast to the SPI — only the members the detector reaches are real.
 */
export function fixtureProvider(
  repo: FixtureRepo,
  options: FixtureProberOptions = {},
): ProbeCapableProvider & { readonly calls: string[] } {
  const { prober, calls } = fixtureProber(repo, options);

  return {
    kind: "github",
    calls,
    capabilities: () => ({ probe: { repoProbes: true } }),
    coversRepo: (config: unknown, repoRef: string) => {
      const { login, repos } = config as { login: string; repos: string[] };

      return repos.some((name) => `${login}/${name}`.toLowerCase() === repoRef);
    },
    repoLanguages: () => prober({ kind: "languages" }),
    repoTree: () => prober({ kind: "tree" }),
    repoFile: (_context: TicketSyncContext, _repo: string, path: string) =>
      prober({ kind: "file", path }),
  } as unknown as ProbeCapableProvider & { readonly calls: string[] };
}

/**
 * A registry holding one provider.
 *
 * @param provider - The provider, or undefined for a build with none.
 * @returns The registry, as far as the service reads it.
 */
export function fixtureRegistry(provider: unknown): TicketSourceRegistry {
  return { find: () => provider } as unknown as TicketSourceRegistry;
}

/** An opener that hands the source to the scan, and records it. */
export class FixtureOpener implements DetectionSourceOpener {
  /** The sources opened, in order. */
  readonly opened: SyncSource[] = [];
  /** When set, opening fails with it — a credential the vault could not open. */
  failure: Error | undefined;
  /** When set, the scan waits for this before starting — to hold a scan "running". */
  gate: Promise<void> | undefined;

  async withCredentials<T>(
    source: SyncSource,
    run: (context: TicketSyncContext) => Promise<T>,
  ): Promise<T> {
    this.opened.push(source);

    if (this.failure !== undefined) {
      throw this.failure;
    }

    await this.gate;

    return run({
      sourceId: source.sourceId,
      organizationId: source.organizationId,
      config: source.config,
      credentials: "ghp_fixture",
    });
  }
}
