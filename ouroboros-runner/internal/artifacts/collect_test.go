package artifacts

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// write puts a file of the given contents under root, making its directories.
func write(t *testing.T, root, name, contents string) string {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// sum is the manifest's checksum of some bytes.
func sum(contents string) string {
	digest := sha256.Sum256([]byte(contents))
	return "sha256:" + hex.EncodeToString(digest[:])
}

// names is the collection's sent files, by name.
func names(files []File) []string {
	out := make([]string, 0, len(files))
	for _, file := range files {
		out = append(out, file.Name)
	}
	return out
}

// TestCollectFindsWhatTheGlobsMatchResultsFirst: the files the offer's globs match, ordered by
// the glob that matched them — so the built-in result globs, listed first, come first — each
// with its size and the checksum of exactly its bytes.
func TestCollectFindsWhatTheGlobsMatchResultsFirst(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	write(t, root, "captures/rig-capture-estop.csv", "t,v\n0,1\n")
	write(t, root, "build/zephyr/junit-build3.xml", "<testsuites/>")
	write(t, root, "junit-a.xml", "<testsuite/>")
	write(t, root, "coverage/lcov.info", "SF:a.c\nLF:2\nLH:1\nend_of_record\n")
	write(t, root, "notes.md", "not matched")

	collection, err := Collect(root, []string{"**/junit*.xml", "**/lcov*.info", "captures/*.csv"}, Limits{})
	if err != nil {
		t.Fatal(err)
	}

	want := []string{"build/zephyr/junit-build3.xml", "junit-a.xml", "coverage/lcov.info",
		"captures/rig-capture-estop.csv"}
	if got := names(collection.Files); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("collected %v, want %v", got, want)
	}
	if collection.Files[0].Size != 13 || collection.Files[0].Checksum != sum("<testsuites/>") {
		t.Errorf("the first file: %+v", collection.Files[0])
	}
	if len(collection.Skipped) != 0 || collection.Bytes() != int64(13+12+len("SF:a.c\nLF:2\nLH:1\nend_of_record\n")+8) {
		t.Errorf("skipped %v, bytes %d", collection.Skipped, collection.Bytes())
	}
}

// TestCollectCutsAFilePastThePerFileCapAndSaysSo: an oversize file is sent as its head, with a
// checksum of exactly that head and a truncation note — never dropped.
func TestCollectCutsAFilePastThePerFileCapAndSaysSo(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	write(t, root, "rig.csv", strings.Repeat("x", 3000))

	collection, err := Collect(root, []string{"*.csv"}, Limits{MaxFileBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}

	file := collection.Files[0]
	if file.Size != 1024 || file.Checksum != sum(strings.Repeat("x", 1024)) {
		t.Fatalf("the truncated file: %+v", file)
	}
	if file.Truncated == nil || file.Truncated.OriginalBytes != 3000 ||
		file.Truncated.Note != "cut at 1 KiB of 2.9 KiB (per-file cap)" {
		t.Fatalf("the truncation: %+v", file.Truncated)
	}
}

// TestCollectSkipsPastTheJobCapAndTheFileLimitWithReasons: what does not fit is listed, with the
// reason, rather than left out.
func TestCollectSkipsPastTheJobCapAndTheFileLimitWithReasons(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	write(t, root, "a.log", strings.Repeat("a", 600))
	write(t, root, "b.log", strings.Repeat("b", 600))
	write(t, root, "c.log", "c")
	write(t, root, "d.log", "d")

	collection, err := Collect(root, []string{"*.log"}, Limits{MaxJobBytes: 1000, MaxFiles: 2})
	if err != nil {
		t.Fatal(err)
	}

	if got := names(collection.Files); strings.Join(got, ",") != "a.log,c.log" {
		t.Fatalf("sent %v", got)
	}
	if len(collection.Skipped) != 2 {
		t.Fatalf("skipped %+v", collection.Skipped)
	}
	jobCap, maxFiles := collection.Skipped[0], collection.Skipped[1]
	if jobCap.Name != "b.log" || jobCap.Reason != SkipJobCap || jobCap.SizeBytes != 600 ||
		jobCap.Detail != "the job's 1000 B upload cap was reached" {
		t.Errorf("the job-cap skip: %+v", jobCap)
	}
	if maxFiles.Name != "d.log" || maxFiles.Reason != SkipMaxFiles {
		t.Errorf("the file-limit skip: %+v", maxFiles)
	}
}

// TestCollectNeverFollowsALinkOutOfTheWorkspace: a matched symlink is listed as skipped, its
// target never read — to a file outside the workspace or inside it — and a symlinked directory
// is not walked.
func TestCollectNeverFollowsALinkOutOfTheWorkspace(t *testing.T) {
	t.Parallel()
	outside := t.TempDir()
	secret := write(t, outside, "secret.log", "the host's secret")
	write(t, outside, "dir/junit.xml", "<testsuite/>")
	root := t.TempDir()
	if err := os.Symlink(secret, filepath.Join(root, "stolen.log")); err != nil {
		t.Skipf("symlinks are not available here: %v", err)
	}
	if err := os.Symlink(filepath.Join(outside, "dir"), filepath.Join(root, "linked")); err != nil {
		t.Fatal(err)
	}

	collection, err := Collect(root, []string{"*.log", "**/junit*.xml"}, Limits{})
	if err != nil {
		t.Fatal(err)
	}

	if len(collection.Files) != 0 {
		t.Fatalf("a link was followed: %+v", collection.Files)
	}
	if len(collection.Skipped) != 1 || collection.Skipped[0].Name != "stolen.log" ||
		collection.Skipped[0].Reason != SkipNotRegular {
		t.Fatalf("skipped %+v", collection.Skipped)
	}
}

// TestCollectListsAFileItCannotRead: an unreadable file is a skip with the operating system's
// reason, not an error that loses the rest.
func TestCollectListsAFileItCannotRead(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("permissions do not bind this user")
	}
	root := t.TempDir()
	locked := write(t, root, "locked.log", "no")
	write(t, root, "open.log", "yes")
	if err := os.Chmod(locked, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o600) })

	collection, err := Collect(root, []string{"*.log"}, Limits{})
	if err != nil {
		t.Fatal(err)
	}

	if got := names(collection.Files); strings.Join(got, ",") != "open.log" {
		t.Fatalf("sent %v", got)
	}
	if collection.Skipped[0].Reason != SkipUnreadable ||
		collection.Skipped[0].Detail != "it could not be read: permission denied" {
		t.Fatalf("skipped %+v", collection.Skipped)
	}
}

// TestCollectListsAFileWhoseNameCannotBeAnArtifactName: a backslash or a control character in a
// file name is listed under a safe spelling, never sent under one the control plane refuses.
func TestCollectListsAFileWhoseNameCannotBeAnArtifactName(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("these names cannot exist here")
	}
	root := t.TempDir()
	write(t, root, `a\b.log`, "x")
	write(t, root, "tab\there.log", "y")

	collection, err := Collect(root, []string{"*.log"}, Limits{})
	if err != nil {
		t.Fatal(err)
	}

	if len(collection.Files) != 0 || len(collection.Skipped) != 2 {
		t.Fatalf("collected %+v", collection)
	}
	for _, skip := range collection.Skipped {
		if skip.Reason != SkipOutsideWorkspace || !validName(skip.Name) {
			t.Errorf("skip %+v", skip)
		}
	}
}

// TestCollectBoundsTheSkippedList: a glob that matches thousands of files past the cap lists
// MaxSkipped of them, the last saying how many more there were.
func TestCollectBoundsTheSkippedList(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	// One is sent, and 1004 are skipped: 1000 are listed, the last naming the 4 more.
	for index := range MaxSkipped + 5 {
		write(t, root, fmt.Sprintf("f%05d.log", index), "x")
	}

	collection, err := Collect(root, []string{"*.log"}, Limits{MaxFiles: 1})
	if err != nil {
		t.Fatal(err)
	}

	if len(collection.Files) != 1 || len(collection.Skipped) != MaxSkipped {
		t.Fatalf("sent %d, skipped %d", len(collection.Files), len(collection.Skipped))
	}
	if last := collection.Skipped[MaxSkipped-1]; last.Detail != "and 4 more matching files were not listed" {
		t.Fatalf("the last skip: %+v", last)
	}
}

// TestCollectRefusesARootThatIsNotADirectory: nothing to walk is an error, not an empty upload.
func TestCollectRefusesARootThatIsNotADirectory(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	file := write(t, root, "a.log", "x")

	if _, err := Collect(filepath.Join(root, "missing"), []string{"*"}, Limits{}); err == nil {
		t.Error("a missing root was collected")
	}
	if _, err := Collect(file, []string{"*"}, Limits{}); err == nil {
		t.Error("a file was collected as a root")
	}
}

// TestHumanBytes is the page's spelling of a size.
func TestHumanBytes(t *testing.T) {
	t.Parallel()
	for n, want := range map[int64]string{812: "812 B", 1024: "1 KiB", 2202009: "2.1 MiB", 67108864: "64 MiB"} {
		if got := humanBytes(n); got != want {
			t.Errorf("humanBytes(%d) = %q, want %q", n, got, want)
		}
	}
}
