// Package conn is the runner protocol: the envelope, the sixteen message types, the
// validator that says whether a frame is one of them, and the two halves of resume.
//
// It is deliberately the FIRST thing in this module, because the protocol was specified
// before either implementation of it existed. The agent is Go and the gateway is
// TypeScript ([#251]), written by different work streams; whichever had been written
// first would otherwise have become the specification, and the second would have been
// reverse-engineered from it, with every ambiguity settled by reading somebody else's
// code.
//
// So the contract lives above both:
//
//   - ../../../docs/RUNNER_PROTOCOL.md — the prose, the reasoning and a worked example
//     for every message.
//   - ../../../schemas/runner-protocol/v1.json — the machine-readable schema.
//   - ../../../schemas/runner-protocol/fixtures/ — the golden fixtures, and
//     expected.json: the verdict every implementation has to reproduce.
//
// This package is one implementation of that contract, and protocol_test.go holds it to
// the fixtures. What it is NOT is a connection: dialling, mTLS, backoff and the session
// loop are [#244]'s, and they are built on the types here.
//
// [#251]: https://github.com/NobuData/ouroboros/issues/251
// [#244]: https://github.com/NobuData/ouroboros/issues/244
package conn
