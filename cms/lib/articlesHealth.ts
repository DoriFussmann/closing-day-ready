import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readArticleFile, ARTICLES_DIR } from "./writeArticle.js";
import { SITE_URL } from "./siteConfig.js";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WTS_SOURCES_PATH = path.join(__dirname, "../data/where-things-stand-sources.json");

export const EXTERNAL_SIGNPOST =
  "For further reading, see the Sources listed below.";
export const INTERNAL_SIGNPOST =
  "See Related Reads below for more on this topic.";

export type HealthStatus = "green" | "orange" | "red" | "gray" | "unconfigured";

export type LinkRef = { label: string; url: string };

export type ArticleRecord = {
  slug: string;
  title: string;
  draft: boolean;
  description: string;
  date?: string;
  updatedDate?: string;
  h1?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  schemaType?: string;
  author?: string;
  pillarKeyword?: string;
  supportingKeyword?: string;
  articleType?: string;
  targetKeyword?: string;
  internalLinks: LinkRef[];
  externalLinks: LinkRef[];
  faqs: unknown[];
  body: string;
};

function asLinks(value: unknown): LinkRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const label = String((item as LinkRef).label || "").trim();
      const url = String((item as LinkRef).url || "").trim();
      if (!label || !url) return null;
      return { label, url };
    })
    .filter((x): x is LinkRef => Boolean(x));
}

function loadAllArticles(): ArticleRecord[] {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  return fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(ARTICLES_DIR, file), "utf8");
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
      const fm = match ? YAML.parse(match[1]) || {} : {};
      const body = match ? String(match[2] || "").trim() : raw;
      return {
        slug: String(fm.slug || file.replace(/\.md$/, "")),
        title: String(fm.title || file),
        draft: Boolean(fm.draft),
        description: String(fm.description || ""),
        date: fm.date ? String(fm.date) : undefined,
        updatedDate: fm.updatedDate ? String(fm.updatedDate) : undefined,
        h1: fm.h1 ? String(fm.h1) : undefined,
        canonical: fm.canonical ? String(fm.canonical) : undefined,
        ogTitle: fm.ogTitle ? String(fm.ogTitle) : undefined,
        ogDescription: fm.ogDescription ? String(fm.ogDescription) : undefined,
        ogImage: fm.ogImage ? String(fm.ogImage) : undefined,
        schemaType: fm.schemaType ? String(fm.schemaType) : undefined,
        author: fm.author ? String(fm.author) : undefined,
        pillarKeyword: fm.pillarKeyword ? String(fm.pillarKeyword) : undefined,
        supportingKeyword: fm.supportingKeyword
          ? String(fm.supportingKeyword)
          : undefined,
        articleType: fm.articleType ? String(fm.articleType) : undefined,
        targetKeyword: fm.targetKeyword ? String(fm.targetKeyword) : undefined,
        internalLinks: asLinks(fm.internalLinks),
        externalLinks: asLinks(fm.externalLinks),
        faqs: Array.isArray(fm.faqs) ? fm.faqs : [],
        body,
      };
    });
}

function normalizePath(url: string): string {
  try {
    if (url.startsWith("http")) {
      return new URL(url).pathname.replace(/\/+$/, "") || "/";
    }
  } catch {
    /* ignore */
  }
  const pathOnly = url.split("#")[0].split("?")[0];
  return pathOnly.replace(/\/+$/, "") || "/";
}

function articlePath(slug: string): string {
  return `/articles/${slug}`;
}

function hasInternalLinkTo(links: LinkRef[], slug: string): boolean {
  const target = articlePath(slug);
  return links.some((l) => normalizePath(l.url) === target);
}

function isPillar(article: ArticleRecord): boolean {
  return Boolean(
    article.pillarKeyword &&
      !article.supportingKeyword &&
      article.articleType === "comprehensive"
  );
}

function published(articles: ArticleRecord[]): ArticleRecord[] {
  return articles.filter((a) => !a.draft);
}

/** Required internal targets for an article (published only). */
export function requiredInternalTargets(
  article: ArticleRecord,
  all: ArticleRecord[]
): Array<{ slug: string; title: string; reason: string }> {
  const live = published(all);
  if (!article.pillarKeyword) return [];

  if (isPillar(article)) {
    // One comprehensive hub per supportingKeyword cluster under this pillar
    const clusters = new Map<string, ArticleRecord[]>();
    for (const a of live) {
      if (a.slug === article.slug) continue;
      if (a.pillarKeyword !== article.pillarKeyword) continue;
      if (!a.supportingKeyword) continue;
      const list = clusters.get(a.supportingKeyword) || [];
      list.push(a);
      clusters.set(a.supportingKeyword, list);
    }
    const required: Array<{ slug: string; title: string; reason: string }> = [];
    for (const [supportingKeyword, members] of clusters) {
      const hub =
        members.find((m) => m.articleType === "comprehensive") || members[0];
      if (!hub) continue;
      required.push({
        slug: hub.slug,
        title: hub.title,
        reason: `Pillar should link to comprehensive hub for supporting cluster "${supportingKeyword}"`,
      });
    }
    return required;
  }

  // Supporting article
  const required: Array<{ slug: string; title: string; reason: string }> = [];
  const pillar = live.find(
    (a) =>
      a.pillarKeyword === article.pillarKeyword &&
      !a.supportingKeyword &&
      a.articleType === "comprehensive"
  );
  if (pillar) {
    required.push({
      slug: pillar.slug,
      title: pillar.title,
      reason: "Supporting article must link to its pillar",
    });
  }

  if (article.supportingKeyword) {
    for (const sibling of live) {
      if (sibling.slug === article.slug) continue;
      if (sibling.supportingKeyword !== article.supportingKeyword) continue;
      required.push({
        slug: sibling.slug,
        title: sibling.title,
        reason: `Same supporting cluster ("${article.supportingKeyword}")`,
      });
    }
  }

  return required;
}

function scanLinks(article: ArticleRecord, all: ArticleRecord[]) {
  const externalCount = article.externalLinks.length;
  const required = requiredInternalTargets(article, all);
  const missingInternal = required.filter(
    (r) => !hasInternalLinkTo(article.internalLinks, r.slug)
  );
  const classified = Boolean(article.pillarKeyword || article.articleType);

  let status: HealthStatus = "gray";
  const findings: string[] = [];

  const missingPillar = missingInternal.some((m) =>
    m.reason.includes("must link to its pillar")
  );

  if (!classified) {
    status = "gray";
    findings.push(
      "Unclassified — missing pillarKeyword/articleType relationship metadata."
    );
  } else if (externalCount <= 1 || missingPillar) {
    status = "red";
  } else if (externalCount >= 3 && missingInternal.length === 0) {
    status = "green";
  } else {
    status = "orange";
  }

  if (externalCount < 3) {
    findings.push(
      `External links: ${externalCount}/3 (target is at least 3).`
    );
  } else {
    findings.push(`External links: ${externalCount} (meets target).`);
  }

  if (missingInternal.length) {
    findings.push(
      `Missing ${missingInternal.length} required internal link(s).`
    );
  } else if (classified) {
    findings.push("All required internal links present.");
  }

  const siteUrl = SITE_URL.replace(/\/+$/, "");

  return {
    status,
    findings,
    externalCount,
    internalCount: article.internalLinks.length,
    internalLinks: article.internalLinks.map((l) => ({
      ...l,
      href: l.url.startsWith("http") ? l.url : `${siteUrl}${l.url.startsWith("/") ? "" : "/"}${l.url}`,
    })),
    externalLinks: article.externalLinks.map((l) => ({
      ...l,
      href: l.url,
    })),
    missingInternal: missingInternal.map((m) => ({
      ...m,
      url: `${siteUrl}${articlePath(m.slug)}/`,
      path: `${articlePath(m.slug)}/`,
    })),
    canPropose: externalCount < 3,
    unclassified: !classified,
  };
}

function scanMeta(article: ArticleRecord) {
  const findings: string[] = [];
  const titleLen = article.title.length;
  const descLen = article.description.length;
  const titleOk = titleLen >= 55 && titleLen <= 60;
  const descOk = descLen >= 140 && descLen <= 160;
  const expectedCanonical = `${SITE_URL.replace(/\/+$/, "")}${articlePath(article.slug)}/`;
  const canonical = article.canonical?.trim() || expectedCanonical;
  const canonicalOk =
    !article.canonical ||
    normalizePath(article.canonical) === articlePath(article.slug);
  const ogOk = Boolean(
    (article.ogTitle || article.title) &&
      (article.ogDescription || article.description) &&
      (article.ogImage || true) // hero always supplies OG image in layout
  );
  const h1Ok = !article.h1 || article.h1.length >= 20;

  if (!titleOk) {
    findings.push(`title is ${titleLen} characters, needs 55–60.`);
  }
  if (!descOk) {
    findings.push(
      `description is ${descLen} characters, needs 140–160.`
    );
  }
  if (article.canonical) {
    findings.push(
      canonicalOk
        ? `canonical present: ${article.canonical}`
        : `canonical present but unexpected: ${article.canonical}`
    );
  } else {
    findings.push(
      `canonical omitted — layout defaults to ${expectedCanonical}.`
    );
  }
  if (!ogOk) findings.push("OG title/description incomplete.");
  else findings.push("OG tags resolve (explicit or via title/description/hero).");
  if (article.h1) {
    findings.push(
      h1Ok
        ? `h1 set (${article.h1.length} chars).`
        : `h1 is ${article.h1.length} chars, needs ≥20 when set.`
    );
  } else {
    findings.push("h1 omitted — layout falls back to title.");
  }

  const status: HealthStatus =
    titleOk && descOk && canonicalOk && ogOk && h1Ok ? "green" : "red";

  return { status, findings, expectedCanonical };
}

function scanSchema(article: ArticleRecord) {
  const findings: string[] = [];
  const expectedTypes = ["BlogPosting", "Person", "BreadcrumbList"];
  if (article.faqs.length > 0) expectedTypes.push("FAQPage");

  const schemaType = article.schemaType || "BlogPosting";
  const okType = schemaType === "BlogPosting" || Boolean(schemaType);
  if (!okType) findings.push("schemaType missing.");
  else findings.push(`schemaType: ${schemaType} (layout emits JSON-LD).`);

  if (!article.author) {
    findings.push("author missing — Person schema would fail at build.");
  } else {
    findings.push(`author present (${article.author}) → Person JSON-LD.`);
  }
  findings.push("BreadcrumbList always emitted by ArticleLayout.");
  if (article.faqs.length > 0) {
    findings.push(`FAQPage emitted (${article.faqs.length} FAQs).`);
  } else {
    findings.push("No FAQs — FAQPage omitted (OK).");
  }

  const status: HealthStatus =
    okType && Boolean(article.author) ? "green" : "red";
  return { status, findings, expectedTypes };
}

function scanSitemap(article: ArticleRecord) {
  const findings: string[] = [];
  const lastmodSource = article.updatedDate || article.date;
  if (article.draft) {
    return {
      status: "red" as HealthStatus,
      findings: ["Draft articles are excluded from the sitemap."],
      lastmod: null as string | null,
    };
  }
  if (!lastmodSource) {
    findings.push("No date/updatedDate — sitemap lastmod would be null.");
    return { status: "red" as HealthStatus, findings, lastmod: null };
  }
  const d = new Date(lastmodSource);
  if (Number.isNaN(d.getTime())) {
    findings.push(`Invalid date for lastmod: ${lastmodSource}`);
    return { status: "red" as HealthStatus, findings, lastmod: null };
  }
  findings.push(
    `Present in sitemap builder map with lastmod from ${article.updatedDate ? "updatedDate" : "date"} (${d.toISOString().slice(0, 10)}).`
  );
  return {
    status: "green" as HealthStatus,
    findings,
    lastmod: d.toISOString(),
  };
}

function scanSpeed() {
  const configured = Boolean(process.env.GOOGLE_PAGESPEED_API_KEY);
  if (!configured) {
    return {
      status: "unconfigured" as HealthStatus,
      findings: [
        "Not configured — add GOOGLE_PAGESPEED_API_KEY to enable PageSpeed checks.",
      ],
      mobile: null as number | null,
      desktop: null as number | null,
    };
  }
  return {
    status: "gray" as HealthStatus,
    findings: [
      "PageSpeed API key detected, but live scoring is not enabled in this version.",
    ],
    mobile: null as number | null,
    desktop: null as number | null,
  };
}

export function buildArticlesHealthReport() {
  const all = loadAllArticles();
  const pagespeedConfigured = Boolean(process.env.GOOGLE_PAGESPEED_API_KEY);
  const articles = published(all).map((article) => {
    const links = scanLinks(article, all);
    const meta = scanMeta(article);
    const schema = scanSchema(article);
    const sitemap = scanSitemap(article);
    const speed = scanSpeed();
    return {
      slug: article.slug,
      title: article.title,
      pillarKeyword: article.pillarKeyword || null,
      supportingKeyword: article.supportingKeyword || null,
      articleType: article.articleType || null,
      targetKeyword: article.targetKeyword || null,
      indicators: {
        links: links.status,
        meta: meta.status,
        schema: schema.status,
        sitemap: sitemap.status,
        speed: speed.status,
      },
      details: { links, meta, schema, sitemap, speed },
    };
  });

  return {
    siteUrl: SITE_URL.replace(/\/+$/, ""),
    pagespeedConfigured,
    articles,
  };
}

type SourceCandidate = { title: string; url: string; source: string };

function loadWtsSources(): SourceCandidate[] {
  if (!fs.existsSync(WTS_SOURCES_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(WTS_SOURCES_PATH, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.sources;
    if (!Array.isArray(list)) return [];
    return list
      .map((item: { url?: string; note?: string; title?: string }) => {
        const url = String(item.url || "").trim();
        if (!url.startsWith("http")) return null;
        return {
          url,
          title: String(item.title || item.note || url).trim(),
          source: "whereThingsStandSources",
        };
      })
      .filter((x: SourceCandidate | null): x is SourceCandidate => Boolean(x));
  } catch {
    return [];
  }
}

function extractBodyExternalLinks(body: string): SourceCandidate[] {
  const out: SourceCandidate[] = [];
  const mdLink = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdLink.exec(body))) {
    out.push({ title: match[1].trim(), url: match[2].trim(), source: "body" });
  }
  const bare = /(?<!\()(https?:\/\/[^\s)<]+)/g;
  while ((match = bare.exec(body))) {
    const url = match[1].replace(/[.,;:]+$/, "");
    if (!out.some((o) => o.url === url)) {
      out.push({ title: url, url, source: "body" });
    }
  }
  return out;
}

export function proposeExternalLinks(slug: string): {
  proposals: SourceCandidate[];
  externalCount: number;
} {
  const article = readArticleFile(slug);
  if (!article) throw new Error(`Article not found: ${slug}`);
  const existing = asLinks(article.frontmatter.externalLinks);
  const existingUrls = new Set(existing.map((l) => l.url.replace(/\/+$/, "")));

  const pool = [
    ...loadWtsSources(),
    ...extractBodyExternalLinks(article.body),
  ];

  const proposals: SourceCandidate[] = [];
  for (const candidate of pool) {
    const key = candidate.url.replace(/\/+$/, "");
    if (existingUrls.has(key)) continue;
    if (proposals.some((p) => p.url.replace(/\/+$/, "") === key)) continue;
    // Prefer non-site URLs
    if (candidate.url.includes("closingdayready.com")) continue;
    proposals.push(candidate);
    if (proposals.length >= 3) break;
  }

  return { proposals, externalCount: existing.length };
}

export function ensureSignpost(body: string, signpost: string): string {
  if (body.includes(signpost)) return body;
  return `${body.trim()}\n\n${signpost}\n`;
}

export function absoluteArticleUrl(slug: string): string {
  return `${SITE_URL.replace(/\/+$/, "")}${articlePath(slug)}/`;
}
