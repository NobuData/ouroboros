# Root public key

`root-pub.pem` is the public half of the Helios root signing key. The bootloader is built
with it (`boot/image_verify.c` imports it through PSA), so an image signed by any other key
is rejected and the unit falls back to recovery.

Rotating it is a factory operation, not a code change: every unit in the field verifies
against the key it shipped with. Nothing under `keys/` is edited in an ordinary pull
request, which is why the directory is a protected path.

The private half is not in this repository and never will be. It lives in the signing HSM;
the release pipeline asks it to sign and only the signature comes back.
