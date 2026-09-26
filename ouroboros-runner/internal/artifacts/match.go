package artifacts

import (
	"path"
	"strings"
)

// Match reports whether a slash-separated relative path matches a glob.
//
// A glob is path.Match's syntax per segment, plus `**` as a whole segment matching any number
// of directories — none included — so `**/junit*.xml` matches `junit.xml` and
// `build/zephyr/junit-build3.xml` alike. A malformed pattern matches nothing, and neither side
// may climb: a `..` segment in either never matches.
func Match(glob, name string) bool {
	if glob == "" || name == "" || strings.HasPrefix(glob, "/") || strings.HasPrefix(name, "/") {
		return false
	}
	patterns := strings.Split(glob, "/")
	segments := strings.Split(name, "/")
	for _, segment := range append(append([]string{}, patterns...), segments...) {
		if segment == ".." {
			return false
		}
	}
	return matchSegments(patterns, segments)
}

// matchSegments matches pattern segments against path segments, `**` spanning any number.
func matchSegments(patterns, segments []string) bool {
	for len(patterns) > 0 {
		if patterns[0] == "**" {
			rest := patterns[1:]
			for skip := 0; skip <= len(segments); skip++ {
				if matchSegments(rest, segments[skip:]) {
					return true
				}
			}
			return false
		}
		if len(segments) == 0 {
			return false
		}
		matched, err := path.Match(patterns[0], segments[0])
		if err != nil || !matched {
			return false
		}
		patterns, segments = patterns[1:], segments[1:]
	}
	return len(segments) == 0
}
