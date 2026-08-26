#!/usr/bin/env node

import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const projectRoot = resolve(repoRoot, "..");
const sourceImage = resolve(projectRoot, "langer线-cc/wrinkle.png");
const baselineDir = resolve(projectRoot, "langer线-cc/wrinkle_rstl_crows_feet_bundle_v22_v9");
const outputDir = resolve(process.env.WRINKLE_CROWS_OUTPUT ||
  resolve(projectRoot, "langer线-cc/wrinkle_rstl_direct_crows_feet_v5"));
const fineLinePath = resolve(repoRoot, "web/assets/wrinkle_fine_lines_v10_wrinkle.json");
const outputName = "04_direct_crows_feet_rstl.png";
const baselineOutputName = "03_baseline_v9_rstl.png";
const comparisonName = "05_baseline_vs_direct.png";

if (!existsSync(baselineDir)) throw new Error(`缺少冻结基线：${baselineDir}`);
if (existsSync(outputDir)) throw new Error(`拒绝覆盖已有输出目录：${outputDir}`);

const baseline = JSON.parse(await readFile(resolve(baselineDir, "wrinkle_rstl_refinement.json"), "utf8"));
const fineLines = JSON.parse(await readFile(fineLinePath, "utf8")).lines;
const lines = baseline.lines.map((line) => ({
  name: line.name,
  region: line.region,
  points: line.points_xy.map(([x, y]) => [x, y]),
}));

function center(points) {
  return points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
    .map((value) => value / points.length);
}
function length(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(
    points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}
function smooth(points, sigma = 2.75) {
  const radius = Math.ceil(3 * sigma);
  return points.map((_, index) => {
    let x = 0, y = 0, weight = 0;
    for (let j = Math.max(0, index - radius); j <= Math.min(points.length - 1, index + radius); j += 1) {
      const w = Math.exp(-0.5 * ((j - index) / sigma) ** 2);
      x += points[j][0] * w;
      y += points[j][1] * w;
      weight += w;
    }
    return [x / weight, y / weight];
  });
}
function resample(points, count) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) cumulative.push(cumulative[i - 1] + Math.hypot(
    points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = cumulative.at(-1) || 0;
  return Array.from({ length: count }, (_, outputIndex) => {
    const target = total * outputIndex / Math.max(1, count - 1);
    let index = 1;
    while (index < cumulative.length && cumulative[index] < target) index += 1;
    const left = Math.max(0, index - 1), span = cumulative[index] - cumulative[left] || 1;
    const t = (target - cumulative[left]) / span;
    return [
      points[left][0] + (points[Math.min(index, points.length - 1)][0] - points[left][0]) * t,
      points[left][1] + (points[Math.min(index, points.length - 1)][1] - points[left][1]) * t,
    ];
  });
}
function maximumTurn(points) {
  let maximum = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = [points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]];
    const b = [points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]];
    const denominator = Math.hypot(...a) * Math.hypot(...b);
    if (denominator < 1e-8) continue;
    maximum = Math.max(maximum, Math.acos(Math.max(-1, Math.min(1,
      (a[0] * b[0] + a[1] * b[1]) / denominator))) * 180 / Math.PI);
  }
  return maximum;
}

const NOSE_DORSUM_IDS = new Set(["paired-edge-v10-022", "paired-edge-v10-023", "paired-edge-v10-024"]);
const candidates = fineLines.filter((line) => line.class === "wrinkle" && !NOSE_DORSUM_IDS.has(line.id)).map((line) => ({
  id: line.id,
  points: line.points.map(([x, y]) => [x, y]),
  center: center(line.points),
  length: length(line.points),
}));
const oldIndices = lines.map((line, index) => ({ index, line, center: center(line.points) }))
  .filter(({ line }) => line.region === "lateral_canthus_short_arc_v65");
const leftOld = oldIndices.filter(({ center: point }) => point[0] < 600).sort((a, b) => a.center[1] - b.center[1]);
const rightOld = oldIndices.filter(({ center: point }) => point[0] >= 600).sort((a, b) => a.center[1] - b.center[1]);
const leftFine = candidates.filter(({ center: point }) => point[0] < 600).sort((a, b) => b.length - a.length).slice(0, leftOld.length)
  .sort((a, b) => a.center[1] - b.center[1]);
const rightFine = candidates.filter(({ center: point }) => point[0] > 700).sort((a, b) => b.length - a.length).slice(0, rightOld.length)
  .sort((a, b) => a.center[1] - b.center[1]);
if (leftFine.length !== leftOld.length || rightFine.length !== rightOld.length) {
  throw new Error(`鱼尾纹替换配对数量异常：左 ${leftFine.length}/${leftOld.length}，右 ${rightFine.length}/${rightOld.length}`);
}

const replacements = [...leftOld.map((old, i) => [old, leftFine[i]]), ...rightOld.map((old, i) => [old, rightFine[i]])]
  .map(([old, fine]) => {
    const direct = resample(smooth(fine.points), old.line.points.length);
    const turn = maximumTurn(direct);
    if (turn > 35) throw new Error(`${fine.id} 平滑转角门禁失败：${turn.toFixed(2)}°`);
    lines[old.index].points = direct;
    return {
      curveIndex: old.index,
      curveName: old.line.name,
      sourceFineLineId: fine.id,
      sourceCenter: fine.center,
      sourceLengthPx: fine.length,
      outputPointCount: direct.length,
      outputLengthPx: length(direct),
      maximumTurnDegrees: turn,
      generatedFromWrinkle: true,
    };
  });

await mkdir(outputDir, { recursive: false });
await writeFile(resolve(outputDir, "direct_crows_feet_geometry.json"), `${JSON.stringify({
  schemaVersion: "langerface.direct-crows-feet-rstl.v1",
  sourceImage: baseline.sourceImage,
  baseline: { directory: baselineDir, atlasVersion: baseline.prior.atlasVersion },
  policy: {
    description: "Replace the ten lateral-canthus RSTL arcs nearest the two crow-feet fields with smoothed v10 wrinkle centerlines.",
    replacementCount: replacements.length,
    maximumTurnGateDegrees: 35,
  },
  replacements,
  lines,
}, null, 2)}\n`);

const render = spawnSync("/opt/anaconda3/envs/longerface/bin/python", ["-c", [
  "import json,sys",
  "from PIL import Image,ImageDraw",
  "src,out,geo=sys.argv[1],sys.argv[2],sys.argv[3]",
  "payload=json.load(open(geo)); im=Image.open(src).convert('RGB'); draw=ImageDraw.Draw(im)",
  "[draw.line([(round(x),round(y)) for x,y in payload['lines'][r['curveIndex']]['points']],fill=(200,0,200),width=2,joint='curve') for r in payload['replacements']]",
  "im.save(out)",
].join(";"), resolve(baselineDir, "04_refined_rstl.png"), resolve(outputDir, outputName), resolve(outputDir, "direct_crows_feet_geometry.json")], { maxBuffer: 8 * 1024 * 1024 });
if (render.status !== 0) throw new Error(`渲染 PNG 失败：${render.stderr.toString()}`);
await copyFile(resolve(baselineDir, "04_refined_rstl.png"), resolve(outputDir, baselineOutputName));
const comparison = spawnSync("/opt/anaconda3/envs/longerface/bin/python", ["-c", [
  "import sys",
  "from PIL import Image,ImageDraw",
  "left,right,out=sys.argv[1],sys.argv[2],sys.argv[3]",
  "a=Image.open(left).convert('RGB'); b=Image.open(right).convert('RGB'); canvas=Image.new('RGB',(a.width+b.width,a.height),(255,255,255)); canvas.paste(a,(0,0)); canvas.paste(b,(a.width,0)); d=ImageDraw.Draw(canvas); d.rectangle((0,0,210,34),fill=(45,50,62)); d.text((10,10),'baseline V9',fill=(255,255,255)); d.rectangle((a.width,0,a.width+240,34),fill=(45,50,62)); d.text((a.width+10,10),'direct crow-feet',fill=(255,255,255)); canvas.save(out)",
].join(";"), resolve(outputDir, baselineOutputName), resolve(outputDir, outputName), resolve(outputDir, comparisonName)], { maxBuffer: 8 * 1024 * 1024 });
if (comparison.status !== 0) throw new Error(`对照图渲染失败：${comparison.stderr.toString()}`);

await writeFile(resolve(outputDir, "README.txt"), [
  "鱼尾纹直接生成 RSTL 对照实验",
  "",
  "本实验仅替换左右鱼尾纹区域各 5 条旧 lateral_canthus_short_arc_v65 曲线。",
  "替换线来自 v10 皱纹中心线，经 Gaussian 平滑和弧长重采样；不修改额头、眉间、鼻背纹或面部其他区域。",
  `结果图：${outputName}（直接沿鱼尾纹生成的新线，颜色与原 RSTL 一致，底图为已裁剪的 V9 RSTL）`,
  `并排对照：${comparisonName}`,
  "",
].join("\n"));
console.log(JSON.stringify({ outputDir, outputName, replacements }, null, 2));
