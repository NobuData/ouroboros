package exec

import (
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// workspaceMode is a workspace's mode: the agent's user, and nobody else. A shell job runs
// as that user; a container job reaches it through a bind mount.
const workspaceMode fs.FileMode = 0o700

// Workspaces is where jobs run: one fresh directory per job under Root, and the policy
// that decides whether it is removed afterwards.
//
// The directory is `<Root>/<job id>` — with Root at `<state-dir>/work`, the path the
// protocol's own `job.start` example reports — so an operator reading a failed job's
// `workspace` in the farm page can walk straight to it.
type Workspaces struct {
	// Root is the directory every workspace is created in. It is created 0700 if missing.
	Root string

	// KeepOnFailure leaves the workspace of a job that failed, timed out or errored in
	// place for diagnosis, because a failed firmware build is often only diagnosable from
	// what it left behind. Off by default: a workspace is removed however its job ended.
	// A succeeded or cancelled job's workspace is always removed.
	KeepOnFailure bool
}

// Create makes a job's workspace, empty.
//
// A directory already there — left by an earlier attempt of the same job that was kept
// for diagnosis, or by an agent that died mid-job — is replaced: a job always starts in an
// empty workspace, never in the leftovers of another run of itself. The caller logs that
// it happened, because it means a kept workspace is gone.
//
// It returns the workspace's path, whether an old one was replaced, and an error for a job
// id that is not one (it names a directory, so it is checked rather than trusted) or a
// directory that cannot be made.
func (w *Workspaces) Create(job string) (dir string, replaced bool, err error) {
	if !conn.ValidJobID(job) {
		return "", false, fmt.Errorf("%q is not a job id, and a workspace is named for one", job)
	}
	if err := os.MkdirAll(w.Root, workspaceMode); err != nil {
		return "", false, fmt.Errorf("create the workspace root %s: %w", w.Root, err)
	}
	dir = filepath.Join(w.Root, job)
	if _, err := os.Lstat(dir); err == nil {
		if err := removeTree(dir); err != nil {
			return "", false, fmt.Errorf("replace the old workspace %s: %w", dir, err)
		}
		replaced = true
	}
	if err := os.Mkdir(dir, workspaceMode); err != nil {
		return "", false, fmt.Errorf("create the workspace %s: %w", dir, err)
	}
	// Explicitly, so a permissive umask cannot widen it.
	if err := os.Chmod(dir, workspaceMode); err != nil {
		return "", false, fmt.Errorf("restrict the workspace %s: %w", dir, err)
	}
	return dir, replaced, nil
}

// Keeps reports whether a job that ended with this outcome leaves its workspace behind.
func (w *Workspaces) Keeps(outcome string) bool {
	if !w.KeepOnFailure {
		return false
	}
	switch outcome {
	case conn.OutcomeFailed, conn.OutcomeTimedOut, conn.OutcomeErrored:
		return true
	default:
		return false
	}
}

// Finish applies the cleanup policy to a finished job's workspace: removed, unless
// [Workspaces.Keeps] says this outcome keeps it. It reports whether the workspace was kept,
// and an error when a removal failed — which leaves the directory for the operator, and
// which the caller logs with its path.
func (w *Workspaces) Finish(dir, outcome string) (kept bool, err error) {
	if dir == "" {
		return false, nil
	}
	if w.Keeps(outcome) {
		return true, nil
	}
	return false, removeTree(dir)
}

// removeTree removes a directory and everything in it.
//
// A build can leave directories it made read-only — Go's module cache does exactly that —
// and os.RemoveAll cannot empty a directory it may not write. So a first failure is followed
// by making every directory in the tree writable by its owner ([unlockTree]) and trying
// again.
func removeTree(dir string) error {
	if err := os.RemoveAll(dir); err == nil {
		return nil
	}
	unlockTree(dir)
	return os.RemoveAll(dir)
}

// unlockTree makes every directory under dir writable by its owner, so its entries can be
// removed.
//
// It works through an [os.Root] opened at dir, so no path it follows can lead outside the
// workspace: a job that left a symlink to the agent's state directory — or swapped one in
// while the walk ran — gets nothing chmodded but its own files. Each directory is changed
// through its open descriptor rather than by name, so there is no window between checking
// what a path is and changing it. Symlinks are never descended through: WalkDir reports
// them as what they are.
func unlockTree(dir string) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return
	}
	defer func() { _ = root.Close() }()
	// An entry that cannot be read or opened is skipped rather than ending the walk: the
	// RemoveAll after this reports whatever is left.
	_ = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr == nil && entry.IsDir() {
			if directory, openErr := root.Open(name); openErr == nil {
				// #nosec G122 G302 -- through the os.Root's descriptor, so no symlink can take
				// it outside the workspace; 0700 only so the directory can be emptied.
				_ = directory.Chmod(workspaceMode)
				_ = directory.Close()
			}
		}
		return nil
	})
}

// ResolveWorkdir is where a SHELL job's command runs: the offer's `workdir`, resolved
// inside the job's workspace.
//
// The server never picks a host directory. A leading `/` names the workspace root, so
// `/Users/builder/work` is `<workspace>/Users/builder/work` and `/` is the workspace itself;
// a relative workdir is relative to the same root. A `..` anywhere is refused rather than
// cleaned away, because a workdir that tries to leave the workspace is a dispatcher
// mistake worth reporting, not a path to quietly repair.
//
// It returns the absolute directory, or a *[Failure] with [CodeWorkspaceInvalid].
func ResolveWorkdir(workspace, workdir string) (string, error) {
	if err := refuseDotDot(workdir); err != nil {
		return "", err
	}
	inside := filepath.Clean(string(filepath.Separator) + filepath.FromSlash(workdir))
	return filepath.Join(workspace, inside), nil
}

// ContainerWorkdir is where a CONTAINER job's command runs, and where its workspace is
// bind-mounted: the offer's `workdir`, which names a path inside the container.
//
// It must be absolute — a container's working directory has no "relative to" — and it may
// not be `/` (mounting the workspace over the image's root would leave nothing to run) or
// carry a `..`, which the mount would resolve somewhere the offer did not say. A `:` is
// refused too, because a bind is written `host:container` and one more colon would make
// it a different bind.
//
// It returns the cleaned path, or a *[Failure] with [CodeWorkspaceInvalid].
func ContainerWorkdir(workdir string) (string, error) {
	if err := refuseDotDot(workdir); err != nil {
		return "", err
	}
	cleaned := path.Clean(workdir)
	switch {
	case !path.IsAbs(workdir):
		return "", failure(CodeWorkspaceInvalid, fmt.Sprintf("a container job's workdir must be absolute; %q is not", workdir))
	case cleaned == "/":
		return "", failure(CodeWorkspaceInvalid, "a container job's workdir cannot be /: the workspace would be mounted over the image's root")
	case strings.Contains(workdir, ":"):
		return "", failure(CodeWorkspaceInvalid, fmt.Sprintf("a container job's workdir cannot contain ':'; %q does", workdir))
	}
	return cleaned, nil
}

// refuseDotDot refuses a workdir with a `..` element, in either separator.
func refuseDotDot(workdir string) error {
	for _, element := range strings.FieldsFunc(workdir, func(r rune) bool { return r == '/' || r == '\\' }) {
		if element == ".." {
			return failure(CodeWorkspaceInvalid,
				fmt.Sprintf("the workdir %q leaves the job's workspace, and a job may not choose a directory outside it", workdir))
		}
	}
	return nil
}
