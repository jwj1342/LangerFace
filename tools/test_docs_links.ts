// 文档链接完整性检查：所有 md 里指向仓库内文件的相对链接都必须解析得到。
// docs/ 改成按语义分子目录后，任何一次移动/改名都会让相对链接静默失效，这里当守卫。
//   node tools/test_docs_links.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (["node_modules", "dist", ".git", "local_outputs", "local_media", "local_archives", "slides"].includes(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

const docsRoot = path.join(repo, "docs");
const markdownFiles = walk(repo);
let failures = 0;
let checked = 0;

// [text](target) —— 只检查仓库内相对路径，跳过 http(s)、mailto、纯锚点
const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

for (const file of markdownFiles) {
  const body = fs.readFileSync(file, "utf8");
  for (const match of body.matchAll(linkRe)) {
    const raw = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) continue;
    const target = raw.split("#")[0];
    if (!target) continue;
    checked++;
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      console.error(`FAIL broken link: ${path.relative(repo, file)} -> ${raw}`);
      failures++;
    }
  }
}

// docs/ 下每篇文档都必须落在一个语义子目录里，且被 docs/README.md 索引到
const indexPath = path.join(docsRoot, "README.md");
if (!fs.existsSync(indexPath)) {
  console.error("FAIL docs/README.md is missing; it is the entry point for the whole doc set");
  failures++;
} else {
  const index = fs.readFileSync(indexPath, "utf8");
  const strays = fs.readdirSync(docsRoot)
    .filter((name) => name.endsWith(".md") && name !== "README.md");
  if (strays.length) {
    console.error("FAIL docs/ 根目录不应直接放文档，请归入语义子目录：");
    for (const name of strays) console.error(`  - docs/${name}`);
    failures++;
  }
  const folders = fs.readdirSync(docsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const folder of folders) {
    if (!index.includes(`docs/${folder}/`) && !index.includes(`${folder}/`)) {
      console.error(`FAIL docs/README.md 未介绍子目录 ${folder}/`);
      failures++;
    }
    for (const name of fs.readdirSync(path.join(docsRoot, folder))) {
      if (!name.endsWith(".md")) continue;
      if (!index.includes(name)) {
        console.error(`FAIL docs/README.md 未索引 docs/${folder}/${name}`);
        failures++;
      }
    }
  }
}

if (failures) {
  console.error(`\n${failures} 处文档链接/索引问题`);
  process.exit(1);
}
console.log(`ok: ${markdownFiles.length} 篇 md 的 ${checked} 条仓库内链接全部可解析，docs 子目录与索引一致`);
