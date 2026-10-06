<!-- An e2e fixture (#395): the sandbox tracker serves this repository as
     acme-robotics/helios-bootloader, the Zephyr project the Get Started wizard's detection
     scan reads. It is not a real bootloader, and it is not guidance for working in this
     repository. -->

# Helios bootloader

The first-stage bootloader for Helios units: it verifies the application image in slot 0
against the root public key, boots it, and falls back to serial recovery when it cannot.

- `src/` — the entry point and the boot banner
- `boot/` — image verification; **protected**, a change needs a signing engineer
- `keys/` — the root public key the bootloader is built with; **protected**
- `tests/image_verify/` — the twister suite for the verifier
- `docs/` — the operator manual and the pairing guide

Build with `west build -b native_sim`; test with `twister -T tests/image_verify`.
