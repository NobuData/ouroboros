package telemetry

import (
	"runtime"
	"testing"
)

// TestArchForEveryTarget asserts the mapping for all three of ci/runner's targets,
// including the two the test is not running on.
//
// `linux/x86_64` is the row worth having a test for: it is the one place the protocol's
// spelling and Go's differ, and an agent that enrolled as `linux/amd64` would be an
// agent no pool has a row for.
func TestArchForEveryTarget(t *testing.T) {
	for _, testCase := range []struct {
		goos, goarch, want string
	}{
		{"linux", "arm64", "linux/arm64"},
		{"linux", "amd64", "linux/x86_64"},
		{"darwin", "arm64", "darwin/arm64"},
	} {
		got, err := archFor(testCase.goos, testCase.goarch)
		if err != nil {
			t.Errorf("%s/%s: %v", testCase.goos, testCase.goarch, err)
			continue
		}
		if got != testCase.want {
			t.Errorf("%s/%s: expected %q, got %q", testCase.goos, testCase.goarch, testCase.want, got)
		}
	}
}

// TestArchForUnsupportedTargets asserts a platform outside the three is an error rather
// than a best-effort string. A pool dispatches work on the strength of this value, so a
// plausible-looking guess is worse than a refusal to enrol.
func TestArchForUnsupportedTargets(t *testing.T) {
	for _, testCase := range []struct{ goos, goarch string }{
		{"darwin", "amd64"},  // an Intel Mac: deliberately not a target
		{"linux", "riscv64"}, // not built for
		{"windows", "amd64"}, // no executor for
		{"", ""},
	} {
		if got, err := archFor(testCase.goos, testCase.goarch); err == nil {
			t.Errorf("%s/%s: expected an error, got %q", testCase.goos, testCase.goarch, got)
		}
	}
}

// TestArchAgreesWithTheRuntime asserts the exported wrapper reads the platform it is
// actually running on. It is the one row that cannot be table-driven, and it is what
// catches the wrapper being pointed at the wrong constants.
func TestArchAgreesWithTheRuntime(t *testing.T) {
	want, wantErr := archFor(runtime.GOOS, runtime.GOARCH)
	got, gotErr := Arch()

	if (gotErr == nil) != (wantErr == nil) {
		t.Fatalf("Arch() returned err=%v, archFor returned err=%v", gotErr, wantErr)
	}
	if got != want {
		t.Errorf("Arch() = %q, archFor(%s, %s) = %q", got, runtime.GOOS, runtime.GOARCH, want)
	}
}

// TestDescribe asserts every field a `hello` needs is filled in with something the
// protocol would accept.
//
// It runs against the real machine, which is the point: a mocked host cannot tell us
// whether this agent can describe the computer it is on, and that is the only question
// worth asking before enrollment.
func TestDescribe(t *testing.T) {
	host, err := Describe()
	if err != nil {
		t.Fatalf("describe this machine: %v", err)
	}

	if host.Hostname == "" {
		t.Error("expected a hostname")
	}
	if host.Arch == "" {
		t.Error("expected an architecture")
	}
	// The protocol's minima. A zero here is an agent enrolling as a machine with no
	// cores and no memory, which would be given work sized for it.
	if host.CPUs < 1 {
		t.Errorf("expected at least one usable core, got %d", host.CPUs)
	}
	if host.MemoryMB < 1 {
		t.Errorf("expected at least one mebibyte of memory, got %d", host.MemoryMB)
	}
}
