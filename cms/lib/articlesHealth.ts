import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readArticleFile,
  patchArticleContent,
  ARTICLES_DIR,
} from "./writeArticle.js";
import { SITE_URL } from "./siteConfig.js";
import { getCachedPageSpeed } from "./pageSpeed.js";
import {
  buildExternalLinkSearchQuery,
  isWebSearchConfigured,
  searchWeb,
} from "./webSearch.js";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WTS_SOURCES_PATH = path.join(__dirname, "../data/where-things-stand-sources.json");

export const EXTERNAL_SIGNPOST =
  "For further reading, see the Sources listed below.";
export const INTERNAL_SIGNPOST =
  "See Related Reads below for more on this topic.";

/** Cap for every CMS write path that mutates externalLinks. */
export const MAX_EXTERNAL_LINKS = 5;

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

function scanSpeed(article: ArticleRecord) {
  const configured = Boolean(process.env.GOOGLE_PAGESPEED_API_KEY?.trim());
  const publishedUrl = article.draft ? null : absoluteArticleUrl(article.slug);

  if (!publishedUrl) {
    return {
      status: "gray" as HealthStatus,
      findings: [
        "Scan unavailable — article is not Published, so there is no live URL to test.",
      ],
      publishedUrl: null,
      canScan: false,
      scanned: false,
      mobile: null as null,
      desktop: null as null,
      indicatorScore: null as number | null,
      indicatorLabel: "mobile Performance" as const,
      fetchedAt: null as string | null,
    };
  }

  if (!configured) {
    return {
      status: "unconfigured" as HealthStatus,
      findings: [
        "Not configured — add GOOGLE_PAGESPEED_API_KEY to cms/.env.local to enable PageSpeed scans.",
      ],
      publishedUrl,
      canScan: false,
      scanned: false,
      mobile: null as null,
      desktop: null as null,
      indicatorScore: null as number | null,
      indicatorLabel: "mobile Performance" as const,
      fetchedAt: null as string | null,
    };
  }

  const canScan = true;

  const cached = getCachedPageSpeed(article.slug);
  if (!cached) {
    return {
      status: "gray" as HealthStatus,
      findings: [
        "Not scanned yet — click Scan to run Google PageSpeed Insights (mobile + desktop).",
      ],
      publishedUrl,
      canScan,
      scanned: false,
      mobile: null as null,
      desktop: null as null,
      indicatorScore: null as number | null,
      indicatorLabel: "mobile Performance" as const,
      fetchedAt: null as string | null,
    };
  }

  return {
    status: cached.status as HealthStatus,
    findings: [
      `Last scan ${cached.fetchedAt.slice(0, 10)} · indicator = ${cached.indicatorLabel} (${cached.indicatorScore}/100).`,
    ],
    publishedUrl,
    canScan,
    scanned: true,
    mobile: cached.mobile,
    desktop: cached.desktop,
    indicatorScore: cached.indicatorScore,
    indicatorLabel: cached.indicatorLabel,
    fetchedAt: cached.fetchedAt,
  };
}

export function buildArticlesHealthReport() {
  const all = loadAllArticles();
  const pagespeedConfigured = Boolean(process.env.GOOGLE_PAGESPEED_API_KEY?.trim());
  // Include drafts so Speed can show the disabled "not Published" state.
  const articles = all.map((article) => {
    const links = scanLinks(article, all);
    const meta = scanMeta(article);
    const schema = scanSchema(article);
    const sitemap = scanSitemap(article);
    const speed = scanSpeed(article);
    const publishedUrl = article.draft ? null : absoluteArticleUrl(article.slug);
    return {
      slug: article.slug,
      title: article.title,
      draft: article.draft,
      publishedUrl,
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

export type SourceCandidate = {
  title: string;
  url: string;
  source: string;
  note?: string;
  confidence?: "high" | "borderline";
};

export type ProposedExternalLink = {
  id: string;
  articleSlug: string;
  articleTitle: string;
  title: string;
  url: string;
  source: string;
  confidence: "high" | "borderline";
  preChecked: boolean;
  slot: number;
};

type TopicConfidence = "high" | "borderline" | "reject";

const TOPIC_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "how",
  "does",
  "what",
  "with",
  "from",
  "that",
  "this",
  "are",
  "was",
  "has",
  "have",
  "into",
  "your",
  "you",
  "can",
  "not",
  "volume",
  "data",
  "guide",
  "complete",
  "best",
]);

/** Too generic alone to prove topical fit (e.g. "home" matching HUD buying-a-home). */
const WEAK_TOPIC_TOKENS = new Set([
  "home",
  "homes",
  "house",
  "houses",
  "buy",
  "buying",
  "buyer",
  "buyers",
  "sell",
  "selling",
  "seller",
  "sellers",
  "new",
  "long",
  "take",
  "last",
  "better",
  "report",
  "checklist",
]);

function normalizeKeyword(value: string | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeKeyword(value: string | undefined): string[] {
  return normalizeKeyword(value)
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !TOPIC_STOPWORDS.has(t));
}

export function urlKey(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Merge new external links into an existing list (dedupe by URL), then enforce
 * MAX_EXTERNAL_LINKS by dropping oldest entries first (newest retained).
 * Used by Articles Health and Articles Update write paths.
 */
export function mergeExternalLinks(
  existing: LinkRef[],
  toAdd: LinkRef[]
): {
  links: LinkRef[];
  written: LinkRef[];
  skipped: Array<LinkRef & { reason: string }>;
  trimmed: LinkRef[];
} {
  let links = [...existing];
  const present = new Set(links.map((l) => urlKey(l.url)));
  const written: LinkRef[] = [];
  const skipped: Array<LinkRef & { reason: string }> = [];

  for (const link of toAdd) {
    const label = String(link.label || "").trim();
    const url = String(link.url || "").trim();
    if (!label || !url) {
      skipped.push({ label, url, reason: "label and url are required" });
      continue;
    }
    const key = urlKey(url);
    if (present.has(key)) {
      skipped.push({ label, url, reason: "External link already present" });
      continue;
    }
    const entry = { label, url };
    links.push(entry);
    present.add(key);
    written.push(entry);
  }

  let trimmed: LinkRef[] = [];
  if (links.length > MAX_EXTERNAL_LINKS) {
    const overflow = links.length - MAX_EXTERNAL_LINKS;
    trimmed = links.slice(0, overflow);
    links = links.slice(-MAX_EXTERNAL_LINKS);
  }

  return { links, written, skipped, trimmed };
}

function mapSourceItem(
  item: { url?: string; note?: string; title?: string },
  source: string
): SourceCandidate | null {
  const url = String(item.url || "").trim();
  if (!url.startsWith("http")) return null;
  if (url.includes("closingdayready.com")) return null;
  return {
    url,
    title: String(item.title || item.note || url).trim(),
    note: item.note ? String(item.note) : undefined,
    source,
  };
}

/**
 * where-things-stand-sources.json supports:
 * - legacy array of sources
 * - { sources: [...], byArticle: { [slug]: [...] } }
 */
function loadWtsPools(slug: string): {
  primary: SourceCandidate[];
  fallback: SourceCandidate[];
} {
  if (!fs.existsSync(WTS_SOURCES_PATH)) {
    return { primary: [], fallback: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(WTS_SOURCES_PATH, "utf8"));
    if (Array.isArray(raw)) {
      return {
        primary: [],
        fallback: raw
          .map((item) => mapSourceItem(item, "whereThingsStandSources"))
          .filter((x): x is SourceCandidate => Boolean(x)),
      };
    }
    const global = Array.isArray(raw.sources)
      ? raw.sources
          .map((item: { url?: string; note?: string; title?: string }) =>
            mapSourceItem(item, "whereThingsStandSources")
          )
          .filter((x: SourceCandidate | null): x is SourceCandidate => Boolean(x))
      : [];
    const byArticle = raw.byArticle && typeof raw.byArticle === "object"
      ? raw.byArticle
      : {};
    const articleList = Array.isArray(byArticle[slug]) ? byArticle[slug] : [];
    const primary = articleList
      .map((item: { url?: string; note?: string; title?: string }) =>
        mapSourceItem(item, "whereThingsStandSources:article")
      )
      .filter((x: SourceCandidate | null): x is SourceCandidate => Boolean(x));
    return { primary, fallback: global };
  } catch {
    return { primary: [], fallback: [] };
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

function stemToken(token: string): string {
  return token.endsWith("s") && token.length > 4 ? token.slice(0, -1) : token;
}

function partitionTopicTokens(tokens: string[]): {
  strong: string[];
  weak: string[];
} {
  const strong: string[] = [];
  const weak: string[] = [];
  for (const token of tokens) {
    if (WEAK_TOPIC_TOKENS.has(token) || WEAK_TOPIC_TOKENS.has(stemToken(token))) {
      weak.push(token);
    } else {
      strong.push(token);
    }
  }
  return { strong, weak };
}

function countHits(tokens: string[], haystack: string): number {
  return tokens.filter((t) => haystack.includes(t) || haystack.includes(stemToken(t)))
    .length;
}

/**
 * Score whether a candidate clearly matches the article topic defined by
 * targetKeyword + pillarKeyword. Rejects off-topic sources before display.
 */
export function scoreTopicRelevance(
  candidate: { title: string; url: string; note?: string },
  targetKeyword: string | undefined,
  pillarKeyword: string | undefined
): TopicConfidence {
  const target = normalizeKeyword(targetKeyword);
  const pillar = normalizeKeyword(pillarKeyword);
  if (!target && !pillar) return "reject";

  const haystack = `${candidate.title} ${candidate.url} ${candidate.note || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, " ");

  const targetTokens = tokenizeKeyword(targetKeyword);
  const pillarTokens = tokenizeKeyword(pillarKeyword);
  const allTokens = [...new Set([...targetTokens, ...pillarTokens])];
  const { strong, weak } = partitionTopicTokens(allTokens);

  const targetPhraseHit = Boolean(target) && haystack.includes(target);
  const pillarPhraseHit = Boolean(pillar) && haystack.includes(pillar);

  const strongHits = countHits(strong, haystack);
  const weakHits = countHits(weak, haystack);
  const targetStrong = partitionTopicTokens(targetTokens).strong;
  const pillarStrong = partitionTopicTokens(pillarTokens).strong;
  const targetStrongHits = countHits(targetStrong, haystack);
  const pillarStrongHits = countHits(pillarStrong, haystack);

  // If the topic has distinctive tokens (inspection, mortgage, …), require at
  // least one strong hit. Weak-only matches like "home" on HUD are rejected.
  if (strong.length > 0 && strongHits === 0 && !targetPhraseHit && !pillarPhraseHit) {
    return "reject";
  }

  if (
    !targetPhraseHit &&
    !pillarPhraseHit &&
    strongHits === 0 &&
    weakHits === 0
  ) {
    return "reject";
  }

  if (
    targetPhraseHit ||
    pillarPhraseHit ||
    (strongHits >= 2 && weakHits >= 0) ||
    (targetStrongHits >= 1 && pillarStrongHits >= 1) ||
    (strongHits >= 1 && (targetStrongHits >= 1 || pillarStrongHits >= 1) && weakHits >= 1)
  ) {
    return "high";
  }

  // Single strong token without weak support — still topical, ask for review.
  if (strongHits >= 1) return "borderline";

  // Weak-only topics (rare) — borderline at best.
  if (strong.length === 0 && weakHits >= 2) return "borderline";

  return "reject";
}

function collectCandidatePool(
  slug: string,
  body: string
): SourceCandidate[] {
  const { primary, fallback } = loadWtsPools(slug);
  const bodyLinks = extractBodyExternalLinks(body);
  // Known sources first: article-specific WTS → body links → global WTS.
  // Live web search is a separate final fallback (see proposeExternalLinks).
  const ordered = [...primary, ...bodyLinks, ...fallback];
  const seen = new Set<string>();
  const out: SourceCandidate[] = [];
  for (const c of ordered) {
    const key = urlKey(c.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function countRejectedOffTopic(
  pool: SourceCandidate[],
  targetKeyword: string | undefined,
  pillarKeyword: string | undefined,
  existingUrls: Set<string>
): number {
  let rejected = 0;
  for (const candidate of pool) {
    if (existingUrls.has(urlKey(candidate.url))) continue;
    if (
      scoreTopicRelevance(candidate, targetKeyword, pillarKeyword) === "reject"
    ) {
      rejected += 1;
    }
  }
  return rejected;
}

async function liveSearchCandidates(
  targetKeyword: string | undefined,
  pillarKeyword: string | undefined
): Promise<{
  candidates: SourceCandidate[];
  searchQuery: string | null;
  searchUsed: boolean;
  searchError: string | null;
}> {
  const searchQuery = buildExternalLinkSearchQuery(targetKeyword, pillarKeyword);
  if (!searchQuery) {
    return {
      candidates: [],
      searchQuery: null,
      searchUsed: false,
      searchError: "Missing targetKeyword/pillarKeyword for live search",
    };
  }
  if (!isWebSearchConfigured()) {
    return {
      candidates: [],
      searchQuery,
      searchUsed: false,
      searchError:
        "DATAFORSEO_LOGIN/PASSWORD not configured. Add them to cms/.env.local for live external-link search.",
    };
  }

  const response = await searchWeb(searchQuery, 10);
  if (!response.available) {
    return {
      candidates: [],
      searchQuery,
      searchUsed: true,
      searchError: response.reason || "Live search failed",
    };
  }

  return {
    candidates: response.results.map((hit) => ({
      title: hit.title,
      url: hit.url,
      note: hit.note,
      source: "liveSearch",
    })),
    searchQuery,
    searchUsed: true,
    searchError: null,
  };
}

function filterRelevantCandidates(
  pool: SourceCandidate[],
  targetKeyword: string | undefined,
  pillarKeyword: string | undefined,
  existingUrls: Set<string>
): Array<SourceCandidate & { confidence: "high" | "borderline" }> {
  const out: Array<SourceCandidate & { confidence: "high" | "borderline" }> = [];
  for (const candidate of pool) {
    const key = urlKey(candidate.url);
    if (existingUrls.has(key)) continue;
    const confidence = scoreTopicRelevance(
      candidate,
      targetKeyword,
      pillarKeyword
    );
    if (confidence === "reject") continue;
    out.push({ ...candidate, confidence });
  }
  // Prefer high-confidence, then preserve pool order within each band.
  out.sort((a, b) => {
    if (a.confidence === b.confidence) return 0;
    return a.confidence === "high" ? -1 : 1;
  });
  return out;
}

function articleTopicFields(frontmatter: Record<string, unknown>): {
  targetKeyword?: string;
  pillarKeyword?: string;
  title: string;
} {
  return {
    targetKeyword: frontmatter.targetKeyword
      ? String(frontmatter.targetKeyword)
      : undefined,
    pillarKeyword: frontmatter.pillarKeyword
      ? String(frontmatter.pillarKeyword)
      : undefined,
    title: String(frontmatter.title || ""),
  };
}

export type ProposeExternalLinksResult = {
  proposals: Array<SourceCandidate & { confidence: "high" | "borderline" }>;
  externalCount: number;
  slotsNeeded: number;
  rejectedOffTopic: number;
  searchQuery: string | null;
  searchUsed: boolean;
  searchError: string | null;
};

/**
 * Per-article Propose / Add External Links candidates.
 * Filters by topic before any candidate is returned for display.
 * Falls back to DataForSEO live SERP when static pools have no on-topic hits.
 */
export async function proposeExternalLinks(
  slug: string
): Promise<ProposeExternalLinksResult> {
  const article = readArticleFile(slug);
  if (!article) throw new Error(`Article not found: ${slug}`);
  const existing = asLinks(article.frontmatter.externalLinks);
  const existingUrls = new Set(existing.map((l) => urlKey(l.url)));
  const { targetKeyword, pillarKeyword } = articleTopicFields(
    article.frontmatter as Record<string, unknown>
  );

  const pool = collectCandidatePool(slug, article.body);
  let rejectedOffTopic = countRejectedOffTopic(
    pool,
    targetKeyword,
    pillarKeyword,
    existingUrls
  );

  let relevant = filterRelevantCandidates(
    pool,
    targetKeyword,
    pillarKeyword,
    existingUrls
  );

  let searchQuery: string | null = null;
  let searchUsed = false;
  let searchError: string | null = null;

  if (relevant.length === 0) {
    const live = await liveSearchCandidates(targetKeyword, pillarKeyword);
    searchQuery = live.searchQuery;
    searchUsed = live.searchUsed;
    searchError = live.searchError;
    rejectedOffTopic += countRejectedOffTopic(
      live.candidates,
      targetKeyword,
      pillarKeyword,
      existingUrls
    );
    relevant = filterRelevantCandidates(
      live.candidates,
      targetKeyword,
      pillarKeyword,
      existingUrls
    );
  }

  const slotsNeeded = Math.max(0, 3 - existing.length);
  const proposals = relevant.slice(0, Math.max(slotsNeeded, 3));

  return {
    proposals,
    externalCount: existing.length,
    slotsNeeded,
    rejectedOffTopic,
    searchQuery,
    searchUsed,
    searchError,
  };
}

/**
 * Batch propose for one article or all published articles needing external links.
 * Does not write — caller must review then add selected.
 */
export async function proposeAllExternalLinks(options?: {
  slug?: string;
}): Promise<{
  proposals: ProposedExternalLink[];
  articlesScanned: number;
  articlesNeeding: number;
  searchErrors: Array<{ slug: string; error: string }>;
}> {
  const all = published(loadAllArticles());
  const targetSlugs = options?.slug
    ? all.filter((a) => a.slug === options.slug)
    : all.filter((a) => a.externalLinks.length < 3);

  if (options?.slug && targetSlugs.length === 0) {
    throw new Error(`Article not found or not published: ${options.slug}`);
  }

  const proposals: ProposedExternalLink[] = [];
  const searchErrors: Array<{ slug: string; error: string }> = [];
  let articlesNeeding = 0;

  for (const article of targetSlugs) {
    const slotsNeeded = Math.max(0, 3 - article.externalLinks.length);
    if (slotsNeeded === 0) continue;
    articlesNeeding += 1;

    const existingUrls = new Set(article.externalLinks.map((l) => urlKey(l.url)));
    const pool = collectCandidatePool(article.slug, article.body);
    let relevant = filterRelevantCandidates(
      pool,
      article.targetKeyword,
      article.pillarKeyword,
      existingUrls
    );

    if (relevant.length === 0) {
      const live = await liveSearchCandidates(
        article.targetKeyword,
        article.pillarKeyword
      );
      if (live.searchError) {
        searchErrors.push({ slug: article.slug, error: live.searchError });
      }
      relevant = filterRelevantCandidates(
        live.candidates,
        article.targetKeyword,
        article.pillarKeyword,
        existingUrls
      );
    }

    // One candidate per missing slot (best remaining).
    const forSlots = relevant.slice(0, slotsNeeded);
    for (let i = 0; i < forSlots.length; i++) {
      const c = forSlots[i];
      proposals.push({
        id: `${article.slug}::${urlKey(c.url)}`,
        articleSlug: article.slug,
        articleTitle: article.title,
        title: c.title,
        url: c.url,
        source: c.source,
        confidence: c.confidence,
        preChecked: c.confidence === "high",
        slot: i + 1,
      });
    }
  }

  return {
    proposals,
    articlesScanned: targetSlugs.length,
    articlesNeeding,
    searchErrors,
  };
}

export function addExternalLinksSelected(
  items: Array<{ slug: string; label: string; url: string }>
): {
  written: Array<{ slug: string; label: string; url: string }>;
  skipped: Array<{ slug: string; label: string; url: string; reason: string }>;
} {
  const written: Array<{ slug: string; label: string; url: string }> = [];
  const skipped: Array<{
    slug: string;
    label: string;
    url: string;
    reason: string;
  }> = [];

  // Group by slug so each article is patched once with all its selected links.
  const bySlug = new Map<
    string,
    Array<{ label: string; url: string }>
  >();
  for (const item of items) {
    const slug = String(item.slug || "").trim();
    const label = String(item.label || "").trim();
    const url = String(item.url || "").trim();
    if (!slug || !label || !url) {
      skipped.push({
        slug,
        label,
        url,
        reason: "slug, label, and url are required",
      });
      continue;
    }
    const list = bySlug.get(slug) || [];
    list.push({ label, url });
    bySlug.set(slug, list);
  }

  for (const [slug, linksToAdd] of bySlug) {
    const existing = readArticleFile(slug);
    if (!existing) {
      for (const link of linksToAdd) {
        skipped.push({ slug, ...link, reason: "Article not found" });
      }
      continue;
    }

    const existingLinks = Array.isArray(existing.frontmatter.externalLinks)
      ? [
          ...(existing.frontmatter.externalLinks as Array<{
            label: string;
            url: string;
          }>),
        ]
      : [];
    const merged = mergeExternalLinks(existingLinks, linksToAdd);
    for (const link of merged.written) {
      written.push({ slug, ...link });
    }
    for (const item of merged.skipped) {
      skipped.push({ slug, ...item });
    }

    if (!merged.written.length) continue;

    const body = ensureSignpost(existing.body, EXTERNAL_SIGNPOST);
    patchArticleContent(slug, {
      frontmatterPatch: { externalLinks: merged.links },
      body,
      bumpUpdatedDate: true,
    });
  }

  return { written, skipped };
}

export function ensureSignpost(body: string, signpost: string): string {
  if (body.includes(signpost)) return body;
  return `${body.trim()}\n\n${signpost}\n`;
}

export function absoluteArticleUrl(slug: string): string {
  return `${SITE_URL.replace(/\/+$/, "")}${articlePath(slug)}/`;
}
