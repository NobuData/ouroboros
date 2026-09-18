# Runner protocol, version 1

> The wire contract between an `ouroboros-runner` agent and the farm gateway.
>
> Filed as [#243](https://github.com/NobuData/ouroboros/issues/243) (AG.1). The machine-readable
> half is [`schemas/runner-protocol/v1.json`](../schemas/runner-protocol/v1.json); the golden
> fixtures and the verdict every implementation must reproduce are in
> [`schemas/runner-protocol/fixtures/`](../schemas/runner-protocol/fixtures).
> The plan this serves is
> [`ROADMAP_MOCKUP_08_BUILD_FARM.md`](ROADMAP_MOCKUP_08_BUILD_FARM.md), decisions **B1**–**B3**.

## Why this document exists before either implementation

The agent is Go and the gateway is TypeScript. They are written by different work streams
— [#244](https://github.com/NobuData/ouroboros/issues/244) and
[#251](https://github.com/NobuData/ouroboros/issues/251) — and neither is finished.

Whichever had been written first would otherwise have *become* the specification, and the
second would have been reverse-engineered from it, with every ambiguity settled by reading
somebody else's code. So the contract is written down first, and both implementations are
written against it rather than against each other.

Two parts of it cannot be added later, and they are why this is a document rather than a
comment.

**Versioning.** This binary runs on **customer machines**, and there is no way to force an
upgrade. The envelope carries a version from message one, and the gateway may refuse an agent
below a floor — the mechanism is trivial to design in now and effectively impossible to
retrofit across a deployed fleet.

**Resume.** A `job.finish` written to a socket that dies before its receipt must not become
two finished jobs. Which end deduplicates, on what key, and for how long is an agreement, and
an agreement discovered during integration is one that was already wrong in production.

## 1. The transport

The agent dials **out**. Nothing listens on the customer's side; there is no inbound port, no
firewall exception, and no address anybody has to expose. That is the promise mockup 08 makes
in as many words — *an outbound-only agent connection — your hardware, your network, no
inbound ports* — and everything below is shaped by it.

| | |
|---|---|
| Transport | WebSocket over TLS (`wss://`), one long-lived connection per agent |
| Endpoint | `wss://<control plane>/api/v1/farm/agent` — port 443 unless the control plane's URL names another |
| Direction | Outbound only, agent → gateway. The gateway never dials an agent. |
| Identity | mutual TLS. The agent's client certificate is issued by the farm CA at enrollment ([#250](https://github.com/NobuData/ouroboros/issues/250)) |
| Bearer fallback | Only where a workspace permits it and the agent was started with `--bearer-fallback`: no client certificate, and `Authorization: Bearer <secret>` on the **upgrade request** — never in a frame. `hello.security_mode` says which of the two a connection is |
| Framing | one JSON object per **text** frame. No batching, no binary frames, no fragmentation of a message across frames. |
| Encoding | UTF-8. Bytes that are not text travel base64-encoded inside a string — see [`log.chunk`](#logchunk). |
| Frame ceiling | 65536 bytes. A frame larger than that is not a frame and is rejected without being parsed. |

One connection carries everything: session, liveness, dispatch, execution and logs. A second
socket would need its own authentication, its own reconnection and its own ordering
relationship with the first, and nothing here needs one.

**The gateway's own certificate is verified like any HTTPS server's** — against the system's
roots, or against the roots an operator names with `--server-ca` for a private deployment. The
farm CA is not a server CA: it signs runner certificates and nothing else, and its key never
leaves the vault ([`SECURITY_MODEL.md` § 7.4](SECURITY_MODEL.md#74-custody-of-the-ca-key)). What
the agent pins is that CA — its fingerprint is checked against its certificate every time the
agent loads its identity, and the client certificate must chain to it before it is presented.

**Ordering** is the WebSocket's: frames arrive in the order they were written, or the
connection is gone. Messages therefore carry no global sequence number — only `log.chunk`
numbers itself, and it does so because its ordering has to survive a *reconnection*, which is
exactly where the transport's guarantee stops.

## 2. The envelope

Every frame, in both directions, is this object and nothing else:

```json
{ "v": 1, "type": "hello", "id": "01KE7NAGMYAV6AVSA6FMTM53N1", "payload": {} }
```

| Field | Type | Meaning |
|---|---|---|
| `v` | integer | The protocol line this frame is written in. Present from message one. |
| `type` | string | Which message this is, from the closed set in § 4. |
| `id` | string | A [ULID](#ids): 26 Crockford base32 characters. Minted once per frame by its sender. On a **terminal** frame it is the idempotency id, and a re-send repeats it verbatim — so it is unique per *frame*, not per transmission ([§ 5](#5-reconnect-resume-and-idempotency)). |
| `payload` | object | The message's own fields. Always an object, even when empty. |

**The envelope is frozen.** Not for this version — forever. A gateway that speaks only
version 1 still has to read the `v` of a version 2 `hello` in order to refuse it politely, and
an agent that has just been refused still has to be able to read the refusal. That is only
possible if the four outer keys never change meaning.

Two consequences follow, and both are enforced rather than advised:

- **A fifth key is an error**, not an extension point. New information goes in `payload`,
  where it is versioned.
- **An absent `payload` and an empty one are different frames**, and only one of them is
  legal. `undrain` has nothing to say and still sends `{}`.

### IDs

Every id in this protocol is a ULID, and the compound ones are a prefix, an underscore and a
ULID:

| Shape | What it identifies | Lifetime |
|---|---|---|
| `01KE7NAGMYAV6AVSA6FMTM53N1` | one frame | the frame |
| `sess_01KE7MV3WKAG706QMDN23AJ3BE` | one session | one connection, plus the resume window |
| `rnr_01KE76X95CS69B659HTXZJ0HA3` | one enrolled runner | for as long as it is enrolled |
| `job_01KE7J4EZ3204KQXMHJRPQPWQ6` | one job | across attempts, sessions and agents |

The shape is fixed rather than free because a ULID's first ten characters encode the
millisecond it was minted: **ids sort by time**. A session log sorts into the order it
happened, a duplicate is adjacent to its original, and no separate ordering field is needed to
read either.

## 3. Versioning, and the version floor

`v` names a **line**, not a release.

- **Adding an optional field is a minor change** and stays inside the line. Both ends must
  therefore tolerate a payload field they do not know — which they do by reporting it, because
  the schema for a line is closed. So in practice: an optional field added to `v1` requires a
  `v1.json` edit, and both implementations pick it up from the same file.
- **A change that would refuse a frame this line accepts is a new line.** Removing a field,
  narrowing an enum, tightening a bound: `v2`, and `v2.json` beside `v1.json`.

### Negotiation

The agent's `hello` advertises the **range** it can speak, and the frame itself is written at
the top of that range:

```
hello.payload.agent.protocol_min   the oldest line this build still speaks
hello.payload.agent.protocol_max   the newest — and the `v` this frame carries
```

The gateway picks a line inside the range, states it in `ack.protocol`, and every frame after
that carries it as `v`. If the ranges do not overlap, the answer is a `refuse` and a close.

A rolling fleet upgrade is what this buys. A gateway that has moved to `v2` keeps speaking
`v1` to the agents that have not, for as long as it chooses to — and the agents it refuses are
told exactly what they would have to be.

### The floor

The gateway is configured with a **minimum acceptable line**, and may refuse anything below
it. This is the GitHub-runner pattern and it exists for the same reason: an agent nobody can
force-upgrade will otherwise still be connecting years later, and the protocol can never drop
anything.

The refusal is designed to be *actionable*, which is the whole of its value:

```
refuse.payload.code        version.below_minimum
refuse.payload.minimum     the oldest line this gateway accepts
refuse.payload.detail      one sentence, for the agent's log and the operator's inbox
```

An agent told only *no* has nothing to report to the person who has to act. An agent told
`minimum: 2` has a sentence its journal can print and its operator can search for. The agent
answers a `version.*` refusal by **not reconnecting** on that error alone — reconnecting into
a refusal is a loop that costs both ends and fixes nothing — and by exiting non-zero so the
service manager records it.

`ouroboros-runner version` prints the range the local build offers, so the two halves of that
conversation can be compared without a network.

## 4. The messages

Fifteen types, and the `payload` column of each table below is the field's contract.
Everything is required unless the table says otherwise; every example is the committed
fixture, byte for byte, and
[`scripts/verify-runner-protocol.sh`](../scripts/verify-runner-protocol.sh) fails the build
when a block here and the fixture it names stop matching.

Direction is fixed per type, and the **agent → gateway** or **gateway → agent** line opening
each section is that contract: a frame arriving in the wrong direction is a protocol error, and
neither end has to guess whether it was meant. It is recorded in the fixture set by
`sessions/*.json`, where every frame carries the `from` that sent it — a codec cannot check
direction, because a codec does not know which end it is running on.

### 4.1 Session

#### `hello`

**agent → gateway.** The first frame on **every** connection, including a reconnection.

It carries **no credential**. Identity is the TLS client certificate the enrollment exchange
issued ([#250](https://github.com/NobuData/ouroboros/issues/250)), so there is no token field
here — and a frame that invents one is *refused* rather than ignored, which is what keeps a
bearer secret out of every session log that will ever be captured.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `agent.version` | string (1–64) | yes | The binary's own semver, as `ci/runner` stamped it |
| `agent.protocol_min` | integer ≥ 1 | yes | Oldest line this build speaks |
| `agent.protocol_max` | integer ≥ 1 | yes | Newest line — and this frame's `v` |
| `arch` | `linux/arm64` · `linux/x86_64` · `darwin/arm64` | yes | The three the farm builds for |
| `hostname` | string (1–253) | yes | What the machine calls itself. For recognition, never for identity |
| `pool` | string (1–64) | no | The pool the agent *believes* it is in. Advisory: the control plane's record wins |
| `capabilities.docker` | boolean | yes | A reachable Docker or Podman daemon |
| `capabilities.shell` | boolean | yes | Whether this agent will run shell jobs at all |
| `capabilities.ccache` | boolean | yes | A `ccache` on `PATH` |
| `capabilities.cpus` | integer ≥ 1 | yes | Usable cores, after any operator limit |
| `capabilities.memory_mb` | integer ≥ 1 | yes | Usable memory, MiB, after any operator limit |
| `security_mode` | `mtls` · `bearer_fallback` | no | How this connection was authenticated. Optional only because it was added inside line 1 (§ 3): every agent that connects sends it |
| `resume` | session id | no | The session this agent wants back. Absent on a first connection |

`capabilities` is *answered*, not assumed. *Is docker present?* is the enrollment card's own
question, and a pool offering container jobs to an agent without a daemon would dispatch work
that cannot start. `shell` is an operator's answer rather than a probe: a machine that holds
signing keys can refuse shell jobs while still taking container ones.

`security_mode` is decision **B3**'s visible degradation. The bearer fallback exists for networks
whose proxies strip client certificates, and it is weaker — so it is *reported*, recorded in the
runner row's `security_mode`, and shown on the farm page
([#257](https://github.com/NobuData/ouroboros/issues/257)) rather than inferred. The gateway holds
the claim to the transport: a hello saying `mtls` on a connection that presented no certificate
is a stripping proxy, not a runner. A hello without the field — which only an agent older than
the field could send — is read from the transport alone.

```json
{
  "v": 1,
  "type": "hello",
  "id": "01KE7NAGMYAV6AVSA6FMTM53N1",
  "payload": {
    "agent": {
      "version": "0.1.0",
      "protocol_min": 1,
      "protocol_max": 1
    },
    "arch": "linux/arm64",
    "hostname": "shed-pi-01",
    "pool": "arm-builders",
    "capabilities": {
      "docker": true,
      "shell": true,
      "ccache": true,
      "cpus": 8,
      "memory_mb": 16384
    },
    "security_mode": "mtls"
  }
}
```

A reconnection is the same frame with `resume` — [`valid/hello-resume.json`](../schemas/runner-protocol/fixtures/valid/hello-resume.json).
The fallback is the same frame with `"security_mode": "bearer_fallback"` —
[`valid/hello-bearer-fallback.json`](../schemas/runner-protocol/fixtures/valid/hello-bearer-fallback.json).

#### `ack`

**gateway → agent.** The answer to a `hello` that was accepted: the session, the line chosen,
whether the previous session survived, and **every limit the agent must not hard-code**.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `session` | session id | yes | This session |
| `protocol` | integer ≥ 1 | yes | The line chosen, inside the advertised range. Every later frame's `v` |
| `resumed` | boolean | yes | True when this is the session `hello.resume` named and it was still held |
| `runner.id` | runner id | yes | Who the control plane thinks this is |
| `runner.name` | string (1–253) | yes | The display name, which an operator may have changed |
| `runner.pool` | string (1–64) | yes | The pool **of record** |
| `limits.heartbeat_interval_ms` | integer 1000–300000 | yes | The nominal heartbeat period |
| `limits.heartbeat_jitter_ms` | integer 0–60000 | yes | Half-width of the jitter added to it |
| `limits.log_chunk_max_bytes` | integer 1024–32768 | yes | Largest **decoded** chunk this session accepts |
| `limits.log_rate_bytes_per_s` | integer ≥ 1024 | yes | Sustained decoded-byte rate to throttle to |
| `limits.offer_ack_ms` | integer ≥ 100 | yes | How long the agent has to answer a `job.offer` |
| `limits.resume_window_ms` | integer ≥ 1000 | yes | How long this session survives a dropped socket |

Sending the limits rather than documenting them is what lets the fleet be re-tuned without a
release nobody can force. Each is at or below the corresponding **ceiling** in
`$defs/limits` — the ceilings belong to the protocol line and cannot be raised by a
configuration change.

```json
{
  "v": 1,
  "type": "ack",
  "id": "01KE7EFQYQ1P7VEMQ3GJSX6YN0",
  "payload": {
    "session": "sess_01KE7MV3WKAG706QMDN23AJ3BE",
    "protocol": 1,
    "resumed": false,
    "runner": {
      "id": "rnr_01KE76X95CS69B659HTXZJ0HA3",
      "name": "shed-pi-01",
      "pool": "arm-builders"
    },
    "limits": {
      "heartbeat_interval_ms": 10000,
      "heartbeat_jitter_ms": 2000,
      "log_chunk_max_bytes": 32768,
      "log_rate_bytes_per_s": 262144,
      "offer_ack_ms": 5000,
      "resume_window_ms": 300000
    }
  }
}
```

#### `refuse`

**gateway → agent.** Sent *instead of* `ack`, and followed by a close.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `code` | see below | yes | Why |
| `minimum` | integer ≥ 1, or `null` | yes | The oldest line accepted, for a `version.*` refusal. `null` otherwise |
| `detail` | string (1–512) | yes | One sentence for a human. Never a secret, never a stack trace |
| `retry_after_ms` | integer ≥ 0, or `null` | yes | When to come back, when coming back could help. `null` means not on this code alone |

| Code | Clears by itself? | The agent's answer |
|---|:---:|---|
| `version.below_minimum` | no | Log the minimum, exit non-zero. Do not reconnect |
| `version.unsupported` | no | As above |
| `identity.unknown` | no | Enrollment has to be redone. Exit non-zero |
| `identity.revoked` | no | Exit non-zero. Do **not** retry — the certificate is dead |
| `pool.unknown` | maybe | Retry on `retry_after_ms`; the control plane's own state may change |
| `capacity.exhausted` | yes | Retry on `retry_after_ms` |

```json
{
  "v": 1,
  "type": "refuse",
  "id": "01KE76AVKJ5KEWE9K4AABJWTDM",
  "payload": {
    "code": "version.below_minimum",
    "minimum": 1,
    "detail": "this gateway no longer speaks protocol 0; upgrade the agent",
    "retry_after_ms": null
  }
}
```

### 4.2 Liveness

#### `heartbeat`

**agent → gateway**, every `heartbeat_interval_ms` ± `heartbeat_jitter_ms`.

It is the agent's only unprompted frame when idle, so its **absence** is what makes a runner
`offline` on the farm page — after a small multiple of the interval, not after one, because a
single lost frame is a network and not a dead machine. The jitter is why a fleet restarted
together does not stay in lockstep for the rest of its life.

It carries the telemetry too ([#245](https://github.com/NobuData/ouroboros/issues/245)) rather
than a second message making the same round trip.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `sent_at` | timestamp | yes | The agent's clock. The control plane records its own receipt time beside it rather than trusting this |
| `state` | `idle` · `busy` · `draining` | yes | `idle` will accept an offer, `draining` will accept nothing |
| `uptime_s` | integer ≥ 0 | yes | How long this **process** has been up. Resets on restart; the session need not |
| `cpu_pct` | number 0–100 | yes | Machine-wide, over the last interval, regardless of core count |
| `memory_used_mb` | integer ≥ 0 | yes | Machine-wide, MiB |
| `memory_total_mb` | integer ≥ 1 | yes | Machine-wide, MiB |
| `queue_depth` | integer ≥ 0 | yes | Jobs accepted and not finished, including the running one |
| `job` | object or `null` | yes | The running job, or `null`. **Null, not absent** |
| `job.id` | job id | yes | — |
| `job.phase` | `fetch` · `prepare` · `run` · `upload` | yes | — |
| `job.pct` | integer 0–100 | yes | — |

`job` being `null` rather than absent is the kind of decision this document exists to make
once: an agent that omitted the key when idle and sent it when busy would have two shapes for
one message, and every reader would need to know both.

```json
{
  "v": 1,
  "type": "heartbeat",
  "id": "01KE75YH3BXJEYV4F3EKH1QME1",
  "payload": {
    "sent_at": "2026-09-18T12:00:00.000Z",
    "state": "idle",
    "uptime_s": 86400,
    "cpu_pct": 4.5,
    "memory_used_mb": 1280,
    "memory_total_mb": 16384,
    "queue_depth": 0,
    "job": null
  }
}
```

With a job running, [`valid/heartbeat-busy.json`](../schemas/runner-protocol/fixtures/valid/heartbeat-busy.json).

### 4.3 Dispatch

#### `job.offer`

**gateway → agent.** Work is **offered**, not assigned.

The agent answers `job.accept` or `job.decline` within `offer_ack_ms`. An offer that is not
answered expires and is re-dispatched elsewhere — which is what stops a machine that went to
sleep mid-handshake from holding a job nobody is running.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `job` | job id | yes | Stable across attempts, sessions and agents |
| `pool` | string (1–64) | yes | The pool this was dispatched to |
| `executor` | `container` · `shell` | yes | How to run it |
| `image` | string (1–512) | **conditional** | Required for `container`, **forbidden** for `shell` |
| `command` | array of string, 1–256 | yes | **argv**, never a shell string |
| `workdir` | string (1–1024) | yes | Where the command runs, inside the prepared workspace |
| `env` | object, ≤ 128 string values | yes | Environment. **No secrets** — see below |
| `repository` | object or `null` | yes | What to check out, or `null` for a job that needs no source |
| `repository.url` | string (1–1024) | yes | Clone URL |
| `repository.ref` | string (1–256) | yes | Ref to fetch |
| `repository.commit` | 40 lowercase hex | yes | The exact commit, so a moving ref cannot change what was built after the fact |
| `timeout_s` | integer 1–86400 | yes | Wall-clock budget. On expiry: cancel, and finish `timed_out` |
| `expires_at` | timestamp | yes | When this offer stops being answerable |

Three of those are worth the words:

**`image` is forbidden on a shell job**, not ignored. A dispatcher that sent one meant a
container, and running the command on the host instead would be the wrong thing done quietly —
on a machine that was given shell access precisely because it holds something a container does
not.

**`command` is argv.** There is no shell to split a string, and a quoted path that a splitter
gets wrong is a build that fails for a reason nobody can see.

**`env` carries no credential.** A dispatch is logged, and a secret in a logged message is a
secret in a log. A job that needs one fetches it itself, through the vault
([#222](https://github.com/NobuData/ouroboros/issues/222)).

```json
{
  "v": 1,
  "type": "job.offer",
  "id": "01KE76GYFT5404Q2FA41RMP9PE",
  "payload": {
    "job": "job_01KE7J4EZ3204KQXMHJRPQPWQ6",
    "pool": "arm-builders",
    "executor": "container",
    "image": "registry.example.invalid/ouroboros/build-arm64:2026-09",
    "command": [
      "make",
      "-j8",
      "all"
    ],
    "workdir": "/workspace",
    "env": {
      "CCACHE_DIR": "/cache/ccache",
      "MAKEFLAGS": "--output-sync=target"
    },
    "repository": {
      "url": "https://github.com/NobuData/ouroboros.git",
      "ref": "refs/pull/971/head",
      "commit": "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80"
    },
    "timeout_s": 3600,
    "expires_at": "2026-09-18T12:00:15.000Z"
  }
}
```

A shell job on the `darwin/arm64` pool, with no image and no repository:
[`valid/job-offer-shell.json`](../schemas/runner-protocol/fixtures/valid/job-offer-shell.json).

#### `job.accept`

**agent → gateway.** Taken.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `job` | job id | yes | — |
| `offer` | ULID | yes | The **envelope id of the offer** being answered |

Naming the offer as well as the job is what stops an offer re-dispatched after a timeout being
accepted twice by an agent that read two copies of it.

```json
{
  "v": 1,
  "type": "job.accept",
  "id": "01KE7VSZ3DCZE1D6KY7QMWEN5T",
  "payload": {
    "job": "job_01KE7J4EZ3204KQXMHJRPQPWQ6",
    "offer": "01KE76GYFT5404Q2FA41RMP9PE"
  }
}
```

#### `job.decline`

**agent → gateway.** Refused, immediately and with a reason.

A decline is worth far more to a dispatcher than a silence it has to wait out: the job goes to
another agent in milliseconds instead of after `offer_ack_ms`.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `job` | job id | yes | — |
| `offer` | ULID | yes | The offer's envelope id |
| `reason` | `draining` · `busy` · `unsupported_executor` · `image_unavailable` · `capacity` · `expired` | yes | — |
| `detail` | string (1–512) | yes | One sentence for the operator |

`draining` and `busy` will clear. `unsupported_executor` will not, and it tells the dispatcher
that this *pool* is mis-configured rather than that this agent was unlucky.

```json
{
  "v": 1,
  "type": "job.decline",
  "id": "01KE757ZQZTW8XKRE8P3WK5V4Z",
  "payload": {
    "job": "job_01KE7J4EZ3204KQXMHJRPQPWQ6",
    "offer": "01KE76GYFT5404Q2FA41RMP9PE",
    "reason": "draining",
    "detail": "the operator asked this agent to stop taking work"
  }
}
```

### 4.4 Execution

#### `job.start`

**agent → gateway.** Running.

Sent once the workspace exists and the executor has been handed the command — **not** on
accept. The gap between the two is where an image pull lives, and a job shown as running while
it is really downloading is a farm page that lies.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `job` | job id | yes | — |
| `attempt` | integer ≥ 1 | yes | 1 for the first run, incrementing per retry |
| `executor` | `container` · `shell` | yes | What it is actually running under |
| `started_at` | timestamp | yes | — |
| `workspace` | string (1–1024) | yes | The directory the job owns, reported so a failure can be inspected on the machine |

`attempt` is what makes a **retry** distinguishable from a **re-send**: a retry is new work
with a new terminal frame, a re-send is the same frame again.

```json
{
  "v": 1,
  "type": "job.start",
  "id": "01KE74RQEM2VEGVMSD6Y5W4X29",
  "payload": {
    "job": "job_01KE7J4EZ3204KQXMHJRPQPWQ6",
    "attempt": 1,
    "executor": "container",
    "started_at": "2026-09-18T12:00:02.140Z",
    "workspace": "/var/lib/ouroboros-runner/work/job_01KE7J4EZ3204KQXMHJRPQPWQ6"
  }
}
```

#### `job.progress`

**agent → gateway.** Advisory, at the agent's discretion and rate-limited by it.

Never required. A job that reports nothing between `job.start` and `job.finish` is a job
running normally — the liveness question belongs to `heartbeat`, and a receiver that inferred
a hang from a missing progress frame would be inventing one.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `job` | job id | yes | — |
| `phase` | `fetch` · `prepare` · `run` · `upload` | yes | — |
| `pct` | integer 0–100 | yes | — |
| `note` | string (≤ 256) | yes | One short line for the run console. **Empty string** when there is nothing to say |

```json
{
  "v": 1,
  "type": "job.progress",
  "id": "01KE7SEN831CW72GWV2HB0H4MS",
  "payload": {
    "job": "job_01KE7J4EZ3204KQXMHJRPQPWQ6",
    "phase": "run",
    "pct": 62,
    "note": "1184 of 1902 translation units"
  }
}
```

#### `job.finish`

**agent → gateway. TERMINAL.** The one message the whole resume design exists for.

**Its envelope `id` is its idempotency id.** The agent mints it once, persists it with the job
record, and re-sends the frame **byte for byte** until a `receipt` comes back. See § 5.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `job` | job id | yes | — |
| `attempt` | integer ≥ 1 | yes | The attempt this terminates, matching its `job.start` |
| `outcome` | `succeeded` · `failed` · `cancelled` · `timed_out` · `errored` | yes | See below |
| `exit_code` | integer −1–255, or `null` | yes | The command's status, or `null` when there was never a command to exit |
| `started_at` | timestamp | yes | — |
| `finished_at` | timestamp | yes | — |
| `log.bytes` | integer ≥ 0 | yes | Decoded bytes delivered |
| `log.chunks` | integer ≥ 0 | yes | `log.chunk` frames sent. The receiver checks its own count against this |
| `log.dropped_bytes` | integer ≥ 0 | yes | Bytes elided to stay inside the throttle, summed |
| `ccache` | object or `null` | yes | Cache statistics, or `null` when there was no ccache |
| `ccache.hits` · `misses` | integer ≥ 0 | yes | — |
| `ccache.hit_rate_pct` | number 0–100 | yes | — |
| `ccache.size_mb` · `max_size_mb` | integer ≥ 0 | yes | — |
| `error` | object or `null` | yes | Why the agent could not run it, or the executor's last word |
| `error.code` | string (1–64) | yes | A stable, greppable token — `executor.exit`, `image.pull_failed` |
| `error.detail` | string (1–1024) | yes | One sentence. Never a credential |

The five outcomes are five *different things*, and conflating any two of them produces a
control plane that retries the wrong jobs:

| Outcome | What happened | `exit_code` |
|---|---|---|
| `succeeded` | The command ran and exited 0 | integer, required |
| `failed` | The command ran and exited non-zero | integer, required |
| `cancelled` | An operator, or a superseding push | integer or `null` |
| `timed_out` | `timeout_s` expired | integer or `null` |
| `errored` | **The agent could not run the job at all** — an image that would not pull, a workspace it could not create | integer or `null` |

`errored` is the one worth insisting on. A build that failed is information about the code; an
agent that could not start is information about the *farm*, and a retry elsewhere is the right
answer to exactly one of them.

`exit_code` is **always present as a key**, and `null` where there was no command. An absent
field and a null one would otherwise both mean *unknown*, and only one of them would be legal.
A `null` under `succeeded` or `failed` is a contradiction and is rejected as one.

```json
{
  "v": 1,
  "type": "job.finish",
  "id": "01KE7PDZMQDPKXES55PN5RZM7Q",
  "payload": {
    "job": "job_01KE7J4EZ3204KQXMHJRPQPWQ6",
    "attempt": 1,
    "outcome": "succeeded",
    "exit_code": 0,
    "started_at": "2026-09-18T12:00:02.140Z",
    "finished_at": "2026-09-18T12:04:51.902Z",
    "log": {
      "bytes": 184320,
      "chunks": 6,
      "dropped_bytes": 0
    },
    "ccache": {
      "hits": 812,
      "misses": 140,
      "hit_rate_pct": 85.3,
      "size_mb": 1024,
      "max_size_mb": 4096
    },
    "error": null
  }
}
```

A failure, on its second attempt, with no ccache:
[`valid/job-finish-failed.json`](../schemas/runner-protocol/fixtures/valid/job-finish-failed.json).

### 4.5 Output

#### `log.chunk`

**agent → gateway.** Output, in order and bounded.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `job` | job id | yes | — |
| `seq` | integer ≥ 0 | yes | **0-based and contiguous per job**, across every stream and across a reconnect |
| `stream` | `stdout` · `stderr` · `runner` | yes | `runner` is the agent's own narration, not the build's |
| `encoding` | `base64` | yes | The only encoding |
| `data` | string, ≤ 43692 characters | yes | The chunk. At most `log_chunk_max_bytes` **decoded** |
| `dropped_bytes` | integer ≥ 0 | yes | Bytes elided immediately **before** this chunk |

Four rules, each of which an implementation would otherwise get wrong at the last minute:

**base64, because a build log is bytes.** A compiler that prints a lone `0x80` is a compiler
whose output is not a JSON string. One encoding means one decoder to get wrong.

**The cap is on decoded bytes.** 32768 of them, which is 43692 base64 characters — so
`maxLength` on the wire form bounds what a receiver must buffer before deciding, and the exact
cap is then checked after decoding. 43692 characters can carry 32769 bytes, one over, so a
receiver that checked only the wire length would accept an over-size chunk.

**`seq` is contiguous across a reconnection.** That is the one ordering guarantee the
WebSocket does not provide, and it is why this message numbers itself while no other does. A
gap is a lost frame, which makes it something a receiver can *notice* — and `job.finish`'s
`log.chunks` is the total to check against.

**Elision is reported, never hidden.** `dropped_bytes` says how much was discarded to stay
inside the throttle, and the run console renders an elision marker rather than pretending the
output was contiguous. A console that showed a throttled log as complete would be lying about
the build ([#247](https://github.com/NobuData/ouroboros/issues/247)).

```json
{
  "v": 1,
  "type": "log.chunk",
  "id": "01KE7NV941ZNP3TRSPXQNGK4QG",
  "payload": {
    "job": "job_01KE7J4EZ3204KQXMHJRPQPWQ6",
    "seq": 4,
    "stream": "stdout",
    "encoding": "base64",
    "data": "Z2NjIC1jIC1vIGJ1aWxkL2tlcm5lbC9zY2hlZC5vIHNyYy9rZXJuZWwvc2NoZWQuYwpnY2MgLWMgLW8gYnVpbGQva2VybmVsL3RpbWVyLm8gc3JjL2tlcm5lbC90aW1lci5jCg==",
    "dropped_bytes": 0
  }
}
```

### 4.6 Delivery

#### `receipt`

**gateway → agent.** Confirmation that a terminal frame has been **durably recorded**.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `of` | ULID | yes | The envelope id being acknowledged |
| `of_type` | `job.finish` | yes | The type of that frame. Only terminal frames are acknowledged |
| `duplicate` | boolean | yes | True when the receiver already held this id |

Without this message the agent could not tell whether a re-send is *needed* or whether it
would be a second finished job, and resume semantics would be a matter of hope.

`duplicate` is how an agent learns its re-send was **deduplicated rather than lost** — which
is the difference between a clean reconnection and a bug nobody can reproduce. Both answers
mean the same thing to the sender (stop re-sending); the difference is worth a log line.

`of_type` is an enum of one. It is there so that a second terminal message cannot be added
without this contract changing.

```json
{
  "v": 1,
  "type": "receipt",
  "id": "01KE7HM1YANPN4CY48P13ZN3X9",
  "payload": {
    "of": "01KE7PDZMQDPKXES55PN5RZM7Q",
    "of_type": "job.finish",
    "duplicate": false
  }
}
```

The answer to a re-send:
[`valid/receipt-duplicate.json`](../schemas/runner-protocol/fixtures/valid/receipt-duplicate.json).

### 4.7 Control

#### `drain`

**gateway → agent.** Withdraw from dispatch without dying: decline new offers, let running
work finish.

This is the safe half of every upgrade and every decommission, and it is the reason a fleet on
customer hardware can be maintained at all.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `reason` | `operator` · `upgrade` · `decommission` · `capacity` | yes | So the agent's log says what somebody did |
| `deadline_ms` | integer ≥ 0 | yes | How long running work is being given. Advisory — the agent does not kill a build on it. `0` means no grace |
| `detail` | string (1–512) | yes | One sentence for the log |

A drained agent still heartbeats, with `state: draining`, and still finishes and reports the
job it was running. It declines every offer with `reason: draining`.

```json
{
  "v": 1,
  "type": "drain",
  "id": "01KE798JRSC2ZV82RCNN9876GB",
  "payload": {
    "reason": "upgrade",
    "deadline_ms": 900000,
    "detail": "agent 0.1.0 is below the fleet floor for 2026-10"
  }
}
```

#### `undrain`

**gateway → agent.** Back in rotation.

The payload is empty, and is still an object. No fields, and an unknown one is an error.

```json
{
  "v": 1,
  "type": "undrain",
  "id": "01KE7DYS9D105E77KERP5B5V43",
  "payload": {}
}
```

#### `bye`

**Either direction.** The orderly close.

| Field | Type | Required | Meaning |
|---|---|:---:|---|
| `reason` | `shutdown` · `drained` · `error` · `server_shutdown` | yes | — |
| `detail` | string (1–512) | yes | One sentence for the log |
| `reconnect_after_ms` | integer ≥ 0, or `null` | yes | When to come back. `null` means the sender has no opinion |

The agent's `bye` is **what a SIGTERM becomes** — said before the socket goes, so the farm page
shows `offline` deliberately rather than after a heartbeat timeout.

The gateway's is a deploy, and `reconnect_after_ms` is why it says when: a gateway that told a
thousand agents to reconnect immediately would be a self-inflicted denial of service. With
`null` the agent falls back to its own backoff
([#244](https://github.com/NobuData/ouroboros/issues/244)).

```json
{
  "v": 1,
  "type": "bye",
  "id": "01KE7NVHQKN0VNYD8VHZNH826Z",
  "payload": {
    "reason": "shutdown",
    "detail": "SIGTERM received",
    "reconnect_after_ms": null
  }
}
```

## 5. Reconnect, resume and idempotency

The failure being survived is narrow and certain: **a `job.finish` is written to a socket that
dies before its receipt comes back.** The agent cannot know whether the frame arrived. It must
therefore re-send — and a re-send that the receiver treats as a second result is a job finished
twice, which is worse than the drop it was fixing.

The contract is two rules, one per end.

### The sender re-sends byte for byte

An agent holds every terminal frame it has sent and not had acknowledged, **as the bytes it
sent**, in mint order. On reconnection, after `hello`/`ack` and before anything else, it
writes them again — unchanged, envelope `id` included.

"Holds" means **on disk**, not only in memory: the Go agent writes each terminal frame to its
state directory's outbox, named for its envelope id, before the frame reaches a socket, and
deletes it when the receipt arrives. An agent killed with a frame outstanding re-sends it from
the next process. Envelope ids are ULIDs minted monotonically, so the outbox's file-name order is
the mint order.

*Byte for byte* is the part that matters. The receiver recognises a re-send by the id inside
it, and re-encoding the frame from the job record is how that id, a timestamp, or a float's
formatting quietly changes. A re-send that is not recognised is a second finished job.

The agent stops re-sending a frame when it receives a `receipt` for it, whether or not that
receipt says `duplicate`.

### The receiver deduplicates by id

A receiver records the envelope id of every terminal frame it has **durably** accepted, and
answers a second copy with `receipt.duplicate: true` instead of acting on it again.

Three properties of that ledger are part of the contract:

1. **Record, then answer.** A receiver that answered first and recorded afterwards would, on a
   crash between the two, have told an agent to stop re-sending a frame it had not kept.
2. **Keyed on the frame, not the session.** A reconnection that could *not* resume its session
   still has to be able to deliver the terminal frame it was holding. This is why
   `ack.resumed: false` does not excuse an agent from re-sending.
3. **Retained for at least `resume_window_ms`**, and in practice for as long as the job record
   itself — the ledger entry is cheap and the alternative is a duplicate accepted as new.

### What `resume` actually buys

`hello.resume` names a session the agent would like back, and `ack.resumed` says whether it
got it.

| `ack.resumed` | What survived | What the agent does |
|---|---|---|
| `true` | The session, and its record of which jobs this agent holds | Re-send unacknowledged terminal frames; carry on with the running job |
| `false` | Nothing session-scoped; the **job** records are still in the control plane, keyed by job id | Re-send unacknowledged terminal frames anyway; treat any job it holds as one the gateway may re-offer elsewhere |

So resume is an optimisation of the *session*, and never the mechanism that makes delivery
correct. Delivery is correct because of the two rules above, which hold whether or not the
session came back.

### The transcripts

Those sequences are committed, frame by frame, as
[`fixtures/sessions/`](../schemas/runner-protocol/fixtures/sessions) — and each frame is a
*path* into the fixture set rather than an inline copy, so a transcript cannot drift from the
message it replays:

| Transcript | What it pins |
|---|---|
| [`enroll.json`](../schemas/runner-protocol/fixtures/sessions/enroll.json) | The enrollment card's sentence: connect, register, be offered work, run it, report it |
| [`resume.json`](../schemas/runner-protocol/fixtures/sessions/resume.json) | The drop. The same `job.finish` file appears **twice** — which is what byte-identity means — and the second is answered `duplicate: true` |
| [`refuse.json`](../schemas/runner-protocol/fixtures/sessions/refuse.json) | The version floor: refused with the minimum named, then closed |
| [`drain.json`](../schemas/runner-protocol/fixtures/sessions/drain.json) | Drained, declining, undrained, closed |

`resume.json` records `duplicate_terminals: 1` in `expected.json`, and every implementation's
suite asserts that replaying it produces exactly one duplicate and exactly one finished job.

## 6. Diagnostics — the parity contract

A rejection is a **code** and the **RFC 6901 path** it is anchored at. The message is not part
of the contract: each implementation renders its own prose, and a contract over English
sentences is one nobody can translate.

| Code | Anchored at | Means |
|---|---|---|
| `envelope.malformed` | `""` | Not a JSON object, or over the frame ceiling |
| `envelope.field.missing` | `/v` `/type` `/id` `/payload` | An envelope key is absent |
| `envelope.field.type` | as above | An envelope key is the wrong JSON type |
| `envelope.field.unknown` | `/<key>` | A fifth envelope key. The envelope is frozen |
| `envelope.version.unsupported` | `/v` | A line this implementation does not speak |
| `envelope.type.unknown` | `/type` | A type outside the enum |
| `envelope.id.malformed` | `/id` | Not a ULID |
| `payload.field.missing` | `/payload/…` | A required payload field is absent |
| `payload.field.type` | `/payload/…` | The wrong JSON type — **or** the right type in the wrong published shape (a job id that is not one, a timestamp that is not RFC 3339 with milliseconds) |
| `payload.field.unknown` | `/payload/…` | A field the type's contract does not name |
| `payload.field.enum` | `/payload/…` | Outside a closed set |
| `payload.field.range` | `/payload/…` | Outside a bound — numeric, string length, or item count |
| `payload.field.conflict` | `/payload/…` | Legal on its own, contradicted by another field: an `image` on a shell job, a `null` exit code under `succeeded` |

Two rules make the codes comparable rather than merely similar.

**An envelope error ends the walk.** A frame whose envelope does not decode has no payload to
check — reporting a payload diagnostic as well would mean guessing which message type the
payload was meant to be, and a guess is what this contract exists to remove.

**Diagnostics are ordered by path, then by code.** Path segments that are numbers compare as
numbers, so `/payload/command/2` precedes `/payload/command/10`. Both ends sort identically,
which is what makes
[`expected.json`](../schemas/runner-protocol/fixtures/expected.json) an element-by-element
comparison rather than a set-membership test.
[`invalid/two-mistakes.json`](../schemas/runner-protocol/fixtures/invalid/two-mistakes.json)
is the case that pins it: `payload.field.range` at `/payload/cpu_pct` comes *before*
`payload.field.enum` at `/payload/state`, which a code-first sort would reverse.

## 7. The golden fixtures

```
schemas/runner-protocol/
├── v1.json                  # the contract — $id …/runner-protocol/v1.json, JSON Schema 2020-12
└── fixtures/
    ├── expected.json        # the parity contract: one case per rule, and its verdict
    ├── valid/               # a worked example per message type, and the variants
    ├── invalid/             # one document per rule, each breaking exactly that rule
    └── sessions/            # ordered transcripts, each frame a path into valid/
```

They live in `schemas/` rather than in either module because **neither module owns them**
([`CONVENTIONS.md` § 1](CONVENTIONS.md#1-repository-shape)): a versioned artifact with an
`$id` that at least two modules read. Three do —
`ouroboros-runner`'s Go suite, `ouroboros-rest`'s gateway
([#251](https://github.com/NobuData/ouroboros/issues/251)) and the TypeScript fake agent
([#255](https://github.com/NobuData/ouroboros/issues/255)) — and none of them imports
another. What makes them agree is that all three assert against these bytes, so **a rule added
to one and forgotten in the next fails in the half that forgot it**, on the pull request that
forgot it.

Two rules that are not obvious from the directory:

**`expected.json` is reviewed and frozen, not regenerated.** A change to it is a change to the
contract, and every suite has to be green on the new one.

**Two rules are deliberately not fixtures.** A frame over the 64KB ceiling and a chunk over the
32KB one would each be tens of kilobytes of filler in git for one assertion. Both limits are
published as *numbers* in `v1.json` under `$defs/limits`, and each implementation constructs
the boundary case from them in a unit test — `internal/conn/limits_test.go` on the Go side.
`expected.json`'s own preamble says so, so the other implementations are told to build them
rather than left to discover the gap.

## 8. What this document does not cover

Named here so that nobody looks for it and concludes it was forgotten:

| Not here | Where |
|---|---|
| Enrollment: the registration token, the CSR, the issued certificate | [#250](https://github.com/NobuData/ouroboros/issues/250), shipped — [`SECURITY_MODEL.md` § 7](SECURITY_MODEL.md#7-the-build-farms-certificate-authority) and `ouroboros-rest`'s `/api/v1/farm/*` |
| Dialling, TLS setup, reconnection backoff, the session loop | [#244](https://github.com/NobuData/ouroboros/issues/244), shipped — [`ouroboros-runner`](../ouroboros-runner/README.md)'s `internal/agent`, `internal/ws` and `internal/state` |
| The gateway's session store, presence table and dispatcher | [#251](https://github.com/NobuData/ouroboros/issues/251), [#252](https://github.com/NobuData/ouroboros/issues/252) |
| How a job is actually run: container, shell, workspace, cancellation | [#246](https://github.com/NobuData/ouroboros/issues/246) |
| How logs are chunked, throttled and stored | [#247](https://github.com/NobuData/ouroboros/issues/247) |
| Packaging, `install.sh`, systemd and launchd units | [#248](https://github.com/NobuData/ouroboros/issues/248) |
| A remote shared cache, and the untrusted-code isolation question | [#264](https://github.com/NobuData/ouroboros/issues/264), [#267](https://github.com/NobuData/ouroboros/issues/267) |

The agent's own configuration — the control plane's URL, the pool, where the certificate lives —
is deliberately absent too. It is the agent's, not the wire's: flags and their
variables, documented in the [`ouroboros-runner` README](../ouroboros-runner/README.md#configuration)
under [`CONVENTIONS.md` § 4](CONVENTIONS.md#4-configuration--environment-variables).

## 9. Keeping this document true

Four things are checked from the checkout, by
[`scripts/verify-runner-protocol.sh`](../scripts/verify-runner-protocol.sh), and `ci/runner`
runs it:

1. **Every message type has a section here, a worked example in `valid/`, and a case in
   `expected.json`.** A type missing any of the three is a type both implementations are free
   to disagree about — and it would show up as a *passing* suite on both sides.
2. **Every example block here is byte-identical to the fixture it names.** A document that has
   drifted from the contract is worse than no document, because it is the one a reader trusts.
3. **Every fixture is named by a case**, so a file nobody asserts against cannot accumulate.
4. **The limits agree** across this document, `v1.json` and the Go constants.

The Go side is held to `expected.json` by
`ouroboros-runner/internal/conn/protocol_test.go`, and the TypeScript side will be by
[#255](https://github.com/NobuData/ouroboros/issues/255). Adding a message type means editing
`v1.json`, adding a fixture, adding a case, adding a section here — and both suites going
green on all of it.
