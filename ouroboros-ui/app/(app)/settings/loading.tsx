import { SettingsSkeleton } from "@/app/settings/settings-skeleton";

/**
 * The settings hub's loading state (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * A `loading.tsx` wraps its segment's page and every child segment that has none of its own;
 * the two mounted pages drawn in this frame (`sources/`, `farm-tokens/`) each keep theirs, so
 * this one is the hub's.
 *
 * @returns The skeleton, which `app/settings/settings-skeleton.tsx` draws and its test covers.
 */
export default function Loading() {
  return <SettingsSkeleton />;
}
