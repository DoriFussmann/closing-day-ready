import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "../data/pagespeed-cache.json");

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PSI_TIMEOUT_MS = 90_000;
const CATEGORIES = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
] as const;

export type CategoryScores = {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
};

export type PageSpeedScanResult = {
  slug: string;
  url: string;
  mobile: CategoryScores;
  desktop: CategoryScores;
  /** Mobile Performance — primary indicator for the collapsed Speed chip. */
  indicatorScore: number;
  indicatorLabel: "mobile Performance";
  status: "green" | "orange" | "red";
  fetchedAt: string;
};

type CacheFile = Record<string, PageSpeedScanResult>;

export function isPageSpeedConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PAGESPEED_API_KEY?.trim());
}

/** Map a 0–100 Lighthouse score to Articles Health colors. */
export function scoreToHealthStatus(score: number): "green" | "orange" | "red" {
  if (score >= 90) return "green";
  if (score >= 50) return "orange";
  return "red";
}

function readCache(): CacheFile {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    return raw && typeof raw === "object" ? (raw as CacheFile) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: CacheFile): void {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

export function getCachedPageSpeed(slug: string): PageSpeedScanResult | null {
  const hit = readCache()[slug];
  return hit && hit.mobile && hit.desktop ? hit : null;
}

function extractScores(payload: unknown): CategoryScores {
  const categories =
    (payload as { lighthouseResult?: { categories?: Record<string, { score?: number | null }> } })
      ?.lighthouseResult?.categories || {};

  const toScore = (key: string): number => {
    const raw = categories[key]?.score;
    if (typeof raw !== "number" || Number.isNaN(raw)) {
      throw new Error(`PageSpeed response missing category score: ${key}`);
    }
    return Math.round(raw * 100);
  };

  return {
    performance: toScore("performance"),
    accessibility: toScore("accessibility"),
    bestPractices: toScore("best-practices"),
    seo: toScore("seo"),
  };
}

async function fetchStrategy(
  url: string,
  strategy: "mobile" | "desktop",
  apiKey: string
): Promise<CategoryScores> {
  const params = new URLSearchParams();
  params.set("url", url);
  params.set("key", apiKey);
  params.set("strategy", strategy);
  for (const category of CATEGORIES) {
    params.append("category", category);
  }

  let response: Response;
  try {
    response = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(PSI_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(
        `PageSpeed ${strategy} scan timed out after ${PSI_TIMEOUT_MS / 1000}s. Try again shortly.`
      );
    }
    throw new Error(
      `PageSpeed ${strategy} request failed: ${
        err instanceof Error ? err.message : "network error"
      }`
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `PageSpeed ${strategy} returned non-JSON (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    const apiError =
      (body as { error?: { message?: string; status?: string; code?: number } })
        ?.error?.message || `HTTP ${response.status}`;
    if (response.status === 429) {
      throw new Error(
        `PageSpeed rate limit hit on ${strategy}. Wait a minute and retry.`
      );
    }
    if (response.status === 400) {
      throw new Error(
        `PageSpeed rejected the URL for ${strategy}: ${apiError}`
      );
    }
    throw new Error(`PageSpeed ${strategy} error: ${apiError}`);
  }

  const runtimeError = (
    body as { lighthouseResult?: { runtimeError?: { message?: string } } }
  )?.lighthouseResult?.runtimeError;
  if (runtimeError?.message) {
    throw new Error(`PageSpeed ${strategy} runtime error: ${runtimeError.message}`);
  }

  return extractScores(body);
}

/**
 * Run mobile + desktop PageSpeed Insights for a live article URL.
 * Persists results to cms/data/pagespeed-cache.json.
 */
export async function runPageSpeedScan(
  slug: string,
  url: string
): Promise<PageSpeedScanResult> {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GOOGLE_PAGESPEED_API_KEY is not configured. Add it to cms/.env.local."
    );
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("A live https published URL is required for PageSpeed.");
  }

  // Sequential: PSI is heavy; avoids bursting the free-tier quota.
  const mobile = await fetchStrategy(url, "mobile", apiKey);
  const desktop = await fetchStrategy(url, "desktop", apiKey);

  const indicatorScore = mobile.performance;
  const result: PageSpeedScanResult = {
    slug,
    url,
    mobile,
    desktop,
    indicatorScore,
    indicatorLabel: "mobile Performance",
    status: scoreToHealthStatus(indicatorScore),
    fetchedAt: new Date().toISOString(),
  };

  const cache = readCache();
  cache[slug] = result;
  writeCache(cache);
  return result;
}
