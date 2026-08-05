import fs from "node:fs";

const blocks = JSON.parse(fs.readFileSync("cms/jsonld-extract.json", "utf8"));
const scripts = blocks
  .map(
    (b) =>
      `<script type="application/ld+json">${JSON.stringify(b, null, 2)}</script>`
  )
  .join("\n");
const html = `<!doctype html>
<html>
<head>
<title>JSON-LD validation snippet</title>
${scripts}
</head>
<body></body>
</html>
`;
fs.writeFileSync("cms/jsonld-snippet.html", html);
console.log("wrote cms/jsonld-snippet.html", html.length, "chars");
