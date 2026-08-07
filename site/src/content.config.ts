import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const linkSchema = z.object({
  label: z.string().min(1),
  url: z.string().min(1),
});

const faqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/articles" }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(55).max(60),
      description: z.string().min(140).max(160),
      slug: z.string().min(1),
      date: z.coerce.date(),
      author: z.string().min(1),
      category: z.string().min(1),
      tags: z.array(z.string()).min(4).max(6),
      image: image(),
      imageAlt: z.string().min(10),
      robots: z.string().default("index, follow"),
      schemaType: z.string().default("BlogPosting"),
      locale: z.string().default("en-US"),
      twitterCard: z.string().default("summary_large_image"),
      draft: z.boolean().default(false),
      h1: z.string().min(20).optional(),
      updatedDate: z.coerce.date().optional(),
      keywords: z.array(z.string()).optional(),
      pillarKeyword: z.string().optional(),
      supportingKeyword: z.string().optional(),
      articleType: z
        .enum(["comprehensive", "howto", "comparison", "faq", "flex"])
        .optional(),
      targetKeyword: z.string().optional(),
      canonical: z.string().optional(),
      image2: image().optional(),
      image2Alt: z.string().min(10).optional(),
      image3: image().optional(),
      image3Alt: z.string().min(10).optional(),
      ogTitle: z.string().optional(),
      ogDescription: z.string().optional(),
      ogImage: z.string().optional(),
      internalLinks: z.array(linkSchema).optional(),
      externalLinks: z.array(linkSchema).optional(),
      faqs: z.array(faqSchema).optional(),
    }),
});

const team = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/team" }),
  schema: ({ image }) =>
    z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
      role: z.string().min(1),
      bio: z.string().min(1),
      credentials: z.string().optional(),
      photo: image(),
      sameAs: z.array(z.string().url()).default([]),
      draft: z.boolean().default(false),
    }),
});

const services = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/services" }),
  schema: z.object({
    title: z.string().min(1),
    slug: z.string().min(1),
    summary: z.string().min(1),
    order: z.number(),
  }),
});

export const collections = { articles, team, services };
