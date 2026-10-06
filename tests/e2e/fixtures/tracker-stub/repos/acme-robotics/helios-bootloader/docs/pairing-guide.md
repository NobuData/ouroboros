# Pairing guide

Pairing binds a Helios unit to one operator console, so the console
can push application images and read telemetry. A unit pairs once;
re-pairing needs the unit in recovery mode.

## Before you start

You need the console within Bluetooth range, the unit powered, and
the unit's serial number from the label on its underside. The blue
LED means the bootloader is still verifying the image and will not
answer a pairing request, so do not start untill it has gone out.

## Pairing

1. On the console, choose *Pair a unit*, type the serial number and
   confirm the Bluetooth adress it shows matches the label.
2. Press the pairing button on the unit once. The green LED blinks
   twice and the console reports *paired*. Confirm within 30 seconds,
   or the unit leaves pairing mode.

## If pairing fails

Most failures are range: move the console closer and try again. If
the console reports a key mismatch, the unit was paired to another
console before and has to be re-paired from recovery mode, which
clears the old binding.
