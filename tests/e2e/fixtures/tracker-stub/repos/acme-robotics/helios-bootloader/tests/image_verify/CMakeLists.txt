# SPDX-License-Identifier: Apache-2.0
cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(helios_image_verify_test LANGUAGES C)

target_sources(app PRIVATE
  test_image_verify.c
  ${CMAKE_CURRENT_SOURCE_DIR}/../../boot/image_verify.c
)
target_include_directories(app PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../..)
