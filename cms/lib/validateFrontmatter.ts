import { articleFrontmatterSchema, type ArticleFrontmatter } from "./schema.js";

export type FieldStatus = {
  field: string;
  ok: boolean;
  message?: string;
};

export type ValidationResult = {
  valid: boolean;
  missing: string[];
  invalid: { field: string; message: string }[];
  statuses: FieldStatus[];
  data?: ArticleFrontmatter;
};

const PLACEHOLDER_RE = /REPLACE|TODO|placeholder/i;

function titleStatus(title: unknown): FieldStatus {
  if (typeof title !== "string" || !title.trim()) {
    return { field: "title", ok: false, message: "required" };
  }
  const len = title.length;
  if (len < 55 || len > 60) {
    return {
      field: "title",
      ok: false,
      message: `${len} chars, needs 55–60`,
    };
  }
  return { field: "title", ok: true };
}

function descriptionStatus(description: unknown): FieldStatus {
  if (typeof description !== "string" || !description.trim()) {
    return { field: "description", ok: false, message: "required" };
  }
  const len = description.length;
  if (len < 140 || len > 160) {
    return {
      field: "description",
      ok: false,
      message: `${len} chars, needs 140–160`,
    };
  }
  return { field: "description", ok: true };
}

function tagsStatus(tags: unknown): FieldStatus {
  if (!Array.isArray(tags) || tags.length === 0) {
    return { field: "tags", ok: false, message: "required (4–6 tags)" };
  }
  if (tags.length < 4 || tags.length > 6) {
    return {
      field: "tags",
      ok: false,
      message: `${tags.length} tags, needs 4–6`,
    };
  }
  if (tags.some((t) => typeof t !== "string" || !t.trim())) {
    return { field: "tags", ok: false, message: "each tag must be non-empty" };
  }
  return { field: "tags", ok: true };
}

/**
 * Image path strings from an uploaded .md do NOT satisfy the requirement.
 * Only a real file uploaded this session (sessionImagePresent) counts.
 */
export function validateArticleInput(
  raw: Record<string, unknown>,
  options: {
    sessionImages: {
      image: boolean;
      image2: boolean;
      image3: boolean;
    };
    knownAuthors: string[];
    siteUrl?: string;
  }
): ValidationResult {
  let siteHost = "";
  try {
    if (options.siteUrl) siteHost = new URL(options.siteUrl).hostname.toLowerCase();
  } catch {
    siteHost = "";
  }
  const statuses: FieldStatus[] = [];
  const missing: string[] = [];
  const invalid: { field: string; message: string }[] = [];

  const push = (status: FieldStatus) => {
    statuses.push(status);
    if (!status.ok) {
      if (status.message === "required" || status.message?.includes("no image uploaded")) {
        missing.push(status.field + (status.message && status.message !== "required" ? ` (${status.message})` : ""));
      } else {
        invalid.push({ field: status.field, message: status.message || "invalid" });
      }
    }
  };

  push(titleStatus(raw.title));
  push(descriptionStatus(raw.description));

  if (typeof raw.slug !== "string" || !raw.slug.trim()) {
    push({ field: "slug", ok: false, message: "required" });
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug)) {
    push({ field: "slug", ok: false, message: "use lowercase kebab-case" });
  } else {
    push({ field: "slug", ok: true });
  }

  if (!raw.date) {
    push({ field: "date", ok: false, message: "required" });
  } else if (Number.isNaN(new Date(String(raw.date)).getTime())) {
    push({ field: "date", ok: false, message: "invalid date" });
  } else {
    push({ field: "date", ok: true });
  }

  if (typeof raw.author !== "string" || !raw.author.trim()) {
    push({ field: "author", ok: false, message: "required" });
  } else if (!options.knownAuthors.includes(raw.author)) {
    push({
      field: "author",
      ok: false,
      message: `unknown team slug "${raw.author}"`,
    });
  } else {
    push({ field: "author", ok: true });
  }

  if (typeof raw.category !== "string" || !raw.category.trim()) {
    push({ field: "category", ok: false, message: "required" });
  } else {
    push({ field: "category", ok: true });
  }

  push(tagsStatus(raw.tags));

  // Hero image: session upload required; existing path is informational only
  const existingImage = typeof raw.image === "string" ? raw.image : "";
  if (!options.sessionImages.image) {
    const msg = existingImage
      ? PLACEHOLDER_RE.test(existingImage) || existingImage.length > 0
        ? "path present in file but no image uploaded this session — drop a real file"
        : "required"
      : "required";
    push({ field: "image", ok: false, message: msg });
  } else {
    push({ field: "image", ok: true });
  }

  if (typeof raw.imageAlt !== "string" || raw.imageAlt.trim().length < 10) {
    push({
      field: "imageAlt",
      ok: false,
      message:
        typeof raw.imageAlt === "string" && raw.imageAlt.trim()
          ? `${raw.imageAlt.trim().length} chars, needs ≥10`
          : "required (min 10 chars)",
    });
  } else {
    push({ field: "imageAlt", ok: true });
  }

  // Optional image2/image3: if session file present, alt required; existing path alone invalid for generate if we're editing with new uploads
  if (options.sessionImages.image2) {
    push({ field: "image2", ok: true });
    if (typeof raw.image2Alt !== "string" || raw.image2Alt.trim().length < 10) {
      push({
        field: "image2Alt",
        ok: false,
        message: "required when image2 present (min 10 chars)",
      });
    } else {
      push({ field: "image2Alt", ok: true });
    }
  } else if (typeof raw.image2 === "string" && raw.image2.trim()) {
    push({
      field: "image2",
      ok: false,
      message: "path present in file but no image uploaded this session — drop a real file",
    });
  }

  if (options.sessionImages.image3) {
    push({ field: "image3", ok: true });
    if (typeof raw.image3Alt !== "string" || raw.image3Alt.trim().length < 10) {
      push({
        field: "image3Alt",
        ok: false,
        message: "required when image3 present (min 10 chars)",
      });
    } else {
      push({ field: "image3Alt", ok: true });
    }
  } else if (typeof raw.image3 === "string" && raw.image3.trim()) {
    push({
      field: "image3",
      ok: false,
      message: "path present in file but no image uploaded this session — drop a real file",
    });
  }

  // Defaults present or defaultable
  for (const field of ["robots", "schemaType", "locale", "twitterCard", "draft"] as const) {
    push({ field, ok: true });
  }

  // Optional h1 — not in missing summary
  if (raw.h1 != null && raw.h1 !== "") {
    if (typeof raw.h1 !== "string" || raw.h1.length < 20) {
      push({ field: "h1", ok: false, message: "min 20 chars when set" });
    } else {
      push({ field: "h1", ok: true });
    }
  }

  // Keywords optional but often expected — not required by schema
  if (raw.keywords != null) {
    if (!Array.isArray(raw.keywords)) {
      push({ field: "keywords", ok: false, message: "must be an array" });
    } else {
      push({ field: "keywords", ok: true });
    }
  }

  // Link validations
  if (Array.isArray(raw.internalLinks)) {
    for (let i = 0; i < raw.internalLinks.length; i++) {
      const link = raw.internalLinks[i] as { label?: string; url?: string };
      if (!link.label?.trim()) {
        push({ field: `internalLinks[${i}].label`, ok: false, message: "required" });
      }
      if (!link.url?.trim()) {
        push({ field: `internalLinks[${i}].url`, ok: false, message: "required" });
      }
    }
  }

  if (Array.isArray(raw.externalLinks)) {
    for (let i = 0; i < raw.externalLinks.length; i++) {
      const link = raw.externalLinks[i] as { label?: string; url?: string };
      if (!link.label?.trim()) {
        push({
          field: `externalLinks[${i}].label`,
          ok: false,
          message: "required",
        });
      }
      try {
        const u = new URL(String(link.url || ""));
        if (!/^https?:$/i.test(u.protocol)) {
          throw new Error("protocol");
        }
        const host = u.hostname.toLowerCase();
        if (host === "example.com" || host.endsWith(".example.com")) {
          push({
            field: `externalLinks[${i}].url`,
            ok: false,
            message: "must not point at example.com placeholder domain",
          });
        } else if (siteHost && host === siteHost) {
          push({
            field: `externalLinks[${i}].url`,
            ok: false,
            message: "must not point at the site's own domain",
          });
        } else {
          push({ field: `externalLinks[${i}].url`, ok: true });
        }
      } catch {
        push({
          field: `externalLinks[${i}].url`,
          ok: false,
          message: "must be a valid http(s) URL",
        });
      }
    }
  }

  const blockingMissing = missing.filter((m) => !m.startsWith("h1"));
  const blockingInvalid = invalid.filter((i) => i.field !== "h1" || true);

  // For generate, image2/image3 path-without-session should block only if user intends to keep them —
  // Spec: pre-existing path must show as missing/invalid and Generate blocked.
  // So if image2 path present without session upload, it's in missing — blocks generate.
  // That means editing an existing article REQUIRES re-uploading all images that have paths.
  // Spec is clear: "The Generate button must be blocked on this exact condition"

  const valid = blockingMissing.length === 0 && blockingInvalid.length === 0;

  let data: ArticleFrontmatter | undefined;
  if (valid) {
    const parsed = articleFrontmatterSchema.safeParse({
      ...raw,
      // placeholder paths for zod string validation; real paths written by writeArticle
      image: options.sessionImages.image ? "session://image" : raw.image,
      image2: options.sessionImages.image2 ? "session://image2" : undefined,
      image3: options.sessionImages.image3 ? "session://image3" : undefined,
      image2Alt: options.sessionImages.image2 ? raw.image2Alt : undefined,
      image3Alt: options.sessionImages.image3 ? raw.image3Alt : undefined,
    });
    if (parsed.success) {
      data = parsed.data;
    } else {
      for (const issue of parsed.error.issues) {
        invalid.push({
          field: issue.path.join(".") || "frontmatter",
          message: issue.message,
        });
      }
    }
  }

  return {
    valid: valid && !!data,
    missing: blockingMissing,
    invalid,
    statuses,
    data,
  };
}

export function formatMissingSummary(result: ValidationResult): string {
  if (result.missing.length === 0 && result.invalid.length === 0) {
    return "All required fields present.";
  }
  const parts: string[] = [];
  if (result.missing.length) {
    parts.push(`Missing: ${result.missing.join(", ")}`);
  }
  if (result.invalid.length) {
    parts.push(
      `Invalid: ${result.invalid.map((i) => `${i.field} (${i.message})`).join(", ")}`
    );
  }
  return parts.join(" · ");
}
