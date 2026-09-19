package logship

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
)

// showStatsLine reads `Hits:` or `Misses:` from `ccache -s` — the first one, the summary
// over local and remote storage — as its count.
func showStatsLine(t *testing.T, showStats, label string) int {
	t.Helper()
	match := regexp.MustCompile(`(?m)^\s+` + label + `:\s+(\d+) /`).FindStringSubmatch(showStats)
	if match == nil {
		t.Fatalf("no %s line in:\n%s", label, showStats)
	}
	count, err := strconv.Atoi(match[1])
	if err != nil {
		t.Fatal(err)
	}
	return count
}

// prepared is a job cache under a fresh root, for a shell or container job of pool-a.
func prepared(t *testing.T, kind string) (*JobCache, Caches) {
	t.Helper()
	caches := Caches{Root: filepath.Join(t.TempDir(), "cache")}
	cache, err := caches.Prepare("pool-a", testJob, kind)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	return cache, caches
}

// The acceptance criterion, against ccache itself: the statistics log of a real build —
// direct hits, a preprocessed hit, misses, and uncacheable calls (a link, a -E, a missing
// file) — captured from ccache 4.7.5 (Debian 12) and 4.11.2 (Debian 13), read as ccache's
// own `ccache -s` over the same build reads it.
func TestStatsMatchCcachesOwnSummaryOfTheSameBuild(t *testing.T) {
	for _, version := range []string{"4.7.5", "4.11.2"} {
		t.Run(version, func(t *testing.T) {
			cache, _ := prepared(t, conn.ExecutorShell)
			log, err := os.ReadFile(filepath.Join("testdata", "ccache-"+version+".statslog"))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(cache.statsLog, log, 0o600); err != nil { // #nosec G703 -- the cache's own path, under t.TempDir()
				t.Fatal(err)
			}
			summary, err := os.ReadFile(filepath.Join("testdata", "ccache-"+version+".show-stats.txt"))
			if err != nil {
				t.Fatal(err)
			}

			stats := cache.Stats(nil)
			hits, misses := showStatsLine(t, string(summary), "Hits"), showStatsLine(t, string(summary), "Misses")
			if stats == nil || stats.Hits != hits || stats.Misses != misses {
				t.Fatalf("stats %+v; ccache -s says %d hits and %d misses", stats, hits, misses)
			}
			if stats.HitRatePct != 45.45 || !strings.Contains(string(summary), "(45.45%)") {
				t.Errorf("hit rate %v; ccache -s prints 45.45%%", stats.HitRatePct)
			}
			if _, err := os.Stat(cache.statsLog); !errors.Is(err, fs.ErrNotExist) {
				t.Errorf("the statistics log was left behind: %v", err)
			}
		})
	}
}

func TestTheHitRateIsRoundedAsCcachePrintsIt(t *testing.T) {
	cache, _ := prepared(t, conn.ExecutorShell)
	log := strings.Repeat("# a.c\ndirect_cache_hit\n", 400) + strings.Repeat("# b.c\npreprocessed_cache_hit\n", 12) +
		strings.Repeat("# c.c\ncache_miss\ndirect_cache_miss\n", 113)
	if err := os.WriteFile(cache.statsLog, []byte(log), 0o600); err != nil {
		t.Fatal(err)
	}
	stats := cache.Stats(nil)
	if stats == nil || stats.Hits != 412 || stats.Misses != 113 || stats.HitRatePct != 78.48 {
		t.Fatalf("stats %+v; want 412 hits, 113 misses, 78.48%% (the mockup's build)", stats)
	}
}

// Decision B5: "no cache here" is null, never 0%.
func TestStatsAreNullWhenNothingWasMeasured(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		setup func(t *testing.T, statsLog string)
	}{
		{"no ccache ran (no log)", func(*testing.T, string) {}},
		{"ccache ran but compiled nothing cacheable", func(t *testing.T, statsLog string) {
			if err := os.WriteFile(statsLog, []byte("# a.out\ncalled_for_link\n# f.c\ncalled_for_preprocessing\n"), 0o600); err != nil {
				t.Fatal(err)
			}
		}},
		{"an empty log", func(t *testing.T, statsLog string) {
			if err := os.WriteFile(statsLog, nil, 0o600); err != nil {
				t.Fatal(err)
			}
		}},
		{"a log that cannot be read", func(t *testing.T, statsLog string) {
			if err := os.Mkdir(statsLog, 0o700); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			cache, _ := prepared(t, conn.ExecutorShell)
			testCase.setup(t, cache.statsLog)
			if stats := cache.Stats(nil); stats != nil {
				t.Fatalf("stats %+v; want null — nothing was measured", stats)
			}
		})
	}
}

func TestANilCacheIsNoCache(t *testing.T) {
	var cache *JobCache
	env := []string{"CI=true", "CCACHE_DIR=/elsewhere"}
	if applied, replaced := cache.Apply(env); !slices.Equal(applied, env) || replaced != nil {
		t.Errorf("a nil cache changed the environment: %q, %q", applied, replaced)
	}
	if cache.Mounts() != nil || cache.Stats(env) != nil {
		t.Error("a nil cache has mounts or statistics")
	}
	if disabled, err := (Caches{}).Prepare("pool-a", testJob, conn.ExecutorShell); disabled != nil || err != nil {
		t.Errorf("a cache with no root: %v, %v", disabled, err)
	}
}

func TestPrepareRefusesAJobIDThatIsNotOne(t *testing.T) {
	caches := Caches{Root: t.TempDir()}
	for _, job := range []string{"", "../../etc/passwd", "job_../x"} {
		if cache, err := caches.Prepare("pool-a", job, conn.ExecutorShell); cache != nil || err == nil {
			t.Errorf("job %q was given a statistics log", job)
		}
	}
}

func TestAShellJobUsesTheHostPaths(t *testing.T) {
	cache, caches := prepared(t, conn.ExecutorShell)
	pool := filepath.Join(caches.Root, "pool-a")
	applied, _ := cache.Apply([]string{"CI=true"})
	want := []string{"CI=true", "CCACHE_DIR=" + filepath.Join(pool, "ccache"),
		"CCACHE_STATSLOG=" + filepath.Join(pool, "stats", testJob+".log")}
	if !slices.Equal(applied, want) {
		t.Errorf("env %q; want %q", applied, want)
	}
	if cache.Mounts() != nil {
		t.Errorf("a shell job was given mounts: %v", cache.Mounts())
	}
	for _, dir := range []string{caches.Root, pool, filepath.Join(pool, "ccache"), filepath.Join(pool, "stats")} {
		info, err := os.Stat(dir)
		if err != nil || !info.IsDir() || info.Mode().Perm() != cacheMode {
			t.Errorf("%s: %v, %v; want a 0700 directory", dir, info, err)
		}
	}
}

func TestAContainerJobSeesThePoolDirectoryAtTheMountTarget(t *testing.T) {
	cache, caches := prepared(t, conn.ExecutorContainer)
	applied, _ := cache.Apply(nil)
	want := []string{"CCACHE_DIR=/ouroboros-cache/ccache", "CCACHE_STATSLOG=/ouroboros-cache/stats/" + testJob + ".log"}
	if !slices.Equal(applied, want) {
		t.Errorf("env %q; want %q", applied, want)
	}
	if mounts := cache.Mounts(); !slices.Equal(mounts, []exec.Mount{{Host: filepath.Join(caches.Root, "pool-a"), Target: CacheMountTarget}}) {
		t.Errorf("mounts %v", mounts)
	}
}

// The pool's directory is the agent's to choose: a pool that allow-lists CCACHE_DIR cannot
// point its jobs at another pool's cache, or anywhere else on the host.
func TestTheAgentsVariablesReplaceAnyThePoolAllows(t *testing.T) {
	cache, _ := prepared(t, conn.ExecutorShell)
	applied, replaced := cache.Apply([]string{"CCACHE_DIR=/var/lib/other-pool", "PATH=/usr/bin", "CCACHE_STATSLOG=/tmp/x", "CCACHE_MAXSIZE=2G"})
	if !slices.Equal(replaced, []string{EnvCcacheDir, EnvCcacheStatsLog}) {
		t.Errorf("replaced %q", replaced)
	}
	var dirs []string
	for _, entry := range applied {
		if strings.HasPrefix(entry, EnvCcacheDir+"=") {
			dirs = append(dirs, entry)
		}
	}
	if len(dirs) != 1 || strings.Contains(dirs[0], "other-pool") || !slices.Contains(applied, "CCACHE_MAXSIZE=2G") ||
		!slices.Contains(applied, "PATH=/usr/bin") {
		t.Errorf("env %q", applied)
	}
}

// The acceptance criterion: two pools on one runner never share a cache directory.
func TestTwoPoolsOnOneRunnerNeverShareACacheDirectory(t *testing.T) {
	caches := Caches{Root: t.TempDir()}
	dirOf := func(pool string) string {
		cache, err := caches.Prepare(pool, testJob, conn.ExecutorShell)
		if err != nil {
			t.Fatal(err)
		}
		applied, _ := cache.Apply(nil)
		return applied[0]
	}
	if a, b := dirOf("pool-a"), dirOf("pool-b"); a == b {
		t.Fatalf("pool-a and pool-b share %s", a)
	}
	if a, again := dirOf("pool-a"), dirOf("pool-a"); a != again {
		t.Fatalf("pool-a's cache moved from %s to %s between jobs", a, again)
	}
}

func TestAPoolNameIsUsedOnlyWhenItIsASafeDirectoryName(t *testing.T) {
	for pool, want := range map[string]string{
		"pool-a": "pool-a", "firmware.nrf52": "firmware.nrf52", "a": "a",
		".":       "=2e",
		"..":      "=2e2e",
		"../etc":  "=2e2e2f657463",
		"Pool-A":  "=506f6f6c2d41",
		"a/b":     "=612f62",
		"-flag":   "=2d666c6167",
		"x-506f6": "x-506f6",
	} {
		if got := PoolDir(pool); got != want {
			t.Errorf("PoolDir(%q) = %q; want %q", pool, got, want)
		}
		if got := PoolDir(pool); strings.ContainsAny(got, `/\`) || got == "." || got == ".." {
			t.Errorf("PoolDir(%q) = %q is not a single directory name", pool, got)
		}
	}
	if long := strings.Repeat("a", 65); PoolDir(long) == long {
		t.Error("a 65-character name was used as a directory name")
	}
}

func TestPrepareRemovesAStaleStatisticsLog(t *testing.T) {
	caches := Caches{Root: t.TempDir()}
	first, err := caches.Prepare("pool-a", testJob, conn.ExecutorShell)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(first.statsLog, []byte("# f.c\ncache_miss\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// The agent died mid-job; the same job runs again.
	again, err := caches.Prepare("pool-a", testJob, conn.ExecutorShell)
	if err != nil {
		t.Fatal(err)
	}
	if stats := again.Stats(nil); stats != nil {
		t.Errorf("a stale log's counts were read as the new run's: %+v", stats)
	}
}

func TestAVeryLongCommentLineIsSkipped(t *testing.T) {
	cache, _ := prepared(t, conn.ExecutorShell)
	log := "# /src/" + strings.Repeat("deep/", statsLogLineMax) + "f.c\ndirect_cache_hit\n# g.c\ncache_miss"
	if err := os.WriteFile(cache.statsLog, []byte(log), 0o600); err != nil {
		t.Fatal(err)
	}
	if stats := cache.Stats(nil); stats == nil || stats.Hits != 1 || stats.Misses != 1 {
		t.Fatalf("stats %+v; want 1 hit and 1 miss around a %d-byte comment", stats, len(log))
	}
}

func TestTheSizeIsThePoolsCacheDirectory(t *testing.T) {
	cache, _ := prepared(t, conn.ExecutorShell)
	objects := filepath.Join(cache.poolDir, ccacheSubdir, "a", "b")
	if err := os.MkdirAll(objects, 0o700); err != nil {
		t.Fatal(err)
	}
	for i, size := range []int{3 * mib, 2*mib + 500_000} {
		if err := os.WriteFile(filepath.Join(objects, strconv.Itoa(i)), make([]byte, size), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(cache.statsLog, []byte("# f.c\ncache_miss\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	stats := cache.Stats(nil)
	if stats == nil || stats.SizeMB != 5 || stats.MaxSizeMB != 5120 {
		t.Fatalf("stats %+v; want 5 MiB of a 5120 MiB (ccache's default) cache", stats)
	}
}

func TestTheLimitIsTheJobsThenTheDirectorysThenCcachesDefault(t *testing.T) {
	cache, _ := prepared(t, conn.ExecutorShell)
	conf := filepath.Join(cache.poolDir, ccacheSubdir, "ccache.conf")
	if got := maxSize(nil, conf); got != defaultMaxSizeBytes {
		t.Errorf("no setting: %d; want ccache's default", got)
	}
	if err := os.WriteFile(conf, []byte("# the pool's\ncompression = true\nmax_size = 10.0 GiB\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := maxSize(nil, conf); got != 10<<30 {
		t.Errorf("the directory's ccache.conf: %d; want 10 GiB", got)
	}
	if got := maxSize([]string{"CCACHE_MAXSIZE=500M", "CI=true"}, conf); got != 500_000_000 {
		t.Errorf("the job's CCACHE_MAXSIZE: %d; want 500 MB", got)
	}
	if got := maxSize([]string{"CCACHE_MAXSIZE=lots"}, conf); got != 10<<30 {
		t.Errorf("an unreadable CCACHE_MAXSIZE: %d; want the directory's", got)
	}
}

func TestSizesAreReadAsCcacheWritesThem(t *testing.T) {
	for text, want := range map[string]int64{
		"5G": 5e9, "5.0G": 5e9, "5.0 GiB": 5 << 30, " 5 GiB ": 5 << 30, "10Gi": 10 << 30,
		"500M": 500e6, "500MB": 500e6, "512Mi": 512 << 20, "100k": 100e3, "64Ki": 64 << 10,
		"1T": 1e12, "1Ti": 1 << 40, "0": 0, "2": 2e9, "1.5G": 1.5e9,
	} {
		if got, ok := parseSize(text); !ok || got != want {
			t.Errorf("parseSize(%q) = %d, %v; want %d", text, got, ok, want)
		}
	}
	for _, text := range []string{"", "G", "five", "-1G", "5X", "5 GiBs", "1e30T"} {
		if got, ok := parseSize(text); ok {
			t.Errorf("parseSize(%q) = %d; want it refused", text, got)
		}
	}
}
