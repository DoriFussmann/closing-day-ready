import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { TeamFrontmatter } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TEAM_DIR = path.join(ROOT, "site/src/content/team");
const ASSETS_DIR = path.join(ROOT, "site/src/assets/team");

export function listTeam(): Array<{
  slug: string;
  name: string;
  role: string;
  file: string;
}> {
  if (!fs.existsSync(TEAM_DIR)) return [];
  return fs
    .readdirSync(TEAM_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(TEAM_DIR, file), "utf8");
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const fm = match ? YAML.parse(match[1]) : {};
      return {
        slug: String(fm.slug || file.replace(/\.md$/, "")),
        name: String(fm.name || file),
        role: String(fm.role || ""),
        file,
      };
    });
}

export function readTeamMember(slug: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} | null {
  const file = path.join(TEAM_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  return {
    frontmatter: YAML.parse(match[1]) || {},
    body: (match[2] || "").trim(),
  };
}

export function writeTeamMember(options: {
  data: TeamFrontmatter;
  photoAbsPath?: string;
  photoOriginalName?: string;
  overwrite?: boolean;
  keepExistingPhoto?: boolean;
}): { path: string; slug: string } {
  const { data, photoAbsPath, photoOriginalName, overwrite = false, keepExistingPhoto } = options;
  const slug = data.slug;

  fs.mkdirSync(TEAM_DIR, { recursive: true });
  const outMd = path.join(TEAM_DIR, `${slug}.md`);
  if (fs.existsSync(outMd) && !overwrite) {
    throw new Error(`Team slug collision: ${slug}.md already exists.`);
  }

  const assetDir = path.join(ASSETS_DIR, slug);
  fs.mkdirSync(assetDir, { recursive: true });

  let photoRel = typeof data.photo === "string" ? data.photo : "";

  if (photoAbsPath && photoOriginalName) {
    const ext = path.extname(photoOriginalName).toLowerCase() || ".jpg";
    const basename = `photo${ext}`;
    fs.copyFileSync(photoAbsPath, path.join(assetDir, basename));
    photoRel = `../../assets/team/${slug}/${basename}`;
  } else if (keepExistingPhoto) {
    const existing = readTeamMember(slug);
    if (existing?.frontmatter.photo) {
      photoRel = String(existing.frontmatter.photo);
    }
  }

  if (!photoRel) {
    throw new Error("Team member photo is required.");
  }

  const fm: Record<string, unknown> = {
    name: data.name,
    slug: data.slug,
    role: data.role,
    bio: data.bio,
    photo: photoRel,
    sameAs: data.sameAs || [],
  };
  if (data.credentials) fm.credentials = data.credentials;

  const yaml = YAML.stringify(fm, { lineWidth: 0 }).trimEnd();
  const content = `---\n${yaml}\n---\n`;
  fs.writeFileSync(outMd, content, "utf8");
  return { path: outMd, slug };
}

export function deleteTeamMember(slug: string): void {
  const file = path.join(TEAM_DIR, `${slug}.md`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const assetDir = path.join(ASSETS_DIR, slug);
  if (fs.existsSync(assetDir)) {
    fs.rmSync(assetDir, { recursive: true, force: true });
  }
}

export function knownAuthorSlugs(): string[] {
  return listTeam().map((t) => t.slug);
}

export { TEAM_DIR, ASSETS_DIR as TEAM_ASSETS_DIR };
