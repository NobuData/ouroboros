/**
 * The Anthropic Messages-format facade over the chain executor — DH.2
 * ([#1303](https://github.com/NobuData/ouroboros/issues/1303)).
 *
 * ```
 * harness ── POST …/v1/messages {model: alias, …}  x-api-key: ouro_hrn_…
 *   authenticate      credential → run · stage · alias · attempt          else 401
 *   model = alias?    a credential minted for one alias calls no other    else 403
 *   plan              #235's prepare: the stage's route, or the alias alone
 *   Anthropic hops    every other hop skipped, with why; none left        → no_anthropic_hop
 *   cap               the run's, before every call (never mid-stream)     → cost_cap_exceeded
 *   for each hop      provider month cap → relay → 5xx/429/auth/G8 before the first byte: next
 *   success           relayed byte for byte, ping included; usage row per call
 *   every hop failed  the last upstream error body, unmodified
 * ```
 *
 * **Relayed, not translated.** The executor's `invoke()` reframes a stream as NDJSON; a harness
 * needs the provider's own server-sent events, `ping` frames and all, and its own error bodies,
 * as the vendor's gateway guide requires. So the facade walks the same plan the executor would
 * and meters it through the same usage path, but hands the bytes over as they arrive.
 *
 * **The cap is checked before each call, never by cutting a stream.** A stream cut halfway is a
 * corrupt turn for the harness; refusing the *next* call is what lets the stage halt with the
 * cap named. Routing's per-hop params are not merged into the harness's request: its request is
 * the harness's, an open list of fields.
 */

import { Injectable } from "@nestjs/common";

import { DomainError } from "../../errors/error.envelope";
import { PricingService } from "../../pricing/pricing.service";
import { ConnectionOpener } from "../../provider-connections/connection.opener";
import { monthWindow } from "../../provider-connections/spend";
import {
  supportsMessagesRelay,
  type MessagesRelayPath,
  type RelayedMessages,
} from "../../providers/provider.adapter";
import { INTERNAL_ERRORS } from "../internal.errors";
import { INVOKE_ERROR_CODES, type InvokeCap } from "../invoke.contract";
import { ADVANCES, codeOf, costOf } from "../invoke/invoke.executor";
import { isRefusal, type PlannedHop } from "../invoke/invoke.plan";
import { InvokeRepository } from "../invoke/invoke.repository";
import {
  InvokeService,
  ratesOf,
  usageRow,
  type PreparedInvocation,
} from "../invoke/invoke.service";
import { facadeRefusal, type FacadeRefusal } from "./harness.errors";
import type { CredentialBinding } from "./harness.repository";

/** The request headers relayed to the provider, unchanged. */
export const FORWARDED_HEADERS = ["anthropic-version", "anthropic-beta"] as const;

/** The response header naming the hops the facade skipped, when it skipped any. */
export const SKIPPED_HOPS_HEADER = "x-ouroboros-skipped-hops";

/** Where the facade writes its answer. */
export interface RelaySink {
  /** Send the status and headers. Called once, before any {@link write}. */
  head(status: number, headers: Readonly<Record<string, string>>): void;
  /** Send bytes as they arrive. */
  write(chunk: Uint8Array): void;
  /** End the answer. */
  end(): void;
}

/** One facade call, as the controller hands it over. */
export interface FacadeCall {
  readonly path: MessagesRelayPath;
  readonly binding: CredentialBinding;
  readonly body: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

@Injectable()
export class HarnessFacadeService {
  constructor(
    private readonly invocations: InvokeService,
    private readonly repository: InvokeRepository,
    private readonly connections: ConnectionOpener,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Answer one harness call: relay it, or write the facade's refusal.
   *
   * @param call - The call.
   * @param sink - Where the answer goes.
   */
  async relay(call: FacadeCall, sink: RelaySink): Promise<void> {
    const refusal = await this.walk(call, sink);

    if (refusal !== null) {
      writeRefusal(sink, refusal);
    }
  }

  /**
   * The walk; a refusal when the facade answers instead of a provider.
   *
   * @param call - The call.
   * @param sink - Where a relayed answer goes.
   * @returns The refusal to write, or null when an answer was relayed.
   */
  private async walk(call: FacadeCall, sink: RelaySink): Promise<FacadeRefusal | null> {
    const { binding, body } = call;

    if (body.model !== binding.alias) {
      return facadeRefusal(
        "alias_mismatch",
        `This credential is bound to the alias ${binding.alias} and calls no other.`,
      );
    }

    const prepared = await this.prepare(binding);

    if ("status" in prepared) {
      return prepared;
    }

    const plan = prepared.plan;

    if (isRefusal(plan)) {
      return facadeRefusal(
        plan.code === INVOKE_ERROR_CODES.voteExecutionUnavailable
          ? "vote_execution_unavailable"
          : "resolution_failed",
        plan.message,
        plan.reason === undefined ? {} : { reason: plan.reason },
      );
    }

    const skipped = plan.hops
      .filter((hop) => hop.kind !== "anthropic")
      .map((hop) => skippedFormat(hop));
    const hops = plan.hops.filter((hop) => hop.kind === "anthropic");

    if (hops.length === 0) {
      return facadeRefusal(
        "no_anthropic_hop",
        `The route for ${binding.alias} has no Anthropic-format hop, and the harness serves ` +
          `Claude models only: ${skipped.join("; ")}.`,
        { skipped },
      );
    }

    const counting = call.path === "/v1/messages/count_tokens";

    if (!counting && plan.cap !== null) {
      const spent = await this.repository.subjectSpent(prepared.subject);

      if (spent >= plan.cap.limitCents) {
        const cap: InvokeCap = { ...plan.cap, spentCents: spent };

        return facadeRefusal("cost_cap_exceeded", capSentence(cap), { cap });
      }
    }

    return this.hops(call, prepared, hops, skipped, counting, sink);
  }

  /**
   * Try the Anthropic hops in order, relaying the first that answers.
   *
   * @returns The refusal to write, or null when an answer was relayed.
   */
  private async hops(
    call: FacadeCall,
    prepared: PreparedInvocation,
    hops: readonly PlannedHop[],
    skipped: string[],
    counting: boolean,
    sink: RelaySink,
  ): Promise<FacadeRefusal | null> {
    const organizationId = prepared.subject.organizationId;
    const forwarded = forwardedHeaders(call.headers);
    let lastFailure: RelayedMessages | null = null;
    let providerCap: InvokeCap | null = null;

    for (const [position, hop] of hops.entries()) {
      const last = position === hops.length - 1;
      let opened;

      try {
        opened = await this.connections.open(organizationId, hop.connectionId);
      } catch (error) {
        skipped.push(`${label(hop)} skipped — ${codeOf(error)}`);
        continue;
      }

      if (!supportsMessagesRelay(opened.adapter)) {
        skipped.push(skippedFormat(hop));
        continue;
      }

      if (!counting && opened.monthlyCapCents !== null) {
        const spent = await this.repository.providerMonthSpent(
          organizationId,
          hop.kind,
          monthWindow(new Date()).since,
        );

        if (spent >= opened.monthlyCapCents) {
          providerCap = {
            source: "provider",
            limitCents: opened.monthlyCapCents,
            spentCents: spent,
          };
          skipped.push(`${label(hop)} skipped — its provider is at its monthly cap`);
          continue;
        }
      }

      const started = performance.now();
      let answer: RelayedMessages;

      try {
        answer = await opened.adapter.relayMessages(opened.context, {
          path: call.path,
          body: { ...call.body, model: hop.modelId },
          headers: forwarded,
          signal: call.signal,
        });
      } catch (error) {
        skipped.push(`${label(hop)} failed — ${codeOf(error)}`);
        continue;
      }

      if (answer.failure !== null) {
        lastFailure = answer;

        const code =
          answer.failure.refusal === "context_window_exceeded"
            ? INVOKE_ERROR_CODES.contextWindowExceeded
            : answer.failure.refusal === "model_not_found"
              ? INVOKE_ERROR_CODES.modelNotFound
              : codeOf({ errorClass: answer.failure.errorClass, detail: "" });

        if (ADVANCES.has(code) && !last) {
          skipped.push(`${label(hop)} failed over — ${code}`);
          continue;
        }

        break;
      }

      await this.stream(answer, skipped, sink);

      if (!counting) {
        await this.record(
          prepared,
          call.binding,
          hop,
          answer,
          Math.round(performance.now() - started),
        );
      }

      return null;
    }

    if (lastFailure !== null) {
      // Every hop failed: the last provider's own error, unmodified, as the gateway guide asks.
      await this.stream(lastFailure, skipped, sink);

      return null;
    }

    if (providerCap !== null) {
      return facadeRefusal("cost_cap_exceeded", capSentence(providerCap), {
        cap: providerCap,
        skipped,
      });
    }

    return facadeRefusal(
      "provider_unavailable",
      `No Anthropic-format hop of ${call.binding.alias} could be reached: ${skipped.join("; ")}.`,
      { skipped },
    );
  }

  /**
   * Relay an answer's bytes as they arrive.
   *
   * @param answer - The relayed answer.
   * @param skipped - The hops skipped on the way, for the header.
   * @param sink - Where it goes.
   */
  private async stream(
    answer: RelayedMessages,
    skipped: readonly string[],
    sink: RelaySink,
  ): Promise<void> {
    sink.head(answer.status, relayHeaders(answer, skipped));

    try {
      for await (const chunk of answer.body) {
        sink.write(chunk);
      }
    } catch {
      // The provider dropped the stream partway. The harness sees it end early and retries;
      // nothing can be handed over once bytes have been relayed.
    } finally {
      sink.end();
    }
  }

  /**
   * Store one call's usage row, attributed to run, stage, attempt, provider, model and the
   * credential (#235's usage path), and stamp the connection's `last_used_at`.
   */
  private async record(
    prepared: PreparedInvocation,
    binding: CredentialBinding,
    hop: PlannedHop,
    answer: RelayedMessages,
    latencyMs: number,
  ): Promise<void> {
    const usage = answer.usage();
    const organizationId = prepared.subject.organizationId;

    await this.connections.touch(organizationId, hop.connectionId, new Date());

    if (usage === null) {
      return;
    }

    const rates = ratesOf(await this.pricing.resolve(hop.kind, hop.modelId, organizationId));
    const row = usageRow(
      prepared,
      { hop, usage, costCents: costOf(rates, usage), latencyMs: Math.max(0, latencyMs) },
      await prepared.snapshotId,
    );

    await this.repository.insertUsage({
      ...row,
      attempt: binding.attempt,
      harness_credential_id: binding.id,
    });
  }

  /**
   * #235's plan for the credential's alias under its stage.
   *
   * @param binding - The credential, as bound.
   * @returns The prepared invocation, or a refusal for an alias that cannot be called.
   */
  private async prepare(binding: CredentialBinding): Promise<PreparedInvocation | FacadeRefusal> {
    try {
      return await this.invocations.prepare({
        alias: binding.alias,
        payload: {},
        runCtx: { run: binding.runId, stage: binding.stage },
      });
    } catch (error) {
      if (
        error instanceof DomainError &&
        ([INTERNAL_ERRORS.aliasNotFound, INTERNAL_ERRORS.aliasUnavailable] as string[]).includes(
          error.envelope().code,
        )
      ) {
        return facadeRefusal(
          "alias_unavailable",
          `The alias ${binding.alias} cannot be called: ${error.envelope().message}`,
        );
      }

      throw error;
    }
  }
}

/**
 * The headers relayed to the provider: only those the gateway guide says pass unchanged.
 *
 * @param headers - The harness's request headers, lower-cased.
 * @returns `anthropic-version` and `anthropic-beta`, when sent.
 */
export function forwardedHeaders(
  headers: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const name of FORWARDED_HEADERS) {
    const value = headers[name];

    if (typeof value === "string") {
      out[name] = value;
    }
  }

  return out;
}

/**
 * The response headers the harness gets: the provider's content type and request id, and the
 * skipped hops when there were any.
 *
 * @param answer - The relayed answer.
 * @param skipped - Why each skipped hop was skipped.
 * @returns The headers.
 */
export function relayHeaders(
  answer: RelayedMessages,
  skipped: readonly string[],
): Record<string, string> {
  return {
    "content-type": answer.contentType,
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    ...(answer.requestId === null ? {} : { "request-id": answer.requestId }),
    ...(skipped.length === 0 ? {} : { [SKIPPED_HOPS_HEADER]: ascii(skipped.join("; ")) }),
  };
}

/**
 * Write a facade refusal as the Messages API writes an error.
 *
 * @param sink - Where it goes.
 * @param refusal - The refusal.
 */
export function writeRefusal(sink: RelaySink, refusal: FacadeRefusal): void {
  sink.head(refusal.status, { "content-type": "application/json" });
  sink.write(new TextEncoder().encode(JSON.stringify(refusal.body)));
  sink.end();
}

/**
 * A hop as an explanation names it.
 *
 * @param hop - The hop.
 * @returns `hop 2 (coder-fallback, openai_compatible)`.
 */
function label(hop: PlannedHop): string {
  return `hop ${(hop.index + 1).toString()} (${hop.alias ?? hop.modelId}, ${hop.kind})`;
}

/**
 * Why a hop that is not Anthropic-format is skipped.
 *
 * @param hop - The hop.
 * @returns The explanation.
 */
function skippedFormat(hop: PlannedHop): string {
  return `${label(hop)} skipped — not an Anthropic-format provider`;
}

/**
 * The sentence naming a cap.
 *
 * @param cap - The cap.
 * @returns It.
 */
function capSentence(cap: InvokeCap): string {
  const limit = `$${(cap.limitCents / 100).toFixed(2)}`;
  const source =
    cap.source === "route"
      ? "the route's per-run cap"
      : cap.source === "spend_guard"
        ? "the org policy's spend guard"
        : cap.source === "worker"
          ? "the caller's cap"
          : "the provider's monthly cap";

  return `This run reached ${source} of ${limit}; the stage halts here.`;
}

/**
 * A header value a socket can carry.
 *
 * @param text - Any text.
 * @returns It, with every non-ASCII character a `-`.
 */
function ascii(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, "-");
}
