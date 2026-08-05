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
  return "article";
}

/* ---------------- Article screen ---------------- */

const articleState = {
  frontmatter: {},
  body: "",
  sessionFiles: { image: null, image2: null, image3: null },
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
    image2: articleState.frontmatter.image2 || undefined,
    image2Alt: String(fd.get("image2Alt") || "") || undefined,
    image3: articleState.frontmatter.image3 || undefined,
    image3Alt: String(fd.get("image3Alt") || "") || undefined,
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
    if (pageKind() === "article") void runValidation();
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
    if (pageKind() === "article") void runValidation();
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
  articleState.frontmatter = { ...fm };
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
  form.image2Alt.value = fm.image2Alt || "";
  form.image3Alt.value = fm.image3Alt || "";
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
  articleState.sessionFiles = { image: null, image2: null, image3: null };
  document.getElementById("image-file-label").textContent = fm.image
    ? `Path in file (not accepted): ${fm.image}`
    : "No file this session";
  document.getElementById("image2-file-label").textContent = fm.image2
    ? `Path in file (not accepted): ${fm.image2}`
    : "No file this session";
  document.getElementById("image3-file-label").textContent = fm.image3
    ? `Path in file (not accepted): ${fm.image3}`
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
  const data = await parseJsonResponse(await fetch("/articles"));
  list.innerHTML = "";
  for (const a of data.articles) {
    const li = document.createElement("li");
    li.innerHTML = `
      <a href="#" data-slug="${escapeAttr(a.slug)}">${escapeHtml(a.title)}</a>
      ${a.draft ? '<span class="badge">draft</span>' : ""}
      <span class="item-actions">
        <button type="button" class="list-action" data-action="toggle-draft" data-slug="${escapeAttr(a.slug)}" data-draft="${a.draft ? "false" : "true"}">
          ${a.draft ? "Publish" : "Unpublish"}
        </button>
        <button type="button" class="btn-danger" data-action="delete" data-slug="${escapeAttr(a.slug)}">Delete</button>
      </span>
    `;
    list.appendChild(li);
  }
  list.addEventListener("click", onArticleListClick);
}

async function onArticleListClick(e) {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const slug = t.getAttribute("data-slug");
  if (!slug) return;

  if (t.tagName === "A") {
    e.preventDefault();
    const data = await parseJsonResponse(await fetch(`/api/articles/${slug}`));
    const form = document.getElementById("article-form");
    fillFormFromFrontmatter(form, data.frontmatter, data.body);
    articleState.editingSlug = slug;
    setStatus(document.getElementById("action-status"), `Loaded ${slug} for editing.`);
    await runValidation();
    return;
  }

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

function bindDropZone(el, onFiles) {
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    onFiles(files);
  });
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
      "Please drop image files.",
      true
    );
    return;
  }
  for (const img of images) {
    if (img.size > MAX_FILE_BYTES) {
      setStatus(
        document.getElementById("image-drop-status"),
        `${img.name} exceeds 10MB limit.`,
        true
      );
      return;
    }
  }

  const slots = ["image", "image2", "image3"];
  let i = 0;
  for (const slot of slots) {
    if (!articleState.sessionFiles[slot] && images[i]) {
      articleState.sessionFiles[slot] = images[i];
      document.getElementById(`${slot}-file-label`).textContent =
        `Uploaded this session: ${images[i].name}`;
      i++;
    }
  }
  // If hero empty, always prefer filling from start
  if (!articleState.sessionFiles.image && images[0]) {
    articleState.sessionFiles.image = images[0];
    document.getElementById("image-file-label").textContent =
      `Uploaded this session: ${images[0].name}`;
  }

  setStatus(
    document.getElementById("image-drop-status"),
    `Staged ${Math.min(images.length, 3)} image(s). Max 10MB each.`
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
            image2: Boolean(articleState.sessionFiles.image2),
            image3: Boolean(articleState.sessionFiles.image3),
          },
        }),
      })
    );

    summaryEl.textContent = data.summary;
    applyChecklistStatuses(data.statuses || []);

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
    if (articleState.sessionFiles.image2) {
      fd.append("image2", articleState.sessionFiles.image2);
    }
    if (articleState.sessionFiles.image3) {
      fd.append("image3", articleState.sessionFiles.image3);
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

async function previewJsonLd() {
  const form = document.getElementById("article-form");
  const preview = document.getElementById("jsonld-preview");
  try {
    const frontmatter = collectFrontmatterFromForm(form);
    const data = await parseJsonResponse(
      await fetch("/api/preview-jsonld", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontmatter }),
      })
    );
    preview.textContent = JSON.stringify(data.schemas, null, 2);
  } catch (err) {
    preview.textContent = err.message;
  }
}

async function initArticlePage() {
  const form = document.getElementById("article-form");
  if (!form) return;

  const cfg = await parseJsonResponse(await fetch("/api/config"));
  articleState.siteUrl = cfg.siteUrl;
  const routes = await parseJsonResponse(await fetch("/api/routes"));
  articleState.knownRoutes = routes.routes;

  await loadTeamOptions(form.author);
  await loadArticleList();

  bindDropZone(document.getElementById("md-drop"), handleMarkdownDrop);
  bindDropZone(document.getElementById("image-drop"), handleImageDrop);

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
  document
    .getElementById("preview-jsonld")
    .addEventListener("click", previewJsonLd);

  // Prefill from ?slug=
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  if (slug) {
    const data = await parseJsonResponse(await fetch(`/api/articles/${slug}`));
    fillFormFromFrontmatter(form, data.frontmatter, data.body);
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

/* ---------------- Boot ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  const kind = pageKind();
  if (kind === "article") void initArticlePage().catch((err) => {
    setStatus(document.getElementById("action-status"), err.message, true);
  });
  if (kind === "team") void initTeamPage().catch((err) => {
    setStatus(document.getElementById("team-status"), err.message, true);
  });
  if (kind === "dashboard") void initDashboard();
});
