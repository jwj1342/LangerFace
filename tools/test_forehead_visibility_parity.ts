// 额头可见性行为回归：生产已收敛为唯一 TypeScript 实现，不再与 legacy JS 自我对拍。
import assert from "node:assert/strict";

import {
  buildForeheadSkinVisibility,
  buildHeadVisibility,
  skinColorMatchesReferences,
  stabilizeForeheadMask,
  type Rgb,
} from "../web/src/services/foreheadVisibility.ts";

const skinReferences: Rgb[] = [[205, 155, 130], [198, 148, 124], [210, 162, 138]];
assert.equal(skinColorMatchesReferences([180, 120, 96], skinReferences), true, "典型肤色应通过");
assert.equal(skinColorMatchesReferences([35, 25, 20], skinReferences), false, "深色头发应被拒绝");
assert.equal(skinColorMatchesReferences([40, 70, 190], skinReferences), false, "蓝色背景应被拒绝");
assert.equal(skinColorMatchesReferences(null, skinReferences), true, "空采样应安全降级为不裁剪");
assert.equal(skinColorMatchesReferences([180, 120, 96], []), true, "无参考色时应安全降级");

const landmarks: number[][] = Array.from({ length: 478 }, (_, index) => {
  const angle = (index / 478) * Math.PI * 2;
  return [320 + 90 * Math.cos(angle), 300 + 130 * Math.sin(angle), 0];
});
landmarks[10] = [320, 175, 0];
landmarks[9] = [320, 245, 0];
landmarks[8] = [320, 250, 0];
landmarks[107] = [295, 248, 0];
landmarks[336] = [345, 248, 0];
for (const index of [1, 4, 5, 195, 197, 205, 425]) landmarks[index] = [320, 320, 0];
landmarks[338] = [345, 180, 0];
landmarks[109] = [295, 180, 0];

const headVisible = buildHeadVisibility(landmarks);
let headAccepted = 0;
let headRejected = 0;
for (let x = 0; x <= 640; x += 16) {
  for (let y = 0; y <= 480; y += 16) {
    if (headVisible([x, y, 0])) headAccepted++;
    else headRejected++;
  }
}
assert.ok(headAccepted > 0 && headRejected > 0, "头部椭圆包络必须真正裁剪画布");

const width = 640;
const height = 480;
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
const skinVisible = buildForeheadSkinVisibility({ data, width, height }, width, height, landmarks);
assert.equal(skinVisible([320, 185, 0]), false, "合成帧的头发区域必须被拒绝");
assert.equal(buildForeheadSkinVisibility(null, width, height, landmarks)([1, 1, 0]), true,
  "无像素数据时应安全降级为不裁剪");

const splitByGap = (left: number, gap: number, right: number) => [
  ...new Array(left).fill(1), ...new Array(gap).fill(0), ...new Array(right).fill(1),
];
const shortRun = stabilizeForeheadMask([0, 0, 0, 1, 1, 1, ...new Array(14).fill(0)]);
assert.ok(shortRun.every((value) => !value), "过短可见段必须整体丢弃");
for (const gap of [3, 10]) {
  const stable = stabilizeForeheadMask(splitByGap(20, gap, 20));
  assert.ok(stable.slice(0, 20).every(Boolean), `间隙 ${gap} 左侧合格段应保留`);
  assert.ok(stable.slice(20, 20 + gap).every((value) => !value), `间隙 ${gap} 应保持不可见`);
  assert.ok(stable.slice(20 + gap).every(Boolean), `间隙 ${gap} 右侧合格段应保留`);
}

console.log("test_forehead_visibility: TypeScript 单实现的肤色、包络与稳定化行为通过");
