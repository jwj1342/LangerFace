import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const web = new URL("../web/", import.meta.url);
const runtime = new URL("../web/compat/personalized/", import.meta.url);
const source = await readFile(new URL("personalized.js", runtime), "utf8");
const page = await readFile(new URL("personalized.html", web), "utf8");
const currentPage = await readFile(new URL("current/index.html", web), "utf8");
const currentMain = await readFile(new URL("current/main.js", web), "utf8");
const currentRender = await readFile(new URL("current/render.js", web), "utf8");
const liveSource = await readFile(new URL("src/services/liveRuntime.ts", web), "utf8");
const dataSource = await readFile(new URL("src/services/dataSource.ts", web), "utf8");
const vercelConfig = JSON.parse(await readFile(new URL("vercel.json", web), "utf8"));
const atlas = JSON.parse(await readFile(new URL("assets/atlas_rstl.json", web), "utf8"));

assert.equal(atlas.lines.length, 116, "the capture flow must use the latest v8.1.55 atlas");
assert.equal(atlas.lines.reduce((count, line) => count + line.points.length, 0), 12_030,
  "the latest atlas point topology must be preserved");
assert.equal(atlas.lines.at(-1)?.name, "standard_field_0148_left",
  "the latest atlas tail must be present");
assert.match(source, /from "\.\/yolo_wrinkle_onnx\.js"/);
assert.match(source, /from "\.\/v6_rstl_refinement\.js"/);
assert.match(source, /from "\.\.\/\.\.\/assets\/atlas_rstl\.json\?url"/);
assert.match(source, /confidenceThreshold: YOLO_CONFIDENCE/);
assert.match(source, /const CYCLES_REQUIRED = 1;/,
  "each expression must be captured exactly once");
assert.match(source, /const REGION_GATE_THRESHOLD = 0\.08;/,
  "expression masks must use the soft 0.08 spatial floor");
assert.match(source, /const FROWN_QUALITY_THRESHOLDS = Object\.freeze/,
  "frown uses a mobile-tolerant quality gate");
assert.match(source, /action === "frown"\s*\/\/ 皱眉由定时采集提交/,
  "frown visual signal is advisory instead of a blocking gate");
assert.match(source, /FROWN_REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO = 0\.025/,
  "frown has an expression-aware registration residual limit");
assert.match(source, /SMILE_REGISTRATION_RESIDUAL_LIMIT_FACE_RATIO = 0\.030/,
  "smile has an expression-aware registration residual limit");
assert.match(source, /consolidationRadiusPx/,
  "cross-expression strict union exposes a direction-aware deghosted mask");
assert.match(source, /fused\?\.consolidatedMask \|\| fused\?\.mask/,
  "V6 consumes the consolidated view while retaining the exact union for audit");
assert.match(source, /soft_floor_with_confidence_weight/,
  "diagnostics must identify the softened expression-region gate");
assert.match(source, /SQUINT_QUALITY_THRESHOLDS/,
  "squint needs a dedicated eye-occlusion quality gate");
assert.match(source, /action === "squint"[\s\S]{0,180}SQUINT_QUALITY_THRESHOLDS/,
  "the squint-specific quality gate must be selected at commit time");
assert.doesNotMatch(source, /repeatabilityScore\(cycles\[0\], cycles\[1\]/,
  "single-capture mode must not wait for a second expression round");
assert.match(source, /skinMask: sess\?\.skin/);
assert.match(source, /forbiddenMask: sess\?\.forbidden/);
assert.match(source, /cross_expression_operation: "strict_union"/);
assert.match(source, /dataSource\.stagePreviewAtlas\(activeAtlas\)/);
assert.match(page, /id="liveWorkspace"/);
assert.match(page, /id="liveWorkspaceFrame"/);
assert.match(source, /async function openLiveWorkspace\(\)/,
  "personalized results must open the complete live 2D UI in the same page");
assert.match(source, /liveWorkspaceFrame\.src = `\/app\/live\?embedded=personalized/,
  "the current React live UI must be reused instead of copied");
assert.doesNotMatch(source, /location\.href = "index\.html"/,
  "the personalized flow must not navigate back to the initial page");
assert.match(source, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/,
  "the capture camera must be released before the live workspace starts");
assert.match(dataSource, /const PREVIEW_ATLAS_KEY = "langerface\.previewAtlas"/,
  "the capture and React live UI must share the local preview-atlas session key");
assert.match(liveSource, /provenanceText\.includes\("local-yolo"\)/,
  "the live UI must recognize the string provenance emitted by the browser V6 pipeline");
assert.match(liveSource, /\? "个性化 V6"/,
  "the live UI must preserve personalized provenance instead of labeling every preview as annotation");
assert.match(source, /expandForehead: false/,
  "personalized canonical mapping must not apply the legacy forehead expansion twice");
assert.match(source, /disableRuntimeExpansion: true/,
  "the staged personalized atlas must keep legacy expansion disabled in the live renderer");
assert.doesNotMatch(source, /warpPriorCurvesWithHessian/,
  "the legacy Hessian curve warper must not remain in the final personalization route");
assert.match(page, /id="localPipelineProgress"/);
assert.match(page, /id="usePersonalizedBtn"/);
assert.match(page, /id="wrinkleMaskCanvas"/);
assert.match(page, /id="wrinkleMaskDownloadBtn"/);
assert.match(page, /id="wrinkleSemanticCanvas"/);
assert.match(page, /id="wrinkleSemanticDownloadBtn"/);
assert.match(page, /每个表情采集一次/);
assert.deepEqual(vercelConfig.rewrites[0], { source: "/", destination: "/current/index.html" },
  "the latest live workbench must be the deployed main page");
for (const id of ["uploadBtn", "camBtn", "pauseBtn", "exportBtn", "refine2dBtn", "density", "routeSel"]) {
  assert.match(currentPage, new RegExp(`id=["']${id}["']`), `current main page must expose ${id}`);
}
assert.match(currentPage, /href="\/personalized"/,
  "the main page must open the V6 personalized workflow");
assert.match(currentMain, /String\(atlas\.provenance \|\| ""\)\.includes\("local-yolo"\)/,
  "the current main page must identify a staged V6 atlas");
assert.match(currentRender, /lineIndicesForDensity/,
  "the current main page must keep symmetric line-density selection");

const modelParts = [0, 1, 2, 3].map((index) =>
  new URL(`model/wrinkle-yolov8s-seg-640.onnx.part${String(index).padStart(2, "0")}`, runtime));
const hash = createHash("sha256");
let bytes = 0;
for (const part of modelParts) {
  const payload = await readFile(part);
  bytes += payload.byteLength;
  hash.update(payload);
}
assert.equal(bytes, 47_378_404);
assert.equal(hash.digest("hex").toUpperCase(),
  "4BB6ECD9C5FDDDDF1A4559813FB40293F6AE552EA1287912219157B91408A744");

console.log(`personalized YOLO/V6 integration test passed (${root}; ${bytes} model bytes)`);
