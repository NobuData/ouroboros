// Package state is the agent's state directory: what it is, what it holds, and the
// rules that keep a private key in it rather than anywhere else.
//
// It is the one place on the customer's machine where this agent writes anything, and
// everything in it is the runner's identity or the runner's unfinished business:
//
//	<state>/
//	├── .lock           held for as long as an `enroll` or a `run` is using the directory
//	├── runner.json     who this runner is — ids, names, dates, the farm CA. NO secrets
//	├── identity.pem    the client certificate AND its private key, in one file     (0600)
//	├── bearer.token    bearer-fallback mode only: the long-lived secret            (0600)
//	├── session         the last session the gateway granted, for `hello.resume`    (0600)
//	└── outbox/         terminal frames sent and not yet receipted, one file each   (0700)
//
// Three rules, and each is enforced here rather than advised:
//
//   - EVERY FILE IS 0600 AND THE DIRECTORY IS 0700. A file is created with those modes
//     and then chmodded to them explicitly, so a permissive umask cannot widen them.
//   - EVERY WRITE IS ATOMIC. A temporary file in the same directory, fsynced, renamed
//     over the target, and the directory fsynced — so a power cut leaves the old file or
//     the new one, never half of either.
//   - THE KEY AND ITS CERTIFICATE ARE ONE FILE. A renewal replaces both, and two files
//     replaced by two renames can be left disagreeing by a crash between them; one file
//     replaced by one rename cannot. The combined PEM is also what `curl --cert` and most
//     TLS tooling read, so an operator can exercise the identity by hand.
//
// The private key is never logged and never leaves this directory. This package is the
// only code that writes it, and it writes it here.
package state

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// The directory's entries.
const (
	lockFile     = ".lock"
	recordFile   = "runner.json"
	identityFile = "identity.pem"
	bearerFile   = "bearer.token"
	sessionFile  = "session"
	outboxDir    = "outbox"

	// tempPrefix marks a write in progress. A leftover one is a write a crash
	// interrupted, and Open removes it.
	tempPrefix = ".tmp-"
)

// The modes. Named, because gosec is right to ask about every file mode in a program
// that writes a private key, and a constant is an answer it can read.
const (
	dirMode  os.FileMode = 0o700
	fileMode os.FileMode = 0o600
)

// ErrLocked is returned by [Open] when another process is using the directory.
var ErrLocked = errors.New("another ouroboros-runner is using this state directory")

// Dir is an open state directory. Open holds an exclusive lock on it until Close.
type Dir struct {
	path string
	lock *os.File
}

// Open opens the state directory at path, creating it 0700 if it does not exist, and
// takes its lock.
//
// The lock is what stops two agents sharing one identity: two processes presenting the
// same certificate and re-sending the same outbox would be one runner connected twice,
// and a second enrollment into a directory an agent is running from would replace the
// identity under it. It is an advisory flock, released by the kernel when the process
// exits however it exits, so a crash never leaves the directory locked.
//
// Open also removes temporary files a crash left behind.
func Open(path string) (*Dir, error) {
	if path == "" {
		return nil, errors.New("no state directory given")
	}
	if err := os.MkdirAll(path, dirMode); err != nil {
		return nil, fmt.Errorf("create the state directory %s: %w", path, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("read the state directory %s: %w", path, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("the state directory %s is not a directory", path)
	}

	lock, err := os.OpenFile(filepath.Join(path, lockFile), os.O_CREATE|os.O_RDWR, fileMode) // #nosec G304 -- the operator's own state directory
	if err != nil {
		return nil, fmt.Errorf("open the state directory's lock: %w", err)
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil { // #nosec G115 -- a file descriptor fits an int
		_ = lock.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, fmt.Errorf("%w: %s", ErrLocked, path)
		}
		return nil, fmt.Errorf("lock the state directory %s: %w", path, err)
	}

	dir := &Dir{path: path, lock: lock}
	if err := os.MkdirAll(dir.join(outboxDir), dirMode); err != nil {
		_ = dir.Close()
		return nil, fmt.Errorf("create the outbox: %w", err)
	}
	for _, sub := range []string{path, dir.join(outboxDir)} {
		if err := removeTemporaries(sub); err != nil {
			_ = dir.Close()
			return nil, err
		}
	}
	return dir, nil
}

// Close releases the lock.
func (d *Dir) Close() error {
	if d.lock == nil {
		return nil
	}
	err := d.lock.Close()
	d.lock = nil
	return err
}

// Path is the directory.
func (d *Dir) Path() string { return d.path }

// join is a path inside the directory.
func (d *Dir) join(parts ...string) string {
	return filepath.Join(append([]string{d.path}, parts...)...)
}

// writeFile replaces a file inside the directory atomically, with mode 0600.
func (d *Dir) writeFile(name string, data []byte) error {
	return writeAtomic(d.join(name), data)
}

// readFile reads a file inside the directory.
func (d *Dir) readFile(name string) ([]byte, error) {
	return os.ReadFile(d.join(name)) // #nosec G304 -- a fixed name inside the state directory
}

// exists reports whether a file inside the directory exists.
func (d *Dir) exists(name string) (bool, error) {
	_, err := os.Stat(d.join(name))
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, os.ErrNotExist):
		return false, nil
	default:
		return false, err
	}
}

// writeAtomic writes data to path through a temporary file in the same directory:
// create 0600, write, fsync, chmod 0600, rename over the target, fsync the directory.
//
// The explicit chmod is the belt to the create mode's braces. os.CreateTemp already
// creates 0600, and umask can only remove bits — but "the mode is 0600" is the claim
// this package exists to make, so it is made by a call rather than by an argument
// about umask.
func writeAtomic(path string, data []byte) (err error) {
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, tempPrefix+filepath.Base(path)+"-*")
	if err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	tempPath := temp.Name()
	defer func() {
		if err != nil {
			_ = temp.Close()
			_ = os.Remove(tempPath)
		}
	}()

	if err = temp.Chmod(fileMode); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	if _, err = temp.Write(data); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	if err = temp.Sync(); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	if err = temp.Close(); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	if err = os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return syncDir(dir)
}

// syncDir makes a rename inside a directory durable.
func syncDir(path string) error {
	dir, err := os.Open(path) // #nosec G304 -- a directory this package created
	if err != nil {
		return fmt.Errorf("sync %s: %w", path, err)
	}
	defer dir.Close()
	if err := dir.Sync(); err != nil {
		return fmt.Errorf("sync %s: %w", path, err)
	}
	return nil
}

// removeTemporaries deletes writes a crash interrupted.
func removeTemporaries(path string) error {
	entries, err := os.ReadDir(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), tempPrefix) {
			if err := os.Remove(filepath.Join(path, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove an interrupted write %s: %w", entry.Name(), err)
			}
		}
	}
	return nil
}
