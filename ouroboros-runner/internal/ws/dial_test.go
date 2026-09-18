package ws

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
)

// The handshake, against a real TLS server.

// tlsServer starts an httptest TLS server and returns it with the wss:// URL of a path
// on it and a client TLS configuration that trusts it.
func tlsServer(t *testing.T, handler http.HandlerFunc) (string, *tls.Config) {
	t.Helper()
	server := httptest.NewUnstartedServer(handler)
	// A refused handshake is the point of some of these tests, and the server's own log
	// line about it is noise.
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	t.Cleanup(server.Close)

	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	return "wss" + strings.TrimPrefix(server.URL, "https") + "/api/v1/farm/agent",
		&tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
}

// TestDialUpgradesAndCarriesHeaders is the whole handshake, both directions of traffic,
// and the extra headers — which is how bearer-fallback mode's Authorization reaches the
// gateway without ever entering a frame.
func TestDialUpgradesAndCarriesHeaders(t *testing.T) {
	type seen struct{ path, authorization, agent string }
	requests := make(chan seen, 1)

	url, config := tlsServer(t, func(w http.ResponseWriter, r *http.Request) {
		requests <- seen{r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("User-Agent")}
		server, err := Upgrade(w, r)
		if err != nil {
			return
		}
		defer func() { _ = server.Close() }()
		message, err := server.ReadMessage()
		if err != nil {
			return
		}
		_ = server.WriteText(append([]byte("echo:"), message...))
		_, _ = server.ReadMessage() // the client's close
	})

	header := http.Header{}
	header.Set("Authorization", "Bearer not-a-real-secret")
	header.Set("User-Agent", "ouroboros-runner/test")
	client, err := Dial(context.Background(), url, DialOptions{TLSConfig: config, Header: header})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = client.Close() }()

	if err := client.WriteText([]byte("ping")); err != nil {
		t.Fatalf("write: %v", err)
	}
	reply, err := client.ReadMessage()
	if err != nil || string(reply) != "echo:ping" {
		t.Fatalf("got %q, %v", reply, err)
	}
	_ = client.WriteClose(CloseNormal, "")

	got := <-requests
	if got.path != "/api/v1/farm/agent" || got.authorization != "Bearer not-a-real-secret" ||
		got.agent != "ouroboros-runner/test" {
		t.Errorf("the upgrade request arrived as %+v", got)
	}
}

// TestAServersFirstFrameIsNotLost asserts bytes that arrived with the 101 — already in
// the handshake's read buffer — are the first message read, not silently dropped.
func TestAServersFirstFrameIsNotLost(t *testing.T) {
	url, config := tlsServer(t, func(w http.ResponseWriter, r *http.Request) {
		server, err := Upgrade(w, r)
		if err != nil {
			return
		}
		defer func() { _ = server.Close() }()
		_ = server.WriteText([]byte("first"))
		_, _ = server.ReadMessage()
	})

	client, err := Dial(context.Background(), url, DialOptions{TLSConfig: config})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = client.Close() }()
	if message, err := client.ReadMessage(); err != nil || string(message) != "first" {
		t.Fatalf("got %q, %v", message, err)
	}
}

// TestARefusedUpgradeCarriesItsStatusAndBody is what lets the agent tell a revoked
// identity (401 + farm_identity_refused) from a missing endpoint (404).
func TestARefusedUpgradeCarriesItsStatusAndBody(t *testing.T) {
	url, config := tlsServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"farm_identity_refused","message":"no","details":{}}`))
	})

	_, err := Dial(context.Background(), url, DialOptions{TLSConfig: config})
	var refused *HandshakeError
	if !errors.As(err, &refused) {
		t.Fatalf("expected a HandshakeError, got %v", err)
	}
	if refused.StatusCode != http.StatusUnauthorized || !strings.Contains(string(refused.Body), "farm_identity_refused") {
		t.Errorf("got %d %s", refused.StatusCode, refused.Body)
	}
	if !strings.Contains(refused.Error(), "401") {
		t.Errorf("the error should name the status: %v", refused)
	}
}

// TestDialVerifiesTheGateway asserts the server certificate is checked: a client that
// trusts nothing connects to nothing.
func TestDialVerifiesTheGateway(t *testing.T) {
	url, _ := tlsServer(t, func(http.ResponseWriter, *http.Request) {})
	_, err := Dial(context.Background(), url, DialOptions{
		TLSConfig: &tls.Config{RootCAs: x509.NewCertPool(), MinVersion: tls.VersionTLS12},
	})
	var unknown x509.UnknownAuthorityError
	if !errors.As(err, &unknown) {
		t.Fatalf("expected an unknown-authority error, got %v", err)
	}
}

// TestDialRefusesADishonestUpgrade covers the three ways a 101 can fail to be a
// WebSocket: a wrong accept key, no Upgrade header, and no Connection token.
func TestDialRefusesADishonestUpgrade(t *testing.T) {
	for name, response := range map[string]func(key string) string{
		"a wrong accept key": func(string) string {
			return "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
				"Sec-WebSocket-Accept: bm90IHRoZSBrZXk=\r\n\r\n"
		},
		"no Upgrade header": func(key string) string {
			return "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\n" +
				"Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"
		},
		"no Connection token": func(key string) string {
			return "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" +
				"Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"
		},
	} {
		t.Run(name, func(t *testing.T) {
			url, config := tlsServer(t, func(w http.ResponseWriter, r *http.Request) {
				netConn, buffered, err := w.(http.Hijacker).Hijack()
				if err != nil {
					return
				}
				defer func() { _ = netConn.Close() }()
				_, _ = buffered.WriteString(response(r.Header.Get("Sec-WebSocket-Key")))
				_ = buffered.Flush()
			})
			if _, err := Dial(context.Background(), url, DialOptions{TLSConfig: config}); err == nil {
				t.Fatal("expected the upgrade to be refused")
			}
		})
	}
}

// TestDialHonoursTheHandshakeTimeout asserts a gateway that accepts the connection and
// never answers cannot hold the agent: the reconnect loop has to get control back.
func TestDialHonoursTheHandshakeTimeout(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	url, config := tlsServer(t, func(http.ResponseWriter, *http.Request) { <-release })
	t.Cleanup(func() { once.Do(func() { close(release) }) })

	started := time.Now()
	_, err := Dial(context.Background(), url, DialOptions{TLSConfig: config, HandshakeTimeout: 200 * time.Millisecond})
	once.Do(func() { close(release) })

	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected the handshake deadline, got %v", err)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Errorf("the timeout took %v to fire", elapsed)
	}
}

// TestDialStopsWhenCancelled asserts a SIGTERM during a handshake is not a wait.
func TestDialStopsWhenCancelled(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	url, config := tlsServer(t, func(http.ResponseWriter, *http.Request) { <-release })
	t.Cleanup(func() { once.Do(func() { close(release) }) })

	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(100*time.Millisecond, cancel)
	_, err := Dial(ctx, url, DialOptions{TLSConfig: config})
	once.Do(func() { close(release) })

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

// TestDialRefusesWhatIsNotAGatewayURL covers the arguments Dial refuses before opening
// anything.
func TestDialRefusesWhatIsNotAGatewayURL(t *testing.T) {
	config := &tls.Config{MinVersion: tls.VersionTLS12}
	for name, url := range map[string]string{
		"plain ws://":      "ws://gateway.example.invalid/api/v1/farm/agent",
		"https://":         "https://gateway.example.invalid/",
		"not a url at all": "::not a url",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Dial(context.Background(), url, DialOptions{TLSConfig: config}); err == nil {
				t.Error("expected a refusal")
			}
		})
	}
	if _, err := Dial(context.Background(), "wss://gateway.example.invalid/", DialOptions{}); err == nil {
		t.Error("expected a dial with no TLS configuration to be refused")
	}
}

// TestDialDefaultsToPort443 is the mockup's promise in one assertion: a machine that can
// reach the control plane on 443 needs nothing else.
func TestDialDefaultsToPort443(t *testing.T) {
	var dialled string
	dialer := &net.Dialer{Control: func(_, address string, _ syscall.RawConn) error {
		dialled = address
		return errors.New("stop here")
	}}
	_, _ = Dial(context.Background(), "wss://127.0.0.1/api/v1/farm/agent", DialOptions{
		TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		NetDialer: dialer,
	})
	if dialled != "127.0.0.1:443" {
		t.Errorf("expected the dial to target port 443, got %q", dialled)
	}
}

// TestUpgradeRefusesWhatIsNotAnUpgrade holds the test gateway's half to the RFC too, so
// the client is tested against a server that would notice its mistakes.
func TestUpgradeRefusesWhatIsNotAnUpgrade(t *testing.T) {
	valid := func() *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/farm/agent", nil)
		r.Header.Set("Upgrade", "websocket")
		r.Header.Set("Connection", "keep-alive, Upgrade")
		r.Header.Set("Sec-WebSocket-Version", "13")
		r.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		return r
	}
	for name, mutate := range map[string]func(*http.Request){
		"a POST":           func(r *http.Request) { r.Method = http.MethodPost },
		"no Upgrade":       func(r *http.Request) { r.Header.Del("Upgrade") },
		"no Connection":    func(r *http.Request) { r.Header.Del("Connection") },
		"version 8":        func(r *http.Request) { r.Header.Set("Sec-WebSocket-Version", "8") },
		"a short key":      func(r *http.Request) { r.Header.Set("Sec-WebSocket-Key", "c2hvcnQ=") },
		"a key not base64": func(r *http.Request) { r.Header.Set("Sec-WebSocket-Key", "!!!") },
	} {
		t.Run(name, func(t *testing.T) {
			request := valid()
			mutate(request)
			recorder := httptest.NewRecorder()
			if _, err := Upgrade(recorder, request); err == nil {
				t.Fatal("expected a refusal")
			}
			if recorder.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d", recorder.Code)
			}
		})
	}

	// A well-formed upgrade on a writer that cannot be hijacked is the server's fault.
	recorder := httptest.NewRecorder()
	if _, err := Upgrade(recorder, valid()); err == nil || recorder.Code != http.StatusInternalServerError {
		t.Errorf("expected a 500 for a writer that cannot be hijacked, got %d, %v", recorder.Code, err)
	}
}

// TestAcceptKeyIsTheRFCsExample pins the handshake arithmetic to RFC 6455 § 1.3's own
// worked example.
func TestAcceptKeyIsTheRFCsExample(t *testing.T) {
	if got := acceptKey("dGhlIHNhbXBsZSBub25jZQ=="); got != "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=" {
		t.Errorf("got %s", got)
	}
}

// TestDefaultReadLimitMatchesTheProtocol holds the restated ceiling to the protocol's
// own constant, which is itself held to v1.json's published number.
func TestDefaultReadLimitMatchesTheProtocol(t *testing.T) {
	if DefaultReadLimit != conn.EnvelopeMaxBytes {
		t.Errorf("the websocket read limit is %d; the protocol's frame ceiling is %d",
			DefaultReadLimit, conn.EnvelopeMaxBytes)
	}
}
