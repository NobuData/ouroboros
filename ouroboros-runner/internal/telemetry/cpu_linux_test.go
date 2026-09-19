package telemetry

import (
	"os"
	"strings"
	"testing"
)

// TestParseCPUTimes covers /proc/stat's machine-wide line and every way it can be wrong.
//
// guest and guest_nice are the counters worth a row: the kernel already counts them in
// user and nice, so a parser that summed all ten would count a virtual machine's time
// twice and read a host running guests as busier than it is.
func TestParseCPUTimes(t *testing.T) {
	const real = `cpu  4705 356 584 3699176 23060 0 277 0 0 0
cpu0 1393 280 234 925040 5877 0 124 0 0 0
cpu1 1142 23 141 925080 5698 0 52 0 0 0
intr 2355225 36 9 0 0 0 0 0 0 1 0
ctxt 3834540
`

	for _, testCase := range []struct {
		name    string
		input   string
		want    cpuTimes
		wantErr string
	}{
		{
			name:  "a real /proc/stat",
			input: real,
			want:  cpuTimes{idle: 3699176 + 23060, total: 4705 + 356 + 584 + 3699176 + 23060 + 0 + 277 + 0},
		},
		{
			name:  "guest time is not counted twice",
			input: "cpu  100 0 0 900 0 0 0 0 50 50\n",
			want:  cpuTimes{idle: 900, total: 1000},
		},
		{
			name:  "an old kernel's four counters",
			input: "cpu  100 20 30 850\n",
			want:  cpuTimes{idle: 850, total: 1000},
		},
		{
			name:  "a per-CPU line first is not the machine",
			input: "cpu0 1 1 1 1\ncpu  2 2 2 4\n",
			want:  cpuTimes{idle: 4, total: 10},
		},
		{name: "no cpu line", input: "intr 1 2 3\n", wantErr: "no cpu line"},
		{name: "empty", input: "", wantErr: "no cpu line"},
		{name: "too few counters", input: "cpu  1 2 3\n", wantErr: "fewer than the four"},
		{name: "a counter that is not a number", input: "cpu  1 2 x 4\n", wantErr: "counter 3 is not a tick count"},
		{name: "a negative counter", input: "cpu  1 -2 3 4\n", wantErr: "counter 2 is not a tick count"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := parseCPUTimes(strings.NewReader(testCase.input))
			if testCase.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), testCase.wantErr) {
					t.Fatalf("expected an error mentioning %q, got %v (%+v)", testCase.wantErr, err, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != testCase.want {
				t.Errorf("expected %+v, got %+v", testCase.want, got)
			}
		})
	}
}

// TestParseCPUTimesErrorsQuoteNoCounter pins the property the log depends on: a failure is
// logged once per distinct message, so a message that quoted a counter — which changes on
// every read — would be logged on every pass.
func TestParseCPUTimesErrorsQuoteNoCounter(t *testing.T) {
	_, first := parseCPUTimes(strings.NewReader("cpu  11 22 x 44\n"))
	_, second := parseCPUTimes(strings.NewReader("cpu  55 66 y 88\n"))
	if first == nil || second == nil || first.Error() != second.Error() {
		t.Errorf("the same malformation read twice gave two messages:\n%v\n%v", first, second)
	}
}

// TestReadCPUTimes reads this machine's real /proc/stat, which is the half a fixture
// cannot test: that the file on the machine running the suite is one the parser knows.
func TestReadCPUTimes(t *testing.T) {
	if _, err := os.Stat(procStat); err != nil {
		t.Fatalf("this suite runs on Linux, where %s exists: %v", procStat, err)
	}
	times, err := readCPUTimes(procStat)
	if err != nil {
		t.Fatalf("read %s: %v", procStat, err)
	}
	if times.total == 0 || times.idle > times.total {
		t.Errorf("implausible CPU time: %+v", times)
	}
}
