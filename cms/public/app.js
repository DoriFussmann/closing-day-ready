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
};

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

function setHealthBatchProgress(message) {
  const el = document.getElementById("health-batch-progress");
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function setHealthBatchControlsDisabled(disabled) {
  healthSession.batchRunning = disabled;
  const globalBtn = document.getElementById("health-connect-all");
  const refreshBtn = document.getElementById("health-refresh");
  if (globalBtn) globalBtn.disabled = disabled;
  if (refreshBtn) refreshBtn.disabled = disabled;
  document
    .querySelectorAll("[data-action='connect-all-internal'], [data-action='connect'], [data-action='propose'], [data-action='add-external']")
    .forEach((btn) => {
      btn.disabled = disabled;
    });
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

  row.innerHTML = `
    <button type="button" class="health-row-summary" aria-expanded="false">
      <span class="health-row-title">${escapeHtml(article.title)}</span>
      <span class="health-indicators" aria-label="Health indicators">
        <span class="health-indicator is-${escapeAttr(ind.links || "gray")}" title="Links">${HEALTH_ICONS.links}</span>
        <span class="health-indicator is-${escapeAttr(ind.meta || "gray")}" title="Meta">${HEALTH_ICONS.meta}</span>
        <span class="health-indicator is-${escapeAttr(ind.schema || "gray")}" title="Schema">${HEALTH_ICONS.schema}</span>
        <span class="health-indicator is-${escapeAttr(ind.sitemap || "gray")}" title="Sitemap">${HEALTH_ICONS.sitemap}</span>
        <span class="health-indicator is-${escapeAttr(ind.speed || "gray")}" title="Speed">${HEALTH_ICONS.speed}</span>
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
      <section class="health-section">
        <h3><span class="health-indicator is-${escapeAttr(ind.speed || "gray")}">${HEALTH_ICONS.speed}</span> Speed</h3>
        ${renderFindings(d.speed?.findings)}
        <p class="health-meta">Diagnostic only — requires GOOGLE_PAGESPEED_API_KEY.</p>
      </section>
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
    proposeBtn.textContent = "Propose external sources";
    actions.appendChild(proposeBtn);
  }

  row.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.getAttribute("data-action");
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (healthSession.batchRunning && action !== "propose") return;

    const progressEl = row.querySelector("[data-role='connect-progress']");

    try {
      if (action === "propose") {
        t.disabled = true;
        const data = await parseJsonResponse(
          await fetch(`/api/articles/${encodeURIComponent(article.slug)}/propose-external`)
        );
        proposalsBox.hidden = false;
        if (!data.proposals?.length) {
          proposalsBox.innerHTML =
            "<p class=\"health-meta\">No proposals found in body links or cms/data/where-things-stand-sources.json.</p>";
        } else {
          proposalsBox.innerHTML = data.proposals
            .map(
              (p) => `<div class="health-proposal">
                <a href="${escapeAttr(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a>
                <span class="health-meta">${escapeHtml(p.source)}</span>
                <button type="button" class="btn-primary" data-action="add-external" data-url="${escapeAttr(p.url)}" data-label="${escapeAttr(p.title)}">Add</button>
              </div>`
            )
            .join("");
        }
        t.disabled = false;
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
  setStatus(
    statusEl,
    `${healthSession.articles.length} published · Links: ${counts.green || 0} healthy, ${counts.orange || 0} needs attention, ${counts.red || 0} critical, ${counts.gray || 0} unclassified`
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
  await refreshArticlesHealth();
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
});
