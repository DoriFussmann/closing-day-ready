-- Closing Day Ready — initial Supabase schema
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run
--
-- NOTE: The current app still reads Markdown from disk (Astro content collections).
-- This migration prepares tables that match cms/lib/schema.ts + site/src/content.config.ts.
-- Run it when you are ready to store content in Postgres; it is not required for the file-based CMS.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Team members
-- ---------------------------------------------------------------------------
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  role text not null,
  bio text not null,
  credentials text,
  photo_path text not null,
  same_as text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_members_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

-- ---------------------------------------------------------------------------
-- Articles
-- ---------------------------------------------------------------------------
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  body text not null default '',
  date date not null,
  updated_date date,
  author_slug text not null references public.team_members (slug) on update cascade,
  category text not null,
  tags text[] not null,
  image_path text not null,
  image_alt text not null,
  image2_path text,
  image2_alt text,
  image3_path text,
  image3_alt text,
  robots text not null default 'index, follow',
  schema_type text not null default 'BlogPosting',
  locale text not null default 'en-US',
  twitter_card text not null default 'summary_large_image',
  draft boolean not null default false,
  h1 text,
  keywords text[],
  canonical text,
  og_title text,
  og_description text,
  og_image text,
  internal_links jsonb not null default '[]'::jsonb,
  external_links jsonb not null default '[]'::jsonb,
  faqs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint articles_title_len check (char_length(title) between 55 and 60),
  constraint articles_description_len check (char_length(description) between 140 and 160),
  constraint articles_tags_len check (cardinality(tags) between 4 and 6),
  constraint articles_image_alt_len check (char_length(image_alt) >= 10),
  constraint articles_image2_alt_len check (image2_path is null or char_length(coalesce(image2_alt, '')) >= 10),
  constraint articles_image3_alt_len check (image3_path is null or char_length(coalesce(image3_alt, '')) >= 10),
  constraint articles_h1_len check (h1 is null or char_length(h1) >= 20),
  constraint articles_internal_links_is_array check (jsonb_typeof(internal_links) = 'array'),
  constraint articles_external_links_is_array check (jsonb_typeof(external_links) = 'array'),
  constraint articles_faqs_is_array check (jsonb_typeof(faqs) = 'array')
);

create index if not exists articles_date_idx on public.articles (date desc);
create index if not exists articles_draft_idx on public.articles (draft);
create index if not exists articles_author_slug_idx on public.articles (author_slug);
create index if not exists articles_tags_gin_idx on public.articles using gin (tags);

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text not null,
  order_index integer not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists services_order_idx on public.services (order_index);

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists team_members_set_updated_at on public.team_members;
create trigger team_members_set_updated_at
  before update on public.team_members
  for each row execute function public.set_updated_at();

drop trigger if exists articles_set_updated_at on public.articles;
create trigger articles_set_updated_at
  before update on public.articles
  for each row execute function public.set_updated_at();

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Public can read published content; writes go through service role / CMS.
-- ---------------------------------------------------------------------------
alter table public.team_members enable row level security;
alter table public.articles enable row level security;
alter table public.services enable row level security;

drop policy if exists "Public read team_members" on public.team_members;
create policy "Public read team_members"
  on public.team_members
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Public read published articles" on public.articles;
create policy "Public read published articles"
  on public.articles
  for select
  to anon, authenticated
  using (draft = false);

drop policy if exists "Public read services" on public.services;
create policy "Public read services"
  on public.services
  for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policies for anon/authenticated.
-- Use the service role key from the CMS/server for writes.

-- ---------------------------------------------------------------------------
-- Optional Storage buckets (uncomment if you want Supabase Storage for images)
-- ---------------------------------------------------------------------------
-- insert into storage.buckets (id, name, public)
-- values
--   ('article-images', 'article-images', true),
--   ('team-photos', 'team-photos', true)
-- on conflict (id) do nothing;
--
-- create policy "Public read article images"
--   on storage.objects for select to anon, authenticated
--   using (bucket_id = 'article-images');
--
-- create policy "Public read team photos"
--   on storage.objects for select to anon, authenticated
--   using (bucket_id = 'team-photos');
