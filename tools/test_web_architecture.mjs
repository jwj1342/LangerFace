import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const files = fs.readdirSync(root)
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join(root, name));

const graph = new Map();
let fail = 0;

for (const file of files) {
  const code = fs.readFileSync(file, "utf8");
  const deps = [];
  const importRe = /from\s+["'](\.\/[^"']+\.js)["']/g;
  for (const match of code.matchAll(importRe)) {
    const dep = path.resolve(path.dirname(file), match[1]);
    if (!fs.existsSync(dep)) {
      console.error(`FAIL missing import: ${path.relative(root, file)} -> ${match[1]}`);
      fail++;
      continue;
    }
    deps.push(dep);
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
console.log("ok: web static import graph has no cycles");
