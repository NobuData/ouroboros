/*
 * Helios bootloader — entry point.
 *
 * Verify the application image in slot 0, print the banner, and hand over. When the image
 * does not verify, drop into serial recovery and stay there: a unit that boots an image
 * nobody signed is worse than a unit that does not boot.
 */

#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/logging/log.h>

#include "boot/image_verify.h"
#include "src/boot_banner.h"

LOG_MODULE_REGISTER(helios_boot, CONFIG_HELIOS_BOOT_LOG_LEVEL);

/* Slot 0: the application image, immediately after the bootloader partition. */
#define HELIOS_SLOT0_ADDR CONFIG_HELIOS_SLOT0_ADDR
#define HELIOS_SLOT0_SIZE CONFIG_HELIOS_SLOT0_SIZE

static const struct gpio_dt_spec led_red = GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios);
static const struct gpio_dt_spec led_green = GPIO_DT_SPEC_GET(DT_ALIAS(led1), gpios);

static void enter_recovery(enum image_verdict verdict)
{
	LOG_ERR("image rejected (%d); entering serial recovery", verdict);
	gpio_pin_set_dt(&led_red, 1);
	helios_recovery_loop();
}

int main(void)
{
	struct image_header header;
	enum image_verdict verdict;

	gpio_pin_configure_dt(&led_red, GPIO_OUTPUT_INACTIVE);
	gpio_pin_configure_dt(&led_green, GPIO_OUTPUT_INACTIVE);

	boot_banner_print();

	verdict = image_verify((const void *)HELIOS_SLOT0_ADDR, HELIOS_SLOT0_SIZE, &header);
	if (verdict != IMAGE_OK) {
		enter_recovery(verdict);
		return 0;
	}

	LOG_INF("image v%u.%u.%u verified, jumping", header.major, header.minor, header.patch);
	gpio_pin_set_dt(&led_green, 1);
	boot_jump(header.entry);

	return 0;
}
