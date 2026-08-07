import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import matter from "gray-matter";
import { loadEnvFiles } from "./lib/loadEnv.js";
import { articleFrontmatterSchema, teamFrontmatterSchema } from "./lib/schema.js";
import {
  formatMissingSummary,
  validateArticleInput,
} from "./lib/validateFrontmatter.js";
import {
  deleteArticle,
  listArticles,
  patchArticleContent,
  readArticleFile,
  setArticleDraft,
  writeArticle,
  type StagedImage,
} from "./lib/writeArticle.js";
import {
  absoluteArticleUrl,
  addExternalLinksSelected,
  buildArticlesHealthReport,
  ensureSignpost,
  EXTERNAL_SIGNPOST,
  INTERNAL_SIGNPOST,
  mergeExternalLinks,
  proposeAllExternalLinks,
  proposeExternalLinks,
} from "./lib/articlesHealth.js";
import {
  applyArticleUpdate,
  parseArticleUpdateFile,
  previewArticleUpdates,
} from "./lib/articlesUpdate.js";
import {
  isPageSpeedConfigured,
  runPageSpeedScan,
} from "./lib/pageSpeed.js";
import {
  deleteTeamMember,
  knownAuthorSlugs,
  listTeam,
  readTeamMember,
  writeTeamMember,
} from "./lib/writeTeamMember.js";
import { generateLlmsTxt } from "./lib/generateLlmsTxt.js";
import { SITE_URL } from "./lib/siteConfig.js";

loadEnvFiles();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE_ROOT = path.join(ROOT, "site");
const STAGING_DIR = path.join(__dirname, "staging");
const PUBLIC_DIR = path.join(__dirname, "public");
const SERVICES_DIR = path.join(SITE_ROOT, "src/content/services");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

fs.mkdirSync(STAGING_DIR, { recursive: true });

const app = express();
const PORT = Number(process.env.CMS_PORT) || 4322;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

function readSiteUrl(): string {
  return SITE_URL;
}

function jsonError(res: Response, status: number, message: string, details?: unknown) {
  return res.status(status).json({ ok: false, error: message, details });
}

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STAGING_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const ok =
      file.mimetype.startsWith("image/") ||
      name.endsWith(".md") ||
      name.endsWith(".json") ||
      file.mimetype === "text/markdown" ||
      file.mimetype === "text/plain" ||
      file.mimetype === "application/json";
    cb(null, ok);
  },
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, maxFileSizeBytes: MAX_FILE_SIZE });
});

app.get("/api/config", (_req, res) => {
  res.json({ ok: true, siteUrl: readSiteUrl(), maxFileSizeBytes: MAX_FILE_SIZE });
});

app.get(
  "/articles",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, articles: listArticles() });
  })
);

app.get(
  "/api/articles/:slug",
  asyncHandler(async (req, res) => {
    const article = readArticleFile(req.params.slug);
    if (!article) return jsonError(res, 404, "Article not found");
    res.json({ ok: true, ...article });
  })
);

app.get(
  "/api/team",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, team: listTeam() });
  })
);

app.get(
  "/api/team/:slug",
  asyncHandler(async (req, res) => {
    const member = readTeamMember(req.params.slug);
    if (!member) return jsonError(res, 404, "Team member not found");
    res.json({ ok: true, ...member });
  })
);

app.get(
  "/api/routes",
  asyncHandler(async (_req, res) => {
    const articles = listArticles().map((a) => `/articles/${a.slug}/`);
    const team = listTeam().map((t) => `/team/#${t.slug}`);
    const services: string[] = [];
    if (fs.existsSync(SERVICES_DIR)) {
      for (const file of fs.readdirSync(SERVICES_DIR)) {
        if (!file.endsWith(".md")) continue;
        services.push(`/`); // services only on home
      }
    }
    res.json({
      ok: true,
      routes: [
        "/",
        "/articles/",
        "/team/",
        ...articles,
        ...team,
        ...services,
      ],
    });
  })
);

app.post(
  "/parse",
  upload.single("markdown"),
  asyncHandler(async (req, res) => {
    if (!req.file) return jsonError(res, 400, "No markdown file uploaded");
    const raw = fs.readFileSync(req.file.path, "utf8");
    const parsed = matter(raw);
    res.json({
      ok: true,
      frontmatter: parsed.data,
      body: parsed.content.trim(),
      filename: req.file.originalname,
    });
  })
);

app.post(
  "/api/validate",
  asyncHandler(async (req, res) => {
    const { frontmatter, sessionImages } = req.body || {};
    const result = validateArticleInput(frontmatter || {}, {
      sessionImages: sessionImages || { image: false, image2: false, image3: false },
      knownAuthors: knownAuthorSlugs(),
      siteUrl: readSiteUrl(),
    });
    res.json({
      ok: true,
      ...result,
      summary: formatMissingSummary(result),
    });
  })
);

app.post(
  "/api/preview-jsonld",
  asyncHandler(async (req, res) => {
    const fm = req.body?.frontmatter || {};
    const siteUrl = readSiteUrl().replace(/\/+$/, "");
    const authorSlug = String(fm.author || "");
    const author = readTeamMember(authorSlug);
    const slug = String(fm.slug || "preview");
    const articleUrl = `${siteUrl}/articles/${slug}/`;

    const person = author
      ? {
          "@context": "https://schema.org",
          "@type": "Person",
          name: author.frontmatter.name,
          jobTitle: author.frontmatter.role,
          description: author.frontmatter.bio,
          url: `${siteUrl}/team/#${authorSlug}`,
          sameAs: author.frontmatter.sameAs || [],
        }
      : { error: "Author not found" };

    const article = {
      "@context": "https://schema.org",
      "@type": fm.schemaType || "BlogPosting",
      headline: fm.title,
      description: fm.description,
      datePublished: fm.date,
      dateModified: fm.updatedDate || fm.date,
      author: {
        "@type": "Person",
        name: author?.frontmatter.name || authorSlug,
      },
      mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl },
    };

    const breadcrumbs = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
        {
          "@type": "ListItem",
          position: 2,
          name: "Articles",
          item: `${siteUrl}/articles/`,
        },
        { "@type": "ListItem", position: 3, name: fm.title, item: articleUrl },
      ],
    };

    const faqs = Array.isArray(fm.faqs) ? fm.faqs : [];
    const faqPage =
      faqs.length > 0
        ? {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqs.map((f: { question: string; answer: string }) => ({
              "@type": "Question",
              name: f.question,
              acceptedAnswer: { "@type": "Answer", text: f.answer },
            })),
          }
        : null;

    res.json({ ok: true, schemas: { article, person, breadcrumbs, faqPage } });
  })
);

app.post(
  "/api/generate",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "image2", maxCount: 1 },
    { name: "image3", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(req.body.payload || "{}"));
    } catch {
      return jsonError(res, 400, "Invalid JSON payload");
    }

    const frontmatter = (payload.frontmatter || {}) as Record<string, unknown>;
    const body = String(payload.body || "");
    const overwrite = Boolean(payload.overwrite);

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const sessionImages = {
      image: Boolean(files?.image?.[0]),
      image2: Boolean(files?.image2?.[0]),
      image3: Boolean(files?.image3?.[0]),
    };

    const result = validateArticleInput(frontmatter, {
      sessionImages,
      knownAuthors: knownAuthorSlugs(),
      siteUrl: readSiteUrl(),
    });

    if (!result.valid || !result.data) {
      return jsonError(res, 400, formatMissingSummary(result), {
        missing: result.missing,
        invalid: result.invalid,
      });
    }

    const staged: StagedImage[] = [];
    for (const slot of ["image", "image2", "image3"] as const) {
      const f = files?.[slot]?.[0];
      if (f) {
        staged.push({
          slot,
          absPath: f.path,
          originalName: f.originalname,
        });
      }
    }

    try {
      // Merge validated data with link arrays from payload (zod may have them)
      const data = articleFrontmatterSchema.parse({
        ...result.data,
        ...frontmatter,
        image: "session://image",
        image2: sessionImages.image2 ? "session://image2" : undefined,
        image3: sessionImages.image3 ? "session://image3" : undefined,
      });

      const written = writeArticle({
        data,
        body,
        stagedImages: staged,
        overwrite,
      });
      res.json({
        ok: true,
        slug: written.slug,
        path: written.path,
        llmsTxt: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to write article";
      return jsonError(res, 400, message);
    }
  })
);

app.post(
  "/api/articles/:slug/draft",
  asyncHandler(async (req, res) => {
    const draft = Boolean(req.body?.draft);
    setArticleDraft(req.params.slug, draft);
    res.json({ ok: true, slug: req.params.slug, draft });
  })
);

app.delete(
  "/api/articles/:slug",
  asyncHandler(async (req, res) => {
    deleteArticle(req.params.slug);
    res.json({ ok: true });
  })
);

app.get(
  "/api/articles-health",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...buildArticlesHealthReport() });
  })
);

app.post(
  "/api/articles/:slug/pagespeed",
  asyncHandler(async (req, res) => {
    if (!isPageSpeedConfigured()) {
      return jsonError(
        res,
        503,
        "GOOGLE_PAGESPEED_API_KEY is not configured. Add it to cms/.env.local."
      );
    }

    const slug = req.params.slug;
    const article = readArticleFile(slug);
    if (!article) return jsonError(res, 404, "Article not found");
    if (article.frontmatter.draft) {
      return jsonError(
        res,
        400,
        "Scan unavailable — article is not Published, so there is no live URL to test."
      );
    }

    const publishedUrl = absoluteArticleUrl(slug);
    try {
      const result = await runPageSpeedScan(slug, publishedUrl);
      res.json({ ok: true, ...result });
    } catch (err) {
      return jsonError(
        res,
        502,
        err instanceof Error ? err.message : "PageSpeed scan failed"
      );
    }
  })
);

app.get(
  "/api/articles/:slug/propose-external",
  asyncHandler(async (req, res) => {
    try {
      const result = proposeExternalLinks(req.params.slug);
      res.json({ ok: true, ...result });
    } catch (err) {
      return jsonError(
        res,
        404,
        err instanceof Error ? err.message : "Propose failed"
      );
    }
  })
);

app.post(
  "/api/articles-health/propose-external",
  asyncHandler(async (req, res) => {
    try {
      const slug = req.body?.slug ? String(req.body.slug).trim() : undefined;
      const result = proposeAllExternalLinks(slug ? { slug } : undefined);
      res.json({ ok: true, ...result });
    } catch (err) {
      return jsonError(
        res,
        400,
        err instanceof Error ? err.message : "Propose all failed"
      );
    }
  })
);

app.post(
  "/api/articles-health/add-external-selected",
  asyncHandler(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) {
      return jsonError(res, 400, "items array is required");
    }
    const normalized = items.map(
      (item: { slug?: string; label?: string; url?: string }) => ({
        slug: String(item?.slug || "").trim(),
        label: String(item?.label || "").trim(),
        url: String(item?.url || "").trim(),
      })
    );
    const result = addExternalLinksSelected(normalized);
    res.json({ ok: true, ...result });
  })
);

app.post(
  "/api/articles/:slug/links/external",
  asyncHandler(async (req, res) => {
    const label = String(req.body?.label || "").trim();
    const url = String(req.body?.url || "").trim();
    if (!label || !url) {
      return jsonError(res, 400, "label and url are required");
    }
    const existing = readArticleFile(req.params.slug);
    if (!existing) return jsonError(res, 404, "Article not found");

    const existingLinks = Array.isArray(existing.frontmatter.externalLinks)
      ? [...(existing.frontmatter.externalLinks as Array<{ label: string; url: string }>)]
      : [];
    const merged = mergeExternalLinks(existingLinks, [{ label, url }]);
    if (!merged.written.length) {
      return jsonError(res, 400, "External link already present");
    }

    const body = ensureSignpost(existing.body, EXTERNAL_SIGNPOST);
    const result = patchArticleContent(req.params.slug, {
      frontmatterPatch: { externalLinks: merged.links },
      body,
      bumpUpdatedDate: true,
    });
    res.json({
      ok: true,
      ...result,
      externalLinks: merged.links,
      trimmed: merged.trimmed,
    });
  })
);

app.post(
  "/api/articles/:slug/links/internal",
  asyncHandler(async (req, res) => {
    const targetSlug = String(req.body?.targetSlug || "").trim();
    if (!targetSlug) return jsonError(res, 400, "targetSlug is required");

    const existing = readArticleFile(req.params.slug);
    if (!existing) return jsonError(res, 404, "Article not found");
    const target = readArticleFile(targetSlug);
    if (!target) return jsonError(res, 404, "Target article not found");
    if (target.frontmatter.draft) {
      return jsonError(res, 400, "Cannot link to a draft article");
    }

    const label = String(
      req.body?.label || target.frontmatter.title || targetSlug
    ).trim();
    const pathUrl = `/articles/${targetSlug}/`;

    const links = Array.isArray(existing.frontmatter.internalLinks)
      ? [...(existing.frontmatter.internalLinks as Array<{ label: string; url: string }>)]
      : [];
    const norm = (u: string) => u.replace(/\/+$/, "");
    if (links.some((l) => norm(l.url) === norm(pathUrl))) {
      return jsonError(res, 400, "Internal link already present");
    }
    links.push({ label, url: pathUrl });

    const body = ensureSignpost(existing.body, INTERNAL_SIGNPOST);
    const result = patchArticleContent(req.params.slug, {
      frontmatterPatch: { internalLinks: links },
      body,
      bumpUpdatedDate: true,
    });
    res.json({
      ok: true,
      ...result,
      internalLinks: links,
      connected: {
        slug: targetSlug,
        label,
        url: pathUrl,
        href: absoluteArticleUrl(targetSlug),
      },
    });
  })
);

app.post(
  "/api/team",
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(req.body.payload || "{}"));
    } catch {
      return jsonError(res, 400, "Invalid JSON payload");
    }

    const overwrite = Boolean(payload.overwrite);
    const keepExistingPhoto = Boolean(payload.keepExistingPhoto);
    const parsed = teamFrontmatterSchema.safeParse({
      ...payload,
      photo: req.file ? "session://photo" : payload.photo || "",
      sameAs: Array.isArray(payload.sameAs)
        ? payload.sameAs
        : String(payload.sameAs || "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
    });

    if (!parsed.success) {
      return jsonError(res, 400, "Team validation failed", parsed.error.issues);
    }

    try {
      const written = writeTeamMember({
        data: parsed.data,
        photoAbsPath: req.file?.path,
        photoOriginalName: req.file?.originalname,
        overwrite,
        keepExistingPhoto: keepExistingPhoto && !req.file,
      });
      res.json({ ok: true, slug: written.slug, path: written.path });
    } catch (err) {
      return jsonError(
        res,
        400,
        err instanceof Error ? err.message : "Failed to write team member"
      );
    }
  })
);

app.delete(
  "/api/team/:slug",
  asyncHandler(async (req, res) => {
    deleteTeamMember(req.params.slug);
    res.json({ ok: true });
  })
);

app.post(
  "/api/llms",
  asyncHandler(async (_req, res) => {
    const body = generateLlmsTxt();
    res.json({ ok: true, body });
  })
);

app.post(
  "/api/articles-update/preview",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    let text = "";
    let filename = "";
    if (req.file) {
      text = fs.readFileSync(req.file.path, "utf8");
      filename = req.file.originalname || req.file.filename;
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore staging cleanup */
      }
    } else if (typeof req.body?.text === "string") {
      text = req.body.text;
      filename = String(req.body.filename || "");
    } else {
      return jsonError(res, 400, "Drop a JSON or YAML-frontmatter .md update file");
    }

    try {
      const entries = parseArticleUpdateFile(text, filename);
      const preview = previewArticleUpdates(entries);
      res.json({
        ok: true,
        filename,
        total: entries.length,
        ...preview,
      });
    } catch (err) {
      return jsonError(
        res,
        400,
        err instanceof Error ? err.message : "Failed to parse update file"
      );
    }
  })
);

app.post(
  "/api/articles-update/confirm",
  asyncHandler(async (req, res) => {
    const slug = String(req.body?.slug || "").trim();
    const newParagraph = String(req.body?.newParagraph || "").trim();
    const newUpdatedDate = String(req.body?.newUpdatedDate || "").trim();
    const selectedSources = Array.isArray(req.body?.selectedSources)
      ? req.body.selectedSources.map(
          (s: { title?: string; url?: string; label?: string }) => ({
            title: String(s?.title || s?.label || "").trim(),
            url: String(s?.url || "").trim(),
          })
        )
      : [];

    try {
      const result = applyArticleUpdate({
        slug,
        newParagraph,
        newUpdatedDate,
        selectedSources,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      return jsonError(
        res,
        400,
        err instanceof Error ? err.message : "Failed to confirm update"
      );
    }
  })
);

// Multer / Express error handler — always JSON
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return jsonError(
        res,
        413,
        `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB per file.`
      );
    }
    return jsonError(res, 400, err.message);
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error(err);
  return jsonError(res, 500, message);
});

app.listen(PORT, () => {
  console.log(`CMS running at http://localhost:${PORT}`);
  console.log(`Max upload size: ${MAX_FILE_SIZE / (1024 * 1024)}MB per file`);
});
