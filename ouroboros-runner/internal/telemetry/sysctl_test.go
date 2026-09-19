package telemetry

import (
	"encoding/binary"
	"testing"
)

// TestDecodeSysctlUint64 is the byte syscall.Sysctl drops. It strips one trailing NUL,
// which for a little-endian memory size is its (zero) most significant byte, so a
// sixteen-gibibyte Mac's hw.memsize comes back as seven bytes — and must still read as
// sixteen gibibytes.
func TestDecodeSysctlUint64(t *testing.T) {
	encode := func(value uint64) string {
		buffer := make([]byte, 8)
		binary.LittleEndian.PutUint64(buffer, value)
		return string(buffer)
	}
	const sixteenGiB = 16 << 30

	for _, testCase := range []struct {
		name    string
		raw     string
		want    uint64
		wantErr bool
	}{
		{name: "all eight bytes", raw: encode(1<<63 + sixteenGiB), want: 1<<63 + sixteenGiB},
		{name: "the trailing zero dropped", raw: encode(sixteenGiB)[:7], want: sixteenGiB},
		{name: "a value whose top two bytes are zero", raw: encode(1 << 40)[:7], want: 1 << 40},
		{name: "a 32-bit value is not this", raw: "\x00\x00\x00\x04", wantErr: true},
		{name: "nothing", raw: "", wantErr: true},
		{name: "too long", raw: encode(1) + "\x01", wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := decodeSysctlUint64("hw.memsize", testCase.raw)
			if testCase.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %d", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != testCase.want {
				t.Errorf("expected %d, got %d", testCase.want, got)
			}
		})
	}
}
