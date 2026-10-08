import MDXComponents from "@theme-original/MDXComponents";

import EnvVar from "../components/EnvVar";
import SectionCards from "../components/SectionCards";
import Since from "../components/Since";
import UiPath from "../components/UiPath";

/**
 * The components every page can use without importing them (CY.4, #1167): Docusaurus'
 * own MDX components, plus the site's shared ones. See the README's Authoring section.
 */
export default {
  ...MDXComponents,
  EnvVar,
  SectionCards,
  Since,
  UiPath,
};
