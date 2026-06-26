import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const srcRoot = path.join(root, "src");

function walk(dir, predicate, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

const legacyRuntimeJs = walk(root, (file) => file.endsWith(".js"))
  .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))
  .filter((file) => !file.includes(`${path.sep}dist${path.sep}`));
if (legacyRuntimeJs.length) {
  console.error("FAIL legacy root JS runtime files remain:");
  for (const file of legacyRuntimeJs) console.error(`  - ${path.relative(root, file)}`);
  process.exit(1);
}

const files = walk(srcRoot, (file) => file.endsWith(".ts") || file.endsWith(".tsx"))
  .concat([path.join(root, "vite.config.ts")]);

const graph = new Map();
let fail = 0;

function resolveTypeScriptImport(fromFile, specifier) {
  const ext = path.extname(specifier);
  if (ext === ".js" || ext === ".jsx") {
    console.error(`FAIL legacy JS import: ${path.relative(root, fromFile)} -> ${specifier}`);
    fail++;
    return null;
  }
  if (ext && ext !== ".ts" && ext !== ".tsx") return null;

  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = ext
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  console.error(`FAIL missing import: ${path.relative(root, fromFile)} -> ${specifier}`);
  fail++;
  return null;
}

for (const file of files) {
  const code = fs.readFileSync(file, "utf8");
  const deps = [];
  const importRe = /(?:from\s+["']|import\s*\(\s*["'])(\.[^"']+)["']/g;
  for (const line of code.split(/\r?\n/)) {
    if (/^\s*(?:import|export)\s+type\b/.test(line)) continue;
    for (const match of line.matchAll(importRe)) {
      const dep = resolveTypeScriptImport(file, match[1]);
      if (dep?.startsWith(srcRoot)) deps.push(dep);
    }
  }
  graph.set(file, deps);
}

const visiting = new Set();
const visited = new Set();
const stack = [];

function dfs(file) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = stack.slice(start).concat(file).map((p) => path.relative(root, p));
    console.error(`FAIL static import cycle: ${cycle.join(" -> ")}`);
    fail++;
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  stack.push(file);
  for (const dep of graph.get(file) || []) dfs(dep);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of graph.keys()) dfs(file);

if (fail) process.exit(1);
console.log("ok: web TypeScript import graph has no missing imports or cycles");
