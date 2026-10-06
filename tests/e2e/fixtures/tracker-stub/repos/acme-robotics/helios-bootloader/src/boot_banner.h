/* The boot banner — see boot_banner.c. */

#ifndef HELIOS_SRC_BOOT_BANNER_H_
#define HELIOS_SRC_BOOT_BANNER_H_

/* The version the banner prints; the build sets it from `git describe`. */
#ifndef HELIOS_BOOT_VERSION
#define HELIOS_BOOT_VERSION "0.4.1"
#endif

void boot_banner_print(void);

#endif /* HELIOS_SRC_BOOT_BANNER_H_ */
