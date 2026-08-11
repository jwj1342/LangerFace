import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const web = new URL("../web/", import.meta.url);
const assets = new URL("../web/compat/personalized/", import.meta.url);
const source = await readFile(new URL("src/services/personalized/personalizedRuntime.ts", web), "utf8");
const page = await readFile(new URL("src/routes/PersonalizedWorkbench.tsx", web), "utf8");
const livePanel = await readFile(new URL("src/components/LiveRefinePanel.tsx", web), "utf8");
const liveSourcePanel = await readFile(new URL("src/components/LiveSourceControlsPanel.tsx", web), "utf8");
const liveRenderPanel = await readFile(new URL("src/components/LiveRenderControlsPanel.tsx", web), "utf8");
const liveSource = await readFile(new URL("src/services/liveRuntime.ts", web), "utf8");
const liveRender = await readFile(new URL("src/services/render2d.ts", web), "utf8");
const app = await readFile(new URL("src/App.tsx", web), "utf8");
const incisionRuntime = await readFile(new URL("src/services/incisionRuntime.ts", web), "utf8");
const incisionAtlasSource = await readFile(new URL("src/services/incisionAtlasSource.ts", web), "utf8");
const dataSource = await readFile(new URL("src/services/dataSource.ts", web), "utf8");
const vercelConfig = JSON.parse(await readFile(new URL("vercel.json", web), "utf8"));
const atlas = JSON.parse(await readFile(new URL("assets/atlas_rstl.json", web), "utf8"));

assert.equal(atlas.atlasVersion, "8.1.74", "the capture flow must use the accepted v8.1.74 atlas");
assert.equal(atlas.lines.length, 159, "the capture flow must preserve all v8.1.74 curves");
assert.equal(atlas.lines.reduce((count, line) => count + line.points.length, 0), 15_222,
  "the latest atlas point topology must be preserved");
assert.equal(atlas.lines.at(-1)?.name, "standard_field_0174_left",
  "the latest atlas tail must be present");
assert.match(source, /from "\.\/yoloWrinkleOnnx\.ts"/);
assert.match(source, /from "\.\/v6RstlRefinement\.ts"/);
assert.match(source, /from "\.\.\/\.\.\/\.\.\/assets\/atlas_rstl\.json\?url"/);
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
assert.doesNotMatch(page, /id="liveWorkspace"/);
assert.doesNotMatch(page, /id="liveWorkspaceFrame"/);
assert.match(source, /async function openIncisionWorkspace\(\)/,
  "personalized results must continue into the incision workbench");
assert.match(source, /location\.assign\(`\/app\/incision\?source=personalized/,
  "the personalized route must hand its RSTL atlas to incision design");
assert.doesNotMatch(source, /location\.href = "index\.html"/,
  "the personalized flow must not navigate back to the initial page");
assert.match(source, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/,
  "the capture camera must be released before the incision workspace starts");
assert.match(dataSource, /const PREVIEW_ATLAS_KEY = "langerface\.previewAtlas"/,
  "personalized capture and incision design must share the transient atlas key");
assert.match(incisionRuntime, /dataSource\.takePreviewAtlas\(\)/,
  "incision design must consume the staged personalized atlas exactly once");
assert.match(incisionAtlasSource, /isPersonalizedRstlAtlas/,
  "incision design must distinguish personalized RSTL from unrelated staged atlases");
assert.match(incisionAtlasSource, /mediapipe_personalized/,
  "the accepted personalized atlas must become the primary MediaPipe incision source");
assert.doesNotMatch(incisionRuntime, /flame-2023|loadFlameBasisAsset|mediaPipeAtlasToFlamePreviewAtlas/,
  "incision design must not depend on FLAME");
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
for (const id of [
  "localPipelineProgress",
  "usePersonalizedBtn",
  "wrinkleMaskCanvas",
  "wrinkleMaskDownloadBtn",
  "wrinkleSemanticCanvas",
  "wrinkleSemanticDownloadBtn",
]) {
  assert.match(page, new RegExp(`["']${id}["']`), `personalized React workbench must expose ${id}`);
}
assert.match(page, /每个表情采集一次/);
assert.deepEqual(vercelConfig.rewrites[0], { source: "/", destination: "/index.html" },
  "the React tool launcher must be the deployed main page");
for (const id of ["uploadBtn", "camBtn", "pauseBtn", "exportBtn", "refine2dBtn", "density"]) {
  const reactSource = [livePanel, liveSourcePanel, liveRenderPanel, liveSource, liveRender].join("\n");
  assert.match(reactSource, new RegExp(`["']${id}["']`), `React live workbench must expose ${id}`);
}
assert.match(app, /path="\/current\/\*" element=\{<Navigate to="\/live" replace \/>\}/,
  "the retired /current URL must redirect to the React live workbench");
assert.match(liveSource, /provenanceText\.includes\("local-yolo"\)/,
  "the React live page must identify a staged V6 atlas");
assert.match(liveRender, /lineIndicesForDensity/,
  "the React live page must keep symmetric line-density selection");

const modelParts = [0, 1, 2, 3].map((index) =>
  new URL(`model/wrinkle-yolov8s-seg-640.onnx.part${String(index).padStart(2, "0")}`, assets));
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
