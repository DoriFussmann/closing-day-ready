import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";
import { SITE_NAME, SITE_URL } from "../config/site";
import { absoluteUrl } from "../lib/url";

export async function GET(context: APIContext) {
  const articles = (await getCollection("articles"))
    .filter((a) => !a.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: SITE_NAME,
    description: `${SITE_NAME} article feed`,
    site: SITE_URL,
    items: articles.map((article) => ({
      title: article.data.title,
      description: article.data.description,
      pubDate: article.data.date,
      link: absoluteUrl(`/articles/${article.data.slug}/`),
    })),
  });
}
