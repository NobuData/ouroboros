/**
 * The fifteen payloads of runner protocol line 1, as TypeScript types.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). One interface per section of
 * [`docs/RUNNER_PROTOCOL.md` § 4](../../../../../docs/RUNNER_PROTOCOL.md#4-the-messages), with the
 * wire's own snake_case names — a payload is read and written exactly as it travels, so a
 * renaming layer would be a second place for a field to be misspelt.
 *
 * **These are the shapes a payload has *after* `protocol.ts` has judged it.** Nothing here
 * validates anything; `decode()` refuses a frame whose payload does not match its table in
 * `protocol.schema.ts`, and only then does a caller narrow it to one of these. Declaring them
 * does not make an unvalidated object one of them.
 */

/** The three architectures the farm builds for. */
export type Arch = "linux/arm64" | "linux/x86_64" | "darwin/arm64";

/** How a job is run. */
export type Executor = "container" | "shell";

/** Where a running job is. */
export type Phase = "fetch" | "prepare" | "run" | "upload";

/** Decision B3's two answers to *how did this connection authenticate?* */
export type SecurityMode = "mtls" | "bearer_fallback";

/** `hello` — the agent's first frame on every connection. */
export interface HelloPayload {
  readonly agent: {
    readonly version: string;
    readonly protocol_min: number;
    readonly protocol_max: number;
  };
  readonly arch: Arch;
  readonly hostname: string;
  readonly pool?: string;
  readonly capabilities: {
    readonly docker: boolean;
    readonly shell: boolean;
    readonly ccache: boolean;
    readonly cpus: number;
    readonly memory_mb: number;
  };
  readonly security_mode?: SecurityMode;
  readonly resume?: string;
}

/** The session limits an `ack` hands the agent, so none of them is hard-coded on its side. */
export interface Limits {
  readonly heartbeat_interval_ms: number;
  readonly heartbeat_jitter_ms: number;
  readonly log_chunk_max_bytes: number;
  readonly log_rate_bytes_per_s: number;
  readonly offer_ack_ms: number;
  readonly resume_window_ms: number;
}

/** `ack` — the answer to a `hello` that was accepted. */
export interface AckPayload {
  readonly session: string;
  readonly protocol: number;
  readonly resumed: boolean;
  readonly runner: { readonly id: string; readonly name: string; readonly pool: string };
  readonly limits: Limits;
}

/** Why a `hello` was refused. */
export type RefuseCode =
  | "version.below_minimum"
  | "version.unsupported"
  | "identity.unknown"
  | "identity.revoked"
  | "pool.unknown"
  | "capacity.exhausted";

/** `refuse` — sent instead of `ack`, and followed by a close. */
export interface RefusePayload {
  readonly code: RefuseCode;
  readonly minimum: number | null;
  readonly detail: string;
  readonly retry_after_ms: number | null;
}

/** What an agent says it is doing. */
export type AgentState = "idle" | "busy" | "draining";

/**
 * `heartbeat` — liveness and telemetry, every interval ± jitter.
 *
 * The three measurements are `null` when the agent's machine could not take them (#245) —
 * never a zero, never the last value it read. `queue_depth` counts jobs accepted and not yet
 * started; the running one is `job`.
 */
export interface HeartbeatPayload {
  readonly sent_at: string;
  readonly state: AgentState;
  readonly uptime_s: number;
  readonly cpu_pct: number | null;
  readonly memory_used_mb: number | null;
  readonly memory_total_mb: number | null;
  readonly queue_depth: number;
  readonly job: { readonly id: string; readonly phase: Phase; readonly pct: number } | null;
}

/** `job.offer` — work, offered rather than assigned. */
export interface JobOfferPayload {
  readonly job: string;
  readonly pool: string;
  readonly executor: Executor;
  readonly image?: string;
  readonly command: readonly string[];
  readonly workdir: string;
  readonly env: Readonly<Record<string, string>>;
  readonly repository: {
    readonly url: string;
    readonly ref: string;
    readonly commit: string;
  } | null;
  readonly timeout_s: number;
  readonly expires_at: string;
}

/** `job.accept` — taken. */
export interface JobAcceptPayload {
  readonly job: string;
  readonly offer: string;
}

/** Why an agent declined an offer. */
export type DeclineReason =
  "draining" | "busy" | "unsupported_executor" | "image_unavailable" | "capacity" | "expired";

/** `job.decline` — refused, immediately and with a reason. */
export interface JobDeclinePayload {
  readonly job: string;
  readonly offer: string;
  readonly reason: DeclineReason;
  readonly detail: string;
}

/** `job.start` — running. */
export interface JobStartPayload {
  readonly job: string;
  readonly attempt: number;
  readonly executor: Executor;
  readonly started_at: string;
  readonly workspace: string;
}

/** `job.progress` — advisory. */
export interface JobProgressPayload {
  readonly job: string;
  readonly phase: Phase;
  readonly pct: number;
  readonly note: string;
}

/** How a job ended — five different things, deliberately. */
export type Outcome = "succeeded" | "failed" | "cancelled" | "timed_out" | "errored";

/** `job.finish` — TERMINAL, and the frame the whole resume design exists for. */
export interface JobFinishPayload {
  readonly job: string;
  readonly attempt: number;
  readonly outcome: Outcome;
  readonly exit_code: number | null;
  readonly started_at: string;
  readonly finished_at: string;
  readonly log: { readonly bytes: number; readonly chunks: number; readonly dropped_bytes: number };
  readonly ccache: {
    readonly hits: number;
    readonly misses: number;
    readonly hit_rate_pct: number;
    readonly size_mb: number;
    readonly max_size_mb: number;
  } | null;
  readonly error: { readonly code: string; readonly detail: string } | null;
}

/** `log.chunk` — output, in order and bounded. */
export interface LogChunkPayload {
  readonly job: string;
  readonly seq: number;
  readonly stream: "stdout" | "stderr" | "runner";
  readonly encoding: "base64";
  readonly data: string;
  readonly dropped_bytes: number;
}

/** `receipt` — a terminal frame has been durably recorded. */
export interface ReceiptPayload {
  readonly of: string;
  readonly of_type: "job.finish";
  readonly duplicate: boolean;
}

/** Why an agent is being drained. */
export type DrainReason = "operator" | "upgrade" | "decommission" | "capacity";

/** `drain` — withdraw from dispatch without dying. */
export interface DrainPayload {
  readonly reason: DrainReason;
  readonly deadline_ms: number;
  readonly detail: string;
}

/** `undrain` — back in rotation. The payload is empty and is still an object. */
export type UndrainPayload = Readonly<Record<string, never>>;

/** Why a session is closing in an orderly way. */
export type ByeReason = "shutdown" | "drained" | "error" | "server_shutdown";

/** `bye` — the orderly close, from either end. */
export interface ByePayload {
  readonly reason: ByeReason;
  readonly detail: string;
  readonly reconnect_after_ms: number | null;
}

/** Every message type's payload, by its wire name. */
export interface Payloads {
  readonly hello: HelloPayload;
  readonly ack: AckPayload;
  readonly refuse: RefusePayload;
  readonly heartbeat: HeartbeatPayload;
  readonly "job.offer": JobOfferPayload;
  readonly "job.accept": JobAcceptPayload;
  readonly "job.decline": JobDeclinePayload;
  readonly "job.start": JobStartPayload;
  readonly "job.progress": JobProgressPayload;
  readonly "job.finish": JobFinishPayload;
  readonly "log.chunk": LogChunkPayload;
  readonly receipt: ReceiptPayload;
  readonly drain: DrainPayload;
  readonly undrain: UndrainPayload;
  readonly bye: ByePayload;
}
