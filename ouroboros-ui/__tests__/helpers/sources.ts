import type { Reading } from "@/app/api/reading";
import type {
  TicketSource,
  TicketSourceCatalog,
  TicketSourceCatalogEntry,
  TicketSourceFormField,
  TicketSourcePage,
  TicketSourceStatusReport,
  TicketSourceTest,
} from "@/app/api/sources";
import type { SourcesReadings } from "@/app/sources/data";

/**
 * The ticket-sources page's fixtures — the catalog as `GET /api/v1/sources/catalog` serves it,
 * the seed's two sources, and the status reports the rows read
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * **The GitHub entry is `ouroboros-rest`'s own**, field for field: what
 * `providers/github.config.ts`'s `GITHUB_SOURCE_SCHEMA` derives to through
 * `toSourceFormFields`, which is what the service answers — so a dialog driven by this is
 * driven by what it will meet in a development stack.
 *
 * {@link fakeEntry} is the proof the ticket asks for: *"verified by pointing the same form
 * component at the in-memory fake provider's schema"*. It is the REST fixture provider's
 * schema — a `url`, a `text`, a `select`, a `list` and a `secret`, every widget the dialect
 * has — under a kind no UI file names, so a dialog that draws it draws anything.
 *
 * The two sources are `R__dev_seed_sources.sql`'s rows: the GitHub one, active and synced,
 * and the Jira one, paused with no credential.
 */

/** Every optional keyword, explicitly unset — the shape the service answers. */
const NOTHING_SET: Omit<TicketSourceFormField, "name" | "label" | "widget" | "required"> = {
  help: null,
  placeholder: null,
  defaultValue: null,
  choices: null,
  minLength: null,
  maxLength: null,
  pattern: null,
  minItems: null,
  maxItems: null,
};

/**
 * One field, optional and with nothing else set unless this case says so.
 *
 * @param over The field's name, label and widget, plus whatever the case is about.
 * @returns The field as the contract serves it.
 */
export function formField(
  over: Pick<TicketSourceFormField, "name" | "label" | "widget"> & Partial<TicketSourceFormField>,
): TicketSourceFormField {
  return { required: false, ...NOTHING_SET, ...over };
}

/** The GitHub provider's form: the account, the repository list, and the token. */
export function githubEntry(): TicketSourceCatalogEntry {
  return {
    kind: "github",
    title: "Connect a GitHub account",
    capabilities: { webhooks: false, labels: true, bidirectionalWrites: false },
    fields: [
      formField({
        name: "login",
        label: "GitHub account",
        widget: "text",
        required: true,
        help: "The organization or user whose repositories to watch, as it appears in a URL.",
        placeholder: "The account name — not a URL",
        minLength: 1,
        maxLength: 39,
        pattern: "^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$",
      }),
      formField({
        name: "repos",
        label: "Repositories",
        widget: "list",
        required: true,
        help: "One repository name per line, without the account — helios-firmware, not acme/helios-firmware.",
        placeholder: "One repository per line",
        minLength: 1,
        maxLength: 100,
        pattern: "^(?!\\.\\.?$)[A-Za-z0-9._-]{1,100}$",
        minItems: 1,
        maxItems: 50,
      }),
      formField({
        name: "token",
        label: "Personal access token",
        widget: "secret",
        required: true,
        help: "Read access to issues on the repositories above. Sealed in the vault the moment it is stored and never shown again.",
        placeholder: "Pasted, never typed — a fine-grained or classic token",
        minLength: 1,
        maxLength: 4096,
      }),
    ],
  };
}

/** The kind the fake entry registers under — one no UI file names. */
export const FAKE_KIND = "custom";

/** The fake entry's heading — what the form step is titled. */
export const FAKE_TITLE = "Connect the fixture tracker";

/**
 * The REST fixture provider's schema, as the catalog would serve it: every widget the dialect
 * has, under a kind the UI has no copy for.
 */
export function fakeEntry(): TicketSourceCatalogEntry {
  return {
    kind: FAKE_KIND,
    title: FAKE_TITLE,
    capabilities: { webhooks: false, labels: false, bidirectionalWrites: false },
    fields: [
      formField({
        name: "site",
        label: "Site",
        widget: "url",
        required: true,
        help: "Where the tracker answers.",
        minLength: 1,
      }),
      formField({
        name: "project",
        label: "Project key",
        widget: "text",
        required: true,
        placeholder: "Upper-case, as the tracker spells it",
        minLength: 1,
        maxLength: 16,
        pattern: "^[A-Z][A-Z0-9]*$",
      }),
      formField({
        name: "region",
        label: "Region",
        widget: "select",
        choices: ["eu", "us"],
        defaultValue: "eu",
      }),
      formField({
        name: "boards",
        label: "Boards",
        widget: "list",
        required: true,
        help: "One board per line.",
        minLength: 1,
        maxLength: 32,
        minItems: 1,
        maxItems: 5,
      }),
      formField({ name: "apiToken", label: "API token", widget: "secret", required: true, minLength: 8 }),
    ],
  };
}

/**
 * The catalog, as the service answers it for this build: GitHub, and nothing else.
 *
 * @returns The entries.
 */
export function seededCatalog(): TicketSourceCatalogEntry[] {
  return [githubEntry()];
}

/**
 * The catalog payload.
 *
 * @param kinds The entries. Defaults to the build's.
 * @returns The payload.
 */
export function catalogPayload(kinds: readonly TicketSourceCatalogEntry[] = seededCatalog()): TicketSourceCatalog {
  return { kinds: [...kinds] };
}

/** The seed's GitHub source. */
export const SEEDED_GITHUB_ID = "5eed001a-0000-4000-8000-000000000001";

/** The seed's Jira source — paused, with no credential. */
export const SEEDED_JIRA_ID = "5eed001a-0000-4000-8000-000000000002";

/** The instant every suite reads the page at — the seed's *synced 40s ago* is from here. */
export const READ_AT = "2026-09-12T10:00:40.000Z";

/** When the seed's GitHub source last synced — forty seconds before {@link READ_AT}. */
export const SEEDED_SYNCED_AT = "2026-09-12T10:00:00.000Z";

/**
 * One source, defaulting to the seed's GitHub one.
 *
 * @param over What differs.
 * @returns The source.
 */
export function source(over: Partial<TicketSource> = {}): TicketSource {
  return {
    id: SEEDED_GITHUB_ID,
    kind: "github",
    displayName: "GitHub · acme-robotics",
    config: {
      login: "acme-robotics",
      repos: ["helios-firmware", "helios-console", "helios-telemetry", "atlas-scheduler"],
    },
    status: "active",
    statusReason: null,
    credentialMask: "••••",
    syncedAt: SEEDED_SYNCED_AT,
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: SEEDED_SYNCED_AT,
    ...over,
  };
}

/** The seed's Jira source. */
export function jiraSource(over: Partial<TicketSource> = {}): TicketSource {
  return source({
    id: SEEDED_JIRA_ID,
    kind: "jira",
    displayName: "Jira · PROJ",
    config: { base_url: "https://acme-robotics.atlassian.net", project_keys: ["PROJ"] },
    status: "paused",
    credentialMask: null,
    syncedAt: null,
    updatedAt: "2026-09-01T09:00:00.000Z",
    ...over,
  });
}

/** A source the tracker refused — the honest reason on the row. */
export function failedSource(over: Partial<TicketSource> = {}): TicketSource {
  return source({
    id: "5eed001a-0000-4000-8000-000000000003",
    displayName: "GitHub · forge-io",
    config: { login: "forge-io", repos: ["forge"] },
    status: "error",
    statusReason: "rate limited until 14:20 UTC",
    syncedAt: "2026-09-12T09:30:00.000Z",
    ...over,
  });
}

/**
 * The seed's two sources, in the listing's order — by display name.
 *
 * @returns The sources.
 */
export function seededSources(): TicketSource[] {
  return [source(), jiraSource()];
}

/**
 * One page of sources.
 *
 * @param items The sources. Defaults to the seed's.
 * @returns The page.
 */
export function sourcePage(items: readonly TicketSource[] = seededSources()): TicketSourcePage {
  return { items: [...items], total: items.length, limit: 100, offset: 0 };
}

/**
 * One status report, defaulting to the seed's GitHub source's: synced a moment ago, nothing
 * running, and the interval still counting down.
 *
 * @param over What differs.
 * @returns The report.
 */
export function statusReport(over: Partial<TicketSourceStatusReport> = {}): TicketSourceStatusReport {
  return {
    sourceId: SEEDED_GITHUB_ID,
    status: "active",
    statusReason: null,
    syncedAt: SEEDED_SYNCED_AT,
    running: false,
    retryAfterSeconds: null,
    lastSync: {
      startedAt: SEEDED_SYNCED_AT,
      outcome: "synced",
      imported: 2,
      updated: 1,
      unchanged: 6,
      skippedClosed: 0,
      enqueued: 2,
      hasMore: false,
      errorClass: null,
      reason: null,
    },
    ...over,
  };
}

/**
 * A test result, defaulting to a pass.
 *
 * @param over What differs.
 * @returns The result.
 */
export function testResult(over: Partial<TicketSourceTest> = {}): TicketSourceTest {
  return {
    sourceId: SEEDED_GITHUB_ID,
    checkedAt: READ_AT,
    status: "ok",
    errorClass: null,
    detail: "acme-robotics · 4 repositories",
    reason: null,
    ...over,
  };
}

/** A refused test — the token the tracker would not take. */
export function refusedTest(): TicketSourceTest {
  return testResult({
    status: "failed",
    errorClass: "auth",
    detail: "GitHub refused the token (401)",
    reason: "credentials rejected",
  });
}

/**
 * The seed's statuses, by source id.
 *
 * @param items The sources whose statuses to seed.
 * @returns The map.
 */
export function seededStatuses(
  items: readonly TicketSource[] = seededSources(),
): Map<string, Reading<TicketSourceStatusReport>> {
  return new Map(
    items.map((item) => [
      item.id,
      {
        ok: true,
        value: statusReport({
          sourceId: item.id,
          status: item.status,
          statusReason: item.statusReason,
          syncedAt: item.syncedAt,
          lastSync: item.syncedAt === null ? null : statusReport().lastSync,
        }),
      },
    ]),
  );
}

/**
 * Everything the screen draws, in the seeded world.
 *
 * @param over What differs.
 * @returns The readings.
 */
export function readings(over: Partial<SourcesReadings> = {}): SourcesReadings {
  return {
    sources: { ok: true, value: seededSources() },
    catalog: { ok: true, value: seededCatalog() },
    statuses: seededStatuses(),
    now: READ_AT,
    ...over,
  };
}
