//go:build ccachetest

// The ccache half (#247) against a REAL ccache and C compiler: `make test-ccache`. Separate
// from `make test` because it needs both on PATH — the default suite stays hermetic — and,
// like `make test-docker`, it fails rather than skipping where they are missing.

package logship

import (
	"bytes"
	"context"
	"fmt"
	"os"
	osexec "os/exec"
	"path/filepath"
	"testing"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
)

// realCompile runs `ccache cc -c <source>` as a shell job's command would run it: argv,
// through the shell executor, in the job's environment.
func realCompile(t *testing.T, env []string, workspace, source string) {
	t.Helper()
	var stderr bytes.Buffer
	code, err := (&exec.Shell{}).Execute(context.Background(), exec.Job{
		ID: testJob, Kind: conn.ExecutorShell, Env: env,
		Command: []string{"ccache", "cc", "-c", source, "-o", source + ".o"},
	}, workspace, exec.Output{Stderr: &stderr})
	if err != nil || code != 0 {
		t.Fatalf("ccache cc -c %s: %d, %v\n%s", source, code, err, stderr.String())
	}
}

// ccacheSays runs ccache itself in the job's environment — `-s` over the whole cache, or
// `--show-log-stats` over the job's own statistics log — and reads its Hits and Misses.
func ccacheSays(t *testing.T, env []string, flag string) (hits, misses int) {
	t.Helper()
	command := osexec.Command("ccache", flag) // #nosec G204 -- a literal flag, in a suite that runs ccache
	command.Env = env
	out, err := command.Output()
	if err != nil {
		t.Fatalf("ccache %s: %v", flag, err)
	}
	return showStatsLine(t, string(out), "Hits"), showStatsLine(t, string(out), "Misses")
}

func TestCcacheStatsMatchARealCcacheRun(t *testing.T) {
	for _, tool := range []string{"ccache", "cc"} {
		if _, err := osexec.LookPath(tool); err != nil {
			t.Fatalf("make test-ccache needs %s on PATH: %v", tool, err)
		}
	}
	caches := Caches{Root: filepath.Join(t.TempDir(), "cache")}
	workspace := t.TempDir()
	for i := range 6 {
		source := fmt.Sprintf("/* v1 */\nint f%d(void) { return %d; }\n", i, i)
		if err := os.WriteFile(filepath.Join(workspace, fmt.Sprintf("f%d.c", i)), []byte(source), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	base := []string{"PATH=" + os.Getenv("PATH"), "HOME=" + t.TempDir()}

	// The first build, on an empty cache: its statistics are the whole cache's, so they must
	// be exactly what a manual `ccache -s` says.
	first, err := caches.Prepare("pool-a", testJob, conn.ExecutorShell)
	if err != nil {
		t.Fatal(err)
	}
	env, _ := first.Apply(base)
	for i := range 6 {
		realCompile(t, env, workspace, fmt.Sprintf("f%d.c", i))
	}
	for i := range 3 {
		realCompile(t, env, workspace, fmt.Sprintf("f%d.c", i))
	}
	hits, misses := ccacheSays(t, env, "-s")
	stats := first.Stats(env)
	t.Logf("first build: %+v; ccache -s: %d hits, %d misses", stats, hits, misses)
	if stats == nil || stats.Hits != hits || stats.Misses != misses || hits != 3 || misses != 6 {
		t.Fatalf("stats %+v; ccache -s says %d hits and %d misses (want 3 and 6)", stats, hits, misses)
	}

	// A second build of the same pool, on the warm cache: its statistics are its own, not the
	// cache's running total — exactly what ccache reads from the job's statistics log.
	second, err := caches.Prepare("pool-a", "job_01KE7J4EZ3204KQXMHJRPQPWQ9", conn.ExecutorShell)
	if err != nil {
		t.Fatal(err)
	}
	env, _ = second.Apply(base)
	for i := range 6 {
		realCompile(t, env, workspace, fmt.Sprintf("f%d.c", i))
	}
	hits, misses = ccacheSays(t, env, "--show-log-stats")
	stats = second.Stats(env)
	t.Logf("second build: %+v; ccache --show-log-stats: %d hits, %d misses", stats, hits, misses)
	if stats == nil || stats.Hits != hits || stats.Misses != misses || hits != 6 || misses != 0 || stats.HitRatePct != 100 {
		t.Fatalf("stats %+v; ccache --show-log-stats says %d hits and %d misses (want 6 and 0)", stats, hits, misses)
	}

	// Another pool's first build shares nothing with pool-a's warm cache.
	other, err := caches.Prepare("pool-b", testJob, conn.ExecutorShell)
	if err != nil {
		t.Fatal(err)
	}
	env, _ = other.Apply(base)
	realCompile(t, env, workspace, "f0.c")
	if stats := other.Stats(env); stats == nil || stats.Hits != 0 || stats.Misses != 1 {
		t.Fatalf("pool-b's first build: %+v; want a miss — pools never share a cache", stats)
	}

	// A build that runs no ccache has no statistics: null, not 0%.
	none, err := caches.Prepare("pool-a", "job_01KE7J4EZ3204KQXMHJRPQPWQA", conn.ExecutorShell)
	if err != nil {
		t.Fatal(err)
	}
	env, _ = none.Apply(base)
	if code, err := (&exec.Shell{}).Execute(context.Background(), exec.Job{
		ID: testJob, Kind: conn.ExecutorShell, Env: env, Command: []string{"cc", "-c", "f0.c", "-o", "plain.o"},
	}, workspace, exec.Output{}); err != nil || code != 0 {
		t.Fatalf("cc without ccache: %d, %v", code, err)
	}
	if stats := none.Stats(env); stats != nil {
		t.Fatalf("a build without ccache reported %+v; want null", stats)
	}
}
