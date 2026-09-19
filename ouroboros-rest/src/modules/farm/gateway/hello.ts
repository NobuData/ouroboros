/**
 * Reading the first frame of a connection, and deciding whether to answer it with `ack` or
 * with `refuse`.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)), against
 * [`docs/RUNNER_PROTOCOL.md` § 3](../../../../../docs/RUNNER_PROTOCOL.md#3-versioning-and-the-version-floor).
 *
 * ```
 * first frame
 *   ├─ not a hello, or not a legal one ............ protocol violation: bye + close
 *   ├─ written in a line this gateway does not speak
 *   │    └─ does the advertised RANGE reach one it does?  yes → read it as that line
 *   │                                                     no  → refuse version.*
 *   ├─ agent.protocol_max < the floor ............. refuse version.below_minimum
 *   ├─ agent.protocol_min > what this gateway speaks refuse version.unsupported
 *   ├─ agent.version < OURO_FARM_MIN_AGENT_VERSION . refuse version.below_minimum
 *   └─ otherwise ................................... ack, at min(agent max, gateway max)
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Two floors, and they answer different questions.** The *protocol* floor is the line: the
 * oldest wire format this gateway still reads, a constant of the build. The *agent-version*
 * floor is the GitHub-runner pattern the issue names — *this fleet will not run agents older
 * than 0.4.0*, because 0.3.x has a bug the wire format cannot see — and it is an operator's
 * setting, unset by default. Both refuse with `version.below_minimum`, both name the oldest
 * line accepted in `minimum` because that is the field's contract, and the `detail` sentence
 * says which floor it was: an agent told only *no* has nothing to report to the person who has
 * to act.
 *
 * **Every refusal here is final**, and the Go agent exits rather than reconnecting into it —
 * `retry_after_ms` is `null` on all of them. A version refusal clears only when somebody
 * upgrades something.
 */

import {
  PROTOCOL_MIN_VERSION,
  PROTOCOL_VERSION,
  decode,
  type Diagnostic,
  type Envelope,
} from "../protocol/protocol";
import type { HelloPayload, RefusePayload, SecurityMode } from "../protocol/protocol.messages";
import { compareVersions, parseVersion } from "./semver";

/** Which protocol lines and which agent versions this gateway accepts. */
export interface VersionPolicy {
  /** The oldest line accepted — the protocol floor. */
  readonly protocolMin: number;
  /** The newest line this gateway speaks. */
  readonly protocolMax: number;
  /** The oldest agent build accepted, as SemVer, or `undefined` for no floor. */
  readonly minimumAgentVersion?: string;
}

/** The policy this build ships with: every line it speaks, and no agent-version floor. */
export const DEFAULT_VERSION_POLICY: VersionPolicy = {
  protocolMin: PROTOCOL_MIN_VERSION,
  protocolMax: PROTOCOL_VERSION,
};

/** What the first frame turned out to be. */
export type HelloReading =
  | {
      readonly kind: "hello";
      readonly envelope: Envelope<"hello">;
      /** The line chosen, which `ack.protocol` states. */
      readonly protocol: number;
    }
  | { readonly kind: "refuse"; readonly refusal: RefusePayload }
  | {
      readonly kind: "violation";
      /** One sentence for the log and the agent's `bye`. Codes and paths only, never content. */
      readonly reason: string;
    };

/**
 * Read a connection's first frame.
 *
 * @param raw - The frame's bytes.
 * @param policy - What this gateway accepts.
 * @returns A hello to acknowledge, a refusal to send, or a violation to close on.
 */
export function readHello(raw: Buffer | string, policy: VersionPolicy): HelloReading {
  const decoded = decode(raw);

  if (decoded.envelope) {
    if (decoded.envelope.type !== "hello") {
      return {
        kind: "violation",
        reason: `the first frame was ${decoded.envelope.type}, not hello`,
      };
    }

    const hello = decoded.envelope as Envelope<"hello">;
    const verdict = negotiate(hello.payload.agent, policy);

    return verdict.accepted
      ? { kind: "hello", envelope: hello, protocol: verdict.protocol }
      : { kind: "refuse", refusal: verdict.refusal };
  }

  if (isOnlyVersionUnsupported(decoded.diagnostics)) return readForeignHello(raw, policy);

  return { kind: "violation", reason: `an illegal first frame: ${describe(decoded.diagnostics)}` };
}

/** Whether an agent may connect, and at which line. */
export type Negotiation =
  | { readonly accepted: true; readonly protocol: number }
  | { readonly accepted: false; readonly refusal: RefusePayload };

/**
 * Apply both floors to what an agent advertised.
 *
 * @param agent - `hello.payload.agent`: its build and the range of lines it speaks.
 * @param policy - What this gateway accepts.
 * @returns The line to speak, or the refusal.
 */
export function negotiate(agent: HelloPayload["agent"], policy: VersionPolicy): Negotiation {
  const speaks = `protocol ${range(policy.protocolMin, policy.protocolMax)}`;
  const offered = `${range(agent.protocol_min, agent.protocol_max)}`;

  if (agent.protocol_max < policy.protocolMin) {
    return refuse(
      "version.below_minimum",
      policy.protocolMin,
      `this gateway speaks ${speaks} and this agent only ${offered}; upgrade the agent`,
    );
  }

  if (agent.protocol_min > policy.protocolMax) {
    return refuse(
      "version.unsupported",
      policy.protocolMin,
      `this gateway speaks ${speaks} and this agent only ${offered}; the gateway has to be upgraded first`,
    );
  }

  if (policy.minimumAgentVersion !== undefined) {
    const floor = parseVersion(policy.minimumAgentVersion);
    const version = parseVersion(agent.version);

    if (floor && (!version || compareVersions(version, floor) < 0)) {
      return refuse(
        "version.below_minimum",
        policy.protocolMin,
        `agent ${agent.version} is below this farm's minimum agent version ` +
          `${policy.minimumAgentVersion}; upgrade the agent`,
      );
    }
  }

  return { accepted: true, protocol: Math.min(agent.protocol_max, policy.protocolMax) };
}

/**
 * Hold a `hello`'s claimed security mode to the transport's fact.
 *
 * The gateway, not the agent, knows how a connection authenticated. A hello that says `mtls` on
 * a connection that presented no certificate is — in the protocol's words — *a stripping proxy,
 * not a runner*; one that says `bearer_fallback` on a certificate connection is an agent whose
 * state directory does not match the identity it presented. A hello without the field predates
 * it and is read from the transport alone.
 *
 * @param claimed - `hello.payload.security_mode`, if the agent sent one.
 * @param transport - How the connection actually authenticated.
 * @returns The refusal to send, or `undefined` when the two agree.
 */
export function securityModeRefusal(
  claimed: SecurityMode | undefined,
  transport: SecurityMode,
): RefusePayload | undefined {
  if (claimed === undefined || claimed === transport) return undefined;

  const detail =
    transport === "mtls"
      ? "this connection presented a client certificate, but the agent reports bearer_fallback; enroll the machine again"
      : "this connection authenticated with a bearer secret, but the agent reports mtls; a proxy may be stripping the client certificate";

  return { code: "identity.unknown", minimum: null, detail, retry_after_ms: null };
}

/**
 * A refusal, with the fields every version refusal shares.
 *
 * @param code - Which floor.
 * @param minimum - The oldest line accepted.
 * @param detail - The sentence.
 * @returns The negotiation.
 */
function refuse(code: RefusePayload["code"], minimum: number, detail: string): Negotiation {
  return { accepted: false, refusal: { code, minimum, detail, retry_after_ms: null } };
}

/**
 * A range of lines as a person reads it.
 *
 * @param low - The oldest.
 * @param high - The newest.
 * @returns `1` or `1–2`.
 */
function range(low: number, high: number): string {
  return low === high ? String(low) : `${String(low)}–${String(high)}`;
}

/**
 * Whether the only thing wrong with a frame is the line it was written in.
 *
 * @param diagnostics - The codec's verdict.
 * @returns True for exactly one `envelope.version.unsupported` at `/v`.
 */
function isOnlyVersionUnsupported(diagnostics: readonly Diagnostic[]): boolean {
  return (
    diagnostics.length === 1 &&
    diagnostics[0].code === "envelope.version.unsupported" &&
    diagnostics[0].path === "/v"
  );
}

/**
 * Read a hello written in a line this gateway does not speak — the case the frozen envelope
 * exists for.
 *
 * An agent writes its hello at the top of its range, so a build speaking 1–2 opens with `v: 2`
 * even to a gateway that speaks only 1. The envelope's four keys never change meaning, which is
 * what lets this read the advertised range out of a frame it cannot otherwise judge — and then
 * either refuse with the minimum named, or, when the ranges overlap, read the payload as the
 * line both ends speak.
 *
 * @param raw - The frame.
 * @param policy - What this gateway accepts.
 * @returns The reading.
 */
function readForeignHello(raw: Buffer | string, policy: VersionPolicy): HelloReading {
  const frame = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as {
    type?: unknown;
    payload?: { agent?: { protocol_min?: unknown; protocol_max?: unknown; version?: unknown } };
  };
  const agent = frame.payload?.agent;

  if (
    frame.type !== "hello" ||
    !Number.isInteger(agent?.protocol_min) ||
    !Number.isInteger(agent?.protocol_max)
  ) {
    return {
      kind: "violation",
      reason: "an illegal first frame: envelope.version.unsupported at /v",
    };
  }

  const verdict = negotiate(
    {
      version: typeof agent?.version === "string" ? agent.version : "",
      protocol_min: agent?.protocol_min as number,
      protocol_max: agent?.protocol_max as number,
    },
    policy,
  );
  if (!verdict.accepted) return { kind: "refuse", refusal: verdict.refusal };

  // The ranges overlap: read the payload as the line chosen. A payload that is not a legal
  // hello of that line cannot be spoken to in it, and is told so rather than guessed at.
  const reread = decode(JSON.stringify({ ...frame, v: verdict.protocol }));
  if (reread.envelope?.type === "hello") {
    return {
      kind: "hello",
      envelope: reread.envelope as Envelope<"hello">,
      protocol: verdict.protocol,
    };
  }

  return {
    kind: "refuse",
    refusal: {
      code: "version.unsupported",
      minimum: policy.protocolMin,
      detail: `this hello is not a legal protocol ${String(verdict.protocol)} hello, and this gateway speaks no other`,
      retry_after_ms: null,
    },
  };
}

/**
 * Diagnostics as one line for a log and a `bye`.
 *
 * @param diagnostics - The codec's verdict.
 * @returns `code at path, …`. Paths name where a frame was wrong, never what was in it.
 */
export function describe(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((d) => `${d.code} at ${d.path === "" ? "/" : d.path}`).join(", ");
}
