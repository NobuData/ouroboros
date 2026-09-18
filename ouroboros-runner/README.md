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

**What exists today** is the module's scaffold and the wire protocol
([#243](https://github.com/NobuData/ouroboros/issues/243)): the envelope, the fifteen message
types, the validator that says whether a frame is one of them, and the two halves of resume.
The connection itself does not exist yet — see
[Related issues](#related-issues) for what each of the following issues adds.

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

The binary has two commands, and both work without a network or an enrollment:

```bash
./bin/ouroboros-runner version   # the build, the protocol range it speaks, this machine
./bin/ouroboros-runner hello     # the hello frame this machine would send, as JSON
```

`hello` is worth knowing about before you need it. It builds the frame the enrollment exchange
begins with — from this machine's real hostname, architecture, core count and memory — and
**validates it against the published contract** before printing it. So when a gateway refuses
an enrollment, this is how you see exactly what your machine claims about itself, and
`version` is how you compare the protocol range it offers against the minimum the refusal
named. Neither needs the farm to be reachable.

```console
$ ouroboros-runner version
ouroboros-runner 0.1.0
protocol        1 (speaks 1–1)
arch            linux/arm64
hostname        shed-pi-01
cpus            8
memory          16384 MB
```

`make dev ARGS="hello"` runs the same thing from source. There is no long-running process to
start yet; the connection loop is
[#244](https://github.com/NobuData/ouroboros/issues/244).

To run the protocol contract's own check — the one that fails when the document, the schema and
the fixtures stop describing the same protocol — run it from the repository root, because its
subject spans three directories:

```bash
scripts/verify-runner-protocol.sh
```

## Configuration

**None yet, deliberately.** An agent has nothing to configure until it has somewhere to
connect, and both arrive together in
[#244](https://github.com/NobuData/ouroboros/issues/244): the gateway URL, the pool, and where
the client certificate the enrollment exchange issued
([#250](https://github.com/NobuData/ouroboros/issues/250)) is kept. They will follow
[`CONVENTIONS.md` § 4](../docs/CONVENTIONS.md#4-configuration--environment-variables) like every
other module's, and the repo-root `.env.example` will document them with their development
defaults.

What the agent *reads about itself* it reads from the machine rather than from configuration —
hostname, architecture, cores, installed memory — because those are facts and a settable fact
is a fact somebody can get wrong. `internal/telemetry` is where they come from.

One thing is configuration and will never be: **the enrollment token does not travel in
`hello`.** Identity is the TLS client certificate, and the protocol refuses a `hello` that
carries a token at all — which is what keeps a bearer secret out of every session log that will
ever be captured.

## Layout

```
ouroboros-runner/
├── cmd/ouroboros-runner/     # the command: `version` and `hello`
├── internal/
│   ├── conn/                 # THE PROTOCOL — envelope, message contracts, validator, resume
│   ├── exec/                 # job executors: container and shell            · #246
│   ├── telemetry/            # what this machine is, and later how loaded it is · #245
│   └── logship/              # chunking, ordering, throttling, ccache stats   · #247
├── .golangci.yml             # the linter, and why each check is on
├── Makefile                  # the verbs — install · dev · lint · format · typecheck · test · build
├── VERSION                   # this module's semver (CONVENTIONS.md § 8)
└── go.mod                    # the module, and the language floor
```

`internal/exec` and `internal/logship` are package documentation and nothing else. That is
deliberate: this issue owes the module its conventions and the wire contract, not its
behaviour — but the *shape* of that behaviour is already fixed by the protocol, and each
package's doc comment says which parts and where they are written down.

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
| [#244](https://github.com/NobuData/ouroboros/issues/244) | Enrollment, the client certificate, the outbound connection, reconnection and backoff |
| [#245](https://github.com/NobuData/ouroboros/issues/245) | Telemetry and presence — the moving half of `heartbeat` |
| [#246](https://github.com/NobuData/ouroboros/issues/246) | The executors: container and shell, workspace lifecycle, cancellation |
| [#247](https://github.com/NobuData/ouroboros/issues/247) | Log shipping and ccache statistics, with truncation reported rather than hidden |
| [#248](https://github.com/NobuData/ouroboros/issues/248) | Packaging: cross-compiled releases, `install.sh`, systemd and launchd units |
| [#250](https://github.com/NobuData/ouroboros/issues/250) | The farm CA — the other end of this agent's identity |
| [#251](https://github.com/NobuData/ouroboros/issues/251) | The gateway: the server half of this protocol, in TypeScript |
| [#255](https://github.com/NobuData/ouroboros/issues/255) | The fake agent — a third implementation of this contract, against the same fixtures |
| [#239](https://github.com/NobuData/ouroboros/issues/239) | The parent epic |
