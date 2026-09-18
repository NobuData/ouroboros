// Package secret is a string that does not print.
//
// The agent handles three credentials: the enrollment token it is given once, the
// bearer secret a fallback enrollment returns, and a private key. The first two are
// strings, and a string reaches a log line by every route there is — a `%v` of a
// struct, an error that quoted its input, a JSON log handler marshalling a config. So
// they are held as [Secret], which answers every one of those routes with a redaction,
// and the one route to the value is a method whose name says what it does.
//
// The private key is not a string and is never held as one: it lives in a
// tls.Certificate from the moment it is generated, and internal/state writes it to a
// 0600 file and nowhere else. cmd/ouroboros-runner's end-to-end suite captures every
// log line of an enrollment, a connection and a renewal, and fails if any of the three
// appears in it.
package secret

import "log/slog"

// Redacted is what a Secret prints as.
const Redacted = "[redacted]"

// Secret is a credential. Its zero value is the empty secret.
type Secret string

// String is what fmt's %v and %s print: never the value.
func (Secret) String() string { return Redacted }

// GoString is what %#v prints: never the value.
func (Secret) GoString() string { return Redacted }

// LogValue is what log/slog records, in every handler: never the value.
func (Secret) LogValue() slog.Value { return slog.StringValue(Redacted) }

// MarshalJSON is what encoding/json writes: never the value. A request body that needs
// the credential builds it from [Secret.Reveal] explicitly, so a struct that merely
// happens to carry one cannot leak it by being marshalled.
func (Secret) MarshalJSON() ([]byte, error) { return []byte(`"` + Redacted + `"`), nil }

// Reveal is the value. Every call site is a place the credential leaves this type,
// and `grep Reveal` finds all of them.
func (s Secret) Reveal() string { return string(s) }

// Empty reports whether there is no secret.
func (s Secret) Empty() bool { return s == "" }
