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
// web/current/、web/compat/personalized/ 与 web/compat/shared/ 是绕过 TypeScript import/cycle 检查的
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
  "compat/personalized/personalized.js",
  "compat/personalized/prstl_personalization_v2.js",
  "compat/personalized/prstl_pipeline.js",
  "compat/personalized/v6_demo_manifest.js",
  "compat/personalized/v6_review.js",
  "compat/personalized/v6_review_model.js",
  "compat/personalized/v6_rstl_refinement.js",
  "compat/personalized/wrinkle_extraction.js",
  "compat/personalized/yolo_wrinkle_onnx.js",
  "compat/shared/constants.js",
  "compat/shared/data_source.js",
  "compat/shared/geometry.js",
  "current/assets.js",
  "current/atlas_contract.js",
  "current/camera.js",
  "current/canvas_fit.js",
  "current/dom.js",
  "current/fit_math.js",
  "current/forehead_visibility.js",
  "current/image_source.js",
  "current/line_density.js",
  "current/logger.js",
  "current/main.js",
  "current/pipeline.js",
  "current/refine2d.js",
  "current/refine2d_math.js",
  "current/render.js",
  "current/state.js",
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

// 兼容运行时被豁免于 TypeScript 检查，所以它的 import 图此前只由打包器兜底：把
// web/compat/shared/ 的共享模块 import 路径写错，全部单测仍会通过，只有 npm run
// build 才炸。这里补上相对 import 解析，让路径错误在测试层就暴露。
let legacyImportFail = 0;
for (const rel of LEGACY_RUNTIME_ALLOWLIST) {
  const file = path.join(root, rel);
  const code = fs.readFileSync(file, "utf8");
  const importRe = /(?:from\s+["']|import\s*\(\s*["'])(\.[^"']+)["']/g;
  for (const match of code.matchAll(importRe)) {
    const specifier = match[1];
    if (!specifier.endsWith(".js")) continue;   // ?url 资产 import 由打包器解析
    const target = path.resolve(path.dirname(file), specifier);
    if (!fs.existsSync(target)) {
      console.error(`FAIL legacy runtime import does not resolve: ${rel} -> ${specifier}`);
      legacyImportFail++;
    }
  }
}
if (legacyImportFail) process.exit(1);
console.log("ok: 兼容运行时的相对 import 全部可解析");

// #110：静态前端不得再出现 serverless 函数。web/api/fit.py 曾是线上无鉴权、
// CORS *、无请求体上限的公开算力端点，删除后需要围栏，避免它无声回流。
const forbiddenBackendPaths = ["api", "requirements.txt"];
const resurrected = forbiddenBackendPaths.filter((rel) => fs.existsSync(path.join(root, rel)));
if (resurrected.length) {
  console.error("FAIL the static frontend must not ship a serverless backend again:");
  for (const rel of resurrected) console.error(`  - web/${rel}`);
  console.error("  见 docs/tracks/FLAME_3D_TRACK.md「生产侧零后端、零 GPU」；离线拟合走 tools/fit_flame_to_landmarks.py。");
  process.exit(1);
}
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
if (vercelConfig.functions) {
  console.error("FAIL web/vercel.json declares a functions block; the frontend must stay purely static.");
  process.exit(1);
}
console.log("ok: 前端保持零 serverless 函数（无 web/api、无 requirements.txt、vercel.json 无 functions）");

// 运行时资产（atlas / topology / triangles / .task / .bin）文件名固定，绝不能被
// immutable 长缓存钉住：否则图谱更新后回访用户会长期停在旧版本而毫无提示。
// 真实事故：测试者浏览器仍在跑 132 条的旧图谱，而生产已是 v8.1.67 的 133 条。
{
  const stableRuntimeAssets = fs.readdirSync(path.join(root, "assets"))
    .filter((name) => /\.(json|task|bin|obj|wasm)$/.test(name));
  if (!stableRuntimeAssets.length) {
    console.error("FAIL web/assets 下没有找到运行时资产，守卫失去意义");
    process.exit(1);
  }
  const rules = (vercelConfig.headers || []).filter((rule) =>
    (rule.headers || []).some((header) =>
      String(header.key).toLowerCase() === "cache-control"
      && /immutable/.test(String(header.value))));
  for (const rule of rules) {
    const pattern = new RegExp(`^${String(rule.source)}$`);
    for (const name of stableRuntimeAssets) {
      if (pattern.test(`/assets/${name}`)) {
        console.error(`FAIL immutable 缓存不能覆盖文件名固定的运行时资产：${rule.source} 命中 /assets/${name}`);
        console.error("  内容哈希过的 bundle 才可以 immutable；固定名资产必须回源验证（见 docs/CI_CD_VERCEL.md）。");
        process.exit(1);
      }
    }
  }
  const revalidates = (vercelConfig.headers || []).some((rule) => {
    const pattern = new RegExp(`^${String(rule.source)}$`);
    const value = (rule.headers || []).find((header) =>
      String(header.key).toLowerCase() === "cache-control")?.value || "";
    return stableRuntimeAssets.some((name) => pattern.test(`/assets/${name}`))
      && /max-age=0|no-cache|must-revalidate/.test(String(value));
  });
  if (!revalidates) {
    console.error("FAIL 固定名运行时资产缺少回源验证的 Cache-Control 规则");
    process.exit(1);
  }
  console.log(`ok: ${stableRuntimeAssets.length} 个固定名运行时资产会回源验证，immutable 只覆盖哈希 bundle`);
}

// 同理：代码侧必须显式 no-cache，才能让已经保存了旧 immutable 响应头的浏览器
// 对 fresh 命中也发条件请求；仅删除 force-cache、退回 default 不足以迁移这些用户。
{
  const loader = fs.readFileSync(path.join(root, "src/services/assetLoader.ts"), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))   // 注释里提到它是允许的，只看真实代码
    .join("\n");
  if (!/fetch\(\s*url\s*,\s*\{\s*cache:\s*["']no-cache["']\s*\}\s*\)/.test(loader)) {
    console.error("FAIL assetLoader 必须用 cache: no-cache：旧 immutable fresh 条目也需要条件验证");
    process.exit(1);
  }
  console.log("ok: assetLoader 强制旧 immutable 条目回源验证");
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
