import YAML from "yaml";
import {
  EXTERNAL_SIGNPOST,
  ensureSignpost,
  mergeExternalLinks,
  type LinkRef,
} from "./articlesHealth.js";
import { patchArticleContent, readArticleFile } from "./writeArticle.js";

export const WTS_START = "<!-- WHERE-THINGS-STAND:START -->";
export const WTS_END = "<!-- WHERE-THINGS-STAND:END -->";

export type ArticleUpdateSource = {
  title: string;
  url: string;
};

export type ArticleUpdateEntry = {
  slug: string;
  newParagraph: string;
  newUpdatedDate: string;
  newSources: ArticleUpdateSource[];
};

export type MatchedArticleUpdate = ArticleUpdateEntry & {
  matched: true;
  title: string;
  currentParagraph: string;
  currentUpdatedDate?: string;
  markersPresent: boolean;
};

export type UnmatchedArticleUpdate = ArticleUpdateEntry & {
  matched: false;
  reason: string;
};

function asTrimmedString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function normalizeSources(raw: unknown): ArticleUpdateSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ArticleUpdateSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = asTrimmedString(row.url);
    if (!url) continue;
    // Match TNV download: title may be empty; fall back to url for CMS label.
    const title =
      asTrimmedString(row.title || row.label || row.note) || url;
    out.push({ title, url });
  }
  return out;
}

function normalizeEntry(raw: unknown): ArticleUpdateEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const slug = asTrimmedString(row.slug);
  const newParagraph = asTrimmedString(
    row.newParagraph ?? row.proposedParagraph ?? row.body
  );
  const newUpdatedDate = asTrimmedString(
    row.newUpdatedDate ?? row.updatedDate
  );
  if (!slug || !newParagraph || !newUpdatedDate) return null;
  return {
    slug,
    newParagraph,
    newUpdatedDate,
    newSources: normalizeSources(row.newSources ?? row.sources),
  };
}

function parseJsonEntries(text: string): ArticleUpdateEntry[] {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { articles?: unknown }).articles)
      ? (data as { articles: unknown[] }).articles
      : null;
  if (!list) {
    throw new Error(
      "JSON must be an array of updates, or an object with an articles array"
    );
  }
  const entries: ArticleUpdateEntry[] = [];
  for (const item of list) {
    const entry = normalizeEntry(item);
    if (entry) entries.push(entry);
  }
  if (!entries.length) {
    throw new Error("No valid article updates found in JSON");
  }
  return entries;
}

/**
 * YAML-frontmatter .md — one or more docs:
 * ---
 * slug: ...
 * newUpdatedDate: YYYY-MM-DD
 * newSources: [{ title, url }]
 * ---
 * newParagraph body
 */
function parseYamlFrontmatterEntries(text: string): ArticleUpdateEntry[] {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("File is empty");

  // Prefer multi-document YAML (gray-matter style concatenated blocks).
  const blocks: string[] = [];
  const re = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n[\s\S]*?)?(?=^---\r?\n|\s*$)/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null) {
    blocks.push(match[0].trim());
  }

  const chunks = blocks.length ? blocks : [trimmed];
  const entries: ArticleUpdateEntry[] = [];

  for (const chunk of chunks) {
    const fmMatch = chunk.match(
      /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/
    );
    if (!fmMatch) continue;
    let fm: Record<string, unknown>;
    try {
      fm = (YAML.parse(fmMatch[1]) || {}) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid YAML frontmatter in update file");
    }
    const body = (fmMatch[2] || "").trim();
    const entry = normalizeEntry({
      ...fm,
      newParagraph: fm.newParagraph ?? fm.proposedParagraph ?? body,
    });
    if (entry) entries.push(entry);
  }

  if (!entries.length) {
    throw new Error("No valid article updates found in markdown/YAML file");
  }
  return entries;
}

export function parseArticleUpdateFile(
  text: string,
  filename = ""
): ArticleUpdateEntry[] {
  const trimmed = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("File is empty");

  const lower = filename.toLowerCase();
  const looksJson =
    lower.endsWith(".json") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{");

  if (looksJson) {
    try {
      return parseJsonEntries(trimmed);
    } catch (err) {
      if (lower.endsWith(".json")) throw err;
      // Fall through to YAML if extension is .md / unknown
    }
  }

  return parseYamlFrontmatterEntries(trimmed);
}

export function extractWhereThingsStand(body: string): string | null {
  const start = body.indexOf(WTS_START);
  const end = body.indexOf(WTS_END);
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start + WTS_START.length, end).trim();
}

export function replaceWhereThingsStand(
  body: string,
  newParagraph: string
): string {
  const start = body.indexOf(WTS_START);
  const end = body.indexOf(WTS_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("WHERE-THINGS-STAND markers not found");
  }
  const before = body.slice(0, start + WTS_START.length);
  const after = body.slice(end);
  return `${before}\n${newParagraph.trim()}\n${after}`;
}

export function previewArticleUpdates(entries: ArticleUpdateEntry[]): {
  matched: MatchedArticleUpdate[];
  unmatched: UnmatchedArticleUpdate[];
} {
  const matched: MatchedArticleUpdate[] = [];
  const unmatched: UnmatchedArticleUpdate[] = [];

  for (const entry of entries) {
    const existing = readArticleFile(entry.slug);
    if (!existing) {
      unmatched.push({
        ...entry,
        matched: false,
        reason: `No local article file for slug "${entry.slug}"`,
      });
      continue;
    }

    const currentParagraph = extractWhereThingsStand(existing.body);
    const markersPresent = currentParagraph != null;
    matched.push({
      ...entry,
      matched: true,
      title: asTrimmedString(existing.frontmatter.title) || entry.slug,
      currentParagraph: currentParagraph ?? "",
      currentUpdatedDate: existing.frontmatter.updatedDate
        ? String(existing.frontmatter.updatedDate)
        : undefined,
      markersPresent,
    });
  }

  return { matched, unmatched };
}

export function applyArticleUpdate(input: {
  slug: string;
  newParagraph: string;
  newUpdatedDate: string;
  selectedSources?: ArticleUpdateSource[];
}): {
  slug: string;
  updatedDate?: string;
  sourcesWritten: LinkRef[];
  sourcesSkipped: Array<LinkRef & { reason: string }>;
} {
  const slug = asTrimmedString(input.slug);
  const newParagraph = asTrimmedString(input.newParagraph);
  const newUpdatedDate = asTrimmedString(input.newUpdatedDate);
  if (!slug) throw new Error("slug is required");
  if (!newParagraph) throw new Error("newParagraph is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newUpdatedDate)) {
    throw new Error("newUpdatedDate must be YYYY-MM-DD");
  }

  const existing = readArticleFile(slug);
  if (!existing) throw new Error(`Article not found: ${slug}`);

  let body = replaceWhereThingsStand(existing.body, newParagraph);
  const frontmatterPatch: Record<string, unknown> = {
    updatedDate: newUpdatedDate,
  };

  const selected = Array.isArray(input.selectedSources)
    ? input.selectedSources
    : [];
  const toAdd: LinkRef[] = selected
    .map((s) => ({
      label: asTrimmedString(s.title),
      url: asTrimmedString(s.url),
    }))
    .filter((s) => s.label && s.url);

  let sourcesWritten: LinkRef[] = [];
  let sourcesSkipped: Array<LinkRef & { reason: string }> = [];

  if (toAdd.length) {
    const existingLinks = Array.isArray(existing.frontmatter.externalLinks)
      ? [...(existing.frontmatter.externalLinks as LinkRef[])]
      : [];
    const merged = mergeExternalLinks(existingLinks, toAdd);
    sourcesWritten = merged.written;
    sourcesSkipped = merged.skipped;
    if (merged.written.length) {
      // Reuse Articles Health signpost + externalLinks write path.
      body = ensureSignpost(body, EXTERNAL_SIGNPOST);
      frontmatterPatch.externalLinks = merged.links;
    }
  }

  const result = patchArticleContent(slug, {
    frontmatterPatch,
    body,
    bumpUpdatedDate: false,
  });

  return {
    ...result,
    sourcesWritten,
    sourcesSkipped,
  };
}
