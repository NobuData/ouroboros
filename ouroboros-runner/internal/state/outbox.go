package state

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// frameSuffix is an outbox file's extension. The name before it is the frame's envelope
// id, which is a ULID — so the files sort in the order the frames were minted, and a
// directory listing is the re-send order.
const frameSuffix = ".frame"

// Outbox is the sender's half of resume (docs/RUNNER_PROTOCOL.md § 5), made durable.
//
// [conn.Outbox] holds unacknowledged terminal frames in memory, which survives a dropped
// socket. This survives the PROCESS: a job.finish written to a socket that died, by an
// agent that was then killed, is still re-sent — byte for byte, envelope id included —
// by the agent that starts next. Each frame is a file named for its envelope id, written
// atomically before the frame is handed to a socket and removed after its receipt.
//
// Add persists before it queues, and Receipt forgets before it deletes. So a crash at any
// point leaves a frame either still on disk — re-sent, and deduplicated by the gateway's
// ledger if it had already arrived — or receipted and gone. There is no point at which a
// frame the gateway has not acknowledged exists only in memory.
type Outbox struct {
	mu     sync.Mutex
	dir    string
	memory *conn.Outbox
}

// Outbox opens the directory's outbox and loads every frame a previous process left.
//
// A file that is not a legal terminal frame named for its own id is moved aside to
// `<name>.invalid` rather than re-sent or deleted, and reported in the second return
// value for the caller to log: a frame this agent cannot vouch for must not reach the
// gateway, and a frame nobody can see was discarded is a job result lost silently.
func (d *Dir) Outbox() (*Outbox, []string, error) {
	outbox := &Outbox{dir: d.join(outboxDir), memory: conn.NewOutbox()}

	entries, err := os.ReadDir(outbox.dir)
	if err != nil {
		return nil, nil, fmt.Errorf("read the outbox: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Type().IsRegular() && strings.HasSuffix(entry.Name(), frameSuffix) {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)

	var problems []string
	for _, name := range names {
		id := strings.TrimSuffix(name, frameSuffix)
		path := filepath.Join(outbox.dir, name)
		frame, problem := readFrame(path, id)
		if problem != "" {
			problems = append(problems, fmt.Sprintf("%s: %s; moved aside to %s.invalid", name, problem, name))
			if err := os.Rename(path, path+".invalid"); err != nil {
				return nil, nil, fmt.Errorf("move aside %s: %w", name, err)
			}
			continue
		}
		outbox.memory.Add(id, frame)
	}
	return outbox, problems, nil
}

// readFrame reads one outbox file and says what is wrong with it, if anything.
func readFrame(path, id string) ([]byte, string) {
	if !conn.ValidID(id) {
		return nil, "the name is not an envelope id"
	}
	frame, err := os.ReadFile(path) // #nosec G304 -- a ULID-named file in the outbox
	if err != nil {
		return nil, err.Error()
	}
	envelope, diags := conn.Decode(frame)
	switch {
	case len(diags) > 0:
		return nil, fmt.Sprintf("not a legal frame (%s at %q)", diags[0].Code, diags[0].Path)
	case !envelope.Type.Terminal():
		return nil, fmt.Sprintf("a %s frame is not terminal", envelope.Type)
	case envelope.ID != id:
		return nil, fmt.Sprintf("the frame's id is %s", envelope.ID)
	}
	return frame, ""
}

// Add persists a terminal frame and queues it for delivery. The frame must be the exact
// bytes that will be written to the socket, and its envelope id must be id.
func (o *Outbox) Add(id string, frame []byte) error {
	if !conn.ValidID(id) {
		return fmt.Errorf("refusing to queue a frame under %q, which is not an envelope id", id)
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if err := writeAtomic(filepath.Join(o.dir, id+frameSuffix), frame); err != nil {
		return fmt.Errorf("persist terminal frame %s: %w", id, err)
	}
	o.memory.Add(id, frame)
	return nil
}

// Receipt stops re-sending a frame and deletes its file. A receipt for a frame that is
// not pending is ignored — it is what a receipt duplicated by a reconnect looks like.
func (o *Outbox) Receipt(id string) error {
	if !conn.ValidID(id) {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.memory.Receipt(id)
	if err := os.Remove(filepath.Join(o.dir, id+frameSuffix)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("forget receipted frame %s: %w", id, err)
	}
	return nil
}

// Entries is every unacknowledged frame, in mint order, with its id.
func (o *Outbox) Entries() []conn.OutboxEntry { return o.memory.Entries() }

// Len is how many frames are waiting for a receipt.
func (o *Outbox) Len() int { return o.memory.Len() }
