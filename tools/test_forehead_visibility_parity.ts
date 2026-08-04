// 额头可见性裁剪的两实现对拍：web/src/services/foreheadVisibility.ts（生产 TypeScript）
// 与 web/current/forehead_visibility.js（兼容运行时）必须对同一输入给出逐点相同的结果。
//
// 为什么需要这条对拍：v8.1.67 的额头拱线在 mapAtlas 之后被主动外推到面部网格之外，
// 显示期的裁剪属于「渲染期后处理」，而 tools/test_web_mapping.ts 的三方对拍只比
// mapAtlas 的输出，看不到这一层。#141 就是因为这层裁剪只存在于兼容运行时而漏了。
//   node tools/test_forehead_visibility_parity.ts
import assert from "node:assert/strict";

import * as ts from "../web/src/services/foreheadVisibility.ts";
import * as js from "../web/current/forehead_visibility.js";

let checks = 0;
const same = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

// ---- 1. 肤色判定：Lab 距离、过暗、低色度三条拒绝路径 ----
// 每个参考集都配了跨阈值两侧的样本，所以任一实现改动阈值常数都会让对拍失败。
// 阈值数值来自 skinColorMatchesReferences：distance <= 26、L < refLight*0.52 且 d > 10、
// chroma < max(5, refChroma*0.70) 且 d > 10。三种肤色参考都测，因为 refLight / refChroma
// 是从参考色算出来的，浅肤色下 tooDark 分支根本不可达。
const referenceSets: Array<[string, ts.Rgb[], Array<[string, ts.Rgb]>]> = [
  ["浅肤色", [[205, 155, 130], [198, 148, 124], [210, 162, 138]], [
    ["典型肤色", [180, 120, 96]],
    ["高光肤色", [235, 200, 185]],
    ["深色头发", [35, 25, 20]],
    ["灰白头发", [185, 180, 177]],
    ["纯黑背景", [0, 0, 0]],
    ["纯白背景", [255, 255, 255]],
    ["蓝色布料", [40, 70, 190]],
    ["仅距离拒绝·内侧 d=25.95", [117, 96, 69]],
    ["仅距离拒绝·外侧 d=29.45", [108, 84, 60]],
    ["低色度阈值内侧 chroma=17.7", [120, 100, 75]],
    ["低色度但距离 d=9.83：靠 d>10 前置条件放行", [223, 184, 168]],
  ]],
  ["中等肤色", [[150, 110, 88], [143, 104, 83], [158, 118, 95]], [
    ["典型肤色", [150, 110, 88]],
    ["过暗阈值内侧 L=24.5", [69, 57, 27]],
    ["过暗阈值外侧 L=26.5", [69, 63, 33]],
    ["低色度但距离 d=9.72：靠 d>10 前置条件放行", [168, 138, 122]],
    ["仅距离拒绝·外侧 d=29.28", [60, 66, 39]],
  ]],
  ["深肤色", [[92, 62, 48], [86, 58, 45], [99, 68, 53]], [
    ["典型肤色", [92, 62, 48]],
    ["过暗阈值内侧 L=13.8", [24, 39, 18]],
    ["过暗阈值外侧 L=15.3", [24, 42, 33]],
    ["仅距离拒绝·内侧 d=25.71", [27, 45, 24]],
    ["仅距离拒绝·外侧 d=29.37", [15, 45, 30]],
    ["浅肤色误判检查", [205, 155, 130]],
  ]],
];
for (const [setLabel, references, cases] of referenceSets) {
  let accepted = 0;
  for (const [label, rgb] of cases) {
    const a = ts.skinColorMatchesReferences(rgb, references);
    same(a, js.skinColorMatchesReferences(rgb, references),
      `skinColorMatchesReferences[${setLabel}] 对「${label}」两实现一致`);
    if (a) accepted++;
  }
  // 每个参考集都必须既有接受也有拒绝，否则这一组样本没有真正压住阈值
  assert.ok(accepted > 0 && accepted < cases.length,
    `${setLabel} 参考集必须同时产生接受与拒绝（接受 ${accepted}/${cases.length}）`);
  same(ts.skinColorMatchesReferences(null, references), js.skinColorMatchesReferences(null, references),
    `${setLabel}：采样为空时两实现一致`);
  same(ts.skinColorMatchesReferences([180, 120, 96], []), js.skinColorMatchesReferences([180, 120, 96], []),
    `${setLabel}：无参考色时两实现一致`);
}
const skinReferences: ts.Rgb[] = referenceSets[0][1];

// ---- 2. Lab 转换与距离 ----
for (const rgb of [[0, 0, 0], [255, 255, 255], [12, 200, 90], [128, 128, 128]]) {
  same(ts.rgbToLab(rgb), js.rgbToLab(rgb), `rgbToLab(${rgb}) 两实现一致`);
}
same(
  ts.labDistance(ts.rgbToLab([180, 120, 96]), ts.rgbToLab([35, 25, 20])),
  js.labDistance(js.rgbToLab([180, 120, 96]), js.rgbToLab([35, 25, 20])),
  "labDistance 两实现一致",
);

// ---- 3. 头部椭圆包络：合成一张脸，采样网格逐点比对 ----
function syntheticFace() {
  const landmarks = [];
  for (let i = 0; i < 478; i++) {
    const angle = (i / 478) * Math.PI * 2;
    landmarks.push([320 + 90 * Math.cos(angle), 300 + 130 * Math.sin(angle), 0]);
  }
  landmarks[10] = [320, 175, 0];   // 额顶
  landmarks[9] = [320, 245, 0];    // 眉间
  landmarks[8] = [320, 250, 0];
  landmarks[107] = [295, 248, 0];
  landmarks[336] = [345, 248, 0];
  for (const index of [1, 4, 5, 195, 197, 205, 425]) landmarks[index] = [320, 320, 0];
  for (const index of [338, 109]) landmarks[index] = [320 + (index === 338 ? 25 : -25), 180, 0];
  return landmarks;
}
const face = syntheticFace();
const tsHead = ts.buildHeadVisibility(face);
const jsHead = js.buildHeadVisibility(face);
let headSamples = 0;
let headVisibleCount = 0;
for (let x = 0; x <= 640; x += 16) {
  for (let y = 0; y <= 480; y += 16) {
    const point = [x, y, 0];
    const a = tsHead(point);
    same(a, jsHead(point), `buildHeadVisibility 在 (${x},${y}) 两实现一致`);
    headSamples++;
    if (a) headVisibleCount++;
  }
}
assert.ok(headVisibleCount > 0 && headVisibleCount < headSamples,
  `头部包络必须真的在裁剪（可见 ${headVisibleCount}/${headSamples}）`);
same(ts.buildHeadVisibility(null)(undefined), js.buildHeadVisibility(null)(undefined),
  "无 landmark 时两实现一致");

// ---- 4. 像素级肤色判定：合成一帧「上半头发 / 下半皮肤」 ----
function syntheticFrame(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const hair = y < 200;
      data[offset] = hair ? 30 : 205;
      data[offset + 1] = hair ? 22 : 155;
      data[offset + 2] = hair ? 18 : 130;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}
const frame = syntheticFrame(640, 480);
const tsSkin = ts.buildForeheadSkinVisibility(frame, 640, 480, face);
const jsSkin = js.buildForeheadSkinVisibility(frame, 640, 480, face);
let skinRejected = 0;
for (let x = 40; x <= 600; x += 20) {
  for (let y = 20; y <= 460; y += 20) {
    const point = [x, y, 0];
    const a = tsSkin(point);
    same(a, jsSkin(point), `buildForeheadSkinVisibility 在 (${x},${y}) 两实现一致`);
    if (!a) skinRejected++;
  }
}
assert.ok(skinRejected > 0, "合成帧的头发区域必须被肤色判定拒绝，否则这条对拍是空的");
same(
  ts.buildForeheadSkinVisibility(null, 640, 480, face)([1, 1, 0]),
  js.buildForeheadSkinVisibility(null, 640, 480, face)([1, 1, 0]),
  "无像素数据时两实现一致（退化为不裁剪）",
);

// ---- 5. 掩膜稳定化：补洞、删短段、保留所有达到 minRun 的段 ----
const splitByGap = (left, gap, right) => [
  ...new Array(left).fill(1),
  ...new Array(gap).fill(0),
  ...new Array(right).fill(1),
];
const threePointMidlineGap = splitByGap(20, 3, 20);
const tenPointMidlineGap = splitByGap(20, 10, 20);
const maskCases = [
  [1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  threePointMidlineGap,
  tenPointMidlineGap,
  new Array(60).fill(1),
  new Array(60).fill(0),
  Array.from({ length: 80 }, (_, i) => (i % 7 === 0 ? 0 : 1)),
];
for (const [index, mask] of maskCases.entries()) {
  same(ts.stabilizeForeheadMask(mask), js.stabilizeForeheadMask(mask),
    `stabilizeForeheadMask 第 ${index} 例两实现一致`);
}
assert.ok(
  ts.stabilizeForeheadMask([0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).every((v) => !v),
  "过短的可见段必须被整体丢弃，否则稳定化没有生效",
);
const stableThreePointGap = ts.stabilizeForeheadMask(threePointMidlineGap);
assert.ok(
  stableThreePointGap.slice(0, 20).every(Boolean)
    && stableThreePointGap.slice(20, 23).every((v) => !v)
    && stableThreePointGap.slice(23).every(Boolean),
  "跨中线额头弧只有 3 点断裂时必须保留两侧合格可见段",
);
const stableTenPointGap = ts.stabilizeForeheadMask(tenPointMidlineGap);
assert.ok(
  stableTenPointGap.slice(0, 20).every(Boolean)
    && stableTenPointGap.slice(20, 30).every((v) => !v)
    && stableTenPointGap.slice(30).every(Boolean),
  "跨中线额头弧有 10 点断裂时仍必须保留两侧合格可见段",
);

console.log(`test_forehead_visibility_parity: ${checks} 项两实现逐点一致（含头部包络与像素肤色网格采样）`);
