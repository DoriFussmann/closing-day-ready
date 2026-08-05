import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { SITE_URL } from "./src/config/site.ts";
import { getArticleLastmodMap } from "./src/lib/sitemap.ts";

const articleLastmod = getArticleLastmodMap();

export default defineConfig({
  site: SITE_URL,
  output: "static",
  trailingSlash: "always",
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/404"),
      serialize(item) {
        try {
          const pathname = new URL(item.url).pathname;
          const lastmod = articleLastmod.get(pathname);
          if (lastmod) {
            item.lastmod = lastmod;
          }
        } catch {
          // leave item unchanged
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
