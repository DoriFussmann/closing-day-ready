import fs from "node:fs";
import { validate, validateMarkup, validateJsonLd } from "schemacraft-validator";

const pageUrl =
  "http://localhost:4321/articles/technical-seo-answer-engine-visibility/";

console.log("=== validate live URL via fetch+markup ===");
const res = await fetch(pageUrl);
const html = await res.text();
fs.writeFileSync("cms/article-page.html", html);

const markupResult = validateMarkup(html);
console.log(JSON.stringify(markupResult, null, 2));

console.log("\n=== validate extracted JSON-LD array ===");
const blocks = JSON.parse(fs.readFileSync("cms/jsonld-extract.json", "utf8"));
const jsonResult = validateJsonLd(blocks);
console.log(JSON.stringify(jsonResult, null, 2));
