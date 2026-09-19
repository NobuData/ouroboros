package logship

import (
	"testing"
	"time"
)

func TestABucketStartsFullAndHoldsOneSecond(t *testing.T) {
	c := newClock()
	b := newBucket(4096)
	if got := b.take(c.Now(), 10_000); got != 4096 {
		t.Fatalf("a full 4096 B/s bucket granted %d; want its one-second burst", got)
	}
	if got := b.take(c.Now(), 1); got != 0 {
		t.Fatalf("an empty bucket granted %d", got)
	}
	c.advance(250 * time.Millisecond)
	if got := b.take(c.Now(), 10_000); got != 1024 {
		t.Fatalf("a quarter second refilled %d; want 1024", got)
	}
	c.advance(time.Hour)
	if got := b.take(c.Now(), 10_000); got != 4096 {
		t.Fatalf("an hour idle refilled %d; the bucket holds one second (4096)", got)
	}
}

func TestABucketIgnoresAClockThatGoesBack(t *testing.T) {
	c := newClock()
	b := newBucket(1000)
	b.take(c.Now(), 1000)
	c.advance(-time.Minute)
	if got := b.take(c.Now(), 1000); got != 0 {
		t.Fatalf("a clock moved back a minute refilled %d", got)
	}
	c.advance(time.Minute + 500*time.Millisecond)
	if got := b.take(c.Now(), 1000); got != 500 {
		t.Fatalf("half a second after the last real reading refilled %d; want 500", got)
	}
}

func TestARefundNeverOverfillsAndARateCutTrimsTheBurst(t *testing.T) {
	c := newClock()
	b := newBucket(4096)
	b.take(c.Now(), 100)
	b.give(10_000)
	if got := b.take(c.Now(), 10_000); got != 4096 {
		t.Fatalf("a refund overfilled the bucket to %d", got)
	}
	b.give(4096)
	b.setRate(1024)
	if got := b.take(c.Now(), 10_000); got != 1024 {
		t.Fatalf("after a cut to 1024 B/s the bucket granted %d", got)
	}
}
