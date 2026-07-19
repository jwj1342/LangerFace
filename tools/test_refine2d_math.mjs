import assert from "node:assert/strict";
import {
  applyCurveRefinementTransport,
  buildCurveRefinementTransport,
  curveEraseTargets,
  deformCurveWide,
} from "../web/current/refine2d_math.js";

const line = Array.from({ length: 21 }, (_, index) => [index * 5, 50]);
const moved = deformCurveWide(line, 10, [60, 65], { width: 200, height: 200 });

assert.deepEqual(moved[10].slice(0, 2), [60, 65], "抓取点必须精确跟随指针");
assert(moved[9][1] > 60, "相邻点应明显联动");
assert(moved[0][1] > 51, "整条曲线的远端也应获得连续的小幅联动");
assert(moved[0][1] < moved[5][1] && moved[5][1] < moved[10][1], "联动权重应沿弧长平滑增加");
assert.deepEqual(curveEraseTargets(4, 9, true), [4, 9], "对称擦除应隐藏两条线");
assert.deepEqual(curveEraseTargets(4, 9, false), [4], "关闭对称后只隐藏当前线");

const autoLines = [{ name: "test", hidden: false, pts: line }];
const refinedLines = [{ name: "test", hidden: true, pts: moved }];
const transport = buildCurveRefinementTransport(autoLines, refinedLines);
const currentAuto = [{ name: "test", hidden: false, pts: line.map((point) => [20 + point[0] * 2, 100]) }];
const liveRefined = applyCurveRefinementTransport(currentAuto, transport, { width: 400, height: 300 });
assert.equal(liveRefined[0].hidden, true, "整线擦除应在返回实时画面后继续生效");
assert(liveRefined[0].pts[10][1] > 125, "定格画面的法向微调应随实时人脸尺度传输");
assert(liveRefined[0].pts[9][1] > liveRefined[0].pts[0][1], "整线平滑联动形状应在实时传输后保留");

console.log("✅ refine2d 曲线联动与擦除测试通过");
