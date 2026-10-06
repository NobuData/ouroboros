/*
 * Serial recovery: the console the bootloader falls into when no image verifies.
 *
 * It answers `helios-recovery>` and takes an image in 512-byte chunks, each acknowledged
 * before the next is sent (docs/operator-manual.md § Recovery mode). The image is written
 * to slot 0 only after the whole of it has arrived and verified — a half-written slot
 * would otherwise be the next boot's rejected image.
 */

#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/drivers/flash.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/sys/reboot.h>

#include "boot/image_verify.h"

#define RECOVERY_CHUNK  512
#define RECOVERY_PROMPT "helios-recovery> "

static const struct device *const console = DEVICE_DT_GET(DT_CHOSEN(zephyr_console));

static void put(const char *text)
{
	while (*text != '\0') {
		uart_poll_out(console, *text++);
	}
}

static size_t take_chunk(uint8_t *into)
{
	size_t got = 0;
	unsigned char byte;

	while (got < RECOVERY_CHUNK) {
		if (uart_poll_in(console, &byte) == 0) {
			into[got++] = byte;
		} else {
			k_msleep(1);
		}
	}

	return got;
}

static void write_slot0(const uint8_t *image, size_t length)
{
	const struct device *flash = DEVICE_DT_GET(DT_CHOSEN(zephyr_flash_controller));

	flash_erase(flash, CONFIG_HELIOS_SLOT0_ADDR, CONFIG_HELIOS_SLOT0_SIZE);
	flash_write(flash, CONFIG_HELIOS_SLOT0_ADDR, image, length);
}

void helios_recovery_loop(void)
{
	static uint8_t staging[CONFIG_HELIOS_SLOT0_SIZE];
	struct image_header header;
	size_t filled = 0;

	put(RECOVERY_PROMPT);

	for (;;) {
		if (filled + RECOVERY_CHUNK > sizeof(staging)) {
			put("image too large; starting over\n");
			filled = 0;
			continue;
		}

		filled += take_chunk(staging + filled);
		put("ok\n");

		/* The header arrives first, so the length is known from the first chunk on. */
		if (filled < sizeof(header)) {
			continue;
		}
		memcpy(&header, staging, sizeof(header));
		if (filled < sizeof(header) + header.length) {
			continue;
		}

		if (image_verify(staging, filled, &header) != IMAGE_OK) {
			put("image rejected; starting over\n");
			filled = 0;
			continue;
		}

		write_slot0(staging, filled);
		put("written; resetting\n");
		sys_reboot(SYS_REBOOT_COLD);
	}
}
