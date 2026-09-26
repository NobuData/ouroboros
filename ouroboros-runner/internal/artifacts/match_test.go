package artifacts

import "testing"

// TestMatch holds the glob dialect to what an offer's globs mean: path.Match per segment, `**`
// for any number of directories, and nothing that climbs.
func TestMatch(t *testing.T) {
	t.Parallel()
	cases := []struct {
		glob, name string
		want       bool
	}{
		{"junit*.xml", "junit-build3.xml", true},
		{"junit*.xml", "build/junit.xml", false},
		{"**/junit*.xml", "junit.xml", true},
		{"**/junit*.xml", "build/zephyr/junit-build3.xml", true},
		{"**/junit*.xml", "build/zephyr/junit-build3.xml.bak", false},
		{"build/**", "build/a/b/c.log", true},
		{"build/**", "build", true},
		{"build/**/twister.xml", "build/twister.xml", true},
		{"build/**/twister.xml", "build/x/y/twister.xml", true},
		{"captures/*.csv", "captures/rig-capture-estop.csv", true},
		{"captures/*.csv", "captures/sub/rig.csv", false},
		{"logs/serial-console.log", "logs/serial-console.log", true},
		{"**/ouro-hil-results*.json", "hil/ouro-hil-results.json", true},
		{"[", "[", false}, // a malformed pattern matches nothing
		{"../secrets/*", "../secrets/key", false},
		{"**", "../outside", false},
		{"/etc/*", "/etc/passwd", false},
		{"", "a", false},
		{"a", "", false},
	}
	for _, c := range cases {
		if got := Match(c.glob, c.name); got != c.want {
			t.Errorf("Match(%q, %q) = %v, want %v", c.glob, c.name, got, c.want)
		}
	}
}
