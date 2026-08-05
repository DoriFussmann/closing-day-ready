import type { APIRoute } from "astro";
import { SITE_URL } from "../config/site";

export const GET: APIRoute = () => {
  const base = SITE_URL.replace(/\/+$/, "");
  const body = `User-agent: *
Allow: /

Sitemap: ${base}/sitemap-index.xml
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
