package telemetry

import (
	"strings"
	"testing"
)

// topOutput is `top -l 2 -n 0 -s 5` as macOS prints it: two samples, each with its CPU
// line, no process rows. The first sample's CPU line is the since-boot average top has
// nothing to difference against; the second is the reading.
const topOutput = `Processes: 612 total, 3 running, 609 sleeping, 3113 threads
2026/09/18 12:00:00
Load Avg: 2.14, 2.03, 1.96
CPU usage: 9.52% user, 12.69% sys, 77.77% idle
SharedLibs: 564M resident, 108M data, 60M linkedit.
MemRegions: 355062 total, 5890M resident, 391M private, 3160M shared.
PhysMem: 23G used (2627M wired, 4096M compressor), 480M unused.
VM: 287T vsize, 4912M framework vsize, 0(0) swapins, 0(0) swapouts.
Networks: packets: 12345678/9876M in, 8765432/1234M out.
Disks: 23456789/345G read, 12345678/234G written.

PID  COMMAND  %CPU TIME     #TH  #WQ #PORT MEM  PURG CMPRS PGRP PPID STATE    BOOSTS

Processes: 612 total, 2 running, 610 sleeping, 3110 threads
2026/09/18 12:00:05
Load Avg: 2.10, 2.02, 1.96
CPU usage: 3.44% user, 5.17% sys, 91.37% idle
SharedLibs: 564M resident, 108M data, 60M linkedit.
MemRegions: 355071 total, 5891M resident, 391M private, 3160M shared.
PhysMem: 23G used (2627M wired, 4096M compressor), 478M unused.
VM: 287T vsize, 4912M framework vsize, 0(0) swapins, 0(0) swapouts.
Networks: packets: 12345690/9876M in, 8765440/1234M out.
Disks: 23456795/345G read, 12345680/234G written.

PID  COMMAND  %CPU TIME     #TH  #WQ #PORT MEM  PURG CMPRS PGRP PPID STATE    BOOSTS
`

// TestParseTopCPU reads the second sample, never the first, and refuses output that is
// not two samples of the shape it knows — a macOS whose top changed its format reports
// null rather than a misread figure.
func TestParseTopCPU(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		output  string
		want    float64
		wantErr string
	}{
		{name: "a real two-sample run", output: topOutput, want: 8.6},
		{
			name:   "entirely idle",
			output: "CPU usage: 50% user, 50% sys, 0% idle\nCPU usage: 0.00% user, 0.00% sys, 100.00% idle\n",
			want:   0,
		},
		{
			name:   "a figure added before idle is still busy",
			output: "CPU usage: 1% user, 1% sys, 98% idle\nCPU usage: 10% user, 5% sys, 5% nice, 80% idle\n",
			want:   20,
		},
		{
			name:    "one sample only",
			output:  "CPU usage: 3.44% user, 5.17% sys, 91.37% idle\n",
			wantErr: "not the two",
		},
		{name: "nothing at all", output: "", wantErr: "not the two"},
		{
			name:    "no idle figure",
			output:  "CPU usage: 1% user\nCPU usage: 3.44% user, 5.17% sys\n",
			wantErr: "no idle figure",
		},
		{
			name:    "an idle figure that is not a number",
			output:  "CPU usage: 1% idle\nCPU usage: 3.44% user, lots% idle\n",
			wantErr: "not a list of percentages",
		},
		{
			name:    "an idle figure over a hundred",
			output:  "CPU usage: 1% idle\nCPU usage: 0% user, 120% idle\n",
			wantErr: "not a list of percentages",
		},
		{
			name:    "a comma decimal, which the pinned C locale rules out",
			output:  "CPU usage: 1% idle\nCPU usage: 3,44% user, 5,17% sys, 91,37% idle\n",
			wantErr: "not a list of percentages",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := parseTopCPU([]byte(testCase.output))
			if testCase.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), testCase.wantErr) {
					t.Fatalf("expected an error mentioning %q, got %v (%v)", testCase.wantErr, err, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != testCase.want {
				t.Errorf("expected %v, got %v", testCase.want, got)
			}
		})
	}
}
