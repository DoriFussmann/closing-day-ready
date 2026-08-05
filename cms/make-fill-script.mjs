import fs from "node:fs";

const html = fs.readFileSync("cms/jsonld-snippet.html", "utf8");
const script = `
(() => {
  const html = ${JSON.stringify(html)};
  const el = document.getElementById("new-test-textarea");
  if (!el) return { ok: false, reason: "missing textarea" };
  el.focus();
  el.value = html;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  // Some MDL UIs listen for keyup
  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  return { ok: true, len: el.value.length };
})()
`;
fs.writeFileSync("cms/fill-validator-expr.js", script);
console.log("wrote fill expression", script.length);
