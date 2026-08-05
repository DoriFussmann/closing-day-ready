import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { SITE_NAME, SITE_URL } from "./siteConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ARTICLES_DIR = path.join(ROOT, "site/src/content/articles");
const LLMS_PATH = path.join(ROOT, "site/public/llms.txt");

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function absoluteArticleUrl(siteUrl: string, slug: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/articles/${slug}/`;
}

/**
 * Rebuilds public/llms.txt from all non-draft articles.
 * Never hand-edit the output file.
 */
export function generateLlmsTxt(): string {
  const articles: Array<{ title: string; slug: string; description: string; date: Date }> = [];

  if (fs.existsSync(ARTICLES_DIR)) {
    for (const file of fs.readdirSync(ARTICLES_DIR)) {
      if (!file.endsWith(".md")) continue;
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), "utf8");
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!match) continue;
      const fm = YAML.parse(match[1]) || {};
      if (fm.draft === true) continue;
      articles.push({
        title: String(fm.title || file),
        slug: String(fm.slug || file.replace(/\.md$/, "")),
        description: String(fm.description || ""),
        date: new Date(fm.date || 0),
      });
    }
  }

  articles.sort((a, b) => b.date.valueOf() - a.date.valueOf());

  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_NAME} publishes structured articles optimized for search and answer engines.`,
    "",
    "## Articles",
    "",
  ];

  for (const a of articles) {
    const url = absoluteArticleUrl(SITE_URL, a.slug);
    lines.push(`- [${a.title}](${withTrailingSlash(url)}): ${a.description}`);
  }

  if (articles.length === 0) {
    lines.push("- No published articles yet.");
  }

  lines.push("");
  const body = lines.join("\n");
  fs.mkdirSync(path.dirname(LLMS_PATH), { recursive: true });
  fs.writeFileSync(LLMS_PATH, body, "utf8");
  return body;
}
