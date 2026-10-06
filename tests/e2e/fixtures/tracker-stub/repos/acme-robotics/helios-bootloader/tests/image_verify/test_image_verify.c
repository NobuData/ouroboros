/*
 * The verifier's suite: one test per verdict. The images are built in RAM from a header
 * and a body and signed with the suite's test key, so the suite runs on native_sim
 * without a device.
 */

#include <string.h>

#include <zephyr/ztest.h>

#include "boot/image_verify.h"

#define BODY_BYTES 256

static uint8_t slot[sizeof(struct image_header) + BODY_BYTES];

static struct image_header *make_image(uint32_t length)
{
	struct image_header *header = (struct image_header *)slot;

	memset(slot, 0xA5, sizeof(slot));
	header->magic = IMAGE_MAGIC;
	header->major = 1;
	header->minor = 2;
	header->patch = 3;
	header->length = length;
	header->entry = 0x10200;
	helios_test_sign(header, slot + sizeof(*header));

	return header;
}

ZTEST_SUITE(image_verify, NULL, NULL, NULL, NULL, NULL);

ZTEST(image_verify, test_a_signed_image_is_accepted)
{
	struct image_header out;

	make_image(BODY_BYTES);

	zassert_equal(image_verify(slot, sizeof(slot), &out), IMAGE_OK);
	zassert_equal(out.entry, 0x10200, "entry copied out");
}

ZTEST(image_verify, test_a_bad_magic_is_rejected_before_the_signature)
{
	struct image_header out;
	struct image_header *header = make_image(BODY_BYTES);

	header->magic = 0xDEADBEEF;

	zassert_equal(image_verify(slot, sizeof(slot), &out), IMAGE_BAD_MAGIC);
}

ZTEST(image_verify, test_an_image_longer_than_the_slot_is_rejected)
{
	struct image_header out;
	struct image_header *header = make_image(BODY_BYTES);

	header->length = BODY_BYTES + 1;

	zassert_equal(image_verify(slot, sizeof(slot), &out), IMAGE_TOO_LARGE);
}

ZTEST(image_verify, test_a_flipped_byte_fails_the_signature)
{
	struct image_header out;

	make_image(BODY_BYTES);
	slot[sizeof(struct image_header) + 17] ^= 0x01;

	zassert_equal(image_verify(slot, sizeof(slot), &out), IMAGE_BAD_SIGNATURE);
}
