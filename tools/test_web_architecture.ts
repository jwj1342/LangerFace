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

// ── 兼容运行时豁免边界（PR #106 review 第 4 点）─────────────────────────────
//
// web/current/ 与 web/compat/personalized/ 是绕过 TypeScript import/cycle 检查的
// 纯 JS 运行时。豁免不是无边界的：下面是**冻结清单**，新增文件会让本测试失败，
// 必须显式改清单才能进来——避免"兼容目录"变成永久免检区。
//
//   owner：#95（Phase 2 消化 Legacy Runtime）
//   允许范围：只允许清单内文件；只允许修 bug 与移植，不允许在此新建功能模块
//   退出条件：#95 把这两个目录收敛进 web/src 的 TypeScript service 层后，
//             删除本清单与整段豁免，让 legacyRuntimeJs 恢复为"一个都不许有"
const LEGACY_RUNTIME_ALLOWLIST = new Set([
  "compat/personalized/bottom_up_personalization.js",
  "compat/personalized/camera_adaptive.js",
  "compat/personalized/constants.js",
  "compat/personalized/data_source.js",
  "compat/personalized/geometry.js",
  "compat/personalized/personalized.js",
  "compat/personalized/prstl_personalization_v2.js",
  "compat/personalized/prstl_pipeline.js",
  "compat/personalized/v6_demo_manifest.js",
  "compat/personalized/v6_review.js",
  "compat/personalized/v6_review_model.js",
  "compat/personalized/v6_rstl_refinement.js",
  "compat/personalized/wrinkle_extraction.js",
  "compat/personalized/yolo_wrinkle_onnx.js",
  "current/assets.js",
  "current/atlas_contract.js",
  "current/camera.js",
  "current/canvas_fit.js",
  "current/constants.js",
  "current/data_source.js",
  "current/dom.js",
  "current/fit_math.js",
  "current/flame_camera_overlay.js",
  "current/flame_fit.js",
  "current/forehead_visibility.js",
  "current/geometry.js",
  "current/image_source.js",
  "current/line_density.js",
  "current/logger.js",
  "current/main.js",
  "current/mode3d.js",
  "current/pipeline.js",
  "current/projection3d.js",
  "current/refine2d.js",
  "current/refine2d_math.js",
  "current/render.js",
  "current/skin_material.js",
  "current/state.js",
  "current/three3d.js",
  "current/ui.js",
]);

const allLegacyJs = walk(root, (file) => file.endsWith(".js"))
  .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))
  .filter((file) => !file.includes(`${path.sep}dist${path.sep}`))
  .map((file) => path.relative(root, file).split(path.sep).join("/"));

const legacyRuntimeJs = allLegacyJs.filter((file) => !LEGACY_RUNTIME_ALLOWLIST.has(file));
if (legacyRuntimeJs.length) {
  console.error("FAIL legacy JS runtime files outside the frozen compatibility allowlist:");
  for (const file of legacyRuntimeJs) console.error(`  - ${file}`);
  console.error("  新增兼容运行时文件必须显式加进 tools/test_web_architecture.ts 的 LEGACY_RUNTIME_ALLOWLIST，");
  console.error("  并说明为什么不能写在 web/src 的 TypeScript service 层（见 #95）。");
  process.exit(1);
}

const staleAllowlistEntries = [...LEGACY_RUNTIME_ALLOWLIST].filter((file) => !allLegacyJs.includes(file));
if (staleAllowlistEntries.length) {
  console.error("FAIL compatibility allowlist lists files that no longer exist (收敛后请同步删除):");
  for (const file of staleAllowlistEntries) console.error(`  - ${file}`);
  process.exit(1);
}
console.log(`ok: 兼容运行时豁免为冻结清单（${LEGACY_RUNTIME_ALLOWLIST.size} 个文件，owner #95）`);

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
