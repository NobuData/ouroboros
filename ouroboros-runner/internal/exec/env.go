package exec

import (
	"sort"
	"strings"
)

// Scrub is a job's whole environment: exactly the variables of env whose names the pool's
// allow-list holds, as sorted `NAME=value` entries.
//
// It is the only environment a job gets. Nothing is inherited from the agent's own process
// — the service manager's variables, the runner's state-directory path, whatever an operator
// exported before starting it — because the failure mode of forgetting an entry is a build
// that cannot see a variable, and the failure mode of inheriting one is a credential on a
// build nobody meant to give it to.
//
//   - env is the offer's `env`.
//   - allowlist is the pool's `env_allowlist`, from `ack.pool`.
//
// It returns the entries (never nil: an empty slice is an empty environment, where nil
// would mean "inherit" to os/exec) and the sorted names it dropped, so the agent can say in
// its log which variables a job asked for and did not get. Values are never returned in
// the dropped list — only names.
//
// A name that cannot be a variable — empty, or containing `=` or a NUL — is dropped even if
// the allow-list holds it: `A=B` as a name would set a DIFFERENT variable, `A`, and a NUL
// would end the entry early. So is a value with a NUL, which no environment can carry.
func Scrub(env map[string]string, allowlist []string) (entries, dropped []string) {
	allowed := make(map[string]bool, len(allowlist))
	for _, name := range allowlist {
		allowed[name] = true
	}

	entries = []string{}
	for name, value := range env {
		if !allowed[name] || !validName(name) || strings.ContainsRune(value, 0) {
			dropped = append(dropped, name)
			continue
		}
		entries = append(entries, name+"="+value)
	}
	sort.Strings(entries)
	sort.Strings(dropped)
	return entries, dropped
}

// validName reports whether a string can be an environment variable's name at all.
func validName(name string) bool {
	return name != "" && !strings.ContainsAny(name, "=\x00")
}
