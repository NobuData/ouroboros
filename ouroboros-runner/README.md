# ouroboros-runner

The Ouroboros build farm **agent** — the one module that runs on hardware Ouroboros does not
own.

## Purpose

A build farm needs machines, and the interesting machines are not in a cloud region: a Mac
that can notarise, a rack of ARM boards, a workstation with a warm `ccache`. This agent is how
they join the farm.

It dials **out**. Nothing listens on the customer's side — no inbound port, no firewall
exception, no address anybody has to expose — which is the promise mockup 08 makes in as many
words: *an outbound-only agent connection — your hardware, your network, no inbound ports*.
It connects over mutual TLS, registers itself, reports what it can do, and then takes the work
it is offered.

**What exists today** is the wire protocol
([#243](https://github.com/NobuData/ouroboros/issues/243)) and the agent's half of decision **B3**
([#244](https://github.com/NobuData/ouroboros/issues/244)): `enroll` spends a token once for a
client certificate over a key this machine generated, and `run` holds the one outbound
connection — `hello`, heartbeats, reconnection with jittered backoff, session resume with
terminal frames re-sent from a durable outbox, certificate renewal before expiry, and a `bye` on
SIGTERM. Every heartbeat carries this machine's real load
([#245](https://github.com/NobuData/ouroboros/issues/245)): CPU averaged over a short window,
memory in use and installed, and `null` for anything the platform will not say. What it cannot
do yet is run a job: every offer is declined with a true reason until the executors land. See
[Related issues](#related-issues) for what each of those adds.

The protocol was written **before** either implementation of it, and that is the point. The
agent is Go and the gateway is TypeScript
([#251](https://github.com/NobuData/ouroboros/issues/251)); whichever had been written first
would otherwise have become the specification, and the second would have been
reverse-engineered from it. So the contract lives above both, in
[`docs/RUNNER_PROTOCOL.md`](../docs/RUNNER_PROTOCOL.md), and both sides assert against the same
golden fixtures.

## Stack

| | |
|---|---|
| Language | Go 1.24 or newer — go.mod's `go 1.24` is the **floor**, and `ci/runner` builds with exactly that so the claim stays true |
| Dependencies | **none**, and the intent is to keep none |
| Lint | [`golangci-lint`](https://golangci-lint.run) v2, configured in [`.golangci.yml`](.golangci.yml) |
| Format | `gofmt`, checked in CI rather than applied |
| Test | `go test` with the **race detector** |
| Targets | `linux/x86_64`, `linux/arm64`, `darwin/arm64` |
| Verbs | a [`Makefile`](Makefile), because this module is not in the Yarn workspace |

**No dependencies** is a decision, not a coincidence. This binary is distributed to machines
nobody in this repository administers, so every dependency is a supply-chain surface on
somebody else's laptop — and the standard library covers what an agent does: a socket, JSON, a
subprocess, a file.

**Not a Yarn workspace**, for the reason `ouroboros-web` is not one: it is not a service in the
application stack, and `yarn test` at the repository root must not start needing a Go
toolchain. The Makefile exposes the same verbs every other module does
([`CONVENTIONS.md` § 3](../docs/CONVENTIONS.md#3-toolchains)), and `ci/runner` runs those verbs
rather than `go` invocations of its own.

## Run

You need Go 1.24 or newer. From this directory:

```bash
make               # what every verb does
make test          # the suite, with the race detector
make lint          # golangci-lint over every package
make build         # this platform, into bin/
make cross         # all three release targets, into bin/
```

### Enrol, then run

Two commands do the work, and neither listens on anything:

```bash
# Once: spend the token, keep the identity it buys. The token may come from
# OURO_RUNNER_TOKEN instead, which keeps it off the process list.
ouroboros-runner enroll \
  --server https://ouroboros.acme.dev \
  --tenant acme-robotics --pool pool-a --token orb_enroll_…

# Forever after — the service manager's ExecStart:
ouroboros-runner run
```

```console
$ ouroboros-runner enroll --server https://ouroboros.acme.dev --tenant acme-robotics --pool pool-a
enrolled shed-pi-01 as runner 7f7c9d0e-… in acme-robotics / pool-a
identity  client certificate 08fb5b04…, valid until 2026-12-17T23:25:14Z, renewed from 2026-11-17T23:25:14Z
farm CA   sha256 7c0416c4… (pinned)
state     /var/lib/ouroboros-runner
next      ouroboros-runner run --state-dir /var/lib/ouroboros-runner
```

`enroll` generates a P-256 key on this machine and sends only a certificate request
([`SECURITY_MODEL.md` § 7.3](../docs/SECURITY_MODEL.md#73-the-runner-generates-its-own-keypair)):
no runner private key ever leaves it. The certificate that comes back is checked before anything
is saved — over this key, issued by the CA the response names, for client authentication, to the
runner id the response names — and the CA's fingerprint is recomputed and pinned. The token is
**spent**: a second enrollment with it is refused by the control plane (`farm_enrollment_refused`),
and the agent refuses to enrol into a state directory that already holds a runner *before*
presenting the token, so that mistake costs nothing.

`run` is the long-lived process:

| | |
|---|---|
| Connect | `wss://<server>/api/v1/farm/agent` on 443, presenting the client certificate. The gateway's own certificate is verified against the system's roots, or `--server-ca` |
| Hello | version, protocol range, arch, hostname, pool, capabilities — **docker** answered by pinging the daemon, **ccache** by `PATH` — and `security_mode` |
| Heartbeat | every `ack.limits.heartbeat_interval_ms` ± its jitter (the gateway's 10 s ± 2 s), carrying the telemetry below |
| Reconnect | exponential backoff with **full jitter** (1s doubling to 60s), so a fleet dropped together does not come back together; a gateway's `reconnect_after_ms` or `retry_after_ms` is a floor, spread past |
| Resume | `hello.resume` names the last session, and every terminal frame not yet receipted is re-sent **byte for byte** from the outbox before anything else — the gateway deduplicates on the envelope id |
| Renew | when `renewAfter` comes, over mTLS with the certificate being replaced — no second token |
| Stop | SIGTERM or SIGINT → `bye {reason: shutdown}`, exit 0 |
| Refused for good | a revoked certificate (TLS alert, `farm_identity_refused`, or `refuse identity.*`), a version floor, an expired certificate → one `level=ERROR` line saying what to do, exit 1, **no retry** |

Offers are declined at once — `unsupported_executor` until [#246](https://github.com/NobuData/ouroboros/issues/246),
`draining` after a `drain` — because a decline is worth far more to a dispatcher than a silence.

### What a heartbeat reports

Every heartbeat is the runners table's row for this machine
([#245](https://github.com/NobuData/ouroboros/issues/245), decision **B7**), measured in the
background by `internal/telemetry` so that a beat never waits for a reading:

| Field | Where it comes from | When it cannot be measured |
|---|---|---|
| `cpu_pct` | the busy share of CPU time over a **5 s window** — an average, not one sample. Linux: `/proc/stat`. macOS: `/usr/bin/top -l 2 -n 0` | `null` — and on the first beat after start, before a window has closed |
| `memory_used_mb` | installed minus what the kernel can reclaim without paging, so the page cache is not "used". Linux: `MemTotal − MemAvailable`. macOS: `hw.memsize` less free, speculative, file-backed and purgeable pages (Activity Monitor's *Memory Used*) | `null` |
| `memory_total_mb` | Linux: `MemTotal`. macOS: `hw.memsize` | `null` |
| `uptime_s` | this process's start | always there |
| `queue_depth` | jobs **accepted and not yet started** — the definition dispatch ([#252](https://github.com/NobuData/ouroboros/issues/252)) shares; the running job is not in it | always there: `0` is a real count |
| `job` | the running job's phase and progress, from the executor | `null` when idle |

**A measurement it cannot take is `null`, never `0` and never the last value it read.** A
container that cannot see the host's CPU, or an environment that refuses a reading, gets an
em-dash in the runners table rather than a number nobody would doubt. A metric that stops being
measurable is `null` on the next beat; one that comes back is reported again. Each failure is
logged **once when it starts and once when it clears** — never on every beat:

```console
level=WARN msg="a heartbeat metric cannot be measured; it is reported as null until it can" metric=cpu_pct error="/proc/stat: no cpu line"
```

Collection uses the standard library only — see [Stack](#stack) for why.

### Inspecting a machine

Three more commands work without a network or an enrollment:

```bash
./bin/ouroboros-runner version     # the build, the protocol range it speaks, this machine
./bin/ouroboros-runner hello       # the hello frame this machine would send, as JSON
./bin/ouroboros-runner heartbeat   # the heartbeat it would send, measured now
```

`hello` is worth knowing about before you need it. It builds the frame the connection loop
sends — from this machine's real hostname, architecture, cores, memory and probes, and once
enrolled the state directory's pool and security mode — and **validates it against the published
contract** before printing it. So when a gateway refuses a connection, this is how you see exactly
what your machine claims about itself, and `version` is how you compare the protocol range it
offers against the minimum the refusal named.

```console
$ ouroboros-runner version
ouroboros-runner 0.3.0
protocol        1 (speaks 1–1)
arch            linux/arm64
hostname        shed-pi-01
cpus            8
memory          16384 MB
```

`make dev ARGS="hello"` runs the same thing from source.

`heartbeat` measures this machine for one window and prints the frame it would send, validated
the same way. It is the parity check for the telemetry: run it beside `top -bn2 -d5` (Linux) or
`top -l 2 -n 0 -s 5` and Activity Monitor (macOS) and the two should agree. `--window` sets the
averaging window to match top's delay, and a metric that cannot be measured prints as the `null`
the gateway would receive, with the reason on stderr.

```console
$ ouroboros-runner heartbeat
{
  "v": 1,
  "type": "heartbeat",
  "id": "00000000000000000000000000",
  "payload": {
    "sent_at": "2026-09-19T02:03:32.184Z",
    "state": "idle",
    "uptime_s": 5,
    "cpu_pct": 2.9,
    "memory_used_mb": 8891,
    "memory_total_mb": 31679,
    "queue_depth": 0,
    "job": null
  }
}
```

To run the protocol contract's own check — the one that fails when the document, the schema and
the fixtures stop describing the same protocol — run it from the repository root, because its
subject spans three directories:

```bash
scripts/verify-runner-protocol.sh
```

## Configuration

Flags, each with an environment-variable fallback of the `OURO_` family
([`CONVENTIONS.md` § 4](../docs/CONVENTIONS.md#4-configuration--environment-variables)). The agent
reads no `.env` file: it runs on a customer's machine, configured by its service unit and nothing
lying around beside it. The repo-root [`.env.example`](../.env.example) documents the variables.

| Flag | Variable | Default | |
|---|---|---|---|
| `--server` | `OURO_RUNNER_SERVER` | — | The control plane, `https://` only. `enroll` records it; `run` reads it from the state directory |
| `--token` | `OURO_RUNNER_TOKEN` | — | The enrollment token. The variable keeps it off the process list. Never written anywhere |
| `--state-dir` | `OURO_RUNNER_STATE_DIR` | `/var/lib/ouroboros-runner` | Where the identity lives — see below |
| `--server-ca` | `OURO_RUNNER_SERVER_CA` | the system's roots | PEM roots to verify the control plane with, for a private deployment |
| `--tenant`, `--pool` | — | — | The mockup's one-liner. The pool is checked against the token's scope by the control plane; the tenant is recorded — the token names the workspace |
| `--name` | — | the hostname, as a slug | The runner's name, unique in its workspace |
| `--bearer-fallback` | *none, on purpose* | off | Decision **B3**'s degraded mode, for networks whose proxies strip client certificates. Asked for at `enroll`, and required again at **every** `run` of such a runner, so the downgrade is stated where the agent is started |

What the agent *reads about itself* it reads from the machine rather than from configuration —
hostname, architecture, cores, installed memory, whether a Docker or Podman daemon answers, whether
`ccache` is on `PATH` — because those are facts, and a settable fact is a fact somebody can get
wrong.

### The state directory

```
/var/lib/ouroboros-runner/          0700, and locked while an enroll or a run uses it
├── runner.json      who this runner is: ids, names, dates, the farm CA and its pin — nothing secret
├── identity.pem     the client certificate AND its private key, one file           0600
├── bearer.token     bearer-fallback mode only                                      0600
├── session          the last session, for hello.resume                             0600
└── outbox/          terminal frames sent and not yet receipted, one file each      0600
```

Every file is written `0600` — chmodded explicitly, so a permissive umask cannot widen it — and
every write is atomic (a temporary file, fsynced, renamed, the directory fsynced). The key and its
certificate are one file so that a renewal replaces both with **one** rename: two files replaced by
two renames can be left disagreeing by a crash between them. And the identity is re-verified every
time it is loaded — pin, key, chain, runner id — so a directory edited by hand is refused before
anything is presented.

**No credential is ever logged.** The token and the bearer secret are held in a type whose every
printed form is `[redacted]`; the key lives in a `tls.Certificate` and a `0600` file and nowhere
else. The end-to-end suite greps every line the command writes for all three.

**The enrollment token does not travel in `hello`**, and neither does the bearer secret: identity
is the TLS client certificate, and the fallback's secret goes in the upgrade request's
`Authorization` header. The protocol refuses a `hello` that carries a token at all — which is what
keeps a bearer secret out of every session log that will ever be captured.

## Layout

```
ouroboros-runner/
├── cmd/ouroboros-runner/     # the command: enroll · run · version · hello
├── internal/
│   ├── conn/                 # THE PROTOCOL — envelope, message contracts, validator, resume, ids
│   ├── ws/                   # RFC 6455, the parts this protocol needs — no dependency
│   ├── enroll/               # the two HTTPS routes: registration and renewal
│   ├── state/                # the state directory: identity, session, durable outbox
│   ├── agent/                # the connection loop: hello, heartbeat, backoff, resume, renewal, workload
│   ├── secret/               # a string that does not print
│   ├── telemetry/            # what this machine is and how loaded it is, whether docker answers
│   ├── farmtest/             # an in-process farm for the suites — never linked into the agent
│   ├── exec/                 # job executors: container and shell               · #246
│   └── logship/              # chunking, ordering, throttling, ccache stats      · #247
├── .golangci.yml             # the linter, and why each check is on
├── Makefile                  # the verbs — install · dev · lint · format · typecheck · test · build
├── VERSION                   # this module's semver (CONVENTIONS.md § 8)
└── go.mod                    # the module, and the language floor
```

`internal/exec` and `internal/logship` are still package documentation and nothing else: their
behaviour is the executors' and the log shipper's issues, and the *shape* of it is already fixed by
the protocol — each package's doc comment says which parts and where they are written down.

**`internal/ws` is written, not imported.** The module keeps no dependencies (see `go.mod`), and
the client half of RFC 6455 is small: an HTTP/1.1 upgrade, a frame header, a masking key, three
control frames. It enforces what the protocol fixes — text frames only, the 65536-byte ceiling
checked from the frame header before the body is read, `wss://` only — and its server half exists
for the test farm, which has to speak the same framing to be a fair test of the client.

**`internal/farmtest` is the other half the agent is tested against** until the real gateway
([#251](https://github.com/NobuData/ouroboros/issues/251)) exists: a farm CA that issues the
control plane's certificate shape, the two enrollment routes with the control plane's status codes
and error codes, and a gateway that judges every frame by `conn.Decode` and by direction. It
listens, which is why the command's tests assert it is never in the agent's dependency closure.

**`VERSION` is this module's manifest** for the purpose of
[`CONVENTIONS.md` § 8](../docs/CONVENTIONS.md#8-versioning). Go has no version field in
`go.mod` — that file names the module and its language floor — so the semver lives in one file,
and the Makefile stamps it into the binary at link time rather than duplicating it in source.
`ouroboros-runner version` and every `hello` frame report what was stamped.

The contract this module implements is **not** in this module:

| | |
|---|---|
| [`docs/RUNNER_PROTOCOL.md`](../docs/RUNNER_PROTOCOL.md) | The prose, the reasoning, and a worked example per message |
| [`schemas/runner-protocol/v1.json`](../schemas/runner-protocol/v1.json) | The schema, with the published limits both sides build their boundary cases from |
| [`schemas/runner-protocol/fixtures/`](../schemas/runner-protocol/fixtures) | The golden documents, and `expected.json` — the verdict every implementation must reproduce |

It lives in `schemas/` because **neither module owns it**
([`CONVENTIONS.md` § 1](../docs/CONVENTIONS.md#1-repository-shape)). Three implementations read
it and none imports another, which is what makes them agree: a rule added to one and forgotten
in the next fails in the half that forgot it.

## Continuous integration

`ci/runner` is path-filtered to this module, the protocol contract, and the check that holds
them together ([`.github/workflows/runner.yml`](../.github/workflows/runner.yml)):

```
install → format → lint → typecheck → test → verify the protocol → build
```

…then `cross/runner` builds all three targets. Build only for the cross ones: an `arm64`
binary cannot be *run* on the `x86_64` runner, and the question worth answering on every pull
request is the one that can be — whether the change still compiles for every machine the farm
supports. `internal/telemetry` has a build-tagged file per platform, so that is not a
formality.

There is deliberately no `publish/runner` job. Every other module ships a container image;
this one ships a **binary**, and what that needs is a tagged release with a checksum per
architecture and an `install.sh` that verifies it — which is
[#248](https://github.com/NobuData/ouroboros/issues/248)'s whole subject.

## Related issues

| Issue | What it adds |
|---|---|
| [#243](https://github.com/NobuData/ouroboros/issues/243) | **This scaffold**, and `docs/RUNNER_PROTOCOL.md` — the contract both sides implement against |
| [#244](https://github.com/NobuData/ouroboros/issues/244) | **Shipped** — enrollment, the client certificate, the outbound connection, reconnection and backoff, resume, renewal |
| [#245](https://github.com/NobuData/ouroboros/issues/245) | **Shipped** — telemetry and presence: CPU, memory, queue depth and job progress in every `heartbeat`, `null` where unmeasurable |
| [#246](https://github.com/NobuData/ouroboros/issues/246) | The executors: container and shell, workspace lifecycle, cancellation |
| [#247](https://github.com/NobuData/ouroboros/issues/247) | Log shipping and ccache statistics, with truncation reported rather than hidden |
| [#248](https://github.com/NobuData/ouroboros/issues/248) | Packaging: cross-compiled releases, `install.sh`, systemd and launchd units |
| [#250](https://github.com/NobuData/ouroboros/issues/250) | The farm CA — the other end of this agent's identity |
| [#251](https://github.com/NobuData/ouroboros/issues/251) | The gateway: the server half of this protocol, in TypeScript |
| [#255](https://github.com/NobuData/ouroboros/issues/255) | The fake agent — a third implementation of this contract, against the same fixtures |
| [#239](https://github.com/NobuData/ouroboros/issues/239) | The parent epic |
