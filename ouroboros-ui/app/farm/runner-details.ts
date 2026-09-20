/**
 * What the runner details sheet says (AI.5,
 * [#260](https://github.com/NobuData/ouroboros/issues/260)) — *the operational facts a fleet
 * owner needs*: the telemetry snapshot, the security mode, the agent version, and the
 * certificate's serial and renewal date.
 *
 * **Framework-free and pure**, as `app/farm/runners.ts` is, and built on its readings so a
 * figure in the sheet and the same figure in the row are one function's answer. The drawing is
 * `app/farm/runner-sheet.tsx`'s.
 *
 * ### The sheet keeps the table's two rules
 *
 * **Stale data is not rendered as current** — a machine the fleet cannot vouch for has no
 * snapshot, whatever the payload carries — and **`null` is not `0`**: a metric an agent could
 * not collect is an em dash.
 *
 * ### Live is not valid
 *
 * The certificate the service names is the one that is neither revoked nor superseded, which is
 * not the same as one that still works. A machine switched off for a quarter holds a certificate
 * whose expiry has passed — the dev seed's `bigiron` does — and one that has been offline
 * through its renewal window is overdue without being expired. {@link certificateState} tells the four
 * apart and the sheet says which in words, because *renewal date: last month* with no comment
 * is a fact an operator has to do arithmetic on.
 */

import type { FarmRunner } from "@/app/api/farm";
import { ageOfSeconds } from "@/app/format";

import {
  BEARER_FALLBACK_NOTE,
  RUNNER_PILLS,
  cpuReading,
  intentNote,
  isVouchedFor,
  lastSeen,
  queueReading,
  ramReading,
  uptimeReading,
} from "./runners";
import { NOT_MEASURED } from "./view";

/* ------------------------------------------------------------------ copy */

/** What the sheet is headed with, above the runner's name. */
export const RUNNER_SHEET_EYEBROW = "Runner";

/** What the sheet's dismissal says. */
export const RUNNER_SHEET_CLOSE = "Close";

/**
 * The sheet's name — what the dialog answers to.
 *
 * @param name The runner.
 * @returns `Runner forge-01`.
 */
export function runnerSheetLabel(name: string): string {
  return `${RUNNER_SHEET_EYEBROW} ${name}`;
}

/** The security mode, in words. */
export const SECURITY_MODES: Readonly<Record<FarmRunner["securityMode"], string>> = {
  mtls: "mTLS — client certificate",
  bearer_fallback: "Bearer-token fallback",
};

/** Why a machine the fleet cannot vouch for has no snapshot. */
export const NO_SNAPSHOT =
  "No live snapshot — the fleet is not hearing from this machine, and an old reading is not " +
  "drawn as a current one.";

/** What stands for the certificate of a machine that cannot hold one (decision **B3**). */
export const NO_CERTIFICATE_BEARER =
  "None — a runner on the bearer-token fallback holds no certificate.";

/** And of an mTLS machine whose certificate was revoked. */
export const NO_CERTIFICATE_REVOKED =
  "None — its certificate was revoked. It cannot reconnect until it is enrolled again.";

/* ------------------------------------------------------------------ the certificate */

/** Where a certificate stands against the clock. */
export type CertificateState =
  /** The machine holds none. */
  | "none"
  /** Accepted, and not yet due to renew. */
  | "valid"
  /** Accepted, and past the day its agent should have renewed it. */
  | "renewal_due"
  /** Past its expiry: the next handshake is refused. */
  | "expired";

/** Milliseconds in a second. */
const SECOND_MS = 1000;

/**
 * Where a runner's certificate stands.
 *
 * @param certificate The certificate the service names, or `null`.
 * @param nowMs The instant the page on screen was confirmed current — never a clock read here,
 *   so a server render and its hydration agree.
 * @returns The state. Dates that do not parse read as `valid`: a sheet that cried *expired* over
 *   a malformed stamp would be inventing an incident.
 */
export function certificateState(
  certificate: FarmRunner["certificate"],
  nowMs: number,
): CertificateState {
  if (certificate === null) return "none";
  if (nowMs >= Date.parse(certificate.notAfter)) return "expired";
  if (nowMs >= Date.parse(certificate.renewAfter)) return "renewal_due";

  return "valid";
}

/**
 * A date with how far off it is — `30 Oct 2026 · in 41d`, or `14 Sep 2026 · 5d ago`.
 *
 * @param iso The instant, ISO 8601.
 * @param nowMs The instant the page was confirmed current.
 * @param day How to say a date — the caller passes the reader's own locale's.
 * @returns The phrase, or {@link NOT_MEASURED} for a stamp that does not parse.
 */
export function datedFromNow(iso: string, nowMs: number, day: (atMs: number) => string): string {
  const atMs = Date.parse(iso);
  if (Number.isNaN(atMs)) return NOT_MEASURED;

  const distance = ageOfSeconds(Math.abs(atMs - nowMs) / SECOND_MS);

  return `${day(atMs)} · ${atMs > nowMs ? `in ${distance}` : `${distance} ago`}`;
}

/* ------------------------------------------------------------------ the facts */

/** How a fact is drawn when it is not plain. */
export type FactTone = "warn" | "err";

/** One fact in the sheet. */
export interface RunnerFact {
  /** What the fact is. */
  readonly term: string;
  /** Its value, already formatted. */
  readonly value: string;
  /** Whether the value is an identifier, drawn in the mono face. */
  readonly mono?: boolean;
  /** Whether it is a warning or an error. **Never the only signal** — see {@link note}. */
  readonly tone?: FactTone;
  /** The sentence under the value that says, in words, what the tone means. */
  readonly note?: string;
}

/** A titled group of facts. */
export interface RunnerFactGroup {
  /** The group's heading. */
  readonly title: string;
  /** Its facts, in reading order. Never empty. */
  readonly facts: readonly RunnerFact[];
}

export const GROUP_MACHINE = "Machine";
export const GROUP_SECURITY = "Security";
export const GROUP_TELEMETRY = "Telemetry snapshot";

/**
 * The certificate's facts.
 *
 * @param runner The runner.
 * @param nowMs The instant the page was confirmed current.
 * @param day How to say a date.
 * @returns One fact for a machine with no certificate; otherwise the serial, the expiry and the
 *   renewal date — the last two carrying their state in words.
 */
function certificateFacts(
  runner: FarmRunner,
  nowMs: number,
  day: (atMs: number) => string,
): readonly RunnerFact[] {
  const { certificate } = runner;
  const state = certificateState(certificate, nowMs);

  if (certificate === null) {
    return [
      {
        term: "Certificate",
        value:
          runner.securityMode === "bearer_fallback"
            ? NO_CERTIFICATE_BEARER
            : NO_CERTIFICATE_REVOKED,
        tone: "warn",
      },
    ];
  }

  return [
    { term: "Certificate serial", value: certificate.serial, mono: true },
    {
      term: "Certificate expires",
      value: datedFromNow(certificate.notAfter, nowMs, day),
      ...(state === "expired"
        ? {
            tone: "err" as const,
            note: "Expired — its next handshake is refused. Enroll the machine again.",
          }
        : {}),
    },
    {
      term: "Renews after",
      value: datedFromNow(certificate.renewAfter, nowMs, day),
      ...(state === "renewal_due"
        ? {
            tone: "warn" as const,
            note: "Renewal is due — the agent renews the next time it is connected.",
          }
        : {}),
    },
  ];
}

/**
 * The telemetry snapshot's facts.
 *
 * @param runner The runner.
 * @param nowMs The instant the page was confirmed current.
 * @returns The snapshot, or the one sentence that says why there is none.
 */
function telemetryFacts(runner: FarmRunner, nowMs: number): readonly RunnerFact[] {
  const telemetry = isVouchedFor(runner.status) ? runner.telemetry : null;
  if (telemetry === null) return [{ term: "Snapshot", value: NO_SNAPSHOT }];

  const sampledMs = telemetry.sampledAt === null ? Number.NaN : Date.parse(telemetry.sampledAt);

  return [
    { term: "CPU", value: cpuReading(telemetry.cpuPct).text },
    {
      term: "RAM",
      value: ramReading(telemetry.ramUsedBytes, telemetry.ramTotalBytes),
    },
    // Two queues, named apart: the row's chip is the control plane's count, and this is what
    // the agent itself last said it was holding.
    { term: "Queue (control plane)", value: queueReading(runner.queueDepth) },
    {
      term: "Queue (agent reported)",
      value: telemetry.queueDepth === null ? NOT_MEASURED : String(telemetry.queueDepth),
    },
    { term: "Uptime", value: uptimeReading(runner.uptimeSeconds) },
    {
      term: "Sampled",
      value: Number.isNaN(sampledMs)
        ? NOT_MEASURED
        : `${ageOfSeconds((nowMs - sampledMs) / SECOND_MS)} ago`,
    },
  ];
}

/**
 * Everything the sheet lists about a runner.
 *
 * @param runner The runner, as served — the sheet follows the live page, not a snapshot taken
 *   when it opened.
 * @param nowMs The instant the page was confirmed current.
 * @param day How to say a date. A parameter so the list is a pure function of its inputs.
 * @returns The groups, in reading order: the machine, its security, its snapshot.
 */
export function runnerFacts(
  runner: FarmRunner,
  nowMs: number,
  day: (atMs: number) => string,
): readonly RunnerFactGroup[] {
  const pill = RUNNER_PILLS[runner.status].label;
  const intent = intentNote(runner.status, runner.desiredState);
  const degraded = runner.securityMode === "bearer_fallback";

  return [
    {
      title: GROUP_MACHINE,
      facts: [
        { term: "Pool", value: runner.pool },
        {
          term: "Status",
          value: intent === null ? pill : `${pill} · ${intent}`,
        },
        { term: "Architecture", value: runner.arch },
        { term: "Hostname", value: runner.hostname ?? NOT_MEASURED },
        {
          term: "Agent version",
          value: runner.agentVersion ?? NOT_MEASURED,
          mono: true,
        },
        {
          term: "Enrolled",
          value: datedFromNow(runner.enrolledAt, nowMs, day),
        },
        { term: "Last heartbeat", value: lastSeen(runner.lastSeenAt, nowMs) },
      ],
    },
    {
      title: GROUP_SECURITY,
      facts: [
        {
          term: "Security mode",
          value: SECURITY_MODES[runner.securityMode],
          ...(degraded ? { tone: "warn" as const, note: BEARER_FALLBACK_NOTE } : {}),
        },
        ...certificateFacts(runner, nowMs, day),
      ],
    },
    { title: GROUP_TELEMETRY, facts: telemetryFacts(runner, nowMs) },
  ];
}
