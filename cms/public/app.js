/* global document, window, fetch, FormData, File, URLSearchParams */

const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function parseJsonResponse(res) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `Server returned non-JSON (${res.status}): ${text.slice(0, 200)}`
    );
  }
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function setStatus(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.dataset.error = isError ? "true" : "false";
}

function pageKind() {
  const path = window.location.pathname;
  if (path.endsWith("team.html")) return "team";
  if (path.endsWith("dashboard.html")) return "dashboard";
  if (path.endsWith("add-article.html")) return "article-form";
  if (path.endsWith("articles-health.html")) return "articles-health";
  if (path.endsWith("articles-update.html")) return "articles-update";
  return "article-list";
}

/* ---------------- Article screen ---------------- */

const articleState = {
  frontmatter: {},
  body: "",
  sessionFiles: { image: null },
  knownRoutes: [],
  siteUrl: "",
  editingSlug: null,
};

function collectFrontmatterFromForm(form) {
  const fd = new FormData(form);
  const tags = String(fd.get("tags") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const keywords = String(fd.get("keywords") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const internalLinks = [...form.querySelectorAll("#internal-links .link-row")].map(
    (row) => ({
      label: row.querySelector('[name="il-label"]').value.trim(),
      url: row.querySelector('[name="il-url"]').value.trim(),
    })
  );

  const externalLinks = [...form.querySelectorAll("#external-links .link-row")].map(
    (row) => ({
      label: row.querySelector('[name="el-label"]').value.trim(),
      url: row.querySelector('[name="el-url"]').value.trim(),
    })
  );

  const faqs = [...form.querySelectorAll("#faqs .faq-row")].map((row) => ({
    question: row.querySelector('[name="faq-q"]').value.trim(),
    answer: row.querySelector('[name="faq-a"]').value.trim(),
  })).filter((f) => f.question || f.answer);

  const title = String(fd.get("title") || "");
  const description = String(fd.get("description") || "");
  const h1 = String(fd.get("h1") || "");
  const ogTitle = String(fd.get("ogTitle") || "");
  const ogDescription = String(fd.get("ogDescription") || "");
  const ogImage = String(fd.get("ogImage") || "");

  const fm = {
    title,
    description,
    slug: String(fd.get("slug") || ""),
    date: String(fd.get("date") || ""),
    updatedDate: String(fd.get("updatedDate") || "") || undefined,
    author: String(fd.get("author") || ""),
    category: String(fd.get("category") || ""),
    tags,
    keywords: keywords.length ? keywords : undefined,
    image: articleState.frontmatter.image || "",
    imageAlt: String(fd.get("imageAlt") || ""),
    pillarKeyword: articleState.frontmatter.pillarKeyword || undefined,
    supportingKeyword: articleState.frontmatter.supportingKeyword || undefined,
    articleType: articleState.frontmatter.articleType || undefined,
    targetKeyword: articleState.frontmatter.targetKeyword || undefined,
    robots: String(fd.get("robots") || "index, follow"),
    schemaType: String(fd.get("schemaType") || "BlogPosting"),
    locale: String(fd.get("locale") || "en-US"),
    twitterCard: String(fd.get("twitterCard") || "summary_large_image"),
    draft: form.querySelector('[name="draft"]').checked,
    canonical: String(fd.get("canonical") || "") || undefined,
    internalLinks: internalLinks.length ? internalLinks : undefined,
    externalLinks: externalLinks.length ? externalLinks : undefined,
    faqs: faqs.length ? faqs : undefined,
  };

  // Only include og* / h1 when user entered a value; server omits if same as base
  if (h1) fm.h1 = h1;
  if (ogTitle) fm.ogTitle = ogTitle;
  if (ogDescription) fm.ogDescription = ogDescription;
  if (ogImage) fm.ogImage = ogImage;

  return fm;
}

function updateCounters(form) {
  const title = form.querySelector('[name="title"]');
  const desc = form.querySelector('[name="description"]');
  const tCounter = form.querySelector('.counter[data-for="title"]');
  const dCounter = form.querySelector('.counter[data-for="description"]');
  if (title && tCounter) {
    const n = title.value.length;
    const ok = n >= 55 && n <= 60;
    tCounter.textContent = `${n}/55–60`;
    tCounter.classList.toggle("is-ok", ok);
    tCounter.classList.toggle("is-bad", !ok);
  }
  if (desc && dCounter) {
    const n = desc.value.length;
    const ok = n >= 140 && n <= 160;
    dCounter.textContent = `${n}/140–160`;
    dCounter.classList.toggle("is-ok", ok);
    dCounter.classList.toggle("is-bad", !ok);
  }
}

function addLinkRow(container, prefix, values = { label: "", url: "" }) {
  const row = document.createElement("p");
  row.className = "link-row";
  row.innerHTML = `
    <input name="${prefix}-label" placeholder="label" value="${escapeAttr(values.label)}" />
    <input name="${prefix}-url" placeholder="url" value="${escapeAttr(values.url)}" />
    <button type="button" class="remove-row btn-secondary">Remove</button>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => {
    row.remove();
    if (pageKind() === "article-form") void runValidation();
  });
  container.appendChild(row);
}

function addFaqRow(container, values = { question: "", answer: "" }) {
  const row = document.createElement("p");
  row.className = "faq-row";
  row.innerHTML = `
    <input name="faq-q" placeholder="question" value="${escapeAttr(values.question)}" />
    <textarea name="faq-a" placeholder="answer" rows="2">${escapeHtml(values.answer)}</textarea>
    <button type="button" class="remove-row btn-secondary">Remove</button>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => {
    row.remove();
    if (pageKind() === "article-form") void runValidation();
  });
  container.appendChild(row);
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fillFormFromFrontmatter(form, fm, body) {
  const {
    image2: _image2,
    image2Alt: _image2Alt,
    image3: _image3,
    image3Alt: _image3Alt,
    ...rest
  } = fm || {};
  articleState.frontmatter = { ...rest };
  articleState.body = body || "";
  form.title.value = fm.title || "";
  form.description.value = fm.description || "";
  form.slug.value = fm.slug || "";
  form.date.value = toDateInput(fm.date);
  form.updatedDate.value = toDateInput(fm.updatedDate || fm.date);
  form.category.value = fm.category || "";
  form.tags.value = Array.isArray(fm.tags) ? fm.tags.join(", ") : "";
  form.keywords.value = Array.isArray(fm.keywords) ? fm.keywords.join(", ") : "";
  form.h1.value = fm.h1 || fm.title || "";
  form.imageAlt.value = fm.imageAlt || "";
  form.ogTitle.value = fm.ogTitle || "";
  form.ogDescription.value = fm.ogDescription || "";
  form.ogImage.value = fm.ogImage || "";
  form.canonical.value = fm.canonical || "";
  form.robots.value = fm.robots || "index, follow";
  form.schemaType.value = fm.schemaType || "BlogPosting";
  form.locale.value = fm.locale || "en-US";
  form.twitterCard.value = fm.twitterCard || "summary_large_image";
  form.draft.checked = Boolean(fm.draft);
  form.body.value = body || "";

  if (fm.author) form.author.value = fm.author;

  const il = form.querySelector("#internal-links");
  const el = form.querySelector("#external-links");
  const faq = form.querySelector("#faqs");
  il.innerHTML = "";
  el.innerHTML = "";
  faq.innerHTML = "";
  (fm.internalLinks || []).forEach((l) => addLinkRow(il, "il", l));
  (fm.externalLinks || []).forEach((l) => addLinkRow(el, "el", l));
  (fm.faqs || []).forEach((f) => addFaqRow(faq, f));

  // Reset session images on load — existing paths do not satisfy requirement
  articleState.sessionFiles = { image: null };
  document.getElementById("image-file-label").textContent = fm.image
    ? `Path in file (not accepted): ${fm.image}`
    : "No file this session";

  updateCounters(form);
}

function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return String(value).slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

async function loadTeamOptions(select) {
  const data = await parseJsonResponse(await fetch("/api/team"));
  select.innerHTML = '<option value="">Select author…</option>';
  for (const member of data.team) {
    const opt = document.createElement("option");
    opt.value = member.slug;
    opt.textContent = `${member.name} (${member.slug})`;
    select.appendChild(opt);
  }
}

async function loadArticleList() {
  const list = document.getElementById("article-list");
  if (!list) return;
  if (!articleState.siteUrl) {
    const cfg = await parseJsonResponse(await fetch("/api/config"));
    articleState.siteUrl = cfg.siteUrl;
  }
  const data = await parseJsonResponse(await fetch("/articles"));
  list.innerHTML = "";
  for (const a of data.articles) {
    const li = document.createElement("li");
    const liveUrl = `${articleState.siteUrl.replace(/\/$/, "")}/articles/${a.slug}/`;
    const editUrl = `/add-article.html?slug=${encodeURIComponent(a.slug)}`;
    const dateLabel = a.updatedDate || a.date || "";
    li.innerHTML = `
      <div class="item-main">
        <div class="item-heading">
          <a class="article-title" href="${escapeAttr(editUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a>
          ${a.draft ? '<span class="badge">draft</span>' : ""}
        </div>
        <span class="item-meta">${escapeHtml(a.slug)}${dateLabel ? ` · ${escapeHtml(dateLabel)}` : ""} · ${a.internalLinks} int · ${a.externalLinks} ext · ${a.faqs} faqs</span>
      </div>
      <span class="item-links">
        <a class="item-link" href="${escapeAttr(liveUrl)}" target="_blank" rel="noopener noreferrer">Live</a>
        <a class="item-link" href="${escapeAttr(editUrl)}" target="_blank" rel="noopener noreferrer">Edit</a>
      </span>
      <span class="item-actions">
        <button type="button" class="list-action" data-action="toggle-draft" data-slug="${escapeAttr(a.slug)}" data-draft="${a.draft ? "false" : "true"}">
          ${a.draft ? "Publish" : "Unpublish"}
        </button>
        <button type="button" class="btn-danger" data-action="delete" data-slug="${escapeAttr(a.slug)}">Delete</button>
      </span>
    `;
    list.appendChild(li);
  }
  if (!list.dataset.boundClick) {
    list.dataset.boundClick = "1";
    list.addEventListener("click", onArticleListClick);
  }
}

async function onArticleListClick(e) {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const slug = t.getAttribute("data-slug");
  if (!slug) return;

  if (t.getAttribute("data-action") === "toggle-draft") {
    const draft = t.getAttribute("data-draft") === "true";
    try {
      await parseJsonResponse(
        await fetch(`/api/articles/${slug}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft }),
        })
      );
      await loadArticleList();
      setStatus(
        document.getElementById("action-status"),
        draft ? `Unpublished ${slug}` : `Published ${slug}`
      );
    } catch (err) {
      setStatus(document.getElementById("action-status"), err.message, true);
    }
    return;
  }

  if (t.getAttribute("data-action") === "delete") {
    if (!window.confirm(`Delete article ${slug}?`)) return;
    try {
      await parseJsonResponse(
        await fetch(`/api/articles/${slug}`, { method: "DELETE" })
      );
      await loadArticleList();
      setStatus(document.getElementById("action-status"), `Deleted ${slug}`);
    } catch (err) {
      setStatus(document.getElementById("action-status"), err.message, true);
    }
  }
}

function bindDropZone(el, onFiles, options = {}) {
  if (!el) return;

  const inputId = options.inputId || el.getAttribute("aria-controls");
  let input = inputId ? document.getElementById(inputId) : null;
  if (!input) {
    input = document.createElement("input");
    input.type = "file";
    input.hidden = true;
    el.insertAdjacentElement("afterend", input);
  }
  if (options.accept) input.accept = options.accept;
  if (options.multiple) input.multiple = true;

  const openPicker = () => input.click();

  el.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    onFiles(files);
  });
  el.addEventListener("click", (e) => {
    e.preventDefault();
    openPicker();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });
  input.addEventListener("change", () => {
    const files = [...(input.files || [])];
    if (files.length) onFiles(files);
    input.value = "";
  });
}

function updateMissingPanelHeader(data) {
  const label = document.getElementById("missing-heading-label");
  if (!label) return;
  const count = (data.missing?.length || 0) + (data.invalid?.length || 0);
  label.textContent =
    count === 0 ? "All required fields present" : `Missing Fields (${count})`;
}

function updateChecklistPanelHeader(statuses) {
  const label = document.getElementById("checklist-heading-label");
  if (!label) return;
  const incomplete = (statuses || []).filter((s) => !s.ok).length;
  label.textContent =
    incomplete === 0
      ? "Field Checklist (complete)"
      : `Field Checklist (${incomplete} incomplete)`;
}

async function handleMarkdownDrop(files) {
  const file = files.find((f) => f.name.endsWith(".md"));
  if (!file) {
    setStatus(document.getElementById("md-drop-status"), "Please drop a .md file.", true);
    return;
  }
  const fd = new FormData();
  fd.append("markdown", file);
  try {
    const data = await parseJsonResponse(
      await fetch("/parse", { method: "POST", body: fd })
    );
    const form = document.getElementById("article-form");
    fillFormFromFrontmatter(form, data.frontmatter, data.body);
    setStatus(
      document.getElementById("md-drop-status"),
      `Parsed ${data.filename}`
    );
    await runValidation();
  } catch (err) {
    setStatus(document.getElementById("md-drop-status"), err.message, true);
  }
}

function handleImageDrop(files) {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (!images.length) {
    setStatus(
      document.getElementById("image-drop-status"),
      "Please drop an image file.",
      true
    );
    return;
  }
  const img = images[0];
  if (img.size > MAX_FILE_BYTES) {
    setStatus(
      document.getElementById("image-drop-status"),
      `${img.name} exceeds 10MB limit.`,
      true
    );
    return;
  }

  articleState.sessionFiles.image = img;
  document.getElementById("image-file-label").textContent =
    `Uploaded this session: ${img.name}`;

  setStatus(
    document.getElementById("image-drop-status"),
    images.length > 1
      ? `Staged hero image: ${img.name}. Extra files ignored.`
      : `Staged hero image: ${img.name}. Max 10MB.`
  );
  void runValidation();
}

function applyChecklistStatuses(statuses) {
  const byField = Object.fromEntries(statuses.map((s) => [s.field, s]));
  for (const el of document.querySelectorAll("[data-field]")) {
    const field = el.getAttribute("data-field");
    const statusEl = el.querySelector(".status");
    if (!statusEl) continue;
    const st = byField[field];
    if (!st) {
      statusEl.textContent = "";
      statusEl.classList.remove("is-ok", "is-bad");
      continue;
    }
    statusEl.textContent = st.ok ? "✓" : "✗";
    statusEl.title = st.message || "";
    statusEl.classList.toggle("is-ok", st.ok);
    statusEl.classList.toggle("is-bad", !st.ok);
  }
}

async function runValidation() {
  const form = document.getElementById("article-form");
  if (!form) return;
  updateCounters(form);
  const frontmatter = collectFrontmatterFromForm(form);
  articleState.frontmatter = {
    ...articleState.frontmatter,
    ...frontmatter,
  };

  const statusEl = document.getElementById("action-status");
  const summaryEl = document.getElementById("missing-summary");
  const reasonEl = document.getElementById("generate-reason");
  const generateBtn = document.getElementById("generate");
  const collisionEl = document.getElementById("slug-collision");

  try {
    const data = await parseJsonResponse(
      await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frontmatter,
          sessionImages: {
            image: Boolean(articleState.sessionFiles.image),
            image2: false,
            image3: false,
          },
        }),
      })
    );

    summaryEl.textContent = data.summary;
    applyChecklistStatuses(data.statuses || []);
    updateMissingPanelHeader(data);
    updateChecklistPanelHeader(data.statuses || []);

    // Internal link warnings
    const warnEl = document.getElementById("internal-warnings");
    const warnings = [];
    for (const link of frontmatter.internalLinks || []) {
      if (!link.url) continue;
      const path = link.url.startsWith("http")
        ? new URL(link.url).pathname
        : link.url;
      const normalized = path.endsWith("/") || path.includes("#") ? path : `${path}/`;
      const known = articleState.knownRoutes.some(
        (r) => r === path || r === normalized || normalized.startsWith(r)
      );
      if (!known) {
        warnings.push(`Warning: internal URL "${link.url}" does not match a known route.`);
      }
    }
    warnEl.textContent = warnings.join("\n");

    // Slug collision
    const articles = await parseJsonResponse(await fetch("/articles"));
    const collision = articles.articles.find((a) => a.slug === frontmatter.slug);
    if (collision) {
      collisionEl.textContent = `Slug collision: "${frontmatter.slug}" already exists. Check overwrite or rename.`;
    } else {
      collisionEl.textContent = "";
    }

    const overwrite = document.getElementById("overwrite").checked;
    let canGenerate = data.valid;
    let reason = "";
    if (!data.valid) {
      reason = data.summary;
      canGenerate = false;
    } else if (collision && !overwrite) {
      reason = "Slug collision — enable overwrite or rename the slug.";
      canGenerate = false;
    } else if (!articleState.sessionFiles.image) {
      reason =
        "Hero image: path present in file but no image uploaded this session — drop a real file";
      canGenerate = false;
    }

    generateBtn.disabled = !canGenerate;
    reasonEl.textContent = canGenerate
      ? "Ready to generate."
      : `Generate disabled: ${reason}`;
  } catch (err) {
    setStatus(statusEl, err.message, true);
    generateBtn.disabled = true;
    reasonEl.textContent = `Generate disabled: ${err.message}`;
  }
}

async function generateArticle() {
  const form = document.getElementById("article-form");
  const statusEl = document.getElementById("action-status");
  const generateBtn = document.getElementById("generate");
  generateBtn.disabled = true;
  setStatus(statusEl, "Generating…");

  try {
    const frontmatter = collectFrontmatterFromForm(form);
    const body = form.body.value;
    const overwrite = document.getElementById("overwrite").checked;

    const fd = new FormData();
    fd.append(
      "payload",
      JSON.stringify({ frontmatter, body, overwrite })
    );
    if (articleState.sessionFiles.image) {
      fd.append("image", articleState.sessionFiles.image);
    }

    const data = await parseJsonResponse(
      await fetch("/api/generate", { method: "POST", body: fd })
    );
    setStatus(
      statusEl,
      `Generated article "${data.slug}" and rebuilt llms.txt.`
    );
    await loadArticleList();
    await runValidation();
  } catch (err) {
    setStatus(statusEl, err.message, true);
    await runValidation();
  }
}

async function initArticleListPage() {
  const list = document.getElementById("article-list");
  if (!list) return;
  await loadArticleList();
}

async function initArticlePage() {
  const form = document.getElementById("article-form");
  if (!form) return;

  const cfg = await parseJsonResponse(await fetch("/api/config"));
  articleState.siteUrl = cfg.siteUrl;
  const routes = await parseJsonResponse(await fetch("/api/routes"));
  articleState.knownRoutes = routes.routes;

  await loadTeamOptions(form.author);

  bindDropZone(document.getElementById("md-drop"), handleMarkdownDrop, {
    inputId: "md-file-input",
    accept: ".md,text/markdown",
  });
  bindDropZone(document.getElementById("image-drop"), handleImageDrop, {
    inputId: "image-file-input",
    accept: "image/*",
  });

  document.getElementById("add-internal").addEventListener("click", () => {
    addLinkRow(document.getElementById("internal-links"), "il");
  });
  document.getElementById("add-external").addEventListener("click", () => {
    addLinkRow(document.getElementById("external-links"), "el");
  });
  document.getElementById("add-faq").addEventListener("click", () => {
    addFaqRow(document.getElementById("faqs"));
  });

  form.addEventListener("input", () => {
    if (document.activeElement?.name === "title" && !form.h1.dataset.touched) {
      form.h1.value = form.title.value;
    }
    void runValidation();
  });
  form.h1.addEventListener("input", () => {
    form.h1.dataset.touched = "1";
  });

  document.getElementById("overwrite").addEventListener("change", () => {
    void runValidation();
  });
  document.getElementById("generate").addEventListener("click", generateArticle);

  // Prefill from ?slug=
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  if (slug) {
    const data = await parseJsonResponse(await fetch(`/api/articles/${slug}`));
    fillFormFromFrontmatter(form, data.frontmatter, data.body);
    articleState.editingSlug = slug;
    setStatus(document.getElementById("action-status"), `Loaded ${slug} for editing.`);
  }

  await runValidation();
}

/* ---------------- Team screen ---------------- */

async function initTeamPage() {
  const form = document.getElementById("team-form");
  if (!form) return;
  const statusEl = document.getElementById("team-status");
  const list = document.getElementById("team-list");

  async function refreshList() {
    const data = await parseJsonResponse(await fetch("/api/team"));
    list.innerHTML = "";
    for (const m of data.team) {
      const li = document.createElement("li");
      li.innerHTML = `
        <a href="#" data-slug="${escapeAttr(m.slug)}">${escapeHtml(m.name)}</a>
        <span class="item-meta">${escapeHtml(m.role)}</span>
        <span class="item-actions">
          <button type="button" class="btn-danger" data-action="delete" data-slug="${escapeAttr(m.slug)}">Delete</button>
        </span>
      `;
      list.appendChild(li);
    }
  }

  list.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const slug = t.getAttribute("data-slug");
    if (!slug) return;
    if (t.tagName === "A") {
      e.preventDefault();
      try {
        const data = await parseJsonResponse(await fetch(`/api/team/${slug}`));
        const fm = data.frontmatter;
        form.name.value = fm.name || "";
        form.slug.value = fm.slug || "";
        form.role.value = fm.role || "";
        form.bio.value = fm.bio || "";
        form.credentials.value = fm.credentials || "";
        form.sameAs.value = Array.isArray(fm.sameAs) ? fm.sameAs.join("\n") : "";
        document.getElementById("team-overwrite").checked = true;
        setStatus(statusEl, `Loaded ${slug}. Upload a new photo only if replacing.`);
      } catch (err) {
        setStatus(statusEl, err.message, true);
      }
      return;
    }
    if (t.getAttribute("data-action") === "delete") {
      if (!window.confirm(`Delete team member ${slug}?`)) return;
      try {
        await parseJsonResponse(
          await fetch(`/api/team/${slug}`, { method: "DELETE" })
        );
        await refreshList();
        setStatus(statusEl, `Deleted ${slug}`);
      } catch (err) {
        setStatus(statusEl, err.message, true);
      }
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(statusEl, "Saving…");
    try {
      const payload = {
        name: form.name.value.trim(),
        slug: form.slug.value.trim(),
        role: form.role.value.trim(),
        bio: form.bio.value.trim(),
        credentials: form.credentials.value.trim() || undefined,
        sameAs: form.sameAs.value
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        overwrite: document.getElementById("team-overwrite").checked,
        keepExistingPhoto: true,
        photo: "keep",
      };
      const fd = new FormData();
      fd.append("payload", JSON.stringify(payload));
      if (form.photo.files[0]) {
        if (form.photo.files[0].size > MAX_FILE_BYTES) {
          throw new Error("Photo exceeds 10MB limit.");
        }
        fd.append("photo", form.photo.files[0]);
      }
      const data = await parseJsonResponse(
        await fetch("/api/team", { method: "POST", body: fd })
      );
      setStatus(statusEl, `Saved team member "${data.slug}"`);
      await refreshList();
    } catch (err) {
      setStatus(statusEl, err.message, true);
    }
  });

  document.getElementById("team-reset").addEventListener("click", () => {
    form.reset();
    document.getElementById("team-overwrite").checked = false;
    setStatus(statusEl, "Form reset.");
  });

  await refreshList();
}

/* ---------------- Dashboard ---------------- */

async function initDashboard() {
  const body = document.getElementById("dashboard-body");
  if (!body) return;
  const statusEl = document.getElementById("dashboard-status");
  try {
    const data = await parseJsonResponse(await fetch("/articles"));
    body.innerHTML = "";
    for (const a of data.articles) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(a.title)}</td>
        <td>${escapeHtml(a.slug)}</td>
        <td>${a.draft ? "true" : "false"}</td>
        <td>${a.internalLinks}</td>
        <td>${a.externalLinks}</td>
        <td>${a.faqs}</td>
        <td>${escapeHtml(a.updatedDate || a.date || "")}</td>
      `;
      body.appendChild(tr);
    }
    setStatus(statusEl, `${data.articles.length} article(s)`);
  } catch (err) {
    setStatus(statusEl, err.message, true);
  }
}

/* ---------------- Articles Health ---------------- */

const healthSession = {
  updatedSlugs: new Set(),
  batchRunning: false,
  articles: [],
  speedScanning: new Set(),
};

function scoreTone(score) {
  if (typeof score !== "number") return "gray";
  if (score >= 90) return "green";
  if (score >= 50) return "orange";
  return "red";
}

function renderSpeedScores(speed) {
  if (!speed?.scanned || !speed.mobile || !speed.desktop) return "";
  const row = (label, scores) => `
    <div class="health-speed-strategy">
      <h4 class="health-meta">${escapeHtml(label)}</h4>
      <div class="health-speed-scores">
        ${[
          ["Perf", scores.performance],
          ["A11y", scores.accessibility],
          ["BP", scores.bestPractices],
          ["SEO", scores.seo],
        ]
          .map(
            ([name, value]) => `<span class="health-speed-score is-${scoreTone(value)}" title="${escapeAttr(name)}">
              <span class="health-speed-score-label">${escapeHtml(name)}</span>
              <span class="health-speed-score-value">${escapeHtml(String(value))}</span>
            </span>`
          )
          .join("")}
      </div>
    </div>`;
  return `<div class="health-speed-results">
    ${row("Mobile", speed.mobile)}
    ${row("Desktop", speed.desktop)}
    <p class="health-meta">Collapsed Speed indicator uses <strong>mobile Performance</strong> (${escapeHtml(String(speed.indicatorScore))}/100).</p>
  </div>`;
}

function renderSpeedSection(article, speed, indicatorStatus) {
  const configured = speed?.status !== "unconfigured";
  const canScan = Boolean(speed?.canScan);
  const publishedUrl = article.publishedUrl || speed?.publishedUrl || "";
  const scanning = healthSession.speedScanning.has(article.slug);

  let controls = "";
  if (!configured) {
    controls = `<p class="health-meta">Add GOOGLE_PAGESPEED_API_KEY to cms/.env.local to enable scans.</p>`;
  } else if (!canScan) {
    controls = `<div class="health-actions">
      <button type="button" class="btn-secondary" data-action="scan-speed" data-locked="unpublished" disabled title="Article is not Published — no live URL to test">Scan</button>
      <span class="health-meta">Scan unavailable — article is not Published, so there is no live URL to test.</span>
    </div>`;
  } else {
    controls = `<div class="health-actions">
      <button type="button" class="btn-secondary" data-action="scan-speed" ${scanning ? "disabled" : ""}>
        ${scanning ? "Scanning…" : speed?.scanned ? "Rescan" : "Scan"}
      </button>
      <a class="health-meta" href="${escapeAttr(publishedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(publishedUrl)}</a>
    </div>
    <p class="health-speed-status" data-role="speed-status" ${scanning ? "" : "hidden"}>
      ${scanning ? "Running Google PageSpeed Insights (mobile + desktop). This can take up to a minute…" : ""}
    </p>`;
  }

  return `
    <section class="health-section" data-section="speed">
      <h3><span class="health-indicator is-${escapeAttr(indicatorStatus)}">${HEALTH_ICONS.speed}</span> Speed</h3>
      ${renderFindings(speed?.findings)}
      ${controls}
      <div data-role="speed-results">${renderSpeedScores(speed)}</div>
      <p class="health-meta">On-demand only — PageSpeed calls are slow and count against your API quota.</p>
    </section>`;
}

const HEALTH_ICONS = {
  links: "🔗",
  meta: "🏷️",
  schema: "🧩",
  sitemap: "🗺️",
  speed: "⚡",
};

function updateHealthBanner() {
  const banner = document.getElementById("health-session-banner");
  if (!banner) return;
  const n = healthSession.updatedSlugs.size;
  if (!n) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = `${n} article${n === 1 ? "" : "s"} updated this session — remember to commit, push, and deploy.`;
}

/**
 * @param {string} message
 * @param {{ active?: boolean, current?: number, total?: number }} [options]
 */
function setHealthBatchProgress(message, options = {}) {
  const el = document.getElementById("health-batch-progress");
  if (!el) return;
  const textEl = el.querySelector(".health-batch-progress-text");
  const spinnerEl = el.querySelector(".health-batch-spinner");
  const trackEl = el.querySelector(".health-batch-progress-track");
  const barEl = el.querySelector(".health-batch-progress-bar");

  if (!message) {
    el.hidden = true;
    el.classList.remove("is-active");
    if (textEl) textEl.textContent = "";
    if (spinnerEl) spinnerEl.hidden = true;
    if (trackEl) trackEl.hidden = true;
    if (barEl) barEl.style.width = "0%";
    return;
  }

  const active = Boolean(options.active);
  const total = Number(options.total) || 0;
  const current = Number(options.current) || 0;

  el.hidden = false;
  el.classList.toggle("is-active", active);
  if (textEl) textEl.textContent = message;
  else el.textContent = message;

  if (spinnerEl) spinnerEl.hidden = !active;
  if (trackEl) {
    const showBar = active && total > 0;
    trackEl.hidden = !showBar;
    if (showBar && barEl) {
      const pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
      barEl.style.width = `${pct}%`;
    }
  }
}

function setHealthBatchControlsDisabled(disabled) {
  healthSession.batchRunning = disabled;
  const globalBtn = document.getElementById("health-connect-all");
  const proposeAllBtn = document.getElementById("health-propose-external-all");
  const speedAllBtn = document.getElementById("health-speed-check-all");
  const refreshBtn = document.getElementById("health-refresh");
  if (globalBtn) globalBtn.disabled = disabled;
  if (proposeAllBtn) proposeAllBtn.disabled = disabled;
  if (speedAllBtn) speedAllBtn.disabled = disabled;
  if (refreshBtn) refreshBtn.disabled = disabled;
  document
    .querySelectorAll(
      "[data-action='connect-all-internal'], [data-action='connect'], [data-action='propose'], [data-action='propose-all-external'], [data-action='add-external'], [data-action='scan-speed']"
    )
    .forEach((btn) => {
      if (btn.getAttribute("data-locked") === "unpublished") {
        btn.disabled = true;
        return;
      }
      btn.disabled = disabled;
    });
}

function isSpeedScanEligible(article) {
  return Boolean(article?.publishedUrl && article?.details?.speed?.canScan);
}

function updateSpeedCheckAllButton(pagespeedConfigured) {
  const speedAllBtn = document.getElementById("health-speed-check-all");
  if (!speedAllBtn || healthSession.batchRunning) return;
  const eligible = healthSession.articles.filter(isSpeedScanEligible).length;
  const configured =
    pagespeedConfigured !== undefined
      ? pagespeedConfigured
      : healthSession.articles.some((a) => a.details?.speed?.status !== "unconfigured");
  speedAllBtn.disabled = !configured || eligible === 0;
  speedAllBtn.textContent =
    eligible > 0
      ? `Speed Check All Articles (${eligible})`
      : "Speed Check All Articles";
}

/** Apply a completed PageSpeed result to the in-memory article + visible row immediately. */
function applySpeedScanToUi(slug, result) {
  const article = healthSession.articles.find((a) => a.slug === slug);
  if (article) {
    article.indicators = article.indicators || {};
    article.indicators.speed = result.status;
    article.details = article.details || {};
    article.details.speed = {
      ...(article.details.speed || {}),
      status: result.status,
      findings: [
        `Last scan ${String(result.fetchedAt || "").slice(0, 10)} · indicator = ${
          result.indicatorLabel || "mobile Performance"
        } (${result.indicatorScore}/100).`,
      ],
      publishedUrl: result.url || article.publishedUrl,
      canScan: true,
      scanned: true,
      mobile: result.mobile,
      desktop: result.desktop,
      indicatorScore: result.indicatorScore,
      indicatorLabel: result.indicatorLabel || "mobile Performance",
      fetchedAt: result.fetchedAt,
    };
  }

  const row = document.querySelector(
    `.health-row[data-slug="${CSS.escape(slug)}"]`
  );
  if (!row) return;

  const status = result.status || "gray";
  row
    .querySelectorAll(
      '.health-indicators .health-indicator[title^="Speed"], .health-section[data-section="speed"] .health-indicator'
    )
    .forEach((el) => {
      el.classList.remove(
        "is-green",
        "is-orange",
        "is-red",
        "is-gray",
        "is-unconfigured"
      );
      el.classList.add(`is-${status}`);
      el.setAttribute("title", "Speed (mobile Performance)");
    });

  const resultsEl = row.querySelector("[data-role='speed-results']");
  if (resultsEl && article?.details?.speed) {
    resultsEl.innerHTML = renderSpeedScores(article.details.speed);
  }
  const scanBtn = row.querySelector("[data-action='scan-speed']:not([data-locked])");
  if (scanBtn && !healthSession.batchRunning) {
    scanBtn.disabled = false;
    scanBtn.textContent = "Rescan";
  }
  const statusEl = row.querySelector("[data-role='speed-status']");
  if (statusEl) {
    statusEl.hidden = false;
    statusEl.classList.remove("is-error");
    statusEl.textContent = `Scan complete · mobile Performance ${result.indicatorScore}/100.`;
  }
}

async function scanSpeedForSlug(slug) {
  return parseJsonResponse(
    await fetch(`/api/articles/${encodeURIComponent(slug)}/pagespeed`, {
      method: "POST",
    })
  );
}

async function runGlobalSpeedCheckAll() {
  if (healthSession.batchRunning) return;
  const statusEl = document.getElementById("health-status");
  const data = await refreshArticlesHealth();
  const all = data.articles || [];
  const queue = all.filter(isSpeedScanEligible);
  // Same disabled-state rule as per-article Scan: no live published URL.
  const skippedNoUrl = all.filter((a) => !a.publishedUrl).length;
  const skippedUnconfigured = all.filter(
    (a) => a.publishedUrl && a.details?.speed?.status === "unconfigured"
  ).length;

  if (!queue.length) {
    const reason = skippedUnconfigured
      ? "PageSpeed is not configured (add GOOGLE_PAGESPEED_API_KEY)."
      : skippedNoUrl
        ? "No published articles with a live URL to scan."
        : "No eligible articles to scan.";
    setHealthBatchProgress(reason, { active: false });
    return;
  }

  setHealthBatchControlsDisabled(true);
  let scanned = 0;
  let failed = 0;
  const total = queue.length;

  setHealthBatchProgress(`Preparing speed check for ${total} articles…`, {
    active: true,
    current: 0,
    total,
  });

  try {
    for (let i = 0; i < queue.length; i++) {
      const article = queue[i];
      const n = i + 1;
      setHealthBatchProgress(`Scanning ${n} of ${total}: ${article.title}`, {
        active: true,
        current: i,
        total,
      });
      healthSession.speedScanning.add(article.slug);
      const row = document.querySelector(
        `.health-row[data-slug="${CSS.escape(article.slug)}"]`
      );
      const scanBtn = row?.querySelector(
        "[data-action='scan-speed']:not([data-locked])"
      );
      if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.textContent = "Scanning…";
      }
      try {
        const result = await scanSpeedForSlug(article.slug);
        healthSession.speedScanning.delete(article.slug);
        applySpeedScanToUi(article.slug, result);
        scanned += 1;
      } catch (err) {
        healthSession.speedScanning.delete(article.slug);
        failed += 1;
        if (scanBtn) {
          scanBtn.disabled = true; // still in batch
          scanBtn.textContent = article.details?.speed?.scanned ? "Rescan" : "Scan";
        }
        const rowStatus = row?.querySelector("[data-role='speed-status']");
        if (rowStatus) {
          rowStatus.hidden = false;
          rowStatus.classList.add("is-error");
          rowStatus.textContent = err.message || "PageSpeed scan failed.";
        }
        setStatus(
          statusEl,
          `Speed check error on ${article.slug}: ${err.message}`,
          true
        );
      }

      // Advance the bar as each article finishes (success or failure).
      setHealthBatchProgress(
        n < total
          ? `Scanning ${n} of ${total} complete · next: ${queue[n].title}`
          : `Scanning ${n} of ${total} complete`,
        {
          active: n < total,
          current: n,
          total,
        }
      );
    }

    setHealthBatchControlsDisabled(false);
    await refreshArticlesHealth();
    const skipPart =
      skippedNoUrl > 0
        ? `, ${skippedNoUrl} skipped — no published URL`
        : "";
    const failPart =
      failed > 0 ? `, ${failed} failed` : "";
    const summary = `Scanned ${scanned} article${scanned === 1 ? "" : "s"}${skipPart}${failPart}.`;
    setHealthBatchProgress(summary, { active: false, current: total, total });
    setStatus(statusEl, summary);
  } catch (err) {
    setStatus(statusEl, err.message, true);
    setHealthBatchProgress(`Speed check stopped: ${err.message}`, {
      active: false,
    });
    setHealthBatchControlsDisabled(false);
    await refreshArticlesHealth().catch(() => {});
  }
}

function hideExternalReview() {
  const panel = document.getElementById("health-external-review");
  const listPanel = document.getElementById("health-list-panel");
  if (panel) panel.hidden = true;
  if (listPanel) listPanel.hidden = false;
  const reviewList = document.getElementById("health-review-list");
  if (reviewList) reviewList.innerHTML = "";
  setStatus(document.getElementById("health-review-status"), "");
}

function showExternalReview(proposals, contextLabel) {
  const panel = document.getElementById("health-external-review");
  const listPanel = document.getElementById("health-list-panel");
  const reviewList = document.getElementById("health-review-list");
  const reviewStatus = document.getElementById("health-review-status");
  if (!panel || !reviewList) return;

  if (!proposals?.length) {
    hideExternalReview();
    setHealthBatchProgress(
      contextLabel
        ? `${contextLabel}: no on-topic external candidates found.`
        : "No on-topic external candidates found."
    );
    return;
  }

  reviewList.innerHTML = proposals
    .map((p) => {
      const checked = p.preChecked ? "checked" : "";
      const conf = p.confidence === "high" ? "high" : "borderline";
      return `<label class="health-review-item is-${conf}">
        <input type="checkbox" data-review-id="${escapeAttr(p.id)}" data-slug="${escapeAttr(p.articleSlug)}" data-label="${escapeAttr(p.title)}" data-url="${escapeAttr(p.url)}" ${checked} />
        <span class="health-review-item-body">
          <a href="${escapeAttr(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a>
          <span class="health-review-item-meta">
            <span>${escapeHtml(p.articleTitle || p.articleSlug)}</span>
            <span class="health-confidence is-${conf}">${conf}</span>
            <span>${escapeHtml(p.source || "")}</span>
            <span>${escapeHtml(p.url)}</span>
          </span>
        </span>
      </label>`;
    })
    .join("");

  panel.hidden = false;
  if (listPanel) listPanel.hidden = true;
  setStatus(
    reviewStatus,
    `${proposals.length} candidate${proposals.length === 1 ? "" : "s"} ready for review${
      contextLabel ? ` · ${contextLabel}` : ""
    }. Unchecked items will be discarded.`
  );
  setHealthBatchProgress(
    `Review ${proposals.length} proposed external link${proposals.length === 1 ? "" : "s"} before writing.`
  );
}

async function runProposeAllExternal(slug) {
  if (healthSession.batchRunning) return;
  const statusEl = document.getElementById("health-status");
  setHealthBatchControlsDisabled(true);
  setHealthBatchProgress(
    slug
      ? `Proposing external links for ${slug}...`
      : "Proposing external links across articles..."
  );
  try {
    const data = await parseJsonResponse(
      await fetch("/api/articles-health/propose-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slug ? { slug } : {}),
      })
    );
    setHealthBatchControlsDisabled(false);
    showExternalReview(
      data.proposals || [],
      slug
        ? slug
        : `${data.articlesNeeding || 0} article${
            (data.articlesNeeding || 0) === 1 ? "" : "s"
          } needing sources`
    );
  } catch (err) {
    setStatus(statusEl, err.message, true);
    setHealthBatchProgress(`Propose stopped: ${err.message}`);
    setHealthBatchControlsDisabled(false);
  }
}

async function runAddSelectedExternal() {
  const reviewList = document.getElementById("health-review-list");
  const reviewStatus = document.getElementById("health-review-status");
  if (!reviewList) return;

  const checked = [...reviewList.querySelectorAll("input[type='checkbox']:checked")];
  const items = checked.map((input) => ({
    slug: input.getAttribute("data-slug"),
    label: input.getAttribute("data-label"),
    url: input.getAttribute("data-url"),
  }));

  if (!items.length) {
    setStatus(reviewStatus, "Select at least one candidate, or Cancel.", true);
    return;
  }

  const addBtn = document.getElementById("health-review-add");
  const cancelBtn = document.getElementById("health-review-cancel");
  if (addBtn) addBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  setHealthBatchProgress(`Writing ${items.length} selected external link${items.length === 1 ? "" : "s"}...`);

  try {
    const data = await parseJsonResponse(
      await fetch("/api/articles-health/add-external-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      })
    );
    for (const w of data.written || []) {
      healthSession.updatedSlugs.add(w.slug);
    }
    updateHealthBanner();
    hideExternalReview();
    setHealthBatchControlsDisabled(false);
    await refreshArticlesHealth();
    const written = (data.written || []).length;
    const skipped = (data.skipped || []).length;
    setHealthBatchProgress(
      `Added ${written} external link${written === 1 ? "" : "s"}${
        skipped ? ` · skipped ${skipped}` : ""
      }. Unchecked candidates were discarded.`
    );
  } catch (err) {
    setStatus(reviewStatus, err.message, true);
    setHealthBatchProgress(`Add Selected failed: ${err.message}`);
    if (addBtn) addBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

async function connectInternalLink(articleSlug, targetSlug, label) {
  try {
    await parseJsonResponse(
      await fetch(`/api/articles/${encodeURIComponent(articleSlug)}/links/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSlug, label }),
      })
    );
    return { ok: true, skipped: false };
  } catch (err) {
    if (String(err.message || "").toLowerCase().includes("already present")) {
      return { ok: true, skipped: true };
    }
    throw err;
  }
}

/**
 * Sequentially Connect every missing required internal link for one article.
 * Uses the provided missing list (snapshot) — does not re-query mid-run.
 */
async function connectAllInternalForArticle(articleSlug, missingInternal, onProgress) {
  const missing = Array.isArray(missingInternal) ? missingInternal : [];
  let connected = 0;
  for (let i = 0; i < missing.length; i++) {
    const target = missing[i];
    if (onProgress) {
      onProgress({
        index: i + 1,
        total: missing.length,
        targetSlug: target.slug,
        label: target.title,
      });
    }
    const result = await connectInternalLink(
      articleSlug,
      target.slug,
      target.title
    );
    if (!result.skipped) connected += 1;
  }
  if (connected > 0 || missing.length > 0) {
    healthSession.updatedSlugs.add(articleSlug);
  }
  return { connected, attempted: missing.length };
}

function renderFindings(findings) {
  if (!findings?.length) return "<p class=\"health-meta\">No findings.</p>";
  return `<ul class="health-findings">${findings
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join("")}</ul>`;
}

function renderLinkList(links, emptyLabel) {
  if (!links?.length) {
    return `<p class="health-meta">${escapeHtml(emptyLabel)}</p>`;
  }
  return `<ul class="health-link-list">${links
    .map(
      (l) => `<li>
        <a href="${escapeAttr(l.href || l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a>
        <span class="health-meta">${escapeHtml(l.url)}</span>
      </li>`
    )
    .join("")}</ul>`;
}

function renderHealthRow(article) {
  const ind = article.indicators || {};
  const d = article.details || {};
  const links = d.links || {};
  const row = document.createElement("article");
  row.className = "health-row";
  row.dataset.slug = article.slug;

  const speedStatus = ind.speed || "gray";
  const draftBadge = article.draft
    ? `<span class="health-meta"> · draft</span>`
    : "";

  row.innerHTML = `
    <button type="button" class="health-row-summary" aria-expanded="false">
      <span class="health-row-title">${escapeHtml(article.title)}${draftBadge}</span>
      <span class="health-indicators" aria-label="Health indicators">
        <span class="health-indicator is-${escapeAttr(ind.links || "gray")}" title="Links">${HEALTH_ICONS.links}</span>
        <span class="health-indicator is-${escapeAttr(ind.meta || "gray")}" title="Meta">${HEALTH_ICONS.meta}</span>
        <span class="health-indicator is-${escapeAttr(ind.schema || "gray")}" title="Schema">${HEALTH_ICONS.schema}</span>
        <span class="health-indicator is-${escapeAttr(ind.sitemap || "gray")}" title="Sitemap">${HEALTH_ICONS.sitemap}</span>
        <span class="health-indicator is-${escapeAttr(speedStatus)}" title="Speed (mobile Performance)">${HEALTH_ICONS.speed}</span>
      </span>
    </button>
    <div class="health-row-body">
      <section class="health-section" data-section="links">
        <h3><span class="health-indicator is-${escapeAttr(ind.links || "gray")}">${HEALTH_ICONS.links}</span> Links</h3>
        ${renderFindings(links.findings)}
        <h4 class="health-meta">Internal links</h4>
        ${renderLinkList(links.internalLinks, "No internal links yet.")}
        <div class="missing-internal"></div>
        <h4 class="health-meta">External links (target: 3)</h4>
        ${renderLinkList(links.externalLinks, "No external links yet.")}
        <div class="health-actions"></div>
        <div class="health-proposals" hidden></div>
      </section>
      <section class="health-section">
        <h3><span class="health-indicator is-${escapeAttr(ind.meta || "gray")}">${HEALTH_ICONS.meta}</span> Meta</h3>
        ${renderFindings(d.meta?.findings)}
        <p class="health-meta">Diagnostic only in v1 — no fix action.</p>
      </section>
      <section class="health-section">
        <h3><span class="health-indicator is-${escapeAttr(ind.schema || "gray")}">${HEALTH_ICONS.schema}</span> Schema</h3>
        ${renderFindings(d.schema?.findings)}
        <p class="health-meta">Diagnostic only in v1 — no fix action.</p>
      </section>
      <section class="health-section">
        <h3><span class="health-indicator is-${escapeAttr(ind.sitemap || "gray")}">${HEALTH_ICONS.sitemap}</span> Sitemap</h3>
        ${renderFindings(d.sitemap?.findings)}
        <p class="health-meta">Diagnostic only in v1 — no fix action.</p>
      </section>
      ${renderSpeedSection(article, d.speed, speedStatus)}
    </div>
  `;

  const summary = row.querySelector(".health-row-summary");
  summary.addEventListener("click", () => {
    const open = row.classList.toggle("is-open");
    summary.setAttribute("aria-expanded", open ? "true" : "false");
  });

  const actions = row.querySelector(".health-actions");
  const missingBox = row.querySelector(".missing-internal");
  const proposalsBox = row.querySelector(".health-proposals");

  if (links.missingInternal?.length) {
    missingBox.innerHTML = `
      <div class="health-actions" style="margin-top:0.35rem;margin-bottom:0.35rem">
        <button type="button" class="btn-primary" data-action="connect-all-internal">
          Connect all internal links (${links.missingInternal.length})
        </button>
      </div>
      <p class="health-connect-progress" data-role="connect-progress" hidden></p>
      <h4 class="health-meta">Required connections</h4>
      <ul class="health-link-list">${links.missingInternal
        .map(
          (m) => `<li>
          <a href="${escapeAttr(m.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.title)}</a>
          <span class="health-meta">${escapeHtml(m.reason)}</span>
          <button type="button" class="btn-secondary" data-action="connect" data-target-slug="${escapeAttr(m.slug)}" data-label="${escapeAttr(m.title)}">Connect</button>
        </li>`
        )
        .join("")}</ul>`;
  }

  if (links.canPropose) {
    const proposeBtn = document.createElement("button");
    proposeBtn.type = "button";
    proposeBtn.className = "btn-secondary";
    proposeBtn.dataset.action = "propose";
    proposeBtn.textContent = "Add External Links";
    actions.appendChild(proposeBtn);

    const proposeAllBtn = document.createElement("button");
    proposeAllBtn.type = "button";
    proposeAllBtn.className = "btn-secondary";
    proposeAllBtn.dataset.action = "propose-all-external";
    proposeAllBtn.textContent = "Propose All External Links";
    actions.appendChild(proposeAllBtn);
  }

  row.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.getAttribute("data-action");
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (
      healthSession.batchRunning &&
      action !== "propose" &&
      action !== "propose-all-external"
    ) {
      return;
    }

    const progressEl = row.querySelector("[data-role='connect-progress']");

    try {
      if (action === "propose") {
        t.disabled = true;
        const data = await parseJsonResponse(
          await fetch(`/api/articles/${encodeURIComponent(article.slug)}/propose-external`)
        );
        proposalsBox.hidden = false;
        if (!data.proposals?.length) {
          const rejected = data.rejectedOffTopic
            ? ` Filtered out ${data.rejectedOffTopic} off-topic candidate${
                data.rejectedOffTopic === 1 ? "" : "s"
              }.`
            : "";
          proposalsBox.innerHTML = `<p class="health-meta">No on-topic proposals found in article-specific sources, body links, or cms/data/where-things-stand-sources.json.${rejected}</p>`;
        } else {
          proposalsBox.innerHTML = data.proposals
            .map(
              (p) => `<div class="health-proposal">
                <a href="${escapeAttr(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a>
                <span class="health-meta">${escapeHtml(p.source)}${
                  p.confidence ? ` · ${escapeHtml(p.confidence)}` : ""
                }</span>
                <button type="button" class="btn-primary" data-action="add-external" data-url="${escapeAttr(p.url)}" data-label="${escapeAttr(p.title)}">Add</button>
              </div>`
            )
            .join("");
        }
        t.disabled = false;
        return;
      }

      if (action === "propose-all-external") {
        await runProposeAllExternal(article.slug);
        return;
      }

      if (action === "scan-speed") {
        if (!isSpeedScanEligible(article)) {
          return;
        }
        const statusEl = row.querySelector("[data-role='speed-status']");
        const resultsEl = row.querySelector("[data-role='speed-results']");
        healthSession.speedScanning.add(article.slug);
        t.disabled = true;
        t.textContent = "Scanning…";
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent =
            "Running Google PageSpeed Insights (mobile + desktop). This can take up to a minute…";
          statusEl.classList.remove("is-error");
        }
        try {
          const data = await scanSpeedForSlug(article.slug);
          healthSession.speedScanning.delete(article.slug);
          applySpeedScanToUi(article.slug, data);
          await refreshArticlesHealth();
          // Keep the scanned row expanded after refresh.
          const refreshed = document.querySelector(
            `.health-row[data-slug="${CSS.escape(article.slug)}"]`
          );
          if (refreshed) {
            refreshed.classList.add("is-open");
            refreshed
              .querySelector(".health-row-summary")
              ?.setAttribute("aria-expanded", "true");
          }
        } catch (err) {
          healthSession.speedScanning.delete(article.slug);
          t.disabled = false;
          t.textContent = article.details?.speed?.scanned ? "Rescan" : "Scan";
          if (statusEl) {
            statusEl.hidden = false;
            statusEl.textContent = err.message || "PageSpeed scan failed.";
            statusEl.classList.add("is-error");
          }
          if (resultsEl && !article.details?.speed?.scanned) {
            resultsEl.innerHTML = "";
          }
        }
        return;
      }

      if (action === "add-external") {
        t.disabled = true;
        await parseJsonResponse(
          await fetch(`/api/articles/${encodeURIComponent(article.slug)}/links/external`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              label: t.getAttribute("data-label"),
              url: t.getAttribute("data-url"),
            }),
          })
        );
        healthSession.updatedSlugs.add(article.slug);
        updateHealthBanner();
        await refreshArticlesHealth();
        return;
      }

      if (action === "connect") {
        t.disabled = true;
        await connectInternalLink(
          article.slug,
          t.getAttribute("data-target-slug"),
          t.getAttribute("data-label")
        );
        healthSession.updatedSlugs.add(article.slug);
        updateHealthBanner();
        await refreshArticlesHealth();
        return;
      }

      if (action === "connect-all-internal") {
        const missing = article.details?.links?.missingInternal || [];
        if (!missing.length) return;
        setHealthBatchControlsDisabled(true);
        if (progressEl) {
          progressEl.hidden = false;
          progressEl.textContent = `Connecting 1 of ${missing.length}...`;
        }
        const result = await connectAllInternalForArticle(
          article.slug,
          missing,
          ({ index, total }) => {
            if (progressEl) {
              progressEl.textContent = `Connecting ${index} of ${total}...`;
            }
          }
        );
        updateHealthBanner();
        setHealthBatchProgress(
          `Connected ${result.connected} link${result.connected === 1 ? "" : "s"} on this article.`
        );
        setHealthBatchControlsDisabled(false);
        await refreshArticlesHealth();
      }
    } catch (err) {
      setStatus(document.getElementById("health-status"), err.message, true);
      setHealthBatchControlsDisabled(false);
      t.disabled = false;
      if (progressEl) progressEl.hidden = true;
    }
  });

  return row;
}

async function refreshArticlesHealth() {
  const list = document.getElementById("health-list");
  const statusEl = document.getElementById("health-status");
  if (!list) return;
  const openSlugs = new Set(
    [...list.querySelectorAll(".health-row.is-open")].map((el) => el.dataset.slug)
  );
  const data = await parseJsonResponse(await fetch("/api/articles-health"));
  healthSession.articles = data.articles || [];
  list.innerHTML = "";
  for (const article of healthSession.articles) {
    const row = renderHealthRow(article);
    if (openSlugs.has(article.slug)) {
      row.classList.add("is-open");
      row.querySelector(".health-row-summary")?.setAttribute("aria-expanded", "true");
    }
    list.appendChild(row);
  }
  const counts = { green: 0, orange: 0, red: 0, gray: 0, unconfigured: 0 };
  for (const a of healthSession.articles) {
    const s = a.indicators?.links || "gray";
    counts[s] = (counts[s] || 0) + 1;
  }
  const globalBtn = document.getElementById("health-connect-all");
  if (globalBtn && !healthSession.batchRunning) {
    const needing = healthSession.articles.filter(
      (a) => (a.details?.links?.missingInternal || []).length > 0
    ).length;
    globalBtn.disabled = needing === 0;
    globalBtn.textContent =
      needing > 0
        ? `Connect all internal links (${needing} articles)`
        : "Connect all internal links";
  }
  const proposeAllBtn = document.getElementById("health-propose-external-all");
  if (proposeAllBtn && !healthSession.batchRunning) {
    const needingExt = healthSession.articles.filter(
      (a) => (a.details?.links?.externalCount || 0) < 3
    ).length;
    proposeAllBtn.disabled = needingExt === 0;
    proposeAllBtn.textContent =
      needingExt > 0
        ? `Propose All External Links (${needingExt})`
        : "Propose All External Links";
  }
  updateSpeedCheckAllButton(data.pagespeedConfigured);
  setStatus(
    statusEl,
    `${healthSession.articles.length} articles · Links: ${counts.green || 0} healthy, ${counts.orange || 0} needs attention, ${counts.red || 0} critical, ${counts.gray || 0} unclassified · Speed unscanned shown gray until Scan`
  );
  updateHealthBanner();
  return data;
}

async function runGlobalConnectAllInternal() {
  if (healthSession.batchRunning) return;
  const statusEl = document.getElementById("health-status");
  // Fresh scan so we don't double-process stale missing lists
  const data = await refreshArticlesHealth();
  const queue = (data.articles || []).filter(
    (a) => (a.details?.links?.missingInternal || []).length > 0
  );
  if (!queue.length) {
    setHealthBatchProgress("No missing required internal links.");
    return;
  }

  setHealthBatchControlsDisabled(true);
  let totalConnected = 0;
  let articlesTouched = 0;

  try {
    for (let aIndex = 0; aIndex < queue.length; aIndex++) {
      const article = queue[aIndex];
      const missing = article.details.links.missingInternal;
      const result = await connectAllInternalForArticle(
        article.slug,
        missing,
        ({ index, total }) => {
          setHealthBatchProgress(
            `Article ${aIndex + 1} of ${queue.length}: ${article.slug} — connecting ${index} of ${total} links...`
          );
        }
      );
      if (result.connected > 0) articlesTouched += 1;
      totalConnected += result.connected;
    }

    updateHealthBanner();
    setHealthBatchControlsDisabled(false);
    await refreshArticlesHealth();
    setHealthBatchProgress(
      `Connected ${totalConnected} link${totalConnected === 1 ? "" : "s"} across ${articlesTouched} article${articlesTouched === 1 ? "" : "s"}.`
    );
    setStatus(
      statusEl,
      `Batch complete — connected ${totalConnected} internal link${totalConnected === 1 ? "" : "s"} across ${articlesTouched} article${articlesTouched === 1 ? "" : "s"}.`
    );
  } catch (err) {
    setStatus(statusEl, err.message, true);
    setHealthBatchProgress(`Batch stopped: ${err.message}`);
    setHealthBatchControlsDisabled(false);
    await refreshArticlesHealth().catch(() => {});
  }
}

async function initArticlesHealth() {
  const list = document.getElementById("health-list");
  if (!list) return;
  document.getElementById("health-refresh")?.addEventListener("click", () => {
    void refreshArticlesHealth().catch((err) => {
      setStatus(document.getElementById("health-status"), err.message, true);
    });
  });
  document.getElementById("health-connect-all")?.addEventListener("click", () => {
    void runGlobalConnectAllInternal();
  });
  document
    .getElementById("health-propose-external-all")
    ?.addEventListener("click", () => {
      void runProposeAllExternal();
    });
  document.getElementById("health-speed-check-all")?.addEventListener("click", () => {
    void runGlobalSpeedCheckAll();
  });
  document.getElementById("health-review-cancel")?.addEventListener("click", () => {
    hideExternalReview();
    setHealthBatchProgress("External-link review cancelled — nothing written.");
  });
  document.getElementById("health-review-add")?.addEventListener("click", () => {
    void runAddSelectedExternal();
  });
  await refreshArticlesHealth();
}

/* ---------------- Articles Update ---------------- */

const articlesUpdateSession = {
  updatedSlugs: new Set(),
  matched: [],
  unmatched: [],
  confirmed: new Set(),
  batchRunning: false,
};

function updateArticlesUpdateBanner() {
  const banner = document.getElementById("update-session-banner");
  if (!banner) return;
  const n = articlesUpdateSession.updatedSlugs.size;
  if (!n) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = `${n} article${n === 1 ? "" : "s"} updated this session — remember to commit, push, and deploy.`;
}

function renderArticlesUpdateUnmatched() {
  const panel = document.getElementById("update-unmatched-panel");
  const list = document.getElementById("update-unmatched-list");
  if (!panel || !list) return;
  const rows = articlesUpdateSession.unmatched || [];
  if (!rows.length) {
    panel.hidden = true;
    list.innerHTML = "";
    return;
  }
  panel.hidden = false;
  list.innerHTML = rows
    .map(
      (row) => `<li class="update-unmatched-item">
        <strong>${escapeHtml(row.slug)}</strong>
        <span>${escapeHtml(row.reason || "No matching local article")}</span>
      </li>`
    )
    .join("");
}

function renderArticlesUpdateReview() {
  const panel = document.getElementById("update-review-panel");
  const list = document.getElementById("update-review-list");
  const confirmAll = document.getElementById("update-confirm-all");
  if (!panel || !list) return;

  const rows = articlesUpdateSession.matched || [];
  if (!rows.length) {
    panel.hidden = true;
    list.innerHTML = "";
    if (confirmAll) confirmAll.disabled = true;
    return;
  }

  panel.hidden = false;
  const pending = rows.filter((r) => !articlesUpdateSession.confirmed.has(r.slug));
  if (confirmAll) {
    confirmAll.disabled = articlesUpdateSession.batchRunning || pending.length === 0;
  }

  list.innerHTML = rows
    .map((row) => {
      const confirmed = articlesUpdateSession.confirmed.has(row.slug);
      const sources = Array.isArray(row.newSources) ? row.newSources : [];
      const sourcesHtml = sources.length
        ? `<div class="update-sources">
            <h4>New sources (opt-in)</h4>
            <ul class="update-sources-list">
              ${sources
                .map(
                  (src, idx) => `<li>
                    <label class="update-source-label">
                      <input
                        type="checkbox"
                        data-role="update-source"
                        data-slug="${escapeAttr(row.slug)}"
                        data-index="${idx}"
                        ${confirmed ? "disabled" : ""}
                      />
                      <span>
                        <span class="update-source-title">${escapeHtml(src.title)}</span>
                        <a href="${escapeAttr(src.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.url)}</a>
                      </span>
                    </label>
                  </li>`
                )
                .join("")}
            </ul>
          </div>`
        : `<p class="health-meta">No new sources in this update.</p>`;

      const markerWarning = row.markersPresent
        ? ""
        : `<p class="update-flag is-error">WHERE-THINGS-STAND markers missing in local file — Confirm Update will fail until markers are present.</p>`;

      return `<article class="update-review-card${confirmed ? " is-confirmed" : ""}" data-slug="${escapeAttr(row.slug)}">
        <div class="update-review-header">
          <div>
            <h3>${escapeHtml(row.title || row.slug)}</h3>
            <p class="health-meta">
              slug: <code>${escapeHtml(row.slug)}</code>
              · current updatedDate: <code>${escapeHtml(row.currentUpdatedDate || "—")}</code>
              · proposed: <code>${escapeHtml(row.newUpdatedDate)}</code>
            </p>
          </div>
          <button
            type="button"
            class="btn-primary"
            data-action="confirm-update"
            data-slug="${escapeAttr(row.slug)}"
            ${confirmed || articlesUpdateSession.batchRunning ? "disabled" : ""}
          >
            ${confirmed ? "Updated" : "Confirm Update"}
          </button>
        </div>
        ${markerWarning}
        <div class="update-compare">
          <div class="update-compare-col">
            <h4>Current</h4>
            <pre class="update-paragraph">${escapeHtml(row.currentParagraph || "(empty or markers missing)")}</pre>
          </div>
          <div class="update-compare-col">
            <h4>Proposed</h4>
            <pre class="update-paragraph">${escapeHtml(row.newParagraph)}</pre>
          </div>
        </div>
        ${sourcesHtml}
        <p class="update-card-status health-meta" data-role="card-status" hidden></p>
      </article>`;
    })
    .join("");
}

function getSelectedSourcesForSlug(slug) {
  const row = articlesUpdateSession.matched.find((r) => r.slug === slug);
  if (!row) return [];
  const sources = Array.isArray(row.newSources) ? row.newSources : [];
  const card = document.querySelector(`.update-review-card[data-slug="${CSS.escape(slug)}"]`);
  if (!card) return [];
  const checked = [...card.querySelectorAll('input[data-role="update-source"]:checked')];
  return checked
    .map((input) => sources[Number(input.dataset.index)])
    .filter((s) => s && s.title && s.url)
    .map((s) => ({ title: s.title, url: s.url }));
}

async function confirmArticleUpdate(slug, selectedSourcesOverride) {
  const row = articlesUpdateSession.matched.find((r) => r.slug === slug);
  if (!row) throw new Error(`No matched update for ${slug}`);
  if (articlesUpdateSession.confirmed.has(slug)) return { already: true };

  const selectedSources =
    selectedSourcesOverride !== undefined
      ? selectedSourcesOverride
      : getSelectedSourcesForSlug(slug);
  const data = await parseJsonResponse(
    await fetch("/api/articles-update/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: row.slug,
        newParagraph: row.newParagraph,
        newUpdatedDate: row.newUpdatedDate,
        selectedSources,
      }),
    })
  );

  articlesUpdateSession.confirmed.add(slug);
  articlesUpdateSession.updatedSlugs.add(slug);
  updateArticlesUpdateBanner();
  return data;
}

async function runConfirmAllArticleUpdates() {
  if (articlesUpdateSession.batchRunning) return;
  const pending = articlesUpdateSession.matched.filter(
    (r) => !articlesUpdateSession.confirmed.has(r.slug)
  );
  if (!pending.length) return;

  // Snapshot opt-in sources before any re-render clears checkboxes.
  const plans = pending.map((row) => ({
    row,
    selectedSources: getSelectedSourcesForSlug(row.slug),
  }));

  articlesUpdateSession.batchRunning = true;
  renderArticlesUpdateReview();
  const statusEl = document.getElementById("update-status");

  try {
    for (let i = 0; i < plans.length; i += 1) {
      const { row, selectedSources } = plans[i];
      setStatus(
        statusEl,
        `Confirming ${i + 1} of ${plans.length}: ${row.title || row.slug}`
      );
      const cardStatus = document.querySelector(
        `.update-review-card[data-slug="${CSS.escape(row.slug)}"] [data-role="card-status"]`
      );
      try {
        const data = await confirmArticleUpdate(row.slug, selectedSources);
        if (cardStatus) {
          cardStatus.hidden = false;
          const written = data.sourcesWritten?.length || 0;
          cardStatus.textContent = written
            ? `Updated. Added ${written} source(s).`
            : "Updated.";
        }
      } catch (err) {
        if (cardStatus) {
          cardStatus.hidden = false;
          cardStatus.textContent = err.message;
          cardStatus.dataset.error = "true";
        }
        setStatus(statusEl, err.message, true);
        throw err;
      }
      renderArticlesUpdateReview();
    }
    setStatus(
      statusEl,
      `Confirmed ${plans.length} article${plans.length === 1 ? "" : "s"}.`
    );
  } finally {
    articlesUpdateSession.batchRunning = false;
    renderArticlesUpdateReview();
  }
}

async function handleArticlesUpdateDrop(files) {
  const file = files.find(
    (f) =>
      f.name.toLowerCase().endsWith(".json") ||
      f.name.toLowerCase().endsWith(".md") ||
      f.type === "application/json" ||
      f.type === "text/markdown" ||
      f.type === "text/plain"
  );
  const statusEl = document.getElementById("update-drop-status");
  if (!file) {
    setStatus(statusEl, "Please drop a .json or .md update file.", true);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus(statusEl, "File exceeds 10MB limit.", true);
    return;
  }

  const fd = new FormData();
  fd.append("file", file);
  try {
    setStatus(statusEl, `Parsing ${file.name}…`);
    const data = await parseJsonResponse(
      await fetch("/api/articles-update/preview", { method: "POST", body: fd })
    );
    articlesUpdateSession.matched = data.matched || [];
    articlesUpdateSession.unmatched = data.unmatched || [];
    articlesUpdateSession.confirmed = new Set();
    renderArticlesUpdateUnmatched();
    renderArticlesUpdateReview();
    const matchedN = articlesUpdateSession.matched.length;
    const unmatchedN = articlesUpdateSession.unmatched.length;
    setStatus(
      statusEl,
      `${file.name}: ${matchedN} matched, ${unmatchedN} unmatched (of ${data.total}).`
    );
    setStatus(document.getElementById("update-status"), "");
  } catch (err) {
    setStatus(statusEl, err.message, true);
  }
}

function initArticlesUpdate() {
  const drop = document.getElementById("update-drop");
  if (!drop) return;

  bindDropZone(drop, (files) => {
    void handleArticlesUpdateDrop(files);
  }, {
    inputId: "update-file-input",
    accept: ".json,.md,application/json,text/markdown,text/plain",
  });

  document.getElementById("update-confirm-all")?.addEventListener("click", () => {
    void runConfirmAllArticleUpdates().catch((err) => {
      setStatus(document.getElementById("update-status"), err.message, true);
    });
  });

  document.getElementById("update-review-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="confirm-update"]');
    if (!btn) return;
    const slug = btn.getAttribute("data-slug");
    if (!slug || articlesUpdateSession.batchRunning) return;
    void (async () => {
      const statusEl = document.getElementById("update-status");
      const cardStatus = document.querySelector(
        `.update-review-card[data-slug="${CSS.escape(slug)}"] [data-role="card-status"]`
      );
      try {
        btn.disabled = true;
        setStatus(statusEl, `Confirming ${slug}…`);
        const data = await confirmArticleUpdate(slug);
        const written = data.sourcesWritten?.length || 0;
        if (cardStatus) {
          cardStatus.hidden = false;
          cardStatus.textContent = written
            ? `Updated. Added ${written} source(s).`
            : "Updated.";
        }
        setStatus(statusEl, `Updated ${slug}.`);
        renderArticlesUpdateReview();
      } catch (err) {
        btn.disabled = false;
        if (cardStatus) {
          cardStatus.hidden = false;
          cardStatus.textContent = err.message;
        }
        setStatus(statusEl, err.message, true);
      }
    })();
  });
}

/* ---------------- Boot ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  const kind = pageKind();
  if (kind === "article-list") void initArticleListPage().catch((err) => {
    setStatus(document.getElementById("action-status"), err.message, true);
  });
  if (kind === "article-form") void initArticlePage().catch((err) => {
    setStatus(document.getElementById("action-status"), err.message, true);
  });
  if (kind === "team") void initTeamPage().catch((err) => {
    setStatus(document.getElementById("team-status"), err.message, true);
  });
  if (kind === "dashboard") void initDashboard();
  if (kind === "articles-health") void initArticlesHealth().catch((err) => {
    setStatus(document.getElementById("health-status"), err.message, true);
  });
  if (kind === "articles-update") initArticlesUpdate();
});
