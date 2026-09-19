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

// TestParseMemory covers the heartbeat's two memory figures and the ways each can be
// missing.
//
// The halves fail apart, and that is the row that matters: a kernel without MemAvailable
// still knows what is installed, and reports it beside a null — never MemFree in
// MemAvailable's place, which would read a warm page cache as a machine out of memory.
func TestParseMemory(t *testing.T) {
	const real = `MemTotal:       16321092 kB
MemFree:         2087044 kB
MemAvailable:    9932168 kB
Buffers:          412356 kB
`

	for _, testCase := range []struct {
		name              string
		input             string
		total, used       int
		totalErr, usedErr string
	}{
		{
			name:  "a real /proc/meminfo",
			input: real,
			total: 16321092 / 1024,
			used:  (16321092 - 9932168) / 1024,
		},
		{
			name:  "everything available is nothing used",
			input: "MemTotal: 8192000 kB\nMemAvailable: 8192000 kB\n",
			total: 8000,
			used:  0,
		},
		{
			name:    "a kernel older than 3.14 has no MemAvailable",
			input:   "MemTotal:       16321092 kB\nMemFree:         2087044 kB\n",
			total:   16321092 / 1024,
			usedErr: "no MemAvailable line",
		},
		{
			name:    "MemAvailable in a unit this parser does not know",
			input:   "MemTotal: 16321092 kB\nMemAvailable: 9932168 MB\n",
			total:   16321092 / 1024,
			usedErr: "the MemAvailable line is not",
		},
		{
			name:    "more available than installed",
			input:   "MemTotal: 1048576 kB\nMemAvailable: 2097152 kB\n",
			total:   1024,
			usedErr: "larger than MemTotal",
		},
		{
			name:     "no MemTotal: neither figure",
			input:    "MemAvailable: 9932168 kB\n",
			totalErr: "no MemTotal line",
			usedErr:  "measured against the total",
		},
		{
			name:     "a MemTotal that is not a number",
			input:    "MemTotal: lots kB\nMemAvailable: 1 kB\n",
			totalErr: "MemTotal is not a kibibyte count",
			usedErr:  "measured against the total",
		},
		{
			name:     "a machine with a kibibyte of memory",
			input:    "MemTotal: 64 kB\nMemAvailable: 1 kB\n",
			totalErr: "not a machine",
			usedErr:  "measured against the total",
		},
		{
			name:     "empty",
			input:    "",
			totalErr: "no MemTotal line",
			usedErr:  "measured against the total",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got := parseMemory(strings.NewReader(testCase.input))

			check := func(half string, value, want int, err error, wantErr string) {
				t.Helper()
				if wantErr != "" {
					if err == nil || !strings.Contains(err.Error(), wantErr) {
						t.Errorf("%s: expected an error mentioning %q, got %v (%d)", half, wantErr, err, value)
					}
					return
				}
				if err != nil {
					t.Errorf("%s: unexpected error: %v", half, err)
				} else if value != want {
					t.Errorf("%s: expected %d MB, got %d", half, want, value)
				}
			}
			check("total", got.totalMB, testCase.total, got.totalErr, testCase.totalErr)
			check("used", got.usedMB, testCase.used, got.usedErr, testCase.usedErr)
		})
	}
}

// TestParseMemoryErrorsQuoteNoCount pins what the log depends on: the same malformation,
// read twice with different numbers, is one message — or it would be logged every pass.
func TestParseMemoryErrorsQuoteNoCount(t *testing.T) {
	first := parseMemory(strings.NewReader("MemTotal: 16321092 kB\nMemAvailable: 9932168 MB\n"))
	second := parseMemory(strings.NewReader("MemTotal: 16321092 kB\nMemAvailable: 9931000 MB\n"))
	if first.usedErr == nil || second.usedErr == nil || first.usedErr.Error() != second.usedErr.Error() {
		t.Errorf("the same malformation read twice gave two messages:\n%v\n%v", first.usedErr, second.usedErr)
	}
}
