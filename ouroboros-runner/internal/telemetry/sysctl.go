package telemetry

import (
	"encoding/binary"
	"fmt"
)

// decodeSysctlUint64 reads a 64-bit sysctl value out of what Go's syscall.Sysctl
// returns for it.
//
// syscall.Sysctl is written for string values: it drops one trailing NUL byte before
// returning. A little-endian integer's last byte is its most significant one, and that
// byte is zero for any value under 2^56 — sixty-four pebibytes, so for every machine's
// memory size — so an 8-byte value usually comes back as 7 bytes. The dropped byte was a
// zero, and putting it back restores the value exactly. Anything that is neither 7 nor 8
// bytes is not the value asked for.
//
// It lives outside the darwin build so the Linux CI can test it: the darwin arm64
// machines this runs on are little-endian, and so is every machine ci/runner has.
func decodeSysctlUint64(name, raw string) (uint64, error) {
	buffer := []byte(raw)
	switch len(buffer) {
	case 8:
	case 7:
		buffer = append(buffer, 0)
	default:
		return 0, fmt.Errorf("sysctl %s returned %d bytes, not a 64-bit integer", name, len(buffer))
	}
	return binary.LittleEndian.Uint64(buffer), nil
}
