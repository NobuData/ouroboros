/*
 * The boot banner: one line on the console before verification starts, so a unit that
 * hangs in the verifier still says which bootloader it runs.
 */

#include <zephyr/kernel.h>
#include <zephyr/sys/printk.h>
#include <zephyr/drivers/hwinfo.h>

#include "src/boot_banner.h"

#define BANNER_ID_BYTES 8

void boot_banner_print(void)
{
	uint8_t id[BANNER_ID_BYTES] = {0};
	ssize_t got = hwinfo_get_device_id(id, sizeof(id));

	printk("*** Helios bootloader %s (%s) ***\n", HELIOS_BOOT_VERSION, CONFIG_BOARD);

	if (got <= 0) {
		printk("device id: unavailable\n");
		return;
	}

	printk("device id: ");
	for (ssize_t i = 0; i < got; i++) {
		printk("%02x", id[i]);
	}
	printk("\n");
}
