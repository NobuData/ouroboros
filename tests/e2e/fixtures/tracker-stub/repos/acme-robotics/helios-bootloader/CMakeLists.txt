# SPDX-License-Identifier: Apache-2.0
#
# The Helios bootloader, as a Zephyr application: `west build -b native_sim` for the host
# build the tests run on, `west build -b nrf5340dk/nrf5340/cpuapp` for a unit.
cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(helios_bootloader LANGUAGES C)

target_sources(app PRIVATE
  src/main.c
  src/boot_banner.c
  src/recovery.c
  boot/image_verify.c
)
