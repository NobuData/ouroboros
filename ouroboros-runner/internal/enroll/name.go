package enroll

import (
	"regexp"
	"strings"
)

// nameShape is the control plane's `runners_name_shape` (V040), restated: a lower-case
// slug of at most 64 characters that neither begins nor ends in punctuation. It is also
// the shape of a pool name. Checked here so a bad `--name` or `--pool` is refused before
// the token is presented, rather than as a 422 after.
var nameShape = regexp.MustCompile(`^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$`)

// ValidName reports whether a runner or pool name has the control plane's shape.
func ValidName(name string) bool { return nameShape.MatchString(name) }

// NameFromHostname is the runner name a machine gets when the operator does not give
// one: its hostname, folded into the slug shape.
//
// `Shed-Pi.local` becomes `shed-pi.local`; `build box #3` becomes `build-box-3`. A
// hostname with nothing usable in it becomes `runner`, which the control plane will
// refuse if it is taken — at which point the operator passes `--name`.
func NameFromHostname(hostname string) string {
	var folded strings.Builder
	lastWasDash := false
	for _, r := range strings.ToLower(hostname) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '_':
			folded.WriteRune(r)
			lastWasDash = false
		case !lastWasDash:
			folded.WriteRune('-')
			lastWasDash = true
		}
	}
	name := strings.Trim(folded.String(), "-._")
	if len(name) > 64 {
		name = strings.TrimRight(name[:64], "-._")
	}
	if !ValidName(name) {
		return "runner"
	}
	return name
}
