import { z } from "zod";

/**
 * Single source of truth for the article schema field names.
 * Must match site/src/content.config.ts exactly (field names).
 * Image fields are strings here (relative paths); Astro validates via image().
 */
export const linkSchema = z.object({
  label: z.string().min(1),
  url: z.string().min(1),
});

export const faqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const articleFrontmatterSchema = z.object({
  title: z.string().min(55).max(60),
  description: z.string().min(140).max(160),
  slug: z.string().min(1),
  date: z.coerce.date(),
  author: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()).min(4).max(6),
  image: z.string().min(1),
  imageAlt: z.string().min(10),
  robots: z.string().default("index, follow"),
  schemaType: z.string().default("BlogPosting"),
  locale: z.string().default("en-US"),
  twitterCard: z.string().default("summary_large_image"),
  draft: z.boolean().default(false),
  h1: z.string().min(20).optional(),
  updatedDate: z.coerce.date().optional(),
  keywords: z.array(z.string()).optional(),
  canonical: z.string().optional(),
  image2: z.string().optional(),
  image2Alt: z.string().min(10).optional(),
  image3: z.string().optional(),
  image3Alt: z.string().min(10).optional(),
  ogTitle: z.string().optional(),
  ogDescription: z.string().optional(),
  ogImage: z.string().optional(),
  internalLinks: z.array(linkSchema).optional(),
  externalLinks: z.array(linkSchema).optional(),
  faqs: z.array(faqSchema).optional(),
});

export type ArticleFrontmatter = z.infer<typeof articleFrontmatterSchema>;

export const teamFrontmatterSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  role: z.string().min(1),
  bio: z.string().min(1),
  credentials: z.string().optional(),
  photo: z.string().min(1),
  sameAs: z.array(z.string().url()).default([]),
});

export type TeamFrontmatter = z.infer<typeof teamFrontmatterSchema>;

export const serviceFrontmatterSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  summary: z.string().min(1),
  order: z.number(),
});

export type ServiceFrontmatter = z.infer<typeof serviceFrontmatterSchema>;

/** Required article fields for CMS checklist (names must match Astro schema). */
export const REQUIRED_ARTICLE_FIELDS = [
  "title",
  "description",
  "slug",
  "date",
  "author",
  "category",
  "tags",
  "image",
  "imageAlt",
  "robots",
  "schemaType",
  "locale",
  "twitterCard",
  "draft",
] as const;
