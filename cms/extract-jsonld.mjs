import fs from "node:fs";

const url =
  "http://localhost:4321/articles/technical-seo-answer-engine-visibility/";
const res = await fetch(url);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const html = await res.text();
const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
  (m) => JSON.parse(m[1])
);
fs.writeFileSync("cms/jsonld-extract.json", JSON.stringify(blocks, null, 2));
console.log(`Extracted ${blocks.length} JSON-LD blocks`);
for (const b of blocks) {
  console.log("-", b["@type"], b["@context"] ? "(with context)" : "");
}
