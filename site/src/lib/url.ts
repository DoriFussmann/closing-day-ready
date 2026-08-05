import { SITE_URL } from "../config/site";

/**
 * Join SITE_URL + path, enforcing trailingSlash: 'always'.
 * File endpoints (robots.txt, rss.xml, sitemap-index.xml) should not use this.
 */
export function absoluteUrl(path: string = "/"): string {
  const base = SITE_URL.replace(/\/+$/, "");
  if (!path || path === "/") {
    return `${base}/`;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return `${base}${withSlash}`;
}

/**
 * Resolve a canonical value: absolute http(s) URLs pass through;
 * relative paths go through absoluteUrl().
 */
export function resolveCanonical(canonical: string | undefined, fallbackPath: string): string {
  if (canonical && /^https?:\/\//i.test(canonical)) {
    return canonical;
  }
  if (canonical) {
    return absoluteUrl(canonical);
  }
  return absoluteUrl(fallbackPath);
}
