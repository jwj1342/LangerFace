// 验证遮挡几何：贴合手形掩膜（手掌+指胶囊）只挡住手本身，张开手指间的缝隙保留。
//   node tools/test_occlusion.mjs
import { convexHull, pointInConvex, buildHandMasks, pointInHandMasks,
         buildOccluderHulls, pointInHulls } from "../web/geometry.js";

let fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); fail++; } else console.log("ok:", m); };

// 凸包基本正确性
const sq = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]);
ok(sq.length === 4 && pointInConvex([5, 5], sq) && !pointInConvex([20, 5], sq), "凸包/点在内判定");

// 合成一只张开五指、指向上方的手（21 关键点，像素坐标）
const hand = [
  [300, 500],                                   // 0 wrist
  [255, 470], [225, 440], [205, 415], [190, 395], // 1-4 拇指
  [265, 420], [262, 365], [260, 325], [258, 295], // 5-8 食指
  [302, 415], [302, 355], [302, 310], [302, 280], // 9-12 中指
  [334, 420], [336, 365], [338, 325], [340, 298], // 13-16 无名指
  [366, 430], [369, 378], [372, 343], [374, 318], // 17-20 小指
];
const masks = buildHandMasks([hand], 0.16, 2);
const fullHull = buildOccluderHulls([hand], 2);   // 旧的整手大凸包（对照）

const onFinger = [302, 330];          // 中指上
const palmCenter = [300, 450];        // 手掌中央
const gap = [281, 318];               // 食指与中指之间的缝隙（脸在此可见）
const far = [50, 50];                 // 远离手

ok(pointInHandMasks(onFinger, masks), "手指上的点被遮挡");
ok(pointInHandMasks(palmCenter, masks), "手掌上的点被遮挡");
ok(!pointInHandMasks(far, masks), "远处的点不被遮挡");

// 关键：缝隙点——新掩膜不挡，旧大凸包会误挡
ok(!pointInHandMasks(gap, masks), "★ 手指缝隙处的点【不】被遮挡（脸继续显示）");
ok(pointInHulls(gap, fullHull), "  （对照）旧的整手凸包会错误地挡住缝隙点");

// 无手时不剔除
ok(!pointInHandMasks([281, 318], []), "无手掩膜时不剔除");

console.log(fail === 0 ? "\n✅ 贴合手形遮挡正确：只挡手本身，缝隙保留" : `\n❌ ${fail} 项失败`);
process.exit(fail ? 1 : 0);
