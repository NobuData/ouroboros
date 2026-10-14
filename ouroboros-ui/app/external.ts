/**
 * The addresses outside this application that its chrome links to.
 *
 * Named once here so the header's **Help** control, the account menu's version line and any
 * later link agree about where the documentation and the source live. Both open in a new
 * tab: they leave the application, and a person in the middle of something should not lose
 * their place to read a page.
 */

/** The documentation site — where the header's **Help** control goes. */
export const DOCS_URL = "https://docs.ouroboros.build/";

/** The project on GitHub — where the account menu's version line goes. */
export const REPOSITORY_URL = "https://github.com/NobuData/ouroboros";

/**
 * What a link that leaves the application carries besides its address: a new tab, and no
 * handle back to this one for the page it opens.
 */
export const EXTERNAL_LINK = { target: "_blank", rel: "noopener noreferrer" } as const;
