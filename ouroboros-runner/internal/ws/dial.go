package ws

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1" // #nosec G505 -- RFC 6455 § 4.2.2 fixes SHA-1 for the accept key; it authenticates nothing
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// websocketGUID is the constant RFC 6455 § 1.3 appends to a handshake key.
const websocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// DefaultHandshakeTimeout bounds the TCP connect, the TLS handshake and the HTTP
// upgrade together.
const DefaultHandshakeTimeout = 30 * time.Second

// maxHandshakeBody is how much of a refused upgrade's body is kept — enough for the
// control plane's `{code, message, details}` error envelope, and no more.
const maxHandshakeBody = 4096

// DialOptions configures [Dial].
type DialOptions struct {
	// TLSConfig is the whole of this connection's security: the roots the gateway's
	// certificate is verified against and, in mTLS mode, the client certificate. It is
	// cloned, never modified. Required.
	TLSConfig *tls.Config

	// Header is extra request headers for the upgrade: a User-Agent, and — in
	// bearer-fallback mode only — the Authorization header that carries the secret.
	Header http.Header

	// HandshakeTimeout bounds connect, TLS and upgrade together. Zero means
	// [DefaultHandshakeTimeout].
	HandshakeTimeout time.Duration

	// NetDialer is the TCP dialer. Nil means a default with the handshake timeout and
	// TCP keep-alives on, so a connection through a NAT that silently dropped its
	// mapping is eventually noticed by the kernel as well as by the heartbeat.
	NetDialer *net.Dialer
}

// HandshakeError is the server answering the upgrade with anything but 101.
//
// It keeps the status and the start of the body because both are what an operator
// needs: a 401 whose body names `farm_identity_refused` is a revoked certificate, and a
// 404 is a control plane that does not serve the agent endpoint at all.
type HandshakeError struct {
	StatusCode int
	Body       []byte
}

func (e *HandshakeError) Error() string {
	return fmt.Sprintf("the gateway refused the websocket upgrade: HTTP %d %s",
		e.StatusCode, http.StatusText(e.StatusCode))
}

// Dial opens a WebSocket to a wss:// URL: TCP, TLS, then the HTTP/1.1 upgrade.
//
// Outbound only, by construction — there is no listening half. The context bounds the
// whole handshake, and cancelling it abandons a handshake in progress.
func Dial(ctx context.Context, rawURL string, options DialOptions) (*Conn, error) {
	target, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse the gateway url: %w", err)
	}
	if target.Scheme != "wss" {
		return nil, fmt.Errorf("refusing %q: the gateway connection is wss:// only", target.Scheme+"://")
	}
	if options.TLSConfig == nil {
		return nil, fmt.Errorf("dial %s: no TLS configuration", target.Host)
	}

	address := target.Host
	if target.Port() == "" {
		address = net.JoinHostPort(target.Hostname(), "443")
	}

	timeout := options.HandshakeTimeout
	if timeout <= 0 {
		timeout = DefaultHandshakeTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	netDialer := options.NetDialer
	if netDialer == nil {
		netDialer = &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
	}
	config := options.TLSConfig.Clone()
	if config.ServerName == "" {
		config.ServerName = target.Hostname()
	}
	// HTTP/1.1, stated: an upgrade is an HTTP/1.1 mechanism, and a gateway or proxy
	// that negotiated h2 over ALPN would answer a request this client cannot send.
	config.NextProtos = []string{"http/1.1"}

	dialer := &tls.Dialer{NetDialer: netDialer, Config: config}
	netConn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}

	conn, err := upgradeClient(ctx, netConn, target, options.Header)
	if err != nil {
		_ = netConn.Close()
		return nil, err
	}
	return conn, nil
}

// upgradeClient performs the HTTP/1.1 upgrade on an established TLS connection.
func upgradeClient(ctx context.Context, netConn net.Conn, target *url.URL, extra http.Header) (*Conn, error) {
	// The context's deadline and cancellation reach a blocked read or write through the
	// connection's deadline; nothing else can interrupt them.
	if deadline, ok := ctx.Deadline(); ok {
		if err := netConn.SetDeadline(deadline); err != nil {
			return nil, err
		}
	}
	stop := context.AfterFunc(ctx, func() { _ = netConn.SetDeadline(time.Unix(1, 0)) })
	defer stop()

	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, fmt.Errorf("draw a handshake key: %w", err)
	}
	key := base64.StdEncoding.EncodeToString(nonce[:])

	request := &http.Request{
		Method:     http.MethodGet,
		URL:        &url.URL{Scheme: "https", Host: target.Host, Path: target.Path, RawQuery: target.RawQuery},
		Proto:      "HTTP/1.1",
		ProtoMajor: 1,
		ProtoMinor: 1,
		Header:     make(http.Header),
		Host:       target.Host,
	}
	for name, values := range extra {
		for _, value := range values {
			request.Header.Add(name, value)
		}
	}
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Sec-WebSocket-Key", key)
	request.Header.Set("Sec-WebSocket-Version", "13")

	if err := request.Write(netConn); err != nil {
		return nil, contextError(ctx, err)
	}

	reader := bufio.NewReader(netConn)
	response, err := http.ReadResponse(reader, request)
	if err != nil {
		return nil, contextError(ctx, err)
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		body, _ := io.ReadAll(io.LimitReader(response.Body, maxHandshakeBody))
		_ = response.Body.Close()
		return nil, &HandshakeError{StatusCode: response.StatusCode, Body: body}
	}

	if !strings.EqualFold(response.Header.Get("Upgrade"), "websocket") ||
		!headerHasToken(response.Header, "Connection", "upgrade") {
		return nil, fmt.Errorf("the gateway answered 101 without upgrading to a websocket")
	}
	if response.Header.Get("Sec-WebSocket-Accept") != acceptKey(key) {
		return nil, fmt.Errorf("the gateway's Sec-WebSocket-Accept does not answer this handshake")
	}

	if !stop() {
		return nil, ctx.Err()
	}
	if err := netConn.SetDeadline(time.Time{}); err != nil {
		return nil, err
	}
	return newConn(netConn, reader, true), nil
}

// contextError prefers the context's reason for a failure it caused: a read that timed
// out because the handshake budget ran out is a timeout, not an I/O error.
//
// The connection's deadline and the context's are the same instant, so the read can
// time out a moment before the context notices; a timeout at or past the context's
// deadline is reported as the deadline it was.
func contextError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return fmt.Errorf("%w: %w", ctx.Err(), err)
	}
	var timeout net.Error
	if deadline, ok := ctx.Deadline(); ok && errors.As(err, &timeout) && timeout.Timeout() && !time.Now().Before(deadline) {
		return fmt.Errorf("%w: %w", context.DeadlineExceeded, err)
	}
	return err
}

// acceptKey is the Sec-WebSocket-Accept value that answers a Sec-WebSocket-Key.
func acceptKey(key string) string {
	digest := sha1.Sum([]byte(key + websocketGUID)) // #nosec G401 -- fixed by RFC 6455; not a security primitive here
	return base64.StdEncoding.EncodeToString(digest[:])
}

// headerHasToken reports whether a comma-separated header carries a token, ignoring
// case — `Connection: keep-alive, Upgrade` upgrades.
func headerHasToken(header http.Header, name, token string) bool {
	for _, value := range header.Values(name) {
		for _, part := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(part), token) {
				return true
			}
		}
	}
	return false
}
