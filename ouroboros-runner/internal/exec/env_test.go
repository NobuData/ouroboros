package exec

import (
	"slices"
	"testing"
)

// TestScrubKeepsOnlyTheAllowList is the environment rule of the trust model: a job gets
// the variables its offer carried whose names the pool allow-lists — and nothing else.
func TestScrubKeepsOnlyTheAllowList(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		env       map[string]string
		allowlist []string
		entries   []string
		dropped   []string
	}{
		{
			name:      "the allow-list filters the offer",
			env:       map[string]string{"CI": "true", "MAKEFLAGS": "-j8", "AWS_SECRET_ACCESS_KEY": "x"},
			allowlist: []string{"MAKEFLAGS", "CI"},
			entries:   []string{"CI=true", "MAKEFLAGS=-j8"},
			dropped:   []string{"AWS_SECRET_ACCESS_KEY"},
		},
		{
			name:      "an empty allow-list lets nothing through",
			env:       map[string]string{"CI": "true"},
			allowlist: nil,
			entries:   []string{},
			dropped:   []string{"CI"},
		},
		{
			name:      "an allow-listed name the offer did not send is not invented",
			env:       map[string]string{},
			allowlist: []string{"PATH"},
			entries:   []string{},
		},
		{
			name:      "an empty value is a value",
			env:       map[string]string{"EMPTY": ""},
			allowlist: []string{"EMPTY"},
			entries:   []string{"EMPTY="},
		},
		{
			name: "a name that would set another variable is dropped even when listed",
			env:  map[string]string{"A=B": "c", "": "empty", "NUL\x00": "x", "VALUE": "has\x00nul"},
			allowlist: []string{
				"A=B", "", "NUL\x00", "VALUE",
			},
			entries: []string{},
			dropped: []string{"", "A=B", "NUL\x00", "VALUE"},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			entries, dropped := Scrub(testCase.env, testCase.allowlist)
			if entries == nil {
				t.Fatal("Scrub returned nil, which os/exec reads as \"inherit the agent's environment\"")
			}
			if !slices.Equal(entries, testCase.entries) {
				t.Errorf("entries = %q, want %q", entries, testCase.entries)
			}
			if !slices.Equal(dropped, testCase.dropped) {
				t.Errorf("dropped = %q, want %q", dropped, testCase.dropped)
			}
		})
	}
}
