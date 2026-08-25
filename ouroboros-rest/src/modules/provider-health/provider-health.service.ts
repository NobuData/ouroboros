/**
 * The sweep — what actually decides whether a provider's dot is green, amber, or honestly
 * absent.
 *
 * Z.3 ([#196](https://github.com/NobuData/ouroboros/issues/196)), decision **M8**. Three
 * rules govern everything below, and each of them is a rule about *not* saying something:
 *
 *   * **This service writes only states it observed.** A check that ran produces `active` or
 *     `error`. A check that could not run — a kind with nothing cheap to ask, a row with no
 *     address, a cloud connection whose key has not been entered, a credential this
 *     deployment cannot open — produces **no write at all**. The row keeps whatever it had,
 *     which for a fresh connection is V015's `unknown`. That is why Copilot and Cursor stay
 *     `unknown` until AB.2 ([#208](https://github.com/NobuData/ouroboros/issues/208)), and
 *     why Y.4's seeded states survive a sweep instead of being flattened by it.
 *   * **Latency is stored only where a check measured it.** There is no default and no zero;
 *     see `snapshot.ts`.
 *   * **No completion request is issued.** There is no path from here to one — the only HTTP
 *     this module can perform is `probe.client.ts`'s body-less `GET` against a path from
 *     `checks.ts`'s frozen table.
 *
 * ---------------------------------------------------------------------------
 * **The one place a plaintext credential exists in this module.** {@link ProviderHealthService.keyFor}
 * opens one, for a key-validation check, for the length of one probe. It is not returned to a
 * caller, not attached to the outcome, not put on the row, and not logged — the sweep's log
 * lines are built from a status and a phrase, and `probe.client.ts` logs nothing at all. The
 * `ouroboros/no-secret-logging` lint rule is the second half of that and applies to this file
 * like every other.
 *
 * **A credential that will not open is not a provider failure.** If the vault cannot decrypt
 * a stored envelope — a database restored without `tenant_keys`, a workspace whose rows
 * outlived its key — that is this deployment's problem and says nothing about Anthropic. It
 * is logged for an operator and the row is left alone. Recording `error` would put this
 * service's own fault on somebody else's chip.
 */

import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import type { ProviderConnectionKind } from "../db/schema";
import { describeForLog } from "../errors/failure";
import type { ProviderValidation } from "../providers/provider.adapter";
import { PROVIDER_ERROR_STATUS } from "../providers/provider.errors";
import { VaultService } from "../vault/vault.service";
import { MAX_CHECKS_PER_SWEEP, PROBE_CONCURRENCY, chunked } from "./cadence";
import {
  checkFor,
  checkKindFor,
  checkUrl,
  kindsOnCadence,
  reportsLatencyFor,
  type ProviderCheck,
} from "./checks";
import { ProviderProbe, type ProbeOutcome } from "./probe.client";
import {
  ProviderHealthRepository,
  type DueConnection,
  type DueCutoffs,
} from "./provider-health.repository";
import { providerHealthResource, type ProviderHealthStripResource } from "./resources";
import { mergeHealth, toSnapshot, type ProbeHealth, type ProviderHealthSnapshot } from "./snapshot";

/** What one sweep did, for the log and for a test that wants to assert it. */
export interface SweepReport {
  /** How many connections were checked — probes actually performed. */
  readonly checked: number;
  /** How many of those answered. */
  readonly active: number;
  /** How many failed, refused or timed out. */
  readonly failed: number;
  /**
   * How many due rows were passed over without a probe, and therefore without a write.
   *
   * Not a failure count. A cloud connection with no key yet, and a local one with no address,
   * are both ordinary rows in a workspace somebody is still setting up.
   */
  readonly skipped: number;
  /**
   * Whether the sweep hit {@link MAX_CHECKS_PER_SWEEP}.
   *
   * Reported rather than swallowed: a silent cap reads, from outside, exactly like a sweep
   * that covered everything.
   */
  readonly capped: boolean;
}

@Injectable()
export class ProviderHealthService {
  /** Where a deployment fault goes. Never a provider's state — that goes on the row. */
  private readonly logger = new Logger(ProviderHealthService.name);

  /**
   * @param connections - The statements against `provider_connections`.
   * @param probe - The one thing here that talks to a provider.
   * @param vault - Opens a stored credential, for the one check that needs one. Injected
   *   rather than reached for through the registry, because `RegistryModule` deliberately
   *   holds no vault: a *resolution* carries an address and never a key, and this module is
   *   the different thing — a background job that authenticates as the workspace in order to
   *   ask whether it still can.
   * @param config - The cadences, from the environment.
   */
  constructor(
    private readonly connections: ProviderHealthRepository,
    private readonly probe: ProviderProbe,
    private readonly vault: VaultService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Check every connection whose last check is old enough, and record what was found.
   *
   * @param now - The sweep's clock. Passed in rather than read, so a test can place a row
   *   either side of a cutoff without waiting for one, and so every row in one sweep is
   *   compared against the same instant.
   * @returns What it did. Never rejects for anything a provider did; a repository failure is
   *   the scheduler's to catch, which is where a database that is down belongs.
   */
  async sweep(now: Date = new Date()): Promise<SweepReport> {
    const due = await this.connections.due(this.cutoffs(now), MAX_CHECKS_PER_SWEEP);
    const outcomes: ("active" | "failed" | "skipped")[] = [];

    // Chunked rather than all at once: a workspace with fifty providers should not open fifty
    // sockets in the same millisecond every cycle. See `cadence.ts`.
    for (const run of chunked(due, PROBE_CONCURRENCY)) {
      outcomes.push(...(await Promise.all(run.map((row) => this.checkOne(row)))));
    }

    const report: SweepReport = {
      checked: outcomes.filter((outcome) => outcome !== "skipped").length,
      active: outcomes.filter((outcome) => outcome === "active").length,
      failed: outcomes.filter((outcome) => outcome === "failed").length,
      skipped: outcomes.filter((outcome) => outcome === "skipped").length,
      capped: due.length === MAX_CHECKS_PER_SWEEP,
    };

    if (report.capped) {
      this.logger.warn(
        `Provider health sweep checked its cap of ${MAX_CHECKS_PER_SWEEP.toString()} ` +
          "connections; the rest are checked next cycle, oldest first.",
      );
    }

    return report;
  }

  /**
   * The strip, for one workspace.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Every connection as a chip, ordered by name. Empty for a workspace that has
   *   configured no providers — a state for the page to render rather than an error.
   */
  async strip(organizationId: string): Promise<ProviderHealthStripResource> {
    const snapshots = await this.snapshots(organizationId);

    return { providers: snapshots.map(providerHealthResource) };
  }

  /**
   * Health, as the pure input Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194))
   * resolves against.
   *
   * The ticket's *health snapshots exported for Z.1 to consume as pure inputs*, and "pure" is
   * the operative word: a resolution decides which hop to take, and a resolver that performed
   * a network check while deciding would make routing latency a function of provider latency
   * and make the same question answerable two different ways a second apart. It reads what
   * the sweep last wrote and nothing else.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns One snapshot per connection, ordered by display name.
   */
  async snapshots(organizationId: string): Promise<ProviderHealthSnapshot[]> {
    const rows = await this.connections.forOrganization(organizationId);

    return rows.map(toSnapshot);
  }

  /**
   * The instants each cadence class is stale before.
   *
   * @param now - The sweep's clock.
   * @returns The cutoffs and the kinds they apply to.
   */
  private cutoffs(now: Date): DueCutoffs {
    return {
      local: {
        kinds: kindsOnCadence("local"),
        before: new Date(now.getTime() - this.config.providerHealthIntervalSeconds * 1000),
      },
      cloud: {
        kinds: kindsOnCadence("cloud"),
        before: new Date(now.getTime() - this.config.providerHealthKeyCheckSeconds * 1000),
      },
    };
  }

  /**
   * Record what a live `validate` through an adapter found — the one check this service did
   * not schedule.
   *
   * Mockup 07's **Test connection** (AE.4, [#230](https://github.com/NobuData/ouroboros/issues/230))
   * is user-initiated, goes through the adapter's own `validate`, and is admitted by the
   * lifecycle's role gate rather than by this module; what it owes this module is the write,
   * so the routing page's strip and the providers page's pill are one measurement rather than
   * two opinions. It comes through here rather than through a second writer for the reasons
   * the column has one: {@link mergeHealth} is what keeps AB.2's reserved key intact, and
   * `record` is what stamps the check's clock.
   *
   * The controller's *no check on demand* rule stands: nothing here issues a request. The
   * request was the adapter's, under an administrator's session, and decision **P9** bounds
   * it to a models-list or a ping — the same class of call the sweep makes, never a completion.
   *
   * @param organizationId - The workspace.
   * @param connectionId - The connection that was tested.
   * @param kind - Its kind, for the check name and the latency judgement.
   * @param hasSecret - Whether the adapter's schema declares a credential, for
   *   {@link checkKindFor}.
   * @param validation - What the adapter found.
   * @param at - When the check finished.
   * @returns When it is stored. A connection this workspace does not have is left alone — the
   *   caller has already answered `404` for it, and a write here would be to nothing.
   */
  async recordValidation(
    organizationId: string,
    connectionId: string,
    kind: ProviderConnectionKind,
    hasSecret: boolean,
    validation: ProviderValidation,
    at: Date,
  ): Promise<void> {
    const existing = await this.connections.healthOf(organizationId, connectionId);

    if (existing === undefined) {
      return;
    }

    await this.connections.record(organizationId, connectionId, {
      status: validation.status === "ok" ? "active" : PROVIDER_ERROR_STATUS[validation.errorClass],
      health: mergeHealth(existing, validated(kind, hasSecret, validation)),
      checkedAt: at,
    });
  }

  /**
   * Check one connection, and write back only if a check was actually performed.
   *
   * @param row - The due connection, as the sweep's read returned it.
   * @returns What happened, for the report.
   */
  private async checkOne(row: DueConnection): Promise<"active" | "failed" | "skipped"> {
    const check = checkFor(row.kind);

    // Unreachable through `due`, which only asks for kinds that have one. Kept because it is
    // what makes this method safe to call from anywhere, and because the alternative — a
    // non-null assertion — would be this file promising something the query is responsible for.
    if (check === null) {
      return "skipped";
    }

    const url = checkUrl(check, row.base_url);

    if (url === undefined) {
      // A connection with no address and no vendor default. V015 requires one for the two
      // local kinds, so this is a cloud row nothing can reach — a row mockup 07 has not
      // finished rather than a provider that is down, and `unknown` is the honest chip.
      return "skipped";
    }

    const apiKey = await this.keyFor(check, row);

    if (check.authorize !== null && apiKey === undefined) {
      return "skipped";
    }

    const outcome = await this.probe.run(url, check, apiKey);

    await this.connections.record(row.organization_id, row.id, {
      status: outcome.ok ? "active" : "error",
      health: mergeHealth(row.health, measured(check, outcome)),
      // The check's clock, per V015's column comment: a check that found nothing changed
      // still moves it, because "when did we last look" is the question it answers.
      checkedAt: new Date(),
    });

    return outcome.ok ? "active" : "failed";
  }

  /**
   * Open the credential a key-validation check needs, if there is one and it opens.
   *
   * @param check - The kind's check.
   * @param row - The connection.
   * @returns The plaintext, or `undefined` — for a check that needs none, for a row that holds
   *   none, and for one this deployment cannot open. The caller turns the last two into a
   *   skipped row rather than into a state, which is this file's header's argument.
   */
  private async keyFor(check: ProviderCheck, row: DueConnection): Promise<string | undefined> {
    if (check.authorize === null || !row.has_credential) {
      return undefined;
    }

    const sealed = await this.connections.sealedCredential(row.organization_id, row.id);

    if (sealed === null) {
      // Raced with a write that cleared it between the sweep's read and this one. Ordinary.
      return undefined;
    }

    try {
      // The record id is the connection's primary key, which is what the envelope's additional
      // data is bound to — `registry.secrets.ts` says why it must go on being that value.
      return await this.vault.decryptText(row.organization_id, row.id, sealed);
    } catch (error) {
      // This deployment's fault, not the provider's. Logged where an operator can act on it,
      // and deliberately not written to the row.
      this.logger.error(
        `Provider connection ${row.id} could not be unsealed for a ${check.check} check; ` +
          "its health is left unchanged.",
        describeForLog(error),
      );

      return undefined;
    }
  }
}

/**
 * A probe outcome as the `health` keys this service owns.
 *
 * A free function rather than a method: it is a pure mapping from an outcome to a shape, it is
 * the place the *no latency without a measurement* rule is actually applied, and a test that
 * wants to assert that rule should not have to build a service to do it.
 *
 * @param check - The check that was performed, whose name goes on the record.
 * @param outcome - What it found.
 * @returns The probe-owned keys. A failure carries a `detail` and **no** `latency_ms` — see
 *   `probe.client.ts`'s `ProbeFailure`. A success carries no `models` unless one was counted,
 *   and no `latency_ms` unless the check is one whose round trip is worth storing — see
 *   `ProviderCheck.reportsLatency`, which is where that judgement is made rather than here.
 */
export function measured(check: ProviderCheck, outcome: ProbeOutcome): ProbeHealth {
  if (!outcome.ok) {
    return { check: check.check, detail: outcome.detail };
  }

  return {
    check: check.check,
    ...(check.reportsLatency ? { latency_ms: outcome.latencyMs } : {}),
    ...(outcome.models === null ? {} : { models: outcome.models }),
  };
}

/**
 * An adapter's validation as the `health` keys the column owns.
 *
 * The same rules as {@link measured}, applied to the SPI's answer: a failure carries its phrase
 * and its class and **no** latency, because `ProviderValidationFailure` has none to carry; a
 * success carries a latency only where {@link reportsLatencyFor} says the round trip means
 * something. A test enumerates nothing, so it carries no `models` — and the merge clears the
 * count the last sweep wrote, because a count with a fresh stamp beside it would be vouching
 * for a measurement this check did not make. The next sweep restores it.
 *
 * @param kind - The connection's kind.
 * @param hasSecret - Whether the adapter's schema declares a credential.
 * @param validation - What the adapter found.
 * @returns The probe-owned keys.
 */
export function validated(
  kind: ProviderConnectionKind,
  hasSecret: boolean,
  validation: ProviderValidation,
): ProbeHealth {
  const check = checkKindFor(kind, hasSecret);

  if (validation.status === "failed") {
    return { check, detail: validation.detail, error_class: validation.errorClass };
  }

  return {
    check,
    ...(reportsLatencyFor(kind) ? { latency_ms: validation.latencyMs } : {}),
  };
}
