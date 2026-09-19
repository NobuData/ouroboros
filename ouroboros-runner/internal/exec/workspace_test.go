package exec

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// jobID is a job id of the published shape, numbered.
func jobID(n int) string { return fmt.Sprintf("job_01KE7J4EZ3204KQXMHJRPQ%04d", n) }

// TestWorkspacesCreateAFreshPrivateDirectoryPerJob asserts a workspace is the job's own
// directory, 0700 whatever the umask, named for the job — and empty, even when an earlier
// run of the same job left one behind.
func TestWorkspacesCreateAFreshPrivateDirectoryPerJob(t *testing.T) {
	root := filepath.Join(t.TempDir(), "work")
	spaces := &Workspaces{Root: root}

	dir, replaced, err := spaces.Create(jobID(1))
	if err != nil || replaced {
		t.Fatalf("create: %v, replaced %t", err, replaced)
	}
	if dir != filepath.Join(root, jobID(1)) {
		t.Errorf("the workspace is %s", dir)
	}
	for _, path := range []string{root, dir} {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0o700 {
			t.Errorf("%s: %v, mode %v", path, err, info.Mode().Perm())
		}
	}

	if err := os.WriteFile(filepath.Join(dir, "stale.o"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	dir, replaced, err = spaces.Create(jobID(1))
	if err != nil || !replaced {
		t.Fatalf("recreate: %v, replaced %t", err, replaced)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("a recreated workspace still holds %d entries", len(entries))
	}

	if _, _, err := spaces.Create("../../etc"); err == nil {
		t.Error("a workspace was created for a job id that is a path")
	}
}

// TestTheCleanupPolicy is the keep-workspace-on-failure flag: off, every workspace goes;
// on, only a job that failed, timed out or errored keeps its own.
func TestTheCleanupPolicy(t *testing.T) {
	for _, keep := range []bool{false, true} {
		spaces := &Workspaces{Root: filepath.Join(t.TempDir(), "work"), KeepOnFailure: keep}
		for n, outcome := range []string{
			conn.OutcomeSucceeded, conn.OutcomeFailed, conn.OutcomeCancelled, conn.OutcomeTimedOut, conn.OutcomeErrored,
		} {
			dir, _, err := spaces.Create(jobID(n))
			if err != nil {
				t.Fatal(err)
			}
			kept, err := spaces.Finish(dir, outcome)
			if err != nil {
				t.Fatalf("%s: %v", outcome, err)
			}
			wantKept := keep && outcome != conn.OutcomeSucceeded && outcome != conn.OutcomeCancelled
			_, statErr := os.Stat(dir)
			if kept != wantKept || (statErr == nil) != wantKept {
				t.Errorf("keep %t, %s: kept %t, exists %t", keep, outcome, kept, statErr == nil)
			}
		}
	}
	if kept, err := (&Workspaces{}).Finish("", conn.OutcomeErrored); kept || err != nil {
		t.Error("a workspace never created has nothing to clean up")
	}
}

// TestCleanupRemovesWhatABuildMadeReadOnly asserts a workspace holding directories a build
// made read-only — Go's module cache does — is still removed, and that a symlink out of the
// workspace is removed without its target being touched.
func TestCleanupRemovesWhatABuildMadeReadOnly(t *testing.T) {
	spaces := &Workspaces{Root: filepath.Join(t.TempDir(), "work")}
	dir, _, err := spaces.Create(jobID(1))
	if err != nil {
		t.Fatal(err)
	}
	locked := filepath.Join(dir, "pkg", "mod", "example.com@v1")
	if err := os.MkdirAll(locked, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(locked, "go.mod"), []byte("module x"), 0o400); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{locked, filepath.Dir(locked)} {
		if err := os.Chmod(path, 0o500); err != nil { // #nosec G302 -- the read-only directory under test
			t.Fatal(err)
		}
	}
	outside := t.TempDir()
	precious := filepath.Join(outside, "precious")
	if err := os.WriteFile(precious, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(outside, 0o500); err != nil { // #nosec G302 -- must stay 0500: unlockTree may not reach it
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(outside, 0o700) }) // #nosec G302 -- so TempDir can clean up
	if err := os.Symlink(outside, filepath.Join(dir, "escape")); err != nil {
		t.Fatal(err)
	}

	if _, err := spaces.Finish(dir, conn.OutcomeSucceeded); err != nil {
		t.Fatalf("finish: %v", err)
	}
	if _, err := os.Stat(dir); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the workspace survived: %v", err)
	}
	if _, err := os.Stat(precious); err != nil {
		t.Errorf("cleanup followed a symlink out of the workspace: %v", err)
	}
	if info, err := os.Stat(outside); err != nil || info.Mode().Perm() != 0o500 {
		t.Errorf("unlocking the workspace changed a directory outside it: %v", info.Mode().Perm())
	}
}

// TestResolveWorkdirStaysInsideTheWorkspace is the shell workdir rule: a leading / is the
// workspace root, and a .. is refused — so no offer can name a host directory.
func TestResolveWorkdirStaysInsideTheWorkspace(t *testing.T) {
	workspace := "/var/lib/ouroboros-runner/work/" + jobID(1)
	for workdir, want := range map[string]string{
		"/":                   workspace,
		".":                   workspace,
		"/workspace":          workspace + "/workspace",
		"/Users/builder/work": workspace + "/Users/builder/work",
		"build/out":           workspace + "/build/out",
		"//double//slash/":    workspace + "/double/slash",
	} {
		got, err := ResolveWorkdir(workspace, workdir)
		if err != nil || got != want {
			t.Errorf("ResolveWorkdir(%q) = %q, %v; want %q", workdir, got, err, want)
		}
	}
	for _, workdir := range []string{"..", "/../etc", "build/../../etc", `..\windows`} {
		_, err := ResolveWorkdir(workspace, workdir)
		var reason *Failure
		if !errors.As(err, &reason) || reason.Code != CodeWorkspaceInvalid {
			t.Errorf("ResolveWorkdir(%q) = %v, want a %s failure", workdir, err, CodeWorkspaceInvalid)
		}
	}
}

// TestContainerWorkdir is the container workdir rule: an absolute path inside the image,
// never the root, never with a .. or a colon.
func TestContainerWorkdir(t *testing.T) {
	for workdir, want := range map[string]string{
		"/workspace":      "/workspace",
		"/workspace/":     "/workspace",
		"/src//zephyr/./": "/src/zephyr",
	} {
		got, err := ContainerWorkdir(workdir)
		if err != nil || got != want {
			t.Errorf("ContainerWorkdir(%q) = %q, %v; want %q", workdir, got, err, want)
		}
	}
	for _, workdir := range []string{"workspace", "/", "//", "/workspace/../etc", "/work:/etc"} {
		_, err := ContainerWorkdir(workdir)
		var reason *Failure
		if !errors.As(err, &reason) || reason.Code != CodeWorkspaceInvalid {
			t.Errorf("ContainerWorkdir(%q) = %v, want a %s failure", workdir, err, CodeWorkspaceInvalid)
		}
	}
}

// TestShareOf is a job's fair share of the machine under the pool's cap.
func TestShareOf(t *testing.T) {
	if got := ShareOf(8, 16384, 2); got.NanoCPUs != 4e9 || got.MemoryBytes != 8192*1024*1024 {
		t.Errorf("half of 8 cores and 16 GiB: %+v", got)
	}
	if got := ShareOf(8, 16384, 0); got.NanoCPUs != 8e9 {
		t.Errorf("a cap below 1 is read as 1: %+v", got)
	}
	if got := ShareOf(0, 0, 1); got != (Limits{}) {
		t.Errorf("a machine that reported nothing is not limited to nothing: %+v", got)
	}
}
