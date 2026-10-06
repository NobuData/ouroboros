/*
 * Verify the image in a slot against the root public key.
 *
 * The key is compiled in from keys/root-pub.pem (see keys/README.md); there is no runtime
 * key store, on purpose. The verdict is an enum rather than a bool so recovery can say why.
 */

#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <psa/crypto.h>

#include "boot/image_verify.h"

LOG_MODULE_DECLARE(helios_boot);

/* keys/root-pub.pem, as the build renders it. */
extern const uint8_t helios_root_pub[];
extern const size_t helios_root_pub_len;

static bool signature_valid(const struct image_header *header, const uint8_t *image)
{
	psa_key_id_t key;
	psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
	psa_status_t status;

	psa_set_key_usage_flags(&attributes, PSA_KEY_USAGE_VERIFY_MESSAGE);
	psa_set_key_algorithm(&attributes, PSA_ALG_ECDSA(PSA_ALG_SHA_256));
	psa_set_key_type(&attributes, PSA_KEY_TYPE_ECC_PUBLIC_KEY(PSA_ECC_FAMILY_SECP_R1));

	status = psa_import_key(&attributes, helios_root_pub, helios_root_pub_len, &key);
	if (status != PSA_SUCCESS) {
		LOG_ERR("root key did not import (%d)", status);
		return false;
	}

	status = psa_verify_message(key, PSA_ALG_ECDSA(PSA_ALG_SHA_256), image, header->length,
				    header->sig, sizeof(header->sig));
	psa_destroy_key(key);

	return status == PSA_SUCCESS;
}

enum image_verdict image_verify(const void *slot, size_t slot_size, struct image_header *out)
{
	const struct image_header *header = slot;
	const uint8_t *image = (const uint8_t *)slot + sizeof(*header);

	if (header->magic != IMAGE_MAGIC) {
		return IMAGE_BAD_MAGIC;
	}
	if (header->length > slot_size - sizeof(*header)) {
		return IMAGE_TOO_LARGE;
	}
	if (!signature_valid(header, image)) {
		return IMAGE_BAD_SIGNATURE;
	}

	memcpy(out, header, sizeof(*out));
	return IMAGE_OK;
}
