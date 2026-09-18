# ouroboros-runner — the module's verbs.
#
# A Makefile rather than a package.json adapter, because this module is not in the Yarn
# workspace and cannot be: it is a binary distributed to customer hardware, not a
# service in the application stack, and `yarn test` at the repository root must not
# start needing a Go toolchain. See docs/CONVENTIONS.md § 1 and § 3.
#
# What it does owe the repository is the same VERBS every other module exposes, so CI
# and a human can rely on them without knowing the toolchain (§ 3):
#
#   install · dev · lint · format · typecheck · test · build
#
# and `ci/runner` runs exactly these rather than a `go` invocation of its own — so a
# pull request and a laptop apply the same checkout under the same rules, which is the
# rule every other workflow in this repository follows.

# Expand recipes with a shell that stops on the first failure and on an unset variable,
# rather than /bin/sh's default of carrying on.
SHELL := /bin/sh
.SHELLFLAGS := -eu -c

# The version this module is at (docs/CONVENTIONS.md § 8: one place per module where a
# version is written down). Go has no version field in go.mod — that file names the
# module and its language floor — so VERSION is this module's manifest for the purpose,
# and it is stamped into the binary below rather than duplicated in source.
VERSION := $(shell cat VERSION)

BINARY  := ouroboros-runner
PACKAGE := ./cmd/ouroboros-runner
BIN     := bin

# -s -w strip the symbol table and DWARF: this binary is downloaded over somebody
# else's connection, and a debugger on a customer's machine is not how it is diagnosed.
# The stamp is what makes `ouroboros-runner version` and every `hello` frame report a
# real version rather than the source default.
LDFLAGS := -s -w -X main.version=$(VERSION)

# The three architectures the farm builds for — mockup 08's runners table, and the
# matrix in .github/workflows/runner.yml. `linux/x86_64` is the protocol's spelling of
# `linux/amd64`; the mapping lives in internal/telemetry, not here, because Go's
# toolchain wants Go's spelling.
TARGETS := linux/amd64 linux/arm64 darwin/arm64

.PHONY: help install dev lint format fmt typecheck test cover build cross clean

# The default target is help, so a bare `make` in an unfamiliar module explains itself.
help:
	@printf 'ouroboros-runner — the Ouroboros build farm agent (issue #243).\n\n'
	@printf '  make install     Resolve the module (it has no dependencies, by design).\n'
	@printf '  make dev         Run from source: make dev ARGS="hello".\n'
	@printf '  make lint        golangci-lint over every package.\n'
	@printf '  make format      Report anything gofmt would change. Fails if there is any.\n'
	@printf '  make fmt         Apply it.\n'
	@printf '  make typecheck   go vet over every package.\n'
	@printf '  make test        The suite, with the race detector.\n'
	@printf '  make cover       The suite, with a coverage report.\n'
	@printf '  make build       This platform, into %s/.\n' '$(BIN)'
	@printf '  make cross       All three release targets, into %s/.\n' '$(BIN)'
	@printf '  make clean       Remove %s/ and the coverage output.\n\n' '$(BIN)'
	@printf 'Version %s. The wire contract is docs/RUNNER_PROTOCOL.md.\n' '$(VERSION)'

# The locked install, this toolchain's `yarn install --immutable`. There is nothing to
# download — the module has no dependencies and is meant to keep none (see go.mod) — so
# what this verb really asserts is that that is still true: `go mod download` on a module
# that has grown one would fetch it, and `go mod verify` would then have something to
# check. It is here because § 3 promises the verb, and because the day it stops being a
# no-op is the day somebody should notice.
install:
	go mod download
	go mod verify

# Run from source. There is no long-running process to start yet — the connection loop
# is #244 — so `dev` runs the command, and ARGS is how you say which.
dev:
	go run $(PACKAGE) $(ARGS)

lint:
	golangci-lint run ./...

# Checked, not applied: a pull request that skipped `make fmt` fails rather than being
# silently reformatted by CI, which is the same bargain `ruff format --check` strikes in
# ouroboros-engine.
format:
	@unformatted=$$(gofmt -l .); \
	if [ -n "$$unformatted" ]; then \
		printf 'gofmt would change:\n%s\n\nRun `make fmt`.\n' "$$unformatted" >&2; \
		exit 1; \
	fi; \
	printf 'gofmt: every file is formatted.\n'

fmt:
	gofmt -w .

typecheck:
	go vet ./...

# The race detector is not optional here. This agent runs an executor, a heartbeat
# ticker and a log shipper against one connection, so every interesting bug it can have
# is a data race — and internal/conn's Outbox and Ledger are shared between exactly
# those goroutines.
test:
	go test -race ./...

cover:
	go test -race -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out

build:
	@mkdir -p $(BIN)
	go build -trimpath -ldflags '$(LDFLAGS)' -o $(BIN)/$(BINARY) $(PACKAGE)
	@printf 'built %s/%s %s\n' '$(BIN)' '$(BINARY)' '$(VERSION)'

# One binary per release target, named for the platform it runs on, so a release can be
# assembled by listing the directory. CGO is off explicitly: a cross-compile that
# silently needed a C toolchain would fail on the one target ci/runner cannot natively
# build.
cross:
	@mkdir -p $(BIN)
	@for target in $(TARGETS); do \
		goos=$${target%/*}; goarch=$${target#*/}; \
		printf 'building %s/%s\n' "$$goos" "$$goarch"; \
		CGO_ENABLED=0 GOOS=$$goos GOARCH=$$goarch \
			go build -trimpath -ldflags '$(LDFLAGS)' \
			-o $(BIN)/$(BINARY)-$$goos-$$goarch $(PACKAGE); \
	done
	@ls -1 $(BIN)

clean:
	rm -rf $(BIN) coverage.out
