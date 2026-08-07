/**
 * Live web search for external-link proposals via DataForSEO Google SERP.
 * Requires DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (same keys used in TNV).
 */

const TIMEOUT_MS = 30_000;
const LOCATION_CODE = 2840; // United States
const LANGUAGE_CODE = "en";

export type WebSearchHit = {
  title: string;
  url: string;
  note?: string;
};

export type WebSearchResponse = {
  available: boolean;
  query: string;
  results: WebSearchHit[];
  reason?: string;
};

export function isWebSearchConfigured(): boolean {
  return Boolean(
    process.env.DATAFORSEO_LOGIN?.trim() &&
      process.env.DATAFORSEO_PASSWORD?.trim()
  );
}

function authHeader(): string | null {
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD?.trim();
  if (!login || !password) return null;
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

/**
 * Build a retrieval query from article topic fields.
 * Parenthetical notes like "(no volume data)" are stripped.
 */
export function buildExternalLinkSearchQuery(
  targetKeyword: string | undefined,
  pillarKeyword: string | undefined
): string {
  const clean = (value: string | undefined) =>
    String(value || "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const parts = [clean(targetKeyword), clean(pillarKeyword)].filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length === 0) return "";
  return `${unique.join(" ")} guide OR resource OR statistics`;
}

export async function searchWeb(
  query: string,
  depth = 10
): Promise<WebSearchResponse> {
  const q = String(query || "").trim();
  if (!q) {
    return { available: false, query: "", results: [], reason: "empty query" };
  }

  const auth = authHeader();
  if (!auth) {
    return {
      available: false,
      query: q,
      results: [],
      reason:
        "DATAFORSEO_LOGIN/PASSWORD not configured. Add them to cms/.env.local for live external-link search.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      "https://api.dataforseo.com/v3/serp/google/organic/live/regular",
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            keyword: q,
            location_code: LOCATION_CODE,
            language_code: LANGUAGE_CODE,
            depth: Math.min(Number(depth) || 10, 20),
          },
        ]),
        signal: controller.signal,
      }
    );
    const data = (await res.json().catch(() => null)) as {
      status_code?: number;
      status_message?: string;
      tasks?: Array<{
        status_code?: number;
        status_message?: string;
        result?: Array<{
          items?: Array<{
            type?: string;
            title?: string;
            url?: string;
            description?: string;
          }>;
        }>;
      }>;
    } | null;

    if (!res.ok) {
      return {
        available: false,
        query: q,
        results: [],
        reason: `DataForSEO HTTP ${res.status}`,
      };
    }
    if (!data || data.status_code !== 20000) {
      return {
        available: false,
        query: q,
        results: [],
        reason: data?.status_message || `status_code ${data?.status_code}`,
      };
    }

    const task = Array.isArray(data.tasks) ? data.tasks[0] : null;
    if (!task || task.status_code !== 20000) {
      return {
        available: false,
        query: q,
        results: [],
        reason: task?.status_message || `task status ${task?.status_code}`,
      };
    }

    const items = Array.isArray(task.result?.[0]?.items)
      ? task.result![0].items!
      : [];

    const results: WebSearchHit[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const url = String(item?.url || "").trim();
      if (!url.startsWith("http")) continue;
      if (url.includes("closingdayready.com")) continue;
      const key = url.replace(/\/$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        title: String(item.title || url).trim(),
        url,
        note: item.description ? String(item.description) : undefined,
      });
      if (results.length >= 10) break;
    }

    return { available: true, query: q, results };
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "DataForSEO request timed out"
        : err instanceof Error
          ? err.message
          : "DataForSEO request failed";
    return { available: false, query: q, results: [], reason: msg };
  } finally {
    clearTimeout(timer);
  }
}
