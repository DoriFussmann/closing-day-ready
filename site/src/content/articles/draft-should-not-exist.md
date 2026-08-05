---
title: Draft Articles Must Never Emit A Public Route At Builds
description: Draft articles are validated by the content schema but excluded from getStaticPaths, listings, RSS, and the sitemap so they never ship live.
slug: draft-should-not-exist
date: 2026-08-05
author: alex-rivera
category: Drafts
tags:
  - alpha
  - beta
  - gamma
  - delta
image: ../../assets/articles/technical-seo-answer-engine-visibility/hero.png
imageAlt: Reused hero image for draft route exclusion test
robots: noindex, follow
schemaType: BlogPosting
locale: en-US
twitterCard: summary_large_image
draft: true
---

Draft body. This page must not be emitted by getStaticPaths.
