package artifacts

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// The reasons a collected file is listed but not sent — the manifest's `skipped[].reason`
// vocabulary, which the control plane validates.
const (
	// SkipJobCap is a file past the per-job byte cap.
	SkipJobCap = "job_cap"
	// SkipMaxFiles is a file past the per-job file limit.
	SkipMaxFiles = "max_files"
	// SkipUnreadable is a file this agent could not open or read.
	SkipUnreadable = "unreadable"
	// SkipNotRegular is a match that is not a regular file — a symlink, a device, a socket.
	SkipNotRegular = "not_regular_file"
	// SkipOutsideWorkspace is a match whose name cannot be carried as an artifact name.
	SkipOutsideWorkspace = "outside_workspace"
)

// NameMaxLength is the longest artifact name the control plane registers.
const NameMaxLength = 255

// MaxSkipped is the most skipped entries one manifest lists.
const MaxSkipped = 1000

// Limits are the caps an offer's upload carries.
type Limits struct {
	// MaxFileBytes is the per-file cap: a larger file is sent cut to it, marked truncated.
	MaxFileBytes int64
	// MaxJobBytes is the per-job cap on everything sent: files past it are skipped.
	MaxJobBytes int64
	// MaxFiles is the most files sent: matches past it are skipped.
	MaxFiles int
}

// File is one collected file that will be sent.
type File struct {
	// Name is its path relative to the collection root, slash-separated — its manifest name.
	Name string
	// Path is where it is on this machine.
	Path string
	// Size is how many bytes are sent: the whole file, or the cap when it was truncated.
	Size int64
	// Checksum is `sha256:<hex>` of exactly those bytes.
	Checksum string
	// Truncated is set when the file was longer than the per-file cap.
	Truncated *Truncation
}

// Truncation is the manifest's word that a file was cut short.
type Truncation struct {
	OriginalBytes int64  `json:"original_bytes"`
	Note          string `json:"note"`
}

// Skip is one matched file that is not sent, and why.
type Skip struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"size_bytes"`
	Reason    string `json:"reason"`
	Detail    string `json:"detail"`
}

// Collection is everything the globs matched: what is sent and what is not.
type Collection struct {
	Files   []File
	Skipped []Skip
}

// Bytes is the total that will be sent.
func (c Collection) Bytes() int64 {
	var total int64
	for _, file := range c.Files {
		total += file.Size
	}
	return total
}

// candidate is a match, before the caps are applied.
type candidate struct {
	name  string
	path  string
	glob  int
	entry fs.DirEntry
}

// Collect finds what the globs match under root, applies the caps and checksums what will be
// sent.
//
// Files are ordered by the first glob that matched them, then by name — so the built-in result
// globs, which an offer lists first, are never crowded out of the per-job cap by a capture a
// later glob matched. A directory is walked, never followed through a symlink; a matched
// symlink is listed as skipped rather than read, so no glob can reach outside root.
func Collect(root string, globs []string, limits Limits) (Collection, error) {
	root = filepath.Clean(root)
	info, err := os.Stat(root)
	if err != nil {
		return Collection{}, fmt.Errorf("the collection root cannot be read: %w", err)
	}
	if !info.IsDir() {
		return Collection{}, fmt.Errorf("the collection root %s is not a directory", root)
	}

	var candidates []candidate
	walkErr := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			// An unreadable directory is skipped whole; its files cannot be listed by name.
			if entry != nil && entry.IsDir() && path != root {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		// WalkDir hands back paths under root, so the prefix is always there.
		rel, _ := strings.CutPrefix(path, root+string(filepath.Separator))
		name := filepath.ToSlash(rel)
		for index, glob := range globs {
			if Match(glob, name) {
				candidates = append(candidates, candidate{name: name, path: path, glob: index, entry: entry})
				break
			}
		}
		return nil
	})
	if walkErr != nil {
		return Collection{}, fmt.Errorf("the collection root could not be walked: %w", walkErr)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].glob != candidates[j].glob {
			return candidates[i].glob < candidates[j].glob
		}
		return candidates[i].name < candidates[j].name
	})

	var collection Collection
	var sent int64
	for _, match := range candidates {
		size := sizeOf(match.entry)
		if !validName(match.name) {
			collection.skip(Skip{Name: safeName(match.name), SizeBytes: size, Reason: SkipOutsideWorkspace,
				Detail: "its path cannot be carried as an artifact name"})
			continue
		}
		if !match.entry.Type().IsRegular() {
			collection.skip(Skip{Name: match.name, SizeBytes: size, Reason: SkipNotRegular,
				Detail: "it is not a regular file, and a link is never followed out of the workspace"})
			continue
		}
		if limits.MaxFiles > 0 && len(collection.Files) >= limits.MaxFiles {
			collection.skip(Skip{Name: match.name, SizeBytes: size, Reason: SkipMaxFiles,
				Detail: fmt.Sprintf("the job's limit of %d files was reached", limits.MaxFiles)})
			continue
		}

		send := size
		var truncated *Truncation
		if limits.MaxFileBytes > 0 && size > limits.MaxFileBytes {
			send = limits.MaxFileBytes
			truncated = &Truncation{OriginalBytes: size, Note: fmt.Sprintf("cut at %s of %s (per-file cap)",
				humanBytes(send), humanBytes(size))}
		}
		if limits.MaxJobBytes > 0 && sent+send > limits.MaxJobBytes {
			collection.skip(Skip{Name: match.name, SizeBytes: size, Reason: SkipJobCap,
				Detail: fmt.Sprintf("the job's %s upload cap was reached", humanBytes(limits.MaxJobBytes))})
			continue
		}

		checksum, err := checksumHead(match.path, send)
		if err != nil {
			collection.skip(Skip{Name: match.name, SizeBytes: size, Reason: SkipUnreadable,
				Detail: "it could not be read: " + reasonOf(err)})
			continue
		}
		sent += send
		collection.Files = append(collection.Files, File{Name: match.name, Path: match.path, Size: send,
			Checksum: checksum, Truncated: truncated})
	}
	return collection, nil
}

// skip lists a file that is not sent, up to MaxSkipped; the last listed entry then says how
// many more there were, so even a runaway glob is accounted for.
func (c *Collection) skip(entry Skip) {
	switch {
	case len(c.Skipped) < MaxSkipped:
		c.Skipped = append(c.Skipped, entry)
	default:
		last := &c.Skipped[MaxSkipped-1]
		more := 1
		if n, ok := strings.CutPrefix(last.Detail, "and "); ok {
			if _, err := fmt.Sscanf(n, "%d", &more); err == nil {
				more++
			}
		}
		last.Detail = fmt.Sprintf("and %d more matching files were not listed", more)
	}
}

// checksumHead is `sha256:<hex>` of the first n bytes of a file, which must have that many.
func checksumHead(path string, n int64) (string, error) {
	file, err := os.Open(path) // #nosec G304 -- a regular file this walk found under the collection root
	if err != nil {
		return "", err
	}
	defer func() { _ = file.Close() }()

	hash := sha256.New()
	copied, err := io.Copy(hash, io.LimitReader(file, n))
	if err != nil {
		return "", err
	}
	if copied != n {
		return "", fmt.Errorf("it shrank from %d to %d bytes while being read", n, copied)
	}
	return "sha256:" + hex.EncodeToString(hash.Sum(nil)), nil
}

// sizeOf is a directory entry's size, or 0 when it cannot be read.
func sizeOf(entry fs.DirEntry) int64 {
	info, err := entry.Info()
	if err != nil || !info.Mode().IsRegular() {
		return 0
	}
	return info.Size()
}

// validName is the control plane's artifact name rule: 1–255 characters, no backslash, no
// control character, no surrounding space, no empty, `.` or `..` segment.
func validName(name string) bool {
	if name == "" || len([]rune(name)) > NameMaxLength || strings.TrimSpace(name) != name ||
		strings.ContainsRune(name, '\\') || strings.ContainsFunc(name, unicode.IsControl) {
		return false
	}
	for _, segment := range strings.Split(name, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

// safeName is a name the manifest can carry for a file whose own name it cannot: every
// character the rule refuses replaced, bounded to the length the rule allows.
func safeName(name string) string {
	cleaned := strings.Map(func(r rune) rune {
		if r == '\\' || unicode.IsControl(r) {
			return '_'
		}
		return r
	}, strings.TrimSpace(name))
	runes := []rune(cleaned)
	if len(runes) > NameMaxLength {
		runes = runes[:NameMaxLength]
	}
	if len(runes) == 0 {
		return "_"
	}
	return string(runes)
}

// reasonOf is an error's last word, for a skip's detail: the operating system's sentence,
// without the path the agent already names.
func reasonOf(err error) string {
	var pathErr *fs.PathError
	if errors.As(err, &pathErr) {
		return pathErr.Err.Error()
	}
	return err.Error()
}

// humanBytes renders a byte count the way the page prints one — 64 MiB, 2.1 MiB, 812 B.
func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	value, suffix := float64(n), []string{"KiB", "MiB", "GiB", "TiB"}
	index := -1
	for value >= unit && index < len(suffix)-1 {
		value /= unit
		index++
	}
	if value == float64(int64(value)) {
		return fmt.Sprintf("%d %s", int64(value), suffix[index])
	}
	return fmt.Sprintf("%.1f %s", value, suffix[index])
}
