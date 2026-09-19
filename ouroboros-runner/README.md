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
memory in use and installed, and `null` for anything the platform will not say. And it runs the
jobs it is offered ([#246](https://github.com/NobuData/ouroboros/issues/246)) — in the pool's
pinned image through Docker or Podman, or directly on this machine for HIL rigs and macOS —
declining at once, with a true reason, any offer it cannot satisfy. See
[Running jobs](#running-jobs), and [Related issues](#related-issues) for what is still to come.

And it installs in one line ([#248](https://github.com/NobuData/ouroboros/issues/248)): `ci/runner`
publishes each version as a checksummed GitHub release, a deployment serves that release from its
own origin, and `install.sh` verifies the binary before running it, enrols it, and leaves it
running under systemd or launchd — restarted on failure and started again at boot. See
[Install](#install).

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
make test-docker   # the container executor against this machine's real Docker or Podman
make lint          # golangci-lint over every package
make build         # this platform, into bin/
make cross         # all three release targets, into bin/
make release       # a checksummed release, into dist/<version>/
```

`make lint` runs [`shellcheck`](https://www.shellcheck.net) over the installer as well as
golangci-lint over the Go, and `make test` runs the installer's suite after the Go one, so both
need `shellcheck` and a POSIX `sh` on the machine.

### Install

On a build machine, the command the Build Farm page's enroll card renders:

```bash
curl -fsSL 'https://ouroboros.acme.dev/install.sh?version=0.6.0' | sh -s -- \
  --tenant acme-robotics --pool pool-a --token orb_enroll_…
```

```console
downloading ouroboros-runner 0.6.0 for linux/arm64 from https://ouroboros.acme.dev/runner/0.6.0
verified   sha256 4537a98ce666a84142d6f89c8ddc93a89ff4e383e1f67a183f37f5d8c49f3994
installed  /usr/local/bin/ouroboros-runner
enrolled shed-pi-01 as runner 7f7c9d0e-… in acme-robotics / pool-a
…

ouroboros-runner 0.6.0 is installed and running.
  service  systemd unit ouroboros-runner.service — starts at boot, restarts on failure
  runs as  builder, from /var/lib/ouroboros-runner
  logs     journalctl -u ouroboros-runner -f
  remove   curl -fsSL 'https://ouroboros.acme.dev/install.sh' | sh -s -- --uninstall
```

**The address is your deployment's, not a public one.** Mockup 08 shows
`get.ouroboros.dev`, and that is design shorthand: a self-hosted deployment behind a firewall
may have no route to a public host, and no reason to trust one for a binary that will run on its
build machines. So `ouroboros-rest` serves the installer itself
([`GET /install.sh`](../ouroboros-rest/README.md#the-runner-installer)), with its own address
written into the script's `DEFAULT_SERVER`, and serves the release's files beside it — the
machine needs a route to nothing but the control plane it is about to connect to anyway.

**`?version=` pins the release**, and the rendered command always carries it: two runners enrolled
a month apart are the same build, and a release's `install.sh` installs that release and no
other (`make release` writes its `DEFAULT_VERSION`).

What it does, in order — and **nothing it downloaded runs before step 3**:

1. Works out which release this machine needs — `linux/x86_64`, `linux/arm64` or `darwin/arm64`
   (a Rosetta shell on Apple silicon counts as arm64) — and refuses any other by name.
2. Downloads that binary and the release's `SHA256SUMS` into a private temporary directory, over
   `https` only, redirects included.
3. **Verifies the binary's SHA-256** against `SHA256SUMS`. A mismatch aborts with both checksums
   and *nothing was installed*: nothing is stopped, replaced or enrolled.
4. Asks the verified binary its version, and refuses one that is not the release it asked for.
5. Installs it to `/usr/local/bin` and creates the state directory `0700`. This and the steps
   after it need root; the script uses `sudo` for them when it is not root.
6. Enrols it — the flags below go to `ouroboros-runner enroll`, and the token through
   `OURO_RUNNER_TOKEN` from a private file, so it is on no command line the script runs — unless
   the state directory already holds a runner. **A second run is therefore an upgrade**: it
   stops the agent, replaces the binary, keeps the identity and spends no token.
7. Installs and starts the service, as the account that ran the installer (`SUDO_USER` under
   `sudo`), which owns the state directory from then on.

| Option | |
|---|---|
| `--tenant`, `--pool`, `--name` | Passed to `enroll` |
| `--token` | The enrollment token. `OURO_RUNNER_TOKEN` instead keeps it off even the installer's own process list. Not needed on an enrolled machine |
| `--server URL` | The deployment. Written into the script by the deployment that served it; needed only with a copy from elsewhere |
| `--version X.Y.Z` | The release. Written in by the release the script came from |
| `--download-url URL` | Where the release's files are, when not `<server>/runner/<version>` — a mirror, say. `https` only |
| `--server-ca FILE` | PEM roots for a deployment whose certificate the system does not trust: used for the downloads, installed as `/etc/ouroboros-runner/server-ca.pem`, and passed to `enroll` and `run` |
| `--bearer-fallback`, `--no-shell` | Passed to `enroll` and `run`, as [Configuration](#configuration) describes |
| `--user NAME` | The account the service runs as — the one whose Docker socket, `PATH` and devices jobs use |
| `--state-dir DIR` | Where the identity lives; `/var/lib/ouroboros-runner` |
| `--uninstall`, `--purge` | See below |

**The service** restarts the agent after any exit that is not a clean one and starts it at
boot:

| | Linux — systemd | macOS — launchd |
|---|---|---|
| File | `/etc/systemd/system/ouroboros-runner.service` | `/Library/LaunchDaemons/dev.ouroboros.runner.plist` — a daemon, so it runs with nobody logged in |
| Restart | `Restart=on-failure`, 10 s apart | `KeepAlive` with `SuccessfulExit` false, at most every 10 s (`ThrottleInterval`) |
| Stop | `KillMode=mixed`: SIGTERM to the agent alone, so it reports its jobs cancelled before anything else in the group is killed; `TimeoutStopSec=30` | `ExitTimeOut` 30 |
| Environment | systemd's, as `--user` | `HOME` and `PATH` set, so Docker Desktop's socket and Homebrew are found |
| Logs | `journalctl -u ouroboros-runner` | `/Library/Logs/ouroboros-runner/runner.log` |

A clean stop — `systemctl stop`, `launchctl bootout`, SIGTERM — is exit 0 and stays stopped. **A
permanent refusal is exit 1**, and the agent's promise is not to retry one: a revoked certificate
or a version below the floor. systemd honours that with a start limit — five failed starts in
five minutes and it stops trying, with the reason in `systemctl status` — while launchd has no
start limit and restarts such a runner every ten seconds until somebody acts; each start logs the
same one line saying what to do.

**`--uninstall`** stops and removes the service, the binary and `/etc/ouroboros-runner` (and on
macOS the logs). The state directory is the runner's identity, its private key among it, so it
goes only after a yes on the terminal, or with `--purge`; with neither — `curl | sh` from a
script, say — it is kept and the output names it and the command that removes it. Uninstalling
does not revoke the certificate, which stays valid until it expires: remove the runner on the
Build Farm page for that.

**Where a release comes from.** `make release` writes `dist/<version>/` — the three binaries,
`install.sh` with its version filled in, and `SHA256SUMS` over the four — and `ci/runner`'s
`release/runner` publishes exactly that as the GitHub release `ouroboros-runner-v<version>` on
the push to `main` that carries a new `VERSION`. A release is never replaced. A deployment serves
one by copying it into `OURO_FARM_RELEASES_DIR/<version>/`, verified with
`sha256sum -c SHA256SUMS` — see [`ouroboros-rest`'s README](../ouroboros-rest/README.md#the-runner-installer).

**What the checksum proves**, and what it does not: that the binary is the one `SHA256SUMS`
names, so a download altered or truncated between the two is never run. `SHA256SUMS` comes from
the same place as the binary — by default your own deployment, over TLS — so it is as trustworthy
as that source. With `--download-url` pointing at a mirror, it is the mirror you are trusting.

`install.sh` is POSIX `sh` and passes `shellcheck`; its suite
([`tests/install.test.sh`](tests/install.test.sh)) runs it end to end under `sh`, `dash`, `bash`
and busybox, against a fixture release, a staged root and stubbed service managers.

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
| Hello | version, protocol range, arch, hostname, pool, capabilities — **docker** answered by pinging the daemon, **shell** unless `--no-shell`, **ccache** by `PATH` — and `security_mode` |
| Heartbeat | every `ack.limits.heartbeat_interval_ms` ± its jitter (the gateway's 10 s ± 2 s), carrying the telemetry below |
| Reconnect | exponential backoff with **full jitter** (1s doubling to 60s), so a fleet dropped together does not come back together; a gateway's `reconnect_after_ms` or `retry_after_ms` is a floor, spread past |
| Resume | `hello.resume` names the last session, and every terminal frame not yet receipted is re-sent **byte for byte** from the outbox before anything else — the gateway deduplicates on the envelope id |
| Renew | when `renewAfter` comes, over mTLS with the certificate being replaced — no second token |
| Jobs | an offer is accepted and run, or declined at once with the reason — see [Running jobs](#running-jobs) |
| Cancel | a gateway's `job.cancel` stops that one job and reports it `cancelled`; a cancel for a job this agent does not hold is logged and ignored |
| Stop | SIGTERM or SIGINT → running jobs cancelled and their `cancelled` finishes sent, then `bye {reason: shutdown}`, exit 0 |
| Refused for good | a revoked certificate (TLS alert, `farm_identity_refused`, or `refuse identity.*`), a version floor, an expired certificate → one `level=ERROR` line saying what to do, exit 1, **no retry** |

An offer is answered at once — accepted, or declined with a reason — because a decline is worth
far more to a dispatcher than a silence.

### Running jobs

A pool owns an executor kind (decision **B4**), and this agent has both
([#246](https://github.com/NobuData/ouroboros/issues/246), `internal/exec`):

| | Container | Shell |
|---|---|---|
| For | build pools — mockup 08's `pool-a`, *zephyr-sdk 0.17 image* | HIL rigs and macOS — `pool-b` |
| Runs | the command in the pool's pinned image, through the **Docker Engine API** on the socket the hello's `docker` probe found — Docker, or Podman's compatible API; no `docker` binary needed | the command directly on this machine, as the agent's user |
| Before `job.start` | pulls the image if the daemon lacks it, reporting `job.progress` (`prepare`, `pulling … — 412.0 MB of 980.0 MB, 1 of 3 layers`) so a first pull is not minutes of apparent silence | makes the workdir |
| Workspace | `<state-dir>/work/<job id>`, bind-mounted at the offer's `workdir` | `<state-dir>/work/<job id>`, with `workdir` resolved inside it |
| Limits | the job's share of this machine — its cores and memory divided by the pool's `max_concurrency` — and an init process as PID 1 | — |
| Cancellation | the daemon's `stop`: SIGTERM, SIGKILL after 10 s | SIGTERM to the whole **process group**, SIGKILL after 10 s |

```console
level=INFO msg="accepted a job offer" job=job_01KE7J4EZ3204KQXMHJRPQPWQ6 executor=container image=zephyr-sdk:0.17
level=INFO msg="preparing a job" job=job_01KE7J4EZ3204KQXMHJRPQPWQ6 pct=0 note="pulling zephyr-sdk:0.17"
level=INFO msg="preparing a job" job=job_01KE7J4EZ3204KQXMHJRPQPWQ6 pct=100 note="pulled zephyr-sdk:0.17 — 980.0 MB"
level=INFO msg="a job started" job=job_01KE7J4EZ3204KQXMHJRPQPWQ6 executor=container workspace=/var/lib/ouroboros-runner/work/job_01KE7J4EZ3204KQXMHJRPQPWQ6
level=WARN msg="a job finished" job=job_01KE7J4EZ3204KQXMHJRPQPWQ6 outcome=failed exit_code=2 duration=4m12.117s error=executor.exit detail="the command exited with status 2"
```

**What is declined, and why.** Capability honesty: a runner that cannot run an offer says so
rather than accepting it and failing, which would burn a dispatch cycle and show somebody a
build failure that is really a farm fact.

| The offer | Declined as |
|---|---|
| any, while drained | `draining` |
| one whose `expires_at` has passed | `expired` |
| a container job, and no Docker or Podman daemon answered | `unsupported_executor` — the same fact the hello's `docker: false` reported |
| a shell job, and the agent was started with `--no-shell` | `unsupported_executor` — the hello's `shell: false` |
| one naming a `repository` — this build does not check out source yet | `unsupported_executor` |
| a job this runner already holds, or one past the pool's `max_concurrency` | `busy` |

The hello's capabilities and the executors are built from the same probe, and the agent refuses
to start with a configuration where they disagree — so `docker: true` is never a claim the
agent cannot keep.

**How a job ends** is one of the protocol's five outcomes: exit 0 is `succeeded` and anything
else `failed` (`executor.exit`); `timeout_s` running out is `timed_out`, and the budget runs
from accept, so it covers a pull too; the agent being stopped, or the gateway's `job.cancel`
for that job, is `cancelled`; and a job the
agent could not run at all — a workspace it could not make, an image that would not pull
(`image.pull_failed`), a command that would not start — is `errored`. Every `job.finish`
carries the command's exit code — `null` only when no command ever ran — and its start and
end, so a duration is always there. The
job's output goes to the log shipper ([#247](https://github.com/NobuData/ouroboros/issues/247));
until that lands it is counted and not sent, and `job.finish.log` says so — `dropped_bytes` is
all of it — rather than reporting an empty log.

**Cancellation from the gateway** ([#252](https://github.com/NobuData/ouroboros/issues/252)).
Every job runs under a context of its own, derived from the agent's, so a `job.cancel` stops that
job alone — the same SIGTERM, grace and SIGKILL as a shutdown, the same `cancelled` finish, with
the cancel's reason in its detail (`the gateway cancelled it, operator: …`). A job still pulling
its image finishes `cancelled` with no exit code and no `job.start`. A cancel for a job the agent
does not hold — its finish crossed the cancel, or the offer never arrived — is logged and ignored:
there is nothing to stop, and ending the session over it would only replay the cancel.

**Retries are the dispatcher's.** An offer carries `attempt` when it is the automatic retry of an
infrastructure failure, and the agent reports that number in the job's `job.start` and
`job.finish`; an offer without one is a first attempt. A retry is a new job id, so its workspace,
its log and its terminal frame are its own.

**Cleanup.** A workspace is removed when its job ends — even one a build made read-only.
`--keep-workspace-on-failure` leaves the workspace of a job that failed, timed out or errored
in place, because a failed firmware build is often only diagnosable from what it left behind;
the log says where. A later run of the same job replaces a kept workspace.

**Concurrency.** A runner holds at most its pool's `max_concurrency` jobs at once — accepted
or running — which the gateway sends in `ack.pool`, read from the pool's row at every hello.
With no pool policy in the ack, the cap is 1.

#### The trust model

The shell executor runs commands directly on the customer's machine, with no sandbox. That is
correct for this product, and it is written down rather than implied: **the tenant's machine
runs the tenant's command** — a machine the tenant enrolled into the tenant's own farm, running
the command the tenant's pool dispatched, exactly as it would under any self-hosted CI agent.
The container executor is the same trust with a filesystem boundary, not an isolation
boundary; untrusted code is [#267](https://github.com/NobuData/ouroboros/issues/267)'s
question.

What the agent does promise is that the implementation never *widens* that trust by accident:

1. **argv-exec only.** A job's command is executed as the argv it arrived as — never joined into
   a string, never handed to `sh -c` by the agent. `$(id)`, `;`, `*` and backticks reach the
   program as those characters. A container's command is its exec-form CMD, which the daemon
   runs without a shell too.
2. **The environment is an allow-list, not an inheritance.** A job sees exactly the variables its
   offer carried whose names the pool's `env_allowlist` holds — nothing of the agent's own
   environment, not even `PATH` unless the pool allows it. (The command's own program is found
   on the agent's `PATH`; what it runs after that, it finds in its own environment.) The names
   of any variables dropped are logged; their values never are.
3. **The job owns one directory, and the server cannot name another.** A shell job's `workdir`
   is resolved *inside* its workspace — `/Users/builder/work` is a directory under it, and a
   `..` is refused — so no offer can pick where on this machine a command runs or which
   directory cleanup removes. A container job's workspace is its only bind mount.
4. **Nothing outlives the job.** A shell job's command leads a new process group, and however
   the job ends the whole group is signalled: SIGTERM, then SIGKILL after the grace period. A
   build that spawned a compiler farm leaves no orphans — not when it is cancelled, and not when
   its leader exits and leaves children behind. The one way out is the one every CI agent has: a
   process that deliberately leaves the group (`setsid`, a daemon detaching itself).

A machine that should not run host commands at all — one holding signing keys, say — is started
with `--no-shell`: its hello says `shell: false`, and it declines every shell offer while still
taking container ones.

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
ouroboros-runner 0.6.0
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
| `--no-shell` | `OURO_RUNNER_NO_SHELL` | `false` | Run no job directly on this machine: the hello says `shell: false`, and shell offers are declined. `run` and `hello` |
| `--keep-workspace-on-failure` | `OURO_RUNNER_KEEP_WORKSPACE_ON_FAILURE` | `false` | Leave the workspace of a job that failed, timed out or errored, for diagnosis. `run` |

What the agent *reads about itself* it reads from the machine rather than from configuration —
hostname, architecture, cores, installed memory, whether a Docker or Podman daemon answers, whether
`ccache` is on `PATH` — because those are facts, and a settable fact is a fact somebody can get
wrong. The two boolean variables take `true` or `false` (or `1`/`0`); anything else stops the
agent with a usage error naming the variable, rather than quietly meaning `false`. And what a
job may do is the **pool's** to say, not this machine's: its concurrency cap and environment
allow-list arrive in every `ack`.

### The state directory

```
/var/lib/ouroboros-runner/          0700, and locked while an enroll or a run uses it
├── runner.json      who this runner is: ids, names, dates, the farm CA and its pin — nothing secret
├── identity.pem     the client certificate AND its private key, one file           0600
├── bearer.token     bearer-fallback mode only                                      0600
├── session          the last session, for hello.resume                             0600
├── outbox/          terminal frames sent and not yet receipted, one file each      0600
└── work/            one workspace per running job, removed when it ends            0700
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
│   ├── exec/                 # job executors: container and shell, workspaces, cancellation
│   └── logship/              # chunking, ordering, throttling, ccache stats      · #247
├── install.sh                # the one-liner's installer: verify, install, enrol, daemonize · #248
├── tests/                    # install.sh's suite, end to end against a staged root  · #248
├── .golangci.yml             # the linter, and why each check is on
├── Makefile                  # the verbs — install · dev · lint · format · typecheck · test · build · release
├── VERSION                   # this module's semver (CONVENTIONS.md § 8)
└── go.mod                    # the module, and the language floor
```

`internal/logship` is still package documentation and nothing else: its behaviour is the log
shipper's issue, and the *shape* of it is already fixed by the protocol — the package's doc
comment says which parts and where they are written down.

**`internal/exec` is tested against the operating system, not a model of it.** The shell
executor's suite runs real processes: a job that prints its environment, a job whose arguments
are shell metacharacters, and a build tree with a child that ignores SIGTERM, whose every pid is
checked gone after the cancellation. The container executor's default suite runs against a fake
Engine API on a unix socket; `make test-docker` runs it against this machine's real daemon, and
`ci/runner` compiles and lints that file (the `dockertest` tag) without pulling anything.

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
formality. `make lint` includes shellcheck over `install.sh`, pinned to a release and its
digest, and `make test` the installer's suite.

Then the release ([#248](https://github.com/NobuData/ouroboros/issues/248)). Every other module
ships a container image; this one ships a **binary**, so it publishes a GitHub release instead of
a `publish/<module>` job:

```
ci → package/runner   make release · sha256sum -c · upload       every event, read-only
   → release/runner   gh release create ouroboros-runner-v<VERSION>   push to main only
                      needs ci, cross and package · contents: write — the one job that may
```

`release/runner` publishes the bytes `package/runner` built and checked, not a rebuild, and
**never replaces a release**: if the tag exists it says so and stops. So a merged `VERSION` bump
is what publishes, and two machines installed from one version run the same binary.

## Related issues

| Issue | What it adds |
|---|---|
| [#243](https://github.com/NobuData/ouroboros/issues/243) | **This scaffold**, and `docs/RUNNER_PROTOCOL.md` — the contract both sides implement against |
| [#244](https://github.com/NobuData/ouroboros/issues/244) | **Shipped** — enrollment, the client certificate, the outbound connection, reconnection and backoff, resume, renewal |
| [#245](https://github.com/NobuData/ouroboros/issues/245) | **Shipped** — telemetry and presence: CPU, memory, queue depth and job progress in every `heartbeat`, `null` where unmeasurable |
| [#246](https://github.com/NobuData/ouroboros/issues/246) | **Shipped** — the executors: container and shell, workspace lifecycle, cancellation, the pool's concurrency cap and allow-list |
| [#247](https://github.com/NobuData/ouroboros/issues/247) | Log shipping and ccache statistics, with truncation reported rather than hidden |
| [#248](https://github.com/NobuData/ouroboros/issues/248) | **Shipped** — packaging: checksummed releases from `ci/runner`, `install.sh`, systemd and launchd units, served from the deployment's own origin |
| [#250](https://github.com/NobuData/ouroboros/issues/250) | The farm CA — the other end of this agent's identity |
| [#251](https://github.com/NobuData/ouroboros/issues/251) | The gateway: the server half of this protocol, in TypeScript |
| [#255](https://github.com/NobuData/ouroboros/issues/255) | The fake agent — a third implementation of this contract, against the same fixtures |
| [#239](https://github.com/NobuData/ouroboros/issues/239) | The parent epic |
