package ws

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// Upgrade completes a WebSocket handshake on a request an HTTP server has already
// accepted, and returns the server's end of the connection.
//
// It exists for internal/farmtest — the in-process gateway the agent's suites connect
// to — so that the test speaks exactly the framing the client does rather than a
// second implementation of it. The agent never calls it, and it could not listen if it
// did: it is handed a request by somebody else's server.
//
// On a malformed upgrade it answers 400 itself and returns the reason.
func Upgrade(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	key := r.Header.Get("Sec-WebSocket-Key")
	nonce, err := base64.StdEncoding.DecodeString(key)
	switch {
	case r.Method != http.MethodGet:
		err = fmt.Errorf("an upgrade is a GET, not a %s", r.Method)
	case !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") ||
		!headerHasToken(r.Header, "Connection", "upgrade"):
		err = errors.New("not a websocket upgrade")
	case r.Header.Get("Sec-WebSocket-Version") != "13":
		err = errors.New("websocket version 13 only")
	case err != nil || len(nonce) != 16:
		err = errors.New("Sec-WebSocket-Key is not 16 base64-encoded bytes")
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return nil, err
	}

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "this server cannot upgrade", http.StatusInternalServerError)
		return nil, errors.New("the response writer cannot be hijacked")
	}
	netConn, buffered, err := hijacker.Hijack()
	if err != nil {
		return nil, fmt.Errorf("hijack the connection: %w", err)
	}

	response := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"
	if _, err := buffered.WriteString(response); err != nil {
		_ = netConn.Close()
		return nil, err
	}
	if err := buffered.Flush(); err != nil {
		_ = netConn.Close()
		return nil, err
	}
	return newConn(netConn, buffered.Reader, false), nil
}
