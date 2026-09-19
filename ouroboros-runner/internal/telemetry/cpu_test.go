package telemetry

import (
	"errors"
	"testing"
)

// TestUtilisation is the arithmetic every platform's CPU reading ends in: the busy share
// of the time that passed between two readings — and the two windows that have no true
// answer, which are errors rather than a number somebody would believe.
func TestUtilisation(t *testing.T) {
	for _, testCase := range []struct {
		name          string
		before, after cpuTimes
		want          float64
		wantErr       error
	}{
		{
			name:   "a quarter busy",
			before: cpuTimes{idle: 1000, total: 2000},
			after:  cpuTimes{idle: 1300, total: 2400},
			want:   25,
		},
		{
			name:   "entirely idle is a real zero",
			before: cpuTimes{idle: 1000, total: 2000},
			after:  cpuTimes{idle: 1500, total: 2500},
			want:   0,
		},
		{
			name:   "entirely busy",
			before: cpuTimes{idle: 1000, total: 2000},
			after:  cpuTimes{idle: 1000, total: 2800},
			want:   100,
		},
		{
			name:   "rounded to a tenth",
			before: cpuTimes{idle: 0, total: 0},
			after:  cpuTimes{idle: 2, total: 3},
			want:   33.3,
		},
		{
			name:    "no time passed",
			before:  cpuTimes{idle: 10, total: 20},
			after:   cpuTimes{idle: 10, total: 20},
			wantErr: errNoTimePassed,
		},
		{
			name:    "the total went backwards",
			before:  cpuTimes{idle: 10, total: 20},
			after:   cpuTimes{idle: 10, total: 19},
			wantErr: errCountersBack,
		},
		{
			name:    "idle went backwards",
			before:  cpuTimes{idle: 10, total: 20},
			after:   cpuTimes{idle: 9, total: 30},
			wantErr: errCountersBack,
		},
		{
			name:   "idle cannot exceed the time that passed",
			before: cpuTimes{idle: 0, total: 100},
			after:  cpuTimes{idle: 50, total: 110},
			want:   0,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := utilisation(testCase.before, testCase.after)
			if testCase.wantErr != nil {
				if !errors.Is(err, testCase.wantErr) {
					t.Fatalf("expected %v, got %v (%v)", testCase.wantErr, err, got)
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

// TestRoundTenth holds a reading to what the contract accepts: one decimal place, never
// below zero or above a hundred.
func TestRoundTenth(t *testing.T) {
	for input, want := range map[float64]float64{
		12.34:  12.3,
		12.35:  12.4,
		-0.01:  0,
		100.04: 100,
		150:    100,
		0:      0,
	} {
		if got := roundTenth(input); got != want {
			t.Errorf("roundTenth(%v) = %v, want %v", input, got, want)
		}
	}
}
