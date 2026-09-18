// The Ouroboros runner agent — the build farm's data plane, running on hardware the
// customer owns (roadmap decision B1, issue #243).
//
// `go 1.24` is a FLOOR, not a pin: it is the oldest toolchain this module compiles
// with, and ci/runner builds it with exactly that so the claim stays true. A newer
// toolchain is free to build it.
//
// This module has no dependencies and is meant to keep none. It is distributed as a
// binary to machines nobody in this repository administers, so every dependency is a
// supply-chain surface on somebody else's laptop — and the standard library covers
// what an agent does: a socket, JSON, a subprocess, a file.
module github.com/NobuData/ouroboros/ouroboros-runner

go 1.24
