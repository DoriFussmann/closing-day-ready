import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CMS_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(CMS_ROOT, "..");

/**
 * Minimal .env loader (no dependency). Does not override existing process.env.
 */
export function loadEnvFiles(extraPaths: string[] = []): void {
  const candidates = [
    path.join(CMS_ROOT, ".env.local"),
    path.join(CMS_ROOT, ".env"),
    path.join(REPO_ROOT, ".env.local"),
    path.join(REPO_ROOT, ".env"),
    ...extraPaths,
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
