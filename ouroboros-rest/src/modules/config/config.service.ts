import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { LocalProviderKind } from "../internal/providers";
import {
  listenHost,
  type Configuration,
  type ListenHost,
  type NodeEnvironment,
} from "./configuration";
import { describeConfiguration } from "./redaction";

/**
 * The typed accessor every other module reads configuration through.
 *
 * `@nestjs/config`'s own `ConfigService` is the store underneath — it holds the validated
 * object and is what makes this a `@nestjs/config` module rather than a home-grown one —
 * and this class is the surface. The division is what buys the acceptance criterion: a
 * consumer asks for `config.databaseUrl` and gets a `string`, not `config.get("...")` and
 * a `string | undefined` it has to talk itself out of, and nothing outside this directory
 * ever names an environment variable at all.
 *
 * Everything here is a getter over already-validated data, so nothing can fail: the one
 * moment configuration can be wrong is `loadConfiguration`, in the process entry point,
 * before this provider exists.
 */
@Injectable()
export class AppConfigService {
  /**
   * @param config - Nest's configuration store, holding the validated {@link Configuration}
   *   that `ConfigurationModule.forRoot` loaded into it. The second type parameter is
   *   `true` — "this was validated" — which is what makes every `get` below return a value
   *   rather than a value-or-undefined.
   */
  constructor(private readonly config: ConfigService<Configuration, true>) {}

  /** TCP port to listen on — `PORT`. */
  get port(): number {
    return this.config.getOrThrow<number>("port");
  }

  /** Which environment this is — `NODE_ENV`. */
  get nodeEnv(): NodeEnvironment {
    return this.config.getOrThrow<NodeEnvironment>("nodeEnv");
  }

  /** PostgreSQL connection string for `ouroboros-db` — `OURO_DATABASE_URL`. */
  get databaseUrl(): string {
    return this.config.getOrThrow<string>("databaseUrl");
  }

  /** The origin a browser reaches this service at — `OURO_REST_URL`. */
  get restUrl(): string {
    return this.config.getOrThrow<string>("restUrl");
  }

  /** Where a browser is sent once signed in, or signed out — `OURO_UI_URL`. */
  get uiUrl(): string {
    return this.config.getOrThrow<string>("uiUrl");
  }

  /** Base URL of `ouroboros-engine` — `OURO_ENGINE_URL`. */
  get engineUrl(): string {
    return this.config.getOrThrow<string>("engineUrl");
  }

  /** Value sent as `X-Ouro-Internal-Key` — `OURO_ENGINE_SHARED_SECRET`. */
  get engineSharedSecret(): string {
    return this.config.getOrThrow<string>("engineSharedSecret");
  }

  /**
   * The second value `X-Ouro-Internal-Key` may carry — `OURO_RUN_SIMULATOR_SECRET`.
   *
   * `undefined` when unset, which is *this deployment runs no simulator*: every run opened
   * through the ingestion contract is then a real one. `get` rather than `getOrThrow` for
   * that reason — an absent simulator is a configuration, not a failure.
   */
  get runSimulatorSecret(): string | undefined {
    return this.config.get<string>("runSimulatorSecret");
  }

  /** BetterAuth's signing and encryption key — `BETTER_AUTH_SECRET`. */
  get betterAuthSecret(): string {
    return this.config.getOrThrow<string>("betterAuthSecret");
  }

  /** The origin BetterAuth builds its own URLs from — `BETTER_AUTH_URL`. */
  get betterAuthUrl(): string {
    return this.config.getOrThrow<string>("betterAuthUrl");
  }

  /** GitHub OAuth application, client id — `OURO_GITHUB_CLIENT_ID`. */
  get githubClientId(): string {
    return this.config.getOrThrow<string>("githubClientId");
  }

  /** GitHub OAuth application, client secret — `OURO_GITHUB_CLIENT_SECRET`. */
  get githubClientSecret(): string {
    return this.config.getOrThrow<string>("githubClientSecret");
  }

  /**
   * The vault's key-encryption key, base64 — `OURO_VAULT_MASTER_KEY`.
   *
   * Read by exactly one thing: `MasterKeyWrapper` in `src/modules/vault/`, which decodes it
   * once at construction and holds the bytes. Nothing else should read it, and nothing at
   * all should log it — it is in `SECRET_VARIABLES`, so `describe()` cannot.
   */
  get vaultMasterKey(): string {
    return this.config.getOrThrow<string>("vaultMasterKey");
  }

  /** Browser origins allowed to call this API with credentials — `OURO_CORS_ORIGINS`. */
  get corsOrigins(): readonly string[] {
    return this.config.getOrThrow<readonly string[]>("corsOrigins");
  }

  /** Seconds between dashboard polls, sent as `X-Ouro-Poll-After` — `OURO_DASHBOARD_POLL_SECONDS`. */
  get dashboardPollSeconds(): number {
    return this.config.getOrThrow<number>("dashboardPollSeconds");
  }

  /**
   * Where this deployment's local model providers are — `OURO_LOCAL_PROVIDER_URLS`.
   *
   * Read by one thing: `LocalProviders` in `src/modules/internal/`, which is what answers a
   * worker's lease with an address. Empty for most installations, which is why that surface
   * answers `404 local_provider_not_configured` rather than treating an empty map as a
   * misconfiguration.
   */
  get localProviderUrls(): Readonly<Partial<Record<LocalProviderKind, string>>> {
    return this.config.getOrThrow<Readonly<Partial<Record<LocalProviderKind, string>>>>(
      "localProviderUrls",
    );
  }

  /**
   * The skill names the stage catalog suggests — `OURO_WORKFLOW_SKILL_SUGGESTIONS`.
   *
   * Read by one thing: `WorkflowCatalogService` in `src/modules/workflows/`. Advisory by
   * decision **P7**, and empty for an installation that configured none.
   */
  get workflowSkillSuggestions(): readonly string[] {
    return this.config.getOrThrow<readonly string[]>("workflowSkillSuggestions");
  }

  /**
   * The bind-interface override, when set — `OURO_LISTEN_HOST`.
   *
   * `get` rather than `getOrThrow`: unset is the normal posture, and the only stack that
   * sets it is the e2e compose override (see `configuration.ts`).
   */
  get listenHostOverride(): ListenHost | undefined {
    return this.config.get<ListenHost | undefined>("listenHostOverride");
  }

  /**
   * Where GitHub's REST API is — `OURO_GITHUB_API_BASE_URL`.
   *
   * Always a value: the schema defaults it to the public API, so the one caller —
   * `GithubModule`'s `OCTOKIT_FACTORY` — has an address to hand the library rather than a
   * branch to write. A GitHub Enterprise Server installation, and the e2e suite's sandbox
   * tracker, are the two things that set it.
   */
  get githubApiBaseUrl(): string {
    return this.config.getOrThrow<string>("githubApiBaseUrl");
  }

  /**
   * Seconds between provider health sweeps — `OURO_PROVIDER_HEALTH_INTERVAL_SECONDS`.
   *
   * The nominal interval. `src/modules/provider-health/` jitters every delay by ±25% around
   * it, so a fleet of self-hosted instances does not converge on one schedule; it is also the
   * age at which a *local* provider's last check counts as stale.
   */
  get providerHealthIntervalSeconds(): number {
    return this.config.getOrThrow<number>("providerHealthIntervalSeconds");
  }

  /**
   * Seconds before a cloud provider's key validation is redone —
   * `OURO_PROVIDER_HEALTH_KEY_CHECK_SECONDS`.
   *
   * Much slower than the sweep, and separate from it, because it governs requests to somebody
   * else's rate-limited service rather than to the operator's own machine.
   */
  get providerHealthKeyCheckSeconds(): number {
    return this.config.getOrThrow<number>("providerHealthKeyCheckSeconds");
  }

  /**
   * The header a trusted proxy forwards a runner's client certificate in —
   * `OURO_FARM_CLIENT_CERT_HEADER`.
   *
   * `undefined` when unset, which is the default: `src/modules/farm/` then reads the
   * certificate from the TLS socket and from nowhere else. See
   * `Configuration.farmClientCertHeader` on why trusting a header is an assertion only an
   * operator is in a position to make.
   */
  get farmClientCertHeader(): string | undefined {
    return this.config.get<string>("farmClientCertHeader");
  }

  /**
   * The oldest agent build the farm gateway accepts — `OURO_FARM_MIN_AGENT_VERSION`.
   *
   * `undefined` when unset, which is the default: no agent-version floor. See
   * `Configuration.farmMinAgentVersion`.
   */
  get farmMinAgentVersion(): string | undefined {
    return this.config.get<string>("farmMinAgentVersion");
  }

  /**
   * The https origin runner machines reach this deployment at — `OURO_FARM_PUBLIC_URL`.
   *
   * `undefined` when unset, which is the default: the installer then uses {@link restUrl}. See
   * `Configuration.farmPublicUrl`.
   */
  get farmPublicUrl(): string | undefined {
    return this.config.get<string>("farmPublicUrl");
  }

  /**
   * Where ouroboros-runner releases are served from — `OURO_FARM_RELEASES_DIR`.
   *
   * `undefined` when unset, which is the default: this deployment serves no installer. See
   * `Configuration.farmReleasesDir`.
   */
  get farmReleasesDir(): string | undefined {
    return this.config.get<string>("farmReleasesDir");
  }

  /**
   * The bytes of finished builds' logs one workspace keeps — `OURO_FARM_LOG_BUDGET_BYTES`. See
   * `Configuration.farmLogBudgetBytes`.
   */
  get farmLogBudgetBytes(): number {
    return this.config.getOrThrow<number>("farmLogBudgetBytes");
  }

  /**
   * Seconds between backlog sync cycles — `OURO_BACKLOG_SYNC_INTERVAL_SECONDS`.
   *
   * The nominal interval. `src/modules/backlog-sync/` jitters every delay by ±25% around it,
   * so a fleet of self-hosted instances does not arrive at github.com in the same second, and
   * a cycle that left a capped poll behind books its successor sooner than this rather than
   * waiting a full one.
   */
  get backlogSyncIntervalSeconds(): number {
    return this.config.getOrThrow<number>("backlogSyncIntervalSeconds");
  }

  /**
   * How many issues the estimation pipeline may size at once — `OURO_ESTIMATION_CONCURRENCY`.
   *
   * The bound `src/modules/estimation/`'s work queue admits against, and therefore the most
   * outbound calls to `ouroboros-engine` this process makes for sizing at any moment.
   */
  get estimationConcurrency(): number {
    return this.config.getOrThrow<number>("estimationConcurrency");
  }

  /**
   * Below what confidence an estimate routes its issue to `needs_human` —
   * `OURO_ESTIMATION_CONFIDENCE_FLOOR`.
   *
   * This service's policy, not the estimator's: the L.1 contract has no `needs_human` field on
   * purpose. Defaults to the engine's own published floor so the two cannot drift in silence.
   */
  get estimationConfidenceFloor(): number {
    return this.config.getOrThrow<number>("estimationConfidenceFloor");
  }

  /**
   * How long an issue may sit in `estimating` before the sweep re-queues it —
   * `OURO_ESTIMATION_STALE_SECONDS`.
   *
   * Not a timeout on an estimate — `EngineClient`'s own deadline is that — but how long a row
   * may claim to be estimating with nothing estimating it, which is what a process killed
   * mid-flight leaves behind.
   */
  get estimationStaleSeconds(): number {
    return this.config.getOrThrow<number>("estimationStaleSeconds");
  }

  /**
   * Seconds between stale-estimate sweeps — `OURO_ESTIMATION_SWEEP_INTERVAL_SECONDS`.
   *
   * The nominal interval; `src/modules/estimation/` jitters every delay by ±25% around it, as
   * every background loop in this service does.
   */
  get estimationSweepIntervalSeconds(): number {
    return this.config.getOrThrow<number>("estimationSweepIntervalSeconds");
  }

  /** Seconds a pause, resume or abort is worth delivering — `OURO_RUN_CONTROL_TTL_SECONDS` (#306). */
  get runControlTtlSeconds(): number {
    return this.config.getOrThrow<number>("runControlTtlSeconds");
  }

  /** Seconds a steer is worth delivering — `OURO_RUN_STEER_TTL_SECONDS` (#306). */
  get runSteerTtlSeconds(): number {
    return this.config.getOrThrow<number>("runSteerTtlSeconds");
  }

  /**
   * Seconds between control-expiry sweeps — `OURO_RUN_CONTROL_SWEEP_SECONDS` (#306).
   *
   * The nominal interval; `src/modules/controls/` jitters it by ±25%, as every loop here does.
   */
  get runControlSweepSeconds(): number {
    return this.config.getOrThrow<number>("runControlSweepSeconds");
  }

  /**
   * Days without a tracker update after which an open ticket is stale — `OURO_BACKLOG_STALE_DAYS`.
   *
   * The Backlog Health card's third meter (AL.5, #281); configurable rather than mockup 09's fixed
   * thirty.
   */
  get backlogStaleDays(): number {
    return this.config.getOrThrow<number>("backlogStaleDays");
  }

  /** The UTC hour the nightly re-estimation job is scheduled at — `OURO_REESTIMATION_HOUR_UTC`. */
  get reestimationHourUtc(): number {
    return this.config.getOrThrow<number>("reestimationHourUtc");
  }

  /**
   * The window after the scheduled hour a night's run is jittered across, in minutes —
   * `OURO_REESTIMATION_JITTER_MINUTES`.
   */
  get reestimationJitterMinutes(): number {
    return this.config.getOrThrow<number>("reestimationJitterMinutes");
  }

  /** The most unsized tickets one night's run queues — `OURO_REESTIMATION_BATCH`. */
  get reestimationBatch(): number {
    return this.config.getOrThrow<number>("reestimationBatch");
  }

  /**
   * Is this a production deployment?
   *
   * The one derived flag worth naming, because it is asked in several places and asking
   * it as `nodeEnv === "production"` in each of them is how one of them ends up spelling
   * it `"prod"`. It gates the `Secure` attribute on the legacy cookie eviction
   * (`src/modules/auth/legacy.cookie.ts`).
   *
   * The development email/password sign-in turns on the same question, but asks it of the
   * validated configuration rather than of this provider — `src/auth/password.provider.ts`
   * is loaded by `@better-auth/cli` with no Nest process anywhere, so it can name no
   * injectable. The two agree because both read `nodeEnv`.
   */
  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  /** Which interface to bind — see `listenHost` in `configuration.ts`. */
  get listenHost(): string {
    return listenHost(this.all);
  }

  /**
   * The whole validated set, as one object.
   *
   * @returns A fresh {@link Configuration}. Useful for handing configuration to something
   *   that is not a Nest provider, and for {@link describe}.
   */
  get all(): Configuration {
    return {
      port: this.port,
      nodeEnv: this.nodeEnv,
      databaseUrl: this.databaseUrl,
      restUrl: this.restUrl,
      uiUrl: this.uiUrl,
      engineUrl: this.engineUrl,
      engineSharedSecret: this.engineSharedSecret,
      runSimulatorSecret: this.runSimulatorSecret,
      betterAuthSecret: this.betterAuthSecret,
      betterAuthUrl: this.betterAuthUrl,
      githubClientId: this.githubClientId,
      githubClientSecret: this.githubClientSecret,
      githubApiBaseUrl: this.githubApiBaseUrl,
      vaultMasterKey: this.vaultMasterKey,
      corsOrigins: this.corsOrigins,
      dashboardPollSeconds: this.dashboardPollSeconds,
      listenHostOverride: this.listenHostOverride,
      farmLogBudgetBytes: this.farmLogBudgetBytes,
      providerHealthIntervalSeconds: this.providerHealthIntervalSeconds,
      providerHealthKeyCheckSeconds: this.providerHealthKeyCheckSeconds,
      backlogSyncIntervalSeconds: this.backlogSyncIntervalSeconds,
      estimationConcurrency: this.estimationConcurrency,
      estimationConfidenceFloor: this.estimationConfidenceFloor,
      estimationStaleSeconds: this.estimationStaleSeconds,
      estimationSweepIntervalSeconds: this.estimationSweepIntervalSeconds,
      runControlTtlSeconds: this.runControlTtlSeconds,
      runSteerTtlSeconds: this.runSteerTtlSeconds,
      runControlSweepSeconds: this.runControlSweepSeconds,
      backlogStaleDays: this.backlogStaleDays,
      reestimationHourUtc: this.reestimationHourUtc,
      reestimationJitterMinutes: this.reestimationJitterMinutes,
      reestimationBatch: this.reestimationBatch,
      localProviderUrls: this.localProviderUrls,
      workflowSkillSuggestions: this.workflowSkillSuggestions,
    };
  }

  /**
   * The configuration written down for a log, with every secret redacted.
   *
   * @returns The block {@link describeConfiguration} renders. This is the only supported
   *   way to log configuration — see `redaction.ts`.
   */
  describe(): string {
    return describeConfiguration(this.all);
  }
}
