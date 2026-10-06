# Helios bootloader — operator manual

This manual is for the people who ship, pair and recover Helios units
in the field. It covers what the bootloader does before the
application starts, and what the LEDs and the serial console tell you
while it does it.

## What the bootloader does

On power-up the bootloader checks the application image in slot 0
against the signature in its header, using the root public key it was
built with. A valid image boots; an invalid one is left where it is
and the unit falls back to recovery mode. The check takes about
200 ms on the nRF5340 and cannot be switched off.

## Recovery mode

Hold the pairing button while power is applied to recieve a recovery
image over the serial console. The bootloader answers
`helios-recovery>` at 115200 baud and takes the image in 512-byte
chunks. Keep recovery images in a seperate directory from release
images, so a field update cannot pick up the wrong one. If a failure
has occured three times in a row the unit stays in recovery mode
until a person clears it.

## Status LEDs

| LED | Meaning |
|---|---|
| Blue, steady | Verifying the application image |
| Green, one blink | Image accepted, handing over to the application |
| Red, fast blink | Verification failed; recovery mode in 5 s |

If the red LED stays on without blinking, the board has no valid root
key and has to go back to the factory.
