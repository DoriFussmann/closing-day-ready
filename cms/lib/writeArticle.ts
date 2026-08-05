import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { ArticleFrontmatter } from "./schema.js";
import { generateLlmsTxt } from "./generateLlmsTxt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ARTICLES_DIR = path.join(ROOT, "site/src/content/articles");
const ASSETS_DIR = path.join(ROOT, "site/src/assets/articles");

export type StagedImage = {
  slot: "image" | "image2" | "image3";
  absPath: string;
  originalName: string;
};

function extOf(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ext || ".jpg";
}

function toIsoDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().slice(0, 10);
}

/**
 * Build frontmatter object for YAML, omitting optional overrides that match base
 * (ogTitle/ogDescription/ogImage) and omitting unset optionals.
 */
export function buildFrontmatterForWrite(
  data: ArticleFrontmatter,
  imagePaths: { image: string; image2?: string; image3?: string }
): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    title: data.title,
    description: data.description,
    slug: data.slug,
    date: toIsoDate(data.date),
    author: data.author,
    category: data.category,
    tags: data.tags,
    image: imagePaths.image,
    imageAlt: data.imageAlt,
    robots: data.robots ?? "index, follow",
    schemaType: data.schemaType ?? "BlogPosting",
    locale: data.locale ?? "en-US",
    twitterCard: data.twitterCard ?? "summary_large_image",
    draft: data.draft ?? false,
  };

  if (data.h1 && data.h1 !== data.title) {
    fm.h1 = data.h1;
  } else if (data.h1) {
    // User explicitly set h1 even if same as title — only save if different per spirit of og rules?
    // Spec for h1: optional, layout falls back to title. Saving identical h1 is harmless but
    // og rules say only save when different. Apply same: only write h1 when different from title.
  }

  const updated = data.updatedDate || data.date;
  fm.updatedDate = toIsoDate(updated);

  if (data.keywords?.length) fm.keywords = data.keywords;
  if (data.canonical) fm.canonical = data.canonical;

  if (imagePaths.image2) {
    fm.image2 = imagePaths.image2;
    fm.image2Alt = data.image2Alt;
  }
  if (imagePaths.image3) {
    fm.image3 = imagePaths.image3;
    fm.image3Alt = data.image3Alt;
  }

  // Only write og* when explicitly different from base
  if (data.ogTitle && data.ogTitle !== data.title) fm.ogTitle = data.ogTitle;
  if (data.ogDescription && data.ogDescription !== data.description) {
    fm.ogDescription = data.ogDescription;
  }
  if (data.ogImage && data.ogImage !== data.image) fm.ogImage = data.ogImage;

  if (data.internalLinks?.length) fm.internalLinks = data.internalLinks;
  if (data.externalLinks?.length) fm.externalLinks = data.externalLinks;
  if (data.faqs?.length) fm.faqs = data.faqs;

  return fm;
}

export function writeArticle(options: {
  data: ArticleFrontmatter;
  body: string;
  stagedImages: StagedImage[];
  overwrite?: boolean;
}): { path: string; slug: string } {
  const { data, body, stagedImages, overwrite = false } = options;
  const slug = data.slug;

  fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  const outMd = path.join(ARTICLES_DIR, `${slug}.md`);

  if (fs.existsSync(outMd) && !overwrite) {
    throw new Error(`Slug collision: ${slug}.md already exists. Pass overwrite or rename.`);
  }

  const assetDir = path.join(ASSETS_DIR, slug);
  fs.mkdirSync(assetDir, { recursive: true });

  const imagePaths: { image: string; image2?: string; image3?: string } = {
    image: "",
  };

  for (const staged of stagedImages) {
    const ext = extOf(staged.originalName);
    const basename =
      staged.slot === "image" ? `hero${ext}` : staged.slot === "image2" ? `image2${ext}` : `image3${ext}`;
    const dest = path.join(assetDir, basename);
    fs.copyFileSync(staged.absPath, dest);
    // Relative path from content/articles/{slug}.md → assets/articles/{slug}/{file}
    const rel = `../../assets/articles/${slug}/${basename}`;
    if (staged.slot === "image") imagePaths.image = rel;
    if (staged.slot === "image2") imagePaths.image2 = rel;
    if (staged.slot === "image3") imagePaths.image3 = rel;
  }

  if (!imagePaths.image) {
    throw new Error("Hero image is required — no staged image for slot image.");
  }

  const fm = buildFrontmatterForWrite(data, imagePaths);
  // Enforce filename == slug
  if (fm.slug !== slug) {
    throw new Error("Internal error: slug mismatch.");
  }

  const yaml = YAML.stringify(fm, { lineWidth: 0 }).trimEnd();
  const content = `---\n${yaml}\n---\n\n${body.trim()}\n`;
  fs.writeFileSync(outMd, content, "utf8");

  generateLlmsTxt();

  return { path: outMd, slug };
}

export function listArticles(): Array<{
  slug: string;
  title: string;
  draft: boolean;
  updatedDate?: string;
  date?: string;
  internalLinks: number;
  externalLinks: number;
  faqs: number;
  file: string;
}> {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  return fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), "utf8");
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const fm = match ? YAML.parse(match[1]) : {};
      return {
        slug: String(fm.slug || file.replace(/\.md$/, "")),
        title: String(fm.title || file),
        draft: Boolean(fm.draft),
        updatedDate: fm.updatedDate ? String(fm.updatedDate) : undefined,
        date: fm.date ? String(fm.date) : undefined,
        internalLinks: Array.isArray(fm.internalLinks) ? fm.internalLinks.length : 0,
        externalLinks: Array.isArray(fm.externalLinks) ? fm.externalLinks.length : 0,
        faqs: Array.isArray(fm.faqs) ? fm.faqs.length : 0,
        file,
      };
    });
}

export function readArticleFile(slug: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  filename: string;
} | null {
  const file = path.join(ARTICLES_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw, filename: `${slug}.md` };
  return {
    frontmatter: YAML.parse(match[1]) || {},
    body: (match[2] || "").trim(),
    filename: `${slug}.md`,
  };
}

export function setArticleDraft(slug: string, draft: boolean): void {
  const existing = readArticleFile(slug);
  if (!existing) throw new Error(`Article not found: ${slug}`);
  const fm = { ...existing.frontmatter, draft };
  const yaml = YAML.stringify(fm, { lineWidth: 0 }).trimEnd();
  const content = `---\n${yaml}\n---\n\n${existing.body}\n`;
  fs.writeFileSync(path.join(ARTICLES_DIR, `${slug}.md`), content, "utf8");
  generateLlmsTxt();
}

export function deleteArticle(slug: string): void {
  const file = path.join(ARTICLES_DIR, `${slug}.md`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const assetDir = path.join(ASSETS_DIR, slug);
  if (fs.existsSync(assetDir)) {
    fs.rmSync(assetDir, { recursive: true, force: true });
  }
  generateLlmsTxt();
}

export { ARTICLES_DIR, ASSETS_DIR, ROOT };
