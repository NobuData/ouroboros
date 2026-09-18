package ws

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// The codec, over an in-memory pipe.
//
// net.Pipe is a synchronous full-duplex connection with no buffering, so each test
// drives one end with a real Conn and the other with raw bytes it composed by hand —
// which is how a malformed frame, a masking violation or a fragmented message can be
// sent at all. A library's own encoder would refuse to produce them.

// pipe is one end driven by a Conn, and the raw other end.
type pipe struct {
	conn *Conn
	raw  net.Conn
	rawR *bufio.Reader
}

// newPipe returns a Conn playing the given role, and the raw peer.
func newPipe(t *testing.T, client bool) *pipe {
	t.Helper()
	near, far := net.Pipe()
	t.Cleanup(func() {
		_ = near.Close()
		_ = far.Close()
	})
	return &pipe{
		conn: newConn(near, bufio.NewReader(near), client),
		raw:  far,
		rawR: bufio.NewReader(far),
	}
}

// rawFrame composes a frame byte by byte. mask decides whether a masking key is
// applied, which is how a test sends a frame masked the wrong way round.
func rawFrame(fin bool, opcode byte, payload []byte, mask bool) []byte {
	first := opcode
	if fin {
		first |= 0x80
	}
	frame := []byte{first}
	maskBit := byte(0)
	if mask {
		maskBit = 0x80
	}
	switch n := len(payload); {
	case n <= 125:
		frame = append(frame, maskBit|byte(n))
	case n <= 0xFFFF:
		frame = append(frame, maskBit|126)
		frame = binary.BigEndian.AppendUint16(frame, uint16(n))
	default:
		frame = append(frame, maskBit|127)
		frame = binary.BigEndian.AppendUint64(frame, uint64(n))
	}
	body := append([]byte(nil), payload...)
	if mask {
		key := [4]byte{1, 2, 3, 4}
		frame = append(frame, key[:]...)
		maskBytes(key, body)
	}
	return append(frame, body...)
}

// send writes raw bytes from the far end without blocking the test.
func (p *pipe) send(t *testing.T, frames ...[]byte) {
	t.Helper()
	go func() {
		for _, frame := range frames {
			if _, err := p.raw.Write(frame); err != nil {
				return
			}
		}
	}()
}

// readRaw reads one frame the Conn wrote, unmasking it if it was masked.
func (p *pipe) readRaw(t *testing.T) (opcode byte, payload []byte, masked bool) {
	t.Helper()
	_ = p.raw.SetReadDeadline(time.Now().Add(5 * time.Second))
	var fixed [2]byte
	if _, err := io.ReadFull(p.rawR, fixed[:]); err != nil {
		t.Fatalf("read a frame header: %v", err)
	}
	opcode = fixed[0] & 0x0F
	masked = fixed[1]&0x80 != 0
	length := uint64(fixed[1] & 0x7F)
	switch length {
	case 126:
		var ext [2]byte
		_, _ = io.ReadFull(p.rawR, ext[:])
		length = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		_, _ = io.ReadFull(p.rawR, ext[:])
		length = binary.BigEndian.Uint64(ext[:])
	}
	var key [4]byte
	if masked {
		_, _ = io.ReadFull(p.rawR, key[:])
	}
	payload = make([]byte, length)
	if _, err := io.ReadFull(p.rawR, payload); err != nil {
		t.Fatalf("read a frame payload: %v", err)
	}
	if masked {
		maskBytes(key, payload)
	}
	return opcode, payload, masked
}

// readAsync runs ReadMessage on the Conn and delivers its result.
func (p *pipe) readAsync() <-chan readResult {
	out := make(chan readResult, 1)
	go func() {
		message, err := p.conn.ReadMessage()
		out <- readResult{message, err}
	}()
	return out
}

type readResult struct {
	message []byte
	err     error
}

func wait(t *testing.T, results <-chan readResult) readResult {
	t.Helper()
	select {
	case result := <-results:
		return result
	case <-time.After(5 * time.Second):
		t.Fatal("ReadMessage did not return")
		return readResult{}
	}
}

// expectClose reads the close frame the Conn wrote in answer to a violation and checks
// its code.
func (p *pipe) expectClose(t *testing.T, code int) {
	t.Helper()
	opcode, payload, _ := p.readRaw(t)
	if opcode != opClose {
		t.Fatalf("expected a close frame, got opcode %#x", opcode)
	}
	if got := int(binary.BigEndian.Uint16(payload)); got != code {
		t.Errorf("expected close code %d, got %d (%s)", code, got, payload[2:])
	}
}

func TestClientReadsAServerTextFrame(t *testing.T) {
	p := newPipe(t, true)
	results := p.readAsync()
	p.send(t, rawFrame(true, opText, []byte(`{"v":1}`), false))

	result := wait(t, results)
	if result.err != nil || string(result.message) != `{"v":1}` {
		t.Fatalf("got %q, %v", result.message, result.err)
	}
}

// TestClientMasksEveryFrame is RFC 6455 § 5.3: a client MUST mask. A proxy between the
// agent and the gateway is the reason the rule exists.
func TestClientMasksEveryFrame(t *testing.T) {
	p := newPipe(t, true)
	go func() { _ = p.conn.WriteText([]byte("hello")) }()

	opcode, payload, masked := p.readRaw(t)
	if opcode != opText || string(payload) != "hello" {
		t.Errorf("got opcode %#x payload %q", opcode, payload)
	}
	if !masked {
		t.Error("a client frame went out unmasked")
	}
}

func TestServerDoesNotMask(t *testing.T) {
	p := newPipe(t, false)
	go func() { _ = p.conn.WriteText([]byte("hello")) }()

	_, payload, masked := p.readRaw(t)
	if masked || string(payload) != "hello" {
		t.Errorf("a server frame went out masked (%t) or wrong (%q)", masked, payload)
	}
}

// TestMaskingTheWrongWayRoundIsRefused asserts both ends refuse the other's mistake.
func TestMaskingTheWrongWayRoundIsRefused(t *testing.T) {
	t.Run("a client receiving a masked frame", func(t *testing.T) {
		p := newPipe(t, true)
		results := p.readAsync()
		p.send(t, rawFrame(true, opText, []byte("x"), true))
		p.expectClose(t, CloseProtocolError)
		if wait(t, results).err == nil {
			t.Error("expected an error")
		}
	})
	t.Run("a server receiving an unmasked frame", func(t *testing.T) {
		p := newPipe(t, false)
		results := p.readAsync()
		p.send(t, rawFrame(true, opText, []byte("x"), false))
		p.expectClose(t, CloseProtocolError)
		if wait(t, results).err == nil {
			t.Error("expected an error")
		}
	})
}

// TestBinaryFramesAreRefused is the protocol's "text frames only", with 1003.
func TestBinaryFramesAreRefused(t *testing.T) {
	p := newPipe(t, true)
	results := p.readAsync()
	p.send(t, rawFrame(true, opBinary, []byte{0x80, 0x81}, false))

	p.expectClose(t, CloseUnsupportedData)
	if err := wait(t, results).err; err == nil || !strings.Contains(err.Error(), "text frames only") {
		t.Errorf("expected a refusal naming the rule, got %v", err)
	}
}

// TestTheReadLimitIsCheckedBeforeTheBody asserts a message over the ceiling is refused
// from its header — the payload is never buffered.
func TestTheReadLimitIsCheckedBeforeTheBody(t *testing.T) {
	p := newPipe(t, true)
	p.conn.SetReadLimit(1024)
	results := p.readAsync()

	// Only the header is sent. A reader that waited for the body would hang here.
	header := rawFrame(true, opText, make([]byte, 4096), false)[:4]
	p.send(t, header)

	p.expectClose(t, CloseTooBig)
	if wait(t, results).err == nil {
		t.Error("expected an over-limit message to be refused")
	}
}

// TestTheLimitCoversAReassembledMessage asserts fragments cannot be used to walk past
// the ceiling one frame at a time.
func TestTheLimitCoversAReassembledMessage(t *testing.T) {
	p := newPipe(t, true)
	p.conn.SetReadLimit(100)
	results := p.readAsync()
	p.send(t,
		rawFrame(false, opText, bytes.Repeat([]byte("a"), 60), false),
		rawFrame(true, opContinuation, bytes.Repeat([]byte("b"), 60), false),
	)
	p.expectClose(t, CloseTooBig)
	if wait(t, results).err == nil {
		t.Error("expected the reassembled message to be refused")
	}
}

// TestDefaultReadLimitIsTheFrameCeiling reads a message exactly at 65536 bytes — the
// 64-bit length path — and asserts one byte more is refused.
func TestDefaultReadLimitIsTheFrameCeiling(t *testing.T) {
	p := newPipe(t, true)
	results := p.readAsync()
	p.send(t, rawFrame(true, opText, bytes.Repeat([]byte("a"), DefaultReadLimit), false))
	if result := wait(t, results); result.err != nil || len(result.message) != DefaultReadLimit {
		t.Fatalf("a message at the ceiling: %d bytes, %v", len(result.message), result.err)
	}

	p = newPipe(t, true)
	results = p.readAsync()
	p.send(t, rawFrame(true, opText, bytes.Repeat([]byte("a"), DefaultReadLimit+1), false)[:10])
	p.expectClose(t, CloseTooBig)
	if wait(t, results).err == nil {
		t.Error("expected a message one byte over the ceiling to be refused")
	}
}

// TestFragmentsAreReassembled is RFC 6455's obligation on a receiver, and the 16-bit
// length path.
func TestFragmentsAreReassembled(t *testing.T) {
	p := newPipe(t, true)
	results := p.readAsync()
	first := bytes.Repeat([]byte("x"), 200)
	p.send(t,
		rawFrame(false, opText, first, false),
		rawFrame(true, opPong, []byte("interleaved control frames are legal"), false),
		rawFrame(true, opContinuation, []byte("end"), false),
	)
	result := wait(t, results)
	if result.err != nil || string(result.message) != string(first)+"end" {
		t.Fatalf("got %d bytes, %v", len(result.message), result.err)
	}
}

func TestFragmentationErrors(t *testing.T) {
	for name, frames := range map[string][][]byte{
		"a continuation with nothing to continue": {rawFrame(true, opContinuation, []byte("x"), false)},
		"a new message inside another": {
			rawFrame(false, opText, []byte("x"), false),
			rawFrame(true, opText, []byte("y"), false),
		},
		"a fragmented control frame":    {rawFrame(false, opPing, []byte("x"), false)},
		"an over-long control frame":    {rawFrame(true, opPing, bytes.Repeat([]byte("x"), 126), false)},
		"an unknown data opcode":        {rawFrame(true, 0x3, []byte("x"), false)},
		"an unknown control opcode":     {rawFrame(true, 0xB, []byte("x"), false)},
		"reserved bits with no meaning": {append([]byte{0xC1}, rawFrame(true, opText, []byte("x"), false)[1:]...)},
		"a length with its top bit set": {append([]byte{0x81, 127}, 0x80, 0, 0, 0, 0, 0, 0, 1)},
	} {
		t.Run(name, func(t *testing.T) {
			p := newPipe(t, true)
			results := p.readAsync()
			p.send(t, frames...)
			p.expectClose(t, CloseProtocolError)
			if wait(t, results).err == nil {
				t.Error("expected an error")
			}
		})
	}
}

// TestTextMustBeUTF8 is 1007: a text frame is a promise about its encoding.
func TestTextMustBeUTF8(t *testing.T) {
	p := newPipe(t, true)
	results := p.readAsync()
	p.send(t, rawFrame(true, opText, []byte{0xff, 0xfe}, false))
	p.expectClose(t, CloseInvalidPayload)
	if wait(t, results).err == nil {
		t.Error("expected invalid UTF-8 to be refused")
	}
}

// TestPingIsAnsweredWithTheSamePayload is RFC 6455 § 5.5.3, and it happens inside
// ReadMessage — the reader keeps reading for the next data message afterwards.
func TestPingIsAnsweredWithTheSamePayload(t *testing.T) {
	p := newPipe(t, true)
	results := p.readAsync()
	p.send(t, rawFrame(true, opPing, []byte("are you there"), false))

	opcode, payload, masked := p.readRaw(t)
	if opcode != opPong || string(payload) != "are you there" || !masked {
		t.Errorf("expected a masked pong echoing the ping, got %#x %q masked=%t", opcode, payload, masked)
	}

	p.send(t, rawFrame(true, opText, []byte("after"), false))
	if result := wait(t, results); result.err != nil || string(result.message) != "after" {
		t.Errorf("expected the next data message after the ping, got %q, %v", result.message, result.err)
	}
}

// TestPeerCloseIsEchoedAndReported asserts the close handshake: the peer's code comes
// back as a CloseError, and the same code goes back to the peer.
func TestPeerCloseIsEchoedAndReported(t *testing.T) {
	p := newPipe(t, true)
	results := p.readAsync()
	payload := binary.BigEndian.AppendUint16(nil, CloseGoingAway)
	p.send(t, rawFrame(true, opClose, append(payload, "deploying"...), false))

	p.expectClose(t, CloseGoingAway)
	var closed *CloseError
	if err := wait(t, results).err; !errors.As(err, &closed) || closed.Code != CloseGoingAway || closed.Reason != "deploying" {
		t.Fatalf("expected CloseError{1001, deploying}, got %v", err)
	}
	if !strings.Contains(closed.Error(), "deploying") {
		t.Errorf("the error should name the reason: %v", closed)
	}
}

// TestAnEmptyCloseIsAnsweredNormally covers a close frame with no status code: it is
// reported as 1005 and answered with 1000, because 1005 may never be sent.
func TestAnEmptyCloseIsAnsweredNormally(t *testing.T) {
	p := newPipe(t, true)
	results := p.readAsync()
	p.send(t, rawFrame(true, opClose, nil, false))

	p.expectClose(t, CloseNormal)
	var closed *CloseError
	if err := wait(t, results).err; !errors.As(err, &closed) || closed.Code != CloseNoStatus {
		t.Fatalf("expected CloseError{1005}, got %v", err)
	}
	if closed.Error() == "" {
		t.Error("a CloseError with no reason still describes itself")
	}
}

// TestWritesAfterCloseAreRefused asserts WriteClose is final for this end.
func TestWritesAfterCloseAreRefused(t *testing.T) {
	p := newPipe(t, true)
	go func() { _ = p.conn.WriteClose(CloseNormal, "bye") }()
	p.expectClose(t, CloseNormal)

	if err := p.conn.WriteText([]byte("late")); !errors.Is(err, ErrClosed) {
		t.Errorf("expected ErrClosed, got %v", err)
	}
	if err := p.conn.WriteClose(CloseNormal, "again"); !errors.Is(err, ErrClosed) {
		t.Errorf("expected a second close to be ErrClosed, got %v", err)
	}
}

// TestCloseReasonIsTruncatedToAControlFrame asserts a long reason cannot produce an
// illegal control frame.
func TestCloseReasonIsTruncatedToAControlFrame(t *testing.T) {
	p := newPipe(t, true)
	go func() { _ = p.conn.WriteClose(CloseNormal, strings.Repeat("r", 500)) }()
	opcode, payload, _ := p.readRaw(t)
	if opcode != opClose || len(payload) != maxControlPayload {
		t.Errorf("expected a %d-byte close payload, got %d", maxControlPayload, len(payload))
	}
}

// TestConcurrentWritesDoNotInterleave writes from many goroutines at once — which the
// heartbeat, the loop and a finishing job do — and asserts every message arrives whole.
func TestConcurrentWritesDoNotInterleave(t *testing.T) {
	p := newPipe(t, true)
	const writers, each = 8, 25
	message := bytes.Repeat([]byte("z"), 300)

	var wg sync.WaitGroup
	for range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range each {
				_ = p.conn.WriteText(message)
			}
		}()
	}
	for range writers * each {
		opcode, payload, _ := p.readRaw(t)
		if opcode != opText || !bytes.Equal(payload, message) {
			t.Fatalf("a frame arrived damaged: opcode %#x, %d bytes", opcode, len(payload))
		}
	}
	wg.Wait()
}

// TestReadErrorsSurface asserts a connection that dies mid-frame is an error, not a
// hang or a truncated message.
func TestReadErrorsSurface(t *testing.T) {
	for name, partial := range map[string][]byte{
		"inside the header":           {0x81},
		"inside a 16-bit length":      {0x81, 126, 0x01},
		"inside a 64-bit length":      {0x81, 127, 0, 0},
		"inside the payload":          {0x81, 5, 'a', 'b'},
		"inside a control frame body": {0x89, 5, 'p'},
	} {
		t.Run(name, func(t *testing.T) {
			p := newPipe(t, true)
			results := p.readAsync()
			go func() {
				_, _ = p.raw.Write(partial)
				_ = p.raw.Close()
			}()
			if wait(t, results).err == nil {
				t.Error("expected a truncated frame to be an error")
			}
		})
	}

	t.Run("inside a mask key", func(t *testing.T) {
		p := newPipe(t, false)
		results := p.readAsync()
		go func() {
			_, _ = p.raw.Write([]byte{0x81, 0x81, 1, 2})
			_ = p.raw.Close()
		}()
		if wait(t, results).err == nil {
			t.Error("expected a truncated mask key to be an error")
		}
	})
}

func TestAccessors(t *testing.T) {
	p := newPipe(t, true)
	if p.conn.LocalAddr() == nil || p.conn.NetConn() == nil {
		t.Error("expected the underlying connection to be reachable")
	}
	if err := p.conn.SetReadDeadline(time.Now().Add(time.Millisecond)); err != nil {
		t.Errorf("set a read deadline: %v", err)
	}
	if _, err := p.conn.ReadMessage(); err == nil {
		t.Error("expected the deadline to end the read")
	}
	if err := p.conn.Close(); err != nil {
		t.Errorf("close: %v", err)
	}
}
