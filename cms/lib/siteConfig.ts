/**
 * Single source of truth: re-export site identity from site/src/config/site.ts.
 * Never hardcode SITE_URL / SITE_NAME fallbacks here.
 */
export { SITE_URL, SITE_NAME, SAME_AS } from "../../site/src/config/site.ts";
