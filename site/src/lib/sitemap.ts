import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const articlesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../content/articles"
);

/**
 * Build a map of article page URLs (path portion) → lastmod ISO date
 * from frontmatter updatedDate (fallback: date).
 */
export function getArticleLastmodMap(): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(articlesDir)) return map;

  for (const file of fs.readdirSync(articlesDir)) {
    if (!file.endsWith(".md")) continue;
    const raw = fs.readFileSync(path.join(articlesDir, file), "utf8");
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) continue;
    const fm = match[1];
    const draft = /^\s*draft:\s*true\s*$/m.test(fm);
    if (draft) continue;
    const slugMatch = fm.match(/^\s*slug:\s*["']?([^"'\n]+)["']?\s*$/m);
    const updatedMatch = fm.match(/^\s*updatedDate:\s*["']?([^"'\n]+)["']?\s*$/m);
    const dateMatch = fm.match(/^\s*date:\s*["']?([^"'\n]+)["']?\s*$/m);
    const slug = slugMatch?.[1]?.trim() ?? file.replace(/\.md$/, "");
    const dateStr = updatedMatch?.[1]?.trim() || dateMatch?.[1]?.trim();
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) continue;
    map.set(`/articles/${slug}/`, d.toISOString());
  }
  return map;
}
