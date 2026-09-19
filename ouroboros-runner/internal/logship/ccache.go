package logship

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
)

// The variables the agent sets on every job, whatever its pool allow-lists: the pool's
// cache directory, and the job's own statistics log inside it.
const (
	EnvCcacheDir      = "CCACHE_DIR"
	EnvCcacheStatsLog = "CCACHE_STATSLOG"
	envCcacheMaxSize  = "CCACHE_MAXSIZE"
)

// CacheMountTarget is where a container job sees its pool's cache directory. A container
// job's `workdir` may not be this path or under it (exec refuses the overlap).
const CacheMountTarget = "/ouroboros-cache"

// The layout of one pool's cache directory, under Caches.Root.
const (
	ccacheSubdir = "ccache" // CCACHE_DIR: the pool's cache, kept across its jobs
	statsSubdir  = "stats"  // one CCACHE_STATSLOG per job, removed once it is read
	cacheMode    = 0o700    // the agent's user, and nobody else — as a workspace
)

// defaultMaxSizeBytes is ccache's own default `max_size`: 5 GiB (5 GB before ccache 4.10,
// which the agent cannot tell apart without running the job's ccache).
const defaultMaxSizeBytes = 5 * 1024 * 1024 * 1024

// mib is a mebibyte, the unit `job.finish.ccache` reports sizes in.
const mib = 1024 * 1024

// safePoolName is a pool name that is also a safe directory name: V040's pool-name shape,
// widened by `.` and `_`, and never `.` or `..`.
var safePoolName = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)

// Caches is where each pool's compiler cache lives on this runner: `<Root>/<pool>/ccache`,
// kept across the pool's jobs, so a long-lived runner keeps its cache warm (decision B5's
// "per-runner" cache, until AJ.2 (#264) makes a shared one real). Two pools never share a
// directory, so the cache one pool's toolchain filled is never read by another's.
type Caches struct {
	// Root is `<state-dir>/cache`. Empty disables the cache: no variables are set, and
	// every job reports no ccache statistics.
	Root string
}

// JobCache is one job's view of its pool's cache: the variables it runs with, the mount a
// container job needs, and where its statistics are read from afterwards. A nil JobCache
// is a job with no cache — no variables, no mount, and null statistics.
type JobCache struct {
	kind     string
	poolDir  string // host path of the pool's directory
	statsLog string // host path of this job's CCACHE_STATSLOG
	env      []string
}

// Prepare readies a job's cache: the pool's directory exists, and this job's statistics log
// does not (a stale one — an agent that died mid-job — is removed, so its counts are not
// read as this job's). kind is the job's executor kind; a container job sees the directory
// at CacheMountTarget, a shell job at its host path.
//
// It returns nil and no error when caching is disabled. An error is a directory that could
// not be made; the job runs anyway, without a cache.
func (c Caches) Prepare(pool, job, kind string) (*JobCache, error) {
	if c.Root == "" {
		return nil, nil
	}
	if !conn.ValidJobID(job) {
		return nil, fmt.Errorf("%q is not a job id, and a statistics log is named for one", job)
	}
	dir := filepath.Join(c.Root, PoolDir(pool))
	for _, each := range []string{c.Root, dir, filepath.Join(dir, ccacheSubdir), filepath.Join(dir, statsSubdir)} {
		if err := os.MkdirAll(each, cacheMode); err != nil {
			return nil, fmt.Errorf("create the cache directory %s: %w", each, err)
		}
	}
	// Explicitly, so a permissive umask cannot widen them.
	for _, each := range []string{c.Root, dir} {
		if err := os.Chmod(each, cacheMode); err != nil {
			return nil, fmt.Errorf("restrict the cache directory %s: %w", each, err)
		}
	}

	name := job + ".log"
	statsLog := filepath.Join(dir, statsSubdir, name)
	if err := os.Remove(statsLog); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("remove a stale statistics log %s: %w", statsLog, err)
	}

	cache := &JobCache{kind: kind, poolDir: dir, statsLog: statsLog}
	if kind == conn.ExecutorContainer {
		cache.env = []string{
			EnvCcacheDir + "=" + path.Join(CacheMountTarget, ccacheSubdir),
			EnvCcacheStatsLog + "=" + path.Join(CacheMountTarget, statsSubdir, name),
		}
	} else {
		cache.env = []string{
			EnvCcacheDir + "=" + filepath.Join(dir, ccacheSubdir),
			EnvCcacheStatsLog + "=" + statsLog,
		}
	}
	return cache, nil
}

// PoolDir is the directory a pool's cache lives in: the pool's own name when it is a safe
// one, which every pool V040 allows is — or, for any other name, `=` and its hex, which no
// safe name can equal (not even on a case-insensitive filesystem). No offer can name a path.
func PoolDir(pool string) string {
	if safePoolName.MatchString(pool) {
		return pool
	}
	return "=" + hex.EncodeToString([]byte(pool))
}

// Apply is a job's environment with the cache's variables set — replacing any the pool
// allow-listed, because the pool's directory is the agent's to choose — and the names it
// replaced, for the log.
func (j *JobCache) Apply(env []string) (applied, replaced []string) {
	if j == nil {
		return env, nil
	}
	applied = make([]string, 0, len(env)+len(j.env))
	for _, entry := range env {
		name, _, _ := strings.Cut(entry, "=")
		if name == EnvCcacheDir || name == EnvCcacheStatsLog {
			replaced = append(replaced, name)
			continue
		}
		applied = append(applied, entry)
	}
	return append(applied, j.env...), replaced
}

// Mounts is what a container job needs bind-mounted: its pool's directory, at
// CacheMountTarget. A shell job needs nothing — it runs on the host, where the paths are.
func (j *JobCache) Mounts() []exec.Mount {
	if j == nil || j.kind != conn.ExecutorContainer {
		return nil
	}
	return []exec.Mount{{Host: j.poolDir, Target: CacheMountTarget}}
}

// Stats is the job's compiler-cache statistics, read once its command has ended, and the
// statistics log is removed. env is the environment the job ran with, whose CCACHE_MAXSIZE
// (when its pool allows one) is the cache's limit.
//
// Hits and misses are the job's own — counted from its CCACHE_STATSLOG, so jobs of one pool
// running at once never see each other's — and computed as `ccache -s` computes them: hits
// are direct and preprocessed hits, misses are `cache_miss`. The size is the pool's
// directory as it stands.
//
// It is nil — decision B5's "not measured", never 0% — when there is no statistics log (no
// ccache ran, or one older than 4.0, which writes none), when it cannot be read, or when it
// counts no cacheable compilation at all: a build that compiled nothing has no hit rate.
func (j *JobCache) Stats(env []string) *conn.FinishCcache {
	if j == nil {
		return nil
	}
	hits, misses, err := readStatsLog(j.statsLog)
	_ = os.Remove(j.statsLog)
	if err != nil || hits+misses == 0 {
		return nil
	}
	return &conn.FinishCcache{
		Hits:       hits,
		Misses:     misses,
		HitRatePct: math.Round(float64(hits)*10_000/float64(hits+misses)) / 100,
		SizeMB:     int(dirSize(filepath.Join(j.poolDir, ccacheSubdir)) / mib),
		MaxSizeMB:  int(maxSize(env, filepath.Join(j.poolDir, ccacheSubdir, "ccache.conf")) / mib),
	}
}

// statsLogLineMax is the longest statistics-log line read whole. Counter lines are short;
// the longer ones are `# <source path>` comments, and one longer than this is skipped.
const statsLogLineMax = 64 * 1024

// readStatsLog counts a ccache statistics log's hits and misses. The log is ccache's
// (4.0 and later): for each compilation a `# <source>` line, then one line per counter it
// incremented — `direct_cache_hit`, `preprocessed_cache_hit`, `cache_miss` and others this
// ignores. It is read a line at a time, so its size does not matter.
func readStatsLog(name string) (hits, misses int, err error) {
	file, err := os.Open(name) // #nosec G304 -- the agent's own path, under its state directory
	if err != nil {
		return 0, 0, err
	}
	defer file.Close()

	reader := bufio.NewReaderSize(file, statsLogLineMax)
	for {
		line, err := reader.ReadSlice('\n')
		if errors.Is(err, bufio.ErrBufferFull) {
			for errors.Is(err, bufio.ErrBufferFull) {
				_, err = reader.ReadSlice('\n') // a very long comment: skip the rest of it
			}
			line = nil
		}
		switch string(bytes.TrimSpace(line)) {
		case "direct_cache_hit", "preprocessed_cache_hit":
			hits++
		case "cache_miss":
			misses++
		}
		if errors.Is(err, io.EOF) {
			return hits, misses, nil
		}
		if err != nil {
			return 0, 0, err
		}
	}
}

// dirSize is the apparent size of every regular file under dir. An entry that cannot be read
// is skipped: a cache being written by another job is a moving target, and this is a gauge.
func dirSize(dir string) int64 {
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, entry fs.DirEntry, err error) error {
		if err == nil && entry.Type().IsRegular() {
			if info, err := entry.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

// maxSize is the cache's limit in bytes, as ccache resolves it for this directory: the job's
// CCACHE_MAXSIZE, else `max_size` in the directory's own ccache.conf, else ccache's default.
// 0 is no limit. (A system-wide /etc/ccache.conf — inside a container image, say — is not
// seen; it is below both in ccache's order anyway.)
func maxSize(env []string, conf string) int64 {
	for i := len(env) - 1; i >= 0; i-- {
		if value, found := strings.CutPrefix(env[i], envCcacheMaxSize+"="); found {
			if size, ok := parseSize(value); ok {
				return size
			}
			break
		}
	}
	if raw, err := os.ReadFile(conf); err == nil { // #nosec G304 -- the agent's own path
		for line := range strings.SplitSeq(string(raw), "\n") {
			key, value, found := strings.Cut(line, "=")
			if found && strings.TrimSpace(key) == "max_size" {
				if size, ok := parseSize(value); ok {
					return size
				}
			}
		}
	}
	return defaultMaxSizeBytes
}

// sizeUnits are ccache's size suffixes: k, M, G and T are decimal, Ki, Mi, Gi and Ti binary.
var sizeUnits = map[string]float64{
	"": 1e9, "k": 1e3, "K": 1e3, "M": 1e6, "G": 1e9, "T": 1e12,
	"Ki": 1 << 10, "Mi": 1 << 20, "Gi": 1 << 30, "Ti": 1 << 40,
}

// parseSize reads a ccache size as ccache writes one — `5G`, `5.0 GiB`, `500M`, `10Gi`, `0` —
// in bytes. A bare number is gigabytes, ccache's default unit, and a trailing `B` is allowed.
func parseSize(text string) (int64, bool) {
	text = strings.TrimSpace(text)
	split := strings.IndexFunc(text, func(r rune) bool { return (r < '0' || r > '9') && r != '.' })
	if split < 0 {
		split = len(text)
	}
	number, err := strconv.ParseFloat(text[:split], 64)
	if err != nil || number < 0 {
		return 0, false
	}
	unit := strings.TrimSuffix(strings.TrimSpace(text[split:]), "B")
	scale, known := sizeUnits[unit]
	if !known {
		return 0, false
	}
	size := number * scale
	if size > math.MaxInt64/2 {
		return 0, false
	}
	return int64(size), true
}
