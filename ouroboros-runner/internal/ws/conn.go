// Package ws is the WebSocket transport the runner protocol rides on: RFC 6455, the
// parts of it this agent needs and nothing else.
//
// It is written here rather than imported because this module has no dependencies and
// is meant to keep none (see go.mod). The agent is distributed to machines nobody in
// this repository administers, so every dependency is a supply-chain surface on
// somebody else's laptop — and the client half of RFC 6455 is small: an HTTP/1.1
// upgrade, a frame header, a masking key, and three control frames. Roughly what a
// library would have been, minus the parts this protocol forbids.
//
// What the runner protocol fixes, and so what this package enforces rather than
// offers (docs/RUNNER_PROTOCOL.md § 1):
//
//   - TEXT frames only. A binary frame is refused with close code 1003.
//   - One JSON object per message, with a 65536-byte ceiling. A message over the read
//     limit is refused with 1009 BEFORE its payload is read, because the point of a
//     ceiling is to bound the work a stranger can ask for.
//   - wss:// only. [Dial] refuses a plain ws:// URL: every byte on this connection is
//     either a credential's consequence or a job's result.
//
// Fragmented messages from the peer are reassembled, because RFC 6455 obliges an
// endpoint to accept them; this package never sends one.
//
// The server half — [Upgrade] — exists for the test gateway in internal/farmtest,
// which has to speak the same framing to be a fair test of the client. The agent never
// calls it, and it cannot listen: it takes a request somebody else's server already
// accepted. That the agent binary opens no listening socket is asserted by
// cmd/ouroboros-runner's tests, not by this comment.
package ws

import (
	"bufio"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
	"unicode/utf8"
)

// The opcodes (RFC 6455 § 5.2). Continuation, text and the three control frames are
// the ones this protocol uses; binary is recognised only so it can be refused by name.
const (
	opContinuation = 0x0
	opText         = 0x1
	opBinary       = 0x2
	opClose        = 0x8
	opPing         = 0x9
	opPong         = 0xA
)

// The close codes this package sends or reports (RFC 6455 § 7.4.1).
const (
	CloseNormal          = 1000
	CloseGoingAway       = 1001
	CloseProtocolError   = 1002
	CloseUnsupportedData = 1003
	CloseNoStatus        = 1005 // received only: the peer's close frame carried no code
	CloseInvalidPayload  = 1007
	CloseTooBig          = 1009
)

// maxControlPayload is RFC 6455's cap on a control frame's payload.
const maxControlPayload = 125

// DefaultReadLimit is the largest message a connection accepts: the protocol's frame
// ceiling, 65536 bytes (conn.EnvelopeMaxBytes — restated rather than imported so this
// package does not depend on the protocol it carries; ws_test.go asserts they agree).
const DefaultReadLimit = 65536

// DefaultWriteTimeout bounds one write. A peer that stopped reading must not be able to
// hold a heartbeat — or a SIGTERM's bye — forever.
const DefaultWriteTimeout = 10 * time.Second

// CloseError is the peer closing the connection, with the code and reason it gave.
type CloseError struct {
	Code   int
	Reason string
}

func (e *CloseError) Error() string {
	if e.Reason == "" {
		return fmt.Sprintf("websocket closed by the peer (%d)", e.Code)
	}
	return fmt.Sprintf("websocket closed by the peer (%d: %s)", e.Code, e.Reason)
}

// ErrClosed is returned by a write after this end has sent its close frame.
var ErrClosed = errors.New("websocket already closed")

// Conn is one WebSocket connection, from either end.
//
// Reads are single-goroutine: one reader owns [Conn.ReadMessage]. Writes are safe from
// any number of goroutines — the heartbeat ticker, the connection loop and a job
// finishing all write — and each message is written whole, so two frames never
// interleave on the wire.
type Conn struct {
	netConn net.Conn
	reader  *bufio.Reader

	// client is which end this is. A client masks what it sends and refuses masked
	// frames; a server does the opposite (RFC 6455 § 5.1).
	client bool

	readLimit    int
	writeTimeout time.Duration

	writeMu   sync.Mutex
	closeSent bool
}

// newConn wraps an established connection. The reader carries whatever the handshake
// already buffered — a server is free to send its first frame immediately after the
// 101, and those bytes are in the buffer, not on the socket.
func newConn(netConn net.Conn, reader *bufio.Reader, client bool) *Conn {
	return &Conn{
		netConn:      netConn,
		reader:       reader,
		client:       client,
		readLimit:    DefaultReadLimit,
		writeTimeout: DefaultWriteTimeout,
	}
}

// SetReadLimit changes the largest message accepted. It must be called before the
// first read.
func (c *Conn) SetReadLimit(limit int) { c.readLimit = limit }

// SetReadDeadline bounds the current and future reads, like [net.Conn]'s.
func (c *Conn) SetReadDeadline(at time.Time) error { return c.netConn.SetReadDeadline(at) }

// LocalAddr is the local end of the underlying connection.
func (c *Conn) LocalAddr() net.Addr { return c.netConn.LocalAddr() }

// NetConn is the underlying connection — for the test gateway to inspect the peer's TLS
// state, and for nothing else.
func (c *Conn) NetConn() net.Conn { return c.netConn }

// header is one frame's header, decoded.
type header struct {
	fin    bool
	opcode byte
	masked bool
	length uint64
	mask   [4]byte
}

// ReadMessage returns the next TEXT message, answering pings and absorbing pongs on the
// way.
//
// A close frame from the peer is answered with a close frame of the same code, and
// returned as a [*CloseError]. Anything this package refuses — a binary frame, a
// message over the read limit, a masking violation, text that is not UTF-8 — is
// answered with the matching close code and returned as an error; the connection is
// unusable afterwards.
func (c *Conn) ReadMessage() ([]byte, error) {
	var message []byte
	inMessage := false

	for {
		h, err := c.readHeader()
		if err != nil {
			return nil, err
		}

		if h.opcode >= opClose {
			if !h.fin || h.length > maxControlPayload {
				return nil, c.fail(CloseProtocolError, "a control frame must be whole and short")
			}
			payload, err := c.readPayload(h)
			if err != nil {
				return nil, err
			}
			if err := c.control(h.opcode, payload); err != nil {
				return nil, err
			}
			continue
		}

		switch h.opcode {
		case opText:
			if inMessage {
				return nil, c.fail(CloseProtocolError, "a new message began inside another")
			}
			inMessage = true
		case opContinuation:
			if !inMessage {
				return nil, c.fail(CloseProtocolError, "a continuation with nothing to continue")
			}
		case opBinary:
			return nil, c.fail(CloseUnsupportedData, "this protocol carries text frames only")
		default:
			return nil, c.fail(CloseProtocolError, fmt.Sprintf("unknown opcode %#x", h.opcode))
		}

		// Checked against the header, before the payload is read: a ceiling that is
		// enforced after buffering the thing it limits is not a ceiling.
		if h.length > uint64(c.readLimit-len(message)) { // #nosec G115 -- readLimit >= len(message)
			return nil, c.fail(CloseTooBig, "message over the frame ceiling")
		}
		payload, err := c.readPayload(h)
		if err != nil {
			return nil, err
		}
		message = append(message, payload...)

		if h.fin {
			if !utf8.Valid(message) {
				return nil, c.fail(CloseInvalidPayload, "text frame is not UTF-8")
			}
			return message, nil
		}
	}
}

// readHeader reads and checks one frame header.
func (c *Conn) readHeader() (header, error) {
	var h header
	var fixed [2]byte
	if _, err := io.ReadFull(c.reader, fixed[:]); err != nil {
		return h, err
	}
	h.fin = fixed[0]&0x80 != 0
	if fixed[0]&0x70 != 0 {
		return h, c.fail(CloseProtocolError, "reserved bits set with no extension negotiated")
	}
	h.opcode = fixed[0] & 0x0F
	h.masked = fixed[1]&0x80 != 0

	// A client must never receive a masked frame, and a server must never receive an
	// unmasked one. Either is the other end not speaking RFC 6455.
	if h.masked == c.client {
		return h, c.fail(CloseProtocolError, "frame masking is the wrong way round")
	}

	switch length := fixed[1] & 0x7F; length {
	case 126:
		var extended [2]byte
		if _, err := io.ReadFull(c.reader, extended[:]); err != nil {
			return h, err
		}
		h.length = uint64(binary.BigEndian.Uint16(extended[:]))
	case 127:
		var extended [8]byte
		if _, err := io.ReadFull(c.reader, extended[:]); err != nil {
			return h, err
		}
		h.length = binary.BigEndian.Uint64(extended[:])
		if h.length>>63 != 0 {
			return h, c.fail(CloseProtocolError, "frame length has its top bit set")
		}
	default:
		h.length = uint64(length)
	}

	if h.masked {
		if _, err := io.ReadFull(c.reader, h.mask[:]); err != nil {
			return h, err
		}
	}
	return h, nil
}

// readPayload reads a frame's payload, whose length the caller has already bounded,
// and unmasks it.
func (c *Conn) readPayload(h header) ([]byte, error) {
	payload := make([]byte, h.length)
	if _, err := io.ReadFull(c.reader, payload); err != nil {
		return nil, err
	}
	if h.masked {
		maskBytes(h.mask, payload)
	}
	return payload, nil
}

// control handles a ping, a pong or a close. A close is returned as a CloseError after
// being answered; the other two return nil.
func (c *Conn) control(opcode byte, payload []byte) error {
	switch opcode {
	case opPing:
		return c.writeFrame(opPong, payload)
	case opPong:
		return nil
	case opClose:
		code, reason := CloseNoStatus, ""
		if len(payload) >= 2 {
			code = int(binary.BigEndian.Uint16(payload))
			reason = string(payload[2:])
		}
		// Echo the close (RFC 6455 § 5.5.1) unless this end already sent one.
		echo := code
		if code == CloseNoStatus {
			echo = CloseNormal
		}
		if err := c.WriteClose(echo, ""); err != nil && !errors.Is(err, ErrClosed) {
			return err
		}
		return &CloseError{Code: code, Reason: reason}
	default:
		return c.fail(CloseProtocolError, fmt.Sprintf("unknown control opcode %#x", opcode))
	}
}

// fail answers a violation with a close frame and returns it as an error.
func (c *Conn) fail(code int, reason string) error {
	_ = c.WriteClose(code, reason) // best effort: the connection is being abandoned anyway
	return fmt.Errorf("websocket protocol error (%d): %s", code, reason)
}

// WriteText writes one text message as a single frame.
func (c *Conn) WriteText(message []byte) error {
	return c.writeFrame(opText, message)
}

// WriteClose sends a close frame, once. Later writes return [ErrClosed].
//
// It does not close the connection: the peer answers with its own close frame, and the
// reader should see that answer — as a [*CloseError] from [Conn.ReadMessage] — before
// [Conn.Close]. Closing a TCP connection with unread data in its receive buffer resets
// it, and a reset can discard frames this end wrote just before it, such as a `bye`.
func (c *Conn) WriteClose(code int, reason string) error {
	payload := make([]byte, 2, 2+len(reason))
	binary.BigEndian.PutUint16(payload, uint16(code)) // #nosec G115 -- close codes are 1000–4999
	payload = append(payload, reason...)
	if len(payload) > maxControlPayload {
		payload = payload[:maxControlPayload]
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.closeSent {
		return ErrClosed
	}
	c.closeSent = true
	return c.writeLocked(opClose, payload)
}

// Close closes the underlying connection immediately. It is safe to call more than
// once, and after [Conn.WriteClose].
func (c *Conn) Close() error {
	return c.netConn.Close()
}

// writeFrame writes one whole frame under the write lock.
func (c *Conn) writeFrame(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.closeSent {
		return ErrClosed
	}
	return c.writeLocked(opcode, payload)
}

// writeLocked encodes and writes one frame. The caller holds writeMu.
//
// The frame is assembled into one buffer and written with one call, so a frame is
// never half-written by one goroutine and finished by another. A client masks with a
// fresh key per frame from crypto/rand, which is what the RFC requires and what stops
// a proxy between here and the gateway from being fed bytes an attacker chose.
func (c *Conn) writeLocked(opcode byte, payload []byte) error {
	frame := make([]byte, 0, 14+len(payload))
	frame = append(frame, 0x80|opcode)

	maskBit := byte(0)
	if c.client {
		maskBit = 0x80
	}
	switch n := len(payload); {
	case n <= 125:
		frame = append(frame, maskBit|byte(n))
	case n <= 0xFFFF:
		frame = append(frame, maskBit|126)
		frame = binary.BigEndian.AppendUint16(frame, uint16(n)) // #nosec G115 -- bounded by the case
	default:
		frame = append(frame, maskBit|127)
		frame = binary.BigEndian.AppendUint64(frame, uint64(n))
	}

	if c.client {
		var key [4]byte
		if _, err := rand.Read(key[:]); err != nil {
			return fmt.Errorf("draw a masking key: %w", err)
		}
		frame = append(frame, key[:]...)
		body := len(frame)
		frame = append(frame, payload...)
		maskBytes(key, frame[body:])
	} else {
		frame = append(frame, payload...)
	}

	if c.writeTimeout > 0 {
		if err := c.netConn.SetWriteDeadline(time.Now().Add(c.writeTimeout)); err != nil {
			return err
		}
	}
	_, err := c.netConn.Write(frame)
	return err
}

// maskBytes applies (or removes — it is its own inverse) a masking key in place.
func maskBytes(key [4]byte, data []byte) {
	for i := range data {
		data[i] ^= key[i%4]
	}
}
