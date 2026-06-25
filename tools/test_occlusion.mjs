// 验证遮挡几何：贴合手形掩膜（手掌+指胶囊）只挡住手本身，张开手指间的缝隙保留。
//   node tools/test_occlusion.mjs
import { convexHull, pointInConvex, buildHandMasks, pointInHandMasks,
         buildOccluderHulls, pointInHulls,
         innerMouthTriangles, INNER_LIP, visibleTriangles } from "../web/geometry.js";

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

// ── 口裂（内唇）三角面排除（#38）────────────────────────────────────────────────
// 合成三角拓扑：tri0 是普通脸部三角面，tri1 是已核实的口裂三角面 (78,95,191)，
// tri2 仅 1 个内唇顶点（不应被排除——避免把唇周正常线一并误删）。
const triangles = [
  [1, 234, 454],   // tri0：鼻尖 + 两颊（普通三角面）
  [78, 95, 191],   // tri1：issue #38 核实的口裂三角面（3 顶点全内唇）
  [95, 234, 454],  // tri2：仅 1 个内唇顶点（95），保留
];
const innerMouth = innerMouthTriangles(triangles);

ok(INNER_LIP.has(78) && INNER_LIP.has(95) && INNER_LIP.has(191), "INNER_LIP 含核实的内唇顶点");
ok(innerMouth.has(1), "★ 口裂三角面 (78,95,191) 被识别为内唇三角面");
ok(!innerMouth.has(0), "普通脸部三角面不被误判为内唇三角面");
ok(!innerMouth.has(2), "仅 1 内唇顶点的三角面不被排除（唇周正常线保留）");

// 模拟 render.js 的逐点 mask：落在口裂三角面上的图谱点被强制排除（mask=0）
const atlasPointTris = [0, 1, 2];          // 三个图谱点分别落在 tri0/tri1/tri2 上
const mask = atlasPointTris.map((tri) => (innerMouth.has(tri) ? 0 : 1));
ok(mask[1] === 0, "★ 落在口裂三角面上的图谱点被遮挡（张嘴不画到牙齿）");
ok(mask[0] === 1 && mask[2] === 1, "其余图谱点（含唇周）仍可见");

// memoize：同一 triangles 引用返回同一 Set 实例（不每帧重算）
ok(innerMouthTriangles(triangles) === innerMouth, "innerMouthTriangles 按引用 memoize");

// 退化三角面过滤：近共线三角面不应因为 DEFAULT_OCCLUSION_THRESHOLD 略小于 0 而被当成可见面。
const degenerateLm = [
  [0, 0, 0],
  [10, 0, 0],
  [20, 0, 0],   // tri0 三点共线
  [0, 10, 0],
];
const degenerateTris = [
  [0, 1, 2],
  [0, 2, 3],
];
const visDefault = visibleTriangles(degenerateLm, degenerateTris, []);
const visAreaGated = visibleTriangles(degenerateLm, degenerateTris, [], undefined, { minTriangleAreaPx2: 1 });
ok(visDefault[0] === 1, "默认背面剔除保持旧行为：阈值允许掠射/退化边缘");
ok(visAreaGated[0] === 0, "★ 面积门槛会剔除近共线退化三角面");
ok(visAreaGated[1] === 1, "面积门槛不会误删正常朝前三角面");

console.log(fail === 0 ? "\n✅ 贴合手形遮挡 + 口裂排除正确" : `\n❌ ${fail} 项失败`);
process.exit(fail ? 1 : 0);
