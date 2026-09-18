package telemetry

import (
	"strings"
	"testing"
)

// TestParseMemTotalMB covers the real file's shape and every way it can be wrong.
//
// The unit is checked rather than assumed, and this is the suite that says so. `kB` has
// been /proc/meminfo's unit for the whole life of the file, but a misread memory size is
// an agent claiming sixteen gigabytes or sixteen megabytes, and neither looks obviously
// wrong in a log — so a line this parser does not recognise is an error rather than a
// number.
func TestParseMemTotalMB(t *testing.T) {
	const real = `MemTotal:       16321092 kB
MemFree:         2087044 kB
MemAvailable:    9932168 kB
Buffers:          412356 kB
`

	for _, testCase := range []struct {
		name    string
		input   string
		want    int
		wantErr bool
	}{
		{
			name:  "a real /proc/meminfo",
			input: real,
			want:  16321092 / 1024,
		},
		{
			name:  "MemTotal is not the first line",
			input: "MemFree: 2087044 kB\nMemTotal:       8192000 kB\n",
			want:  8192000 / 1024,
		},
		{
			name:  "MemTotalSomething does not match MemTotal",
			input: "MemTotalHuge:   99 kB\nMemTotal:       4096000 kB\n",
			want:  4096000 / 1024,
		},
		{
			name:    "no MemTotal at all",
			input:   "MemFree:         2087044 kB\n",
			wantErr: true,
		},
		{
			name:    "empty",
			input:   "",
			wantErr: true,
		},
		{
			name:    "a unit this parser does not know",
			input:   "MemTotal:       16321092 MB\n",
			wantErr: true,
		},
		{
			name:    "no unit",
			input:   "MemTotal:       16321092\n",
			wantErr: true,
		},
		{
			name:    "not a number",
			input:   "MemTotal:       lots kB\n",
			wantErr: true,
		},
		{
			name:    "a machine with a kibibyte of memory",
			input:   "MemTotal:       64 kB\n",
			wantErr: true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := parseMemTotalMB(strings.NewReader(testCase.input))

			if testCase.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %d MB", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != testCase.want {
				t.Errorf("expected %d MB, got %d", testCase.want, got)
			}
		})
	}
}

// TestTotalMemoryMB reads the real file, which is the half a fixture cannot test: that
// this machine's /proc/meminfo is a file this parser recognises.
func TestTotalMemoryMB(t *testing.T) {
	got, err := TotalMemoryMB()
	if err != nil {
		t.Fatalf("read installed memory: %v", err)
	}
	if got < 1 {
		t.Errorf("expected at least one mebibyte, got %d", got)
	}
}
