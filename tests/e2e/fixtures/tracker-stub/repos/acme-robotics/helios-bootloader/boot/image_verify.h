/*
 * Image verification — the one decision the bootloader makes.
 *
 * Everything under boot/ is a protected path: a change here is signed off by a signing
 * engineer, never merged by a loop on its own.
 */

#ifndef HELIOS_BOOT_IMAGE_VERIFY_H_
#define HELIOS_BOOT_IMAGE_VERIFY_H_

#include <stddef.h>
#include <stdint.h>

/* The header every signed image starts with. */
#define IMAGE_MAGIC     0x48454c49u /* "HELI" */
#define IMAGE_SIG_BYTES 64

struct image_header {
	uint32_t magic;
	uint8_t major;
	uint8_t minor;
	uint8_t patch;
	uint8_t reserved;
	uint32_t length; /* bytes of image after the header */
	uint32_t entry;  /* the application's reset vector */
	uint8_t sig[IMAGE_SIG_BYTES];
};

enum image_verdict {
	IMAGE_OK = 0,
	IMAGE_BAD_MAGIC,
	IMAGE_TOO_LARGE,
	IMAGE_BAD_SIGNATURE,
};

enum image_verdict image_verify(const void *slot, size_t slot_size, struct image_header *out);

/* The board port's half (boards/<board>/jump.c): relocate the vector table and go. */
void boot_jump(uint32_t entry);

/* The serial recovery console (docs/operator-manual.md § Recovery mode). Never returns. */
void helios_recovery_loop(void);

#endif /* HELIOS_BOOT_IMAGE_VERIFY_H_ */
