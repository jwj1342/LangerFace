# LangerFace 方法原理与算法公式参考

本文是 LangerFace **各核心算法的数学公式与推导的集中参考**：重心坐标映射、One-Euro 平滑、背面剔除、手部遮挡、流线图谱生成、Umeyama/Sim3、FLAME 拟合、软体张力与切口几何。面向需要理解算法**为什么这样算**、或要复现/继续开发的读者。

> **职责边界（避免与其它文档重复）**：本文只讲**算法与公式**。下列主题各有 owning 文档，本文按需引用、不复制：
> - 模块分层、稳定契约、扩展点 → [ARCHITECTURE.md](ARCHITECTURE.md)、[CONTRIBUTING.md «架构与扩展点»](CONTRIBUTING.md#架构与扩展点)
> - 环境与复现步骤 → [ENVIRONMENT.md](ENVIRONMENT.md)、[CONTRIBUTING.md «开发环境»](CONTRIBUTING.md#开发环境)
> - 测试体系与跨语言对拍 → [CONTRIBUTING.md «运行测试»](CONTRIBUTING.md#运行测试)、[CROSS_LANG_PARITY.md](CROSS_LANG_PARITY.md)
> - 诊断 / 隐私 / 可观测性 → [OBSERVABILITY.md](OBSERVABILITY.md)、[PRIVACY_AND_AUDIT.md](PRIVACY_AND_AUDIT.md)
> - FLAME 3D 轨的设计与选型 → [FLAME_3D_TRACK.md](FLAME_3D_TRACK.md)
> - 已实现功能清单 / 路线图 → [README «它能做什么»](../README.md#它能做什么)、[TODO.md](TODO.md)

## 1. 项目定位

LangerFace 是一个面向面部手术规划研究的计算机视觉原型。当前主线是 Stage 1：把可编辑、可校验的 RSTL / Langer 线图谱贴合到患者面部影像或 3D 头模上，用作切口方向判断的可视化参考。系统输出是决策辅助可视化，不是手术指令，也不是已认证医疗器械。

系统的设计原则是：

1. 不训练自定义黑箱模型来预测线条，而是复用 MediaPipe 的稳定人脸关键点检测能力。
2. 把医学知识编码为可版本管理的线条图谱，图谱点存储在标准脸三角网格的重心坐标中。
3. 运行时根据当前人脸关键点、同一套三角拓扑和重心插值，把图谱映射到真实人脸。
4. 对实时场景加入时间平滑、自遮挡、手部遮挡、淡入淡出、诊断日志和跨语言对拍测试，保证工程稳定性。
5. 所有内置图谱当前仍是 `validated:false` 的示意首版，正式临床使用前必须由医生团队校验。

## 2. 数据流总览

> 仓库的模块分层（资产层 / Python 核心库 / Web 前端 / 工具脚本 / 测试）与各层稳定契约见 [ARCHITECTURE.md](ARCHITECTURE.md)、[CONTRIBUTING.md «架构与扩展点»](CONTRIBUTING.md#架构与扩展点)。本文只给**方法视角**的端到端数据流：

整体数据流如下：

```text
照片 / 视频 / 摄像头帧
    -> MediaPipe Face Landmarker 输出 478 个 3D 关键点
    -> 像素化与时间平滑
    -> 读取 RSTL / Langer 图谱 [tri,u,v]
    -> 根据当前关键点三角网格做重心插值
    -> 背面剔除 + 手部遮挡
    -> Canvas / OpenCV / Three.js 渲染
    -> 可选导出、诊断、人工审阅
```

## 3. 标准脸、关键点与坐标系

### 3.1 MediaPipe 关键点

系统使用 MediaPipe Face Landmarker。它输出 478 个 3D 人脸关键点，其中前 468 个与 MediaPipe 标准脸网格拓扑一致，后 10 个为虹膜点。

归一化关键点转像素坐标时使用：

```text
x_px = x * W
y_px = y * H
z_px = z * W
```

其中 `W,H` 为图像宽高。`z` 与 `x` 同量纲，因此乘以 `W`，用于法向、自遮挡和 3D 配准。

### 3.2 MediaPipe 标准脸

`assets/canonical_face_model.obj` 提供：

- 468 个标准顶点。
- 898 个三角面。
- UV 信息。
- 顶点索引与 MediaPipe 前 468 个关键点一一对应。

这意味着标准脸三角面可以直接用于运行时检测到的人脸关键点。标准脸解析位于 `src/langerface/geometry/canonical.py`，输出：

```text
vertices:  (468, 3)
triangles: (898, 3)
uv:        (468, 2) 或 None
```

### 3.3 坐标系约定

| 坐标系 | x | y | z | 用途 |
| --- | --- | --- | --- | --- |
| 屏幕/关键点 | 向右 | 向下 | 入屏 | 实时检测、Canvas 绘制、Web 3D 投影 |
| 标准脸 OBJ | 向右 | 向上 | 朝向观察者 | 标准脸资产、图谱构建 |
| Three.js 展示 | 向右 | 向上 | 出/入屏按 Three.js 约定 | 3D 查看和交互 |

代码中会在不同场景做 y/z 翻转，使检测、重建和 Three.js 展示保持一致。

## 4. 图谱数据模型

RSTL / Langer 线图谱存储在 `assets/atlas_rstl.json`、`assets/atlas_langer.json`，并导出到 `web/assets/`。图谱不是像素坐标，也不是固定 3D 坐标，而是标准脸三角面内的重心坐标。

单个线点格式：

```json
[tri, u, v]
```

其中：

```text
tri = 三角面索引
u,v = 三角面内两个重心坐标
w = 1 - u - v
```

图谱整体格式：

```json
{
  "system": "rstl",
  "version": "0.2",
  "topologyId": "mediapipe-468",
  "topologyVersion": "mediapipe-canonical-468-v1",
  "provenance": "稠密方向场首版...",
  "validated": false,
  "lines": [
    {
      "name": "f0",
      "region": "rstl",
      "points": [[12, 0.21, 0.33], [12, 0.25, 0.30]]
    }
  ]
}
```

这种表示有三个关键优点：

1. 与图像分辨率无关。
2. 与个体脸型、表情、姿态无关。
3. 只要当前帧有同一拓扑的关键点，就可以把线稳定贴到脸上。

图谱读取和校验由 `src/langerface/lines/atlas.py` 完成。校验内容包括版本、拓扑 ID、三角面索引范围、曲线点数和重心坐标范围。

## 5. 核心算法一：重心坐标映射

这是 Stage 1 的核心。

图谱中的每个点存储为 `(tri,u,v)`。运行时取该三角面在当前人脸上的三个顶点：

```text
V0, V1, V2
```

令：

```text
w = 1 - u - v
```

映射后的图像空间点为：

```text
P = u * V0 + v * V1 + w * V2
```

Python 实现在 `src/langerface/lines/mapping.py`，Web 实现在 `web/geometry.js` 的 `mapAtlas`。

该映射本质是分片仿射变形。若三角面顶点经过任意仿射变换：

```text
V'i = A * Vi + b
```

则映射点满足：

```text
P' = u * V0' + v * V1' + w * V2'
   = u * (A V0 + b) + v * (A V1 + b) + w * (A V2 + b)
   = A * (u V0 + v V1 + w V2) + (u+v+w) * b
   = A * P + b
```

因此图谱随三角网格等价变形，对平移、旋转、缩放、局部仿射形变都稳定。这就是线条可以跟随身份、姿态、表情变化的数学基础。

## 6. 核心算法二：One-Euro 时间平滑

实时关键点会抖动。系统使用 One-Euro Filter 对每个关键点每个坐标独立平滑。实现位于 `src/langerface/detection/smoothing.py` 和 `web/geometry.js`。

低通滤波系数：

```text
tau = 1 / (2*pi*cutoff)
alpha = 1 / (1 + tau / dt)
```

先估计速度：

```text
dx = (x_t - x_{t-1}) / dt
dx_hat = alpha_d * dx + (1 - alpha_d) * dx_hat_{t-1}
```

再根据速度自适应调整截止频率：

```text
cutoff = min_cutoff + beta * |dx_hat|
```

最后平滑位置：

```text
x_hat = alpha * x_t + (1 - alpha) * x_hat_{t-1}
```

直观效果：

- 运动慢时 `|dx_hat|` 小，`cutoff` 低，平滑强，抖动小。
- 运动快时 `|dx_hat|` 大，`cutoff` 高，平滑弱，延迟小。

Web 端“平滑”滑杆会映射到相关参数，使用户可在稳定性和响应速度之间取舍。

## 7. 核心算法三：背面剔除与口裂排除

转头时，背侧脸部线条不应该显示。系统基于三角面法向做自遮挡剔除，实现位于 `src/langerface/rendering/occlusion.py` 和 `web/geometry.js`。

对三角面三个顶点：

```text
V0, V1, V2
```

计算法向：

```text
n = (V1 - V0) x (V2 - V0)
```

取 z 分量 `nz` 判断是否朝向相机。由于三角面缠绕方向和坐标系手性可能导致符号不稳定，代码每帧用鼻尖关键点所在三角面自标定：

```text
sign = 1,  如果鼻尖附近三角面的 mean(nz) >= 0
sign = -1, 否则
```

可见性判断：

```text
visible = sign * nz >= threshold
```

其中 `threshold` 略小于 0，允许掠射角边缘三角面保留，避免侧脸边界闪烁。

此外，系统预先找出内唇/口裂相关三角面。张嘴时这些区域可能落入口腔或牙齿上，仅靠背面剔除无法稳定处理，因此代码将这些三角面永久设为不可见。

## 8. 核心算法四：手部遮挡

手挡脸时，手前方区域不应继续画线。该能力目前在 Web 端实现，相关函数在 `web/geometry.js`：

- `buildHandMasks`
- `pointInHandMasks`

Web 端并行运行 MediaPipe Hand Landmarker，得到每只手 21 个关键点。遮挡掩膜不是整手凸包，而是：

1. 手掌关键点凸包。
2. 沿每段指骨生成胶囊体。

点到指骨线段距离用于判断是否落入指骨胶囊。点到线段距离可表示为：

```text
t = clamp( dot(P-A, B-A) / ||B-A||^2, 0, 1 )
Q = A + t * (B-A)
d = ||P-Q||
```

若 `d <= radius`，则认为被该指骨遮挡。

这样张开的指缝不会被误判为整块遮挡区域，脸部线条可以从指缝中保留出来。对应测试在 `tools/test_occlusion.mjs`。

## 9. 核心算法五：渲染与可见线段切分

映射后的线条是一组折线点。渲染前系统按点所属三角面的可见性把折线切成连续可见子段。

伪代码：

```text
current = []
for point, visible in polyline:
    if visible:
        current.append(point)
    else:
        if len(current) >= 2:
            draw(current)
        current = []
```

Python 端用 OpenCV 抗锯齿折线绘制，位于 `src/langerface/rendering/overlay.py`。Web 端用 Canvas 2D 绘制，位于 `web/render.js`。

叠加时使用 alpha 混合：

```text
output = alpha * overlay + (1 - alpha) * frame
```

当检测不到人脸时，`LinePipeline` 使用上一帧映射结果做淡出，避免线条突然消失造成闪烁。

## 10. 2D 运行管线

Python 高层入口是 `src/langerface/pipeline/line_pipeline.py` 的 `LinePipeline`。

单帧处理流程：

```text
输入 BGR 帧
    -> detector.detect(frame)
    -> landmarks_px
    -> 可选 One-Euro 平滑
    -> map_atlas(atlas, landmarks_px, triangles)
    -> visible_triangles(landmarks_px)
    -> draw_overlay(frame, mapped_lines, visible_tri)
    -> 输出叠加帧
```

它同时管理：

- 当前 RSTL / Langer 系统。
- 每张脸独立平滑器。
- 背面剔除开关。
- 丢脸后的淡入淡出。
- 多脸循环。

命令行入口：

```bash
langerface --image face.jpg --system rstl -o out.png
langerface --video clip.mp4 --system langer -o out.mp4
langerface-webcam --system rstl
```

Web 端入口由 `web/pipeline.js`、`web/main.js`、`web/render.js`、`web/state.js` 等模块组成，支持摄像头、上传图片和上传视频。

## 11. 图谱生成方法

当前内置图谱由 `tools/build_field_atlas.py` 生成，是“方向场流线”首版。

### 11.1 人脸归一化平面

标准脸先做正面正交投影：

```text
project_front(v) = (x, -y)
```

再通过稳定解剖锚点定义人脸框：

```text
top    = landmark 10
bottom = landmark 152
left   = landmark 234
right  = landmark 454
```

归一化坐标：

```text
norm = (projected_point - origin) / size
```

图谱生成在 `[0,1]^2` 人脸框中完成。

### 11.2 张力线方向场

脚本定义局部方向角：

```text
theta(x,y)
```

方向场融合使用双角表示：

```text
dir2(theta) = (cos(2theta), sin(2theta))
```

这样 `theta` 与 `theta + pi` 被视为同一条无向切线。多个区域方向用高斯权重平滑融合：

```text
V = sum_i weight_i(x,y) * (cos(2theta_i), sin(2theta_i))
theta = 0.5 * atan2(V_y, V_x)
```

当前 RSTL 方向场大致遵循：

- 前额和颏部横向。
- 鼻梁、人中、眉间竖向。
- 眼周同心切向。
- 口周放射。
- 颊部斜行。

Langer 变体在颊部、鼻部、颏部等分歧区域改变方向，仅作为对照。

### 11.3 人脸掩膜

流线限制在人脸椭圆内，同时挖去眼、口区域：

```text
((x-cx)/rx)^2 + ((y-cy)/ry)^2 <= 1
```

眼和口洞也用椭圆排除。

### 11.4 Jobard-Lefevre 等间距流线

脚本沿方向场追踪流线，并使用空间哈希控制相邻流线距离。主要参数：

```text
d_sep = 流线间距，越小越密
step  = 单步积分长度
d_test = 0.5 * d_sep
```

积分使用二阶 Runge-Kutta 思路：

```text
d1 = (cos(theta(p)), sin(theta(p)))
mid = p + 0.5 * step * d1
d2 = (cos(theta(mid)), sin(theta(mid)))
p_next = p + step * d2
```

追踪停止条件包括：

- 出人脸掩膜。
- 离已有流线太近。
- 达到最大步数。

每条流线生成后，脚本沿其法向播撒新种子，直到掩膜内无法再放置满足间距约束的新线。

### 11.5 投影回三角网格

每个 2D 流线点会定位到标准脸正面投影中的三角面，并转成 `(tri,u,v)`。若点落在多个投影重叠三角面中，优先选择 z 更靠前的三角面，避免误落到背侧。

定位后保存为图谱 JSON。当前图谱 `validated:false`，需要医生用标注工具复核。

## 12. 3D 路线一：多帧关键点重建 Beta

Web 端和 `tools/reconstruct_3d.py` 提供一个轻量 3D Beta 路线：从多帧人脸关键点重建稳定个性化 3D 头模。

### 12.1 Umeyama / Sim3 配准

给定源点 `src` 和目标点 `tgt`，求相似变换：

```text
tgt ≈ s * R * src + t
```

其中：

- `s` 为尺度。
- `R` 为 3x3 旋转矩阵。
- `t` 为平移向量。

加权均值：

```text
mu_x = sum_i w_i * x_i
mu_y = sum_i w_i * y_i
```

去中心化：

```text
X_i = x_i - mu_x
Y_i = y_i - mu_y
```

协方差：

```text
Cov = sum_i w_i * Y_i * X_i^T
```

SVD：

```text
Cov = U * D * V^T
```

处理反射：

```text
S = diag(1,1,det(U)*det(V^T))
R = U * S * V^T
```

尺度：

```text
s = trace(D * S) / sum_i w_i * ||X_i||^2
```

平移：

```text
t = mu_y - s * R * mu_x
```

Python 实现在 `src/langerface/geometry/alignment.py`，Web 实现在 `web/geometry.js`。测试 `tools/test_umeyama.mjs` 验证已知变换可被恢复。

### 12.2 多帧中位数重建

每帧取前 468 个关键点，用一组刚性锚点 `RIGID3D` 对齐到统一参考系。对齐后对每个顶点取多帧中位数：

```text
V_personal[j] = median_t( aligned_frame_t[j] )
```

中位数比均值更抗异常帧、表情抖动和短暂遮挡。得到的 `V_personal` 是一个稳定的个性化中性脸网格。

### 12.3 线条贴到 3D 头模

对 3D 头模仍使用同一图谱重心坐标：

```text
P_3d = u * V0_3d + v * V1_3d + w * V2_3d
```

Web 端 `web/three3d.js` 会计算顶点法向，并将线点沿法向微抬，减少 z-fighting：

```text
P_lifted = P_3d + epsilon * normal
```

Three.js 的深度测试负责旋转查看时的背面遮挡。

### 12.4 实时 3D 投影

投影模式中，每帧用 Umeyama 把稳定重建头模配准到当前活体关键点：

```text
current ≈ s * R * reconstructed + t
```

再把重建头模上的线投回屏幕。这种方式线条来自稳定头模，不直接随表情关键点抖动，但它是刚性配准，因此不能表达细粒度表情形变。

## 13. 3D 路线二：FLAME 形状拟合

仓库还包含 FLAME 3D 轨道，位于 `src/langerface/flame.py`、`web/flame_fit.js` 和相关工具脚本。

FLAME neutral 身份模型可写为：

```text
V(beta) = V_template + shapedirs * beta
```

其中 `beta` 是身份形状系数。借助官方 MediaPipe 到 FLAME 表面的 embedding，可把 FLAME 顶点重心采样成对应 MediaPipe 关键点：

```text
L(beta) = L0 + J * beta
```

拟合目标是最小化关键点误差，并加入 ridge 正则：

```text
min_beta ||J * beta - (target - L0)||^2 + lambda * ||beta||^2
```

法方程：

```text
(J^T J + lambda I) beta = J^T (target - L0)
```

代码采用交替优化：

1. 根据当前 `beta` 得到 FLAME 关键点。
2. 用 Umeyama 将观测关键点对齐到 FLAME 系。
3. 解带正则的线性最小二乘更新 `beta`。
4. 重复若干轮。

拟合后的 FLAME 网格也可通过 `[tri,u,v]` 重心坐标迁移张力线。

## 14. 网页 3D 标注器

`web/annotate.html`、`web/annotate_model.js`、`web/annotate_viewer.js`、`web/annotate_main.js` 实现网页 3D 线标注工具。

主要能力：

1. 加载标准脸、FLAME 网格、拟合 FLAME 网格或用户上传头模。
2. 在 Three.js 场景中点击网格表面拾取点。
3. 相邻控制点通过网格表面路径连接，避免线段直接穿过头模。
4. 导出项目图谱格式 `[tri,u,v]`，或导出通用 3D xyz 折线。
5. 导出图谱默认 `validated:false`，作为临床复核草案。

标注模型中的重心坐标计算使用：

```text
P = a + v0
v0 = b - a
v1 = c - a
v2 = p - a
```

通过点积构造并求解重心坐标。导出时保留 6 位小数，减少文件体积且保持足够精度。

## 15. 手术模拟原型

仓库包含 `web/surgery.html`、`web/surgery_main.js`、`web/soft_body.js`、`web/rstl_field.js`，用于演示沿 RSTL 梭形切除后的闭合新增张力。该部分是 demo 级软体模拟，不是临床级有限元模型，也不和切口 Agent 的候选生成混用。

### 15.1 RSTL 方向场采样

`web/rstl_field.js` 从图谱线条恢复每个线点的 3D 位置和切向：

```text
T_i = normalize(P_{i+1} - P_{i-1})
```

每个顶点取最近图谱线点的切向，得到顶点级 RSTL 方向场：

```text
dir[v] = tangent(nearest_line_point(v))
```

### 15.2 表面质点弹簧模型

`web/soft_body.js` 把标准脸表面边建成弹簧网络。

每条边原长：

```text
L0 = ||Vb - Va||
```

预张力使静息长度缩短：

```text
rest = (1 - PRE) * L0
```

沿 RSTL 方向刚度更大，垂直 RSTL 方向更软：

```text
align = |dot(edge_dir, rstl_dir)|
k = 1 + (ANISO - 1) * align
```

弹簧力大小近似：

```text
F = stiffness * k * (L - rest)
```

这表达了一个演示级假设：沿 RSTL 方向更不易拉伸，垂直 RSTL 方向更容易被拉拢。因此切口长轴平行 RSTL 时，闭合方向垂直 RSTL，新增闭合张力较低。当前 UI 只保留沿 RSTL 的绿色演示路径，避免把“好 / 坏”二元对比混入正式切口候选设计。

### 15.3 梭形切除与闭合

用户点击肿物点后，系统生成沿 RSTL 的梭形切除预览。椭圆切除判定：

```text
along = dot(P - center, axis)
perp  = ||(P - center) - along * axis||

(along^2 / la^2) + (perp^2 / lb^2) <= 1
```

满足条件的顶点被移除。切除周围一定半径内降低 tether，使皮肤局部可移动。模拟迭代后计算伤口区新增张力：

```text
extra_tension = max(0, current_tension - baseline_tension)
```

页面以顶点颜色和 0-100 指数展示两种切向的差异。该功能适合科普、交互演示和早期方向验证，不应被理解为真实软组织力学结论。

## 16. 前端功能实现

> Web 前端各模块（`web/pipeline.js` / `geometry.js` / `render.js` / `mode3d.js` / `three3d.js` / `logger.js` / `annotate_*.js` / `soft_body.js`）的职责与分层见 [ARCHITECTURE.md](ARCHITECTURE.md)；用户可见的功能清单见 [README «它能做什么»](../README.md#它能做什么)。本文不重复模块表——上面各算法章节已在节内标注其 Web 实现文件（如 `mapAtlas` 在 `web/geometry.js`）。

## 17. Python 功能实现

> Python 包（`src/langerface/` 的 `detection/` / `geometry/` / `lines/` / `rendering/` / `pipeline/` / `media/` / `apps/` / `registration/` / `flame.py`）的分层职责与稳定契约见 [ARCHITECTURE.md](ARCHITECTURE.md) 与 [CONTRIBUTING.md «架构与扩展点»](CONTRIBUTING.md#架构与扩展点)。各算法的 Python 实现文件见对应算法章节。

## 18. HeadSpace / FaceScape 离线配准

`tools/headspace/` 放置受许可数据集的离线处理脚本。真实数据不入库，只在本地或受控环境使用。

主要流程：

```text
多视角 PNG + TKA 标定
    -> 每视角检测 468 关键点
    -> 相机反投影生成射线
    -> 射线与 3D 头模求交
    -> 多视角关键点融合
    -> 加权 Sim3 配准
    -> 可选局部残差修正
    -> 把张力线投影到真实采集图像或渲染视频
```

多视角融合中常用加权统计和 medoid 思路，减少单视角检测异常。配准核心已经收敛到 `src/langerface/geometry/alignment.py` 和 `src/langerface/registration/`，脚本层主要保留数据集 I/O 和编排。

## 19. 诊断、隐私与可观测性

> 浏览器诊断 JSON 的 schema、结构化事件字段、计数器与运行时指标见 [OBSERVABILITY.md](OBSERVABILITY.md)；导出内容的隐私边界（禁止混入像素 / 视频帧 / 3D 纹理 / 患者身份 / secret）与审计约束见 [PRIVACY_AND_AUDIT.md](PRIVACY_AND_AUDIT.md)。这两条是本项目的硬约束——任何新增日志/导出都不得越界。

## 20. 验证与测试体系

> 各测试的职责、目检脚本与浏览器实测清单见 [CONTRIBUTING.md «运行测试»](CONTRIBUTING.md#运行测试)（测试事实来源）；Python ⇄ JS ⇄ 金标逐点对拍的不变式（映射误差 < 1e-2 px、可见性不一致数 = 0）与金标重生成见 [CROSS_LANG_PARITY.md](CROSS_LANG_PARITY.md)。本文不重复测试枚举，只强调：改动任何几何代码后，`pytest` 与 `cd web && npm test` 的对拍必须仍逐点一致。

## 21. Stage 2 切口规划路线

Stage 2 目标是在当前张力线迁移基础上，加入肿物输入、临床规则和候选切口生成。系统仍只生成可解释候选和风险提示，最终切口由医生确认。

### 21.1 输入

| 输入 | 来源 | 说明 |
| --- | --- | --- |
| 患者脸部几何 | 照片、视频、摄像头、3D 扫描 | 由当前 2D/3D 配准体系提供 |
| 肿物约束 | 医生标注、术前超声、病理判断 | 中心、直径、边界、深度、安全切缘等 |
| 临床规则 | 医生团队规则库 | RSTL、自然皱襞、美学亚单位、敏感结构例外 |

肿物约束会先经过 `summarize_tumor_input_quality`。该步骤不改变几何，只把缺作者、非 mm 单位、缺皮下深度、缺皮表切缘、自由轮廓点数过稀等输入风险写入工具 trace、`tumor_quality`、审阅 JSON 和 Markdown 报告，避免医生把不完整输入误读为已充分建模的肿物边界。

### 21.2 输出

- RSTL / Langer 线叠加。
- 肿物位置和边界。
- 一个或多个候选切口线。
- 候选解释：方向来源、角度偏差、长宽比、尖端角、平滑性。
- 敏感结构风险提示。
- 医生编辑、覆盖和确认记录。

### 21.3 规则优先级

默认方向优先级：

1. RSTL：长轴尽量平行松弛皮肤张力线。
2. 自然皱襞/皱纹：利用额纹、鱼尾纹、鼻唇沟、睑缘纹等隐藏瘢痕。
3. 美学亚单位边界：眉缘、唇红缘、发际线、鼻翼沟、耳前皱襞等。
4. 敏感结构例外：下睑、唇红缘、鼻翼等区域需要优先保护形态和功能。

当前面部分区仍是标准脸 bbox 启发式，但分区输出会携带 `confidence_reasons` 和 `region_boundary_margin_norm`。`bbox_heuristic_region_classifier`、`near_region_rule_boundary`、`near_canonical_face_edge`、`near_sensitive_free_margin`、`heuristic_region_low_confidence` 以及耳周、鼻尖、口角、下颌缘等过渡区标签会进入工具 trace、guardrail 文案和审阅报告，帮助医生区分“规则边界附近”与“明确敏感结构附近”。这些解释不是临床级分区验证。

### 21.4 皮下肿物线性切口

皮下肿物默认生成线性切口：

```text
center = tumor.center_on_face
axis = query_rstl_direction(center)
length = f(ultrasound_diameter, clinical_rule)
candidate = segment(center, axis, length)
```

需要报告：

- 超声直径和单位来源。
- 切口长度规则。
- `length_target_mm`、`length_target_deficit_mm`、`diameter_coverage_required_mm` 和 `diameter_coverage_deficit_mm`。
- 与局部 RSTL 的角度偏差。
- 是否命中敏感结构 guardrail。
- `candidate_version`、`parent_candidate_id`、`edit_id` 和 `edit_history`；工具生成候选为 v1，医生编辑后的候选至少为 v2，导出报告显示候选版本和编辑记录数。

如果最大长度规则使线性候选短于记录的超声直径，guardrails 输出 `linear_diameter_coverage_deficit` 高风险警告；医生需要增加长度、确认更小影像直径，或记录明确的人工 access decision。

角度偏差可用：

```text
angle_error = arccos(|dot(axis_candidate, axis_rstl)|)
```

取绝对值是因为切口轴线无方向，`theta` 和 `theta + pi` 等价。

局部 RSTL 方向服务同样按无向切线轴统计邻域离散度。对候选邻域切线角 `theta_i` 和加权平均轴 `theta_ref`，使用：

```text
axis_diff(theta_i, theta_ref) = |((theta_i - theta_ref + 90) mod 180) - 90|
angular_spread = 2 * max_i axis_diff(theta_i, theta_ref)
```

这样 `179°` 与 `-179°` 被视为约 `2°` 的轴向差异，而不是普通有向角 `max(theta)-min(theta)` 下的 `358°`。方向置信度因此只在真实邻域方向冲突时下降，不会在角度表示边界处误报低置信度。查询结果还会输出 `confidence_reasons`：`empty_atlas`、`nearest_atlas_support_far`、`nearest_atlas_support_sparse`、`low_support_count` 或 `high_angular_spread` 会进入候选 provenance、guardrail 文案和审阅报告，便于区分“没有图谱支持”和“邻域方向本身冲突”。

### 21.5 皮表肿物梭形切口

皮表肿物生成梭形候选。默认临床经验参数：

```text
long_axis parallel RSTL
length / width ≈ 3
tip_angle ≈ 30 degrees
```

但工程实现应参数化这些值，因为 3:1 长宽比和 30 度尖端角在不同几何条件下不一定能同时严格满足。系统应输出实际指标，而不是隐瞒偏差。

当前梭形候选轮廓使用对称 cubic Hermite profile。设 `u` 为从端点到中点的归一化距离，`R = half_length / half_width`，目标尖端半角斜率 `m = tan(tip_angle / 2)`，则半轮廓端点斜率为 `s = R * m`，并用：

```text
h(u) = (s - 2)u^3 + (3 - 2s)u^2 + su
```

生成从端点 `h(0)=0` 到中点 `h(1)=1`、且中点切线水平 `h'(1)=0` 的平滑轮廓。为避免极端长宽比下曲线过冲，工程上会限制可用端点斜率并在 metrics 中记录 `tip_angle_target_deg`、`tip_angle_estimated_deg`、`tip_angle_error_deg` 和 `tip_angle_limited_by_ratio`。

边界覆盖按长轴投影单独计算：

```text
axis_coverage_required_mm = lesion_axis_diameter_mm + 2 * margin_mm
length_target_mm = max(width_mm * length_to_width_ratio, axis_coverage_required_mm)
axis_coverage_deficit_mm = max(0, axis_coverage_required_mm - length_mm)
```

如果 `length_mm` 因 `max_length_mm` 被截断而小于 `axis_coverage_required_mm`，guardrails 输出 `fusiform_axis_coverage_deficit` 高风险警告；医生需要增加长度、调整切缘或重新标注边界，不能把该候选静默当作已覆盖病灶。

自由轮廓还会进入边界质量 guardrails：`boundary_point_count < min_freehand_boundary_points` 输出 medium 级 `cutaneous_boundary_too_few_points`；投影面积相对名义直径圆盘过小输出 high 级 `cutaneous_boundary_degenerate_area`；轮廓自交输出 high 级 `cutaneous_boundary_self_intersection`；`boundary_center_shift_mm` 超过 `diameter_mm * boundary_center_shift_diameter_multiplier` 输出 high 级 `cutaneous_boundary_center_shift`。这些规则用于防止误点、漏点、近共线轮廓、蝴蝶结式轮廓，或把中心点与轮廓标在不同病灶上。

敏感结构 guardrails 的距离计算使用标准脸归一化坐标。下睑、鼻翼和唇红缘除保留代表性锚点外，还加入简化游离缘线段；中心点或候选几何到这些锚点/线段的最短距离乘以成人脸高近似值，得到 `free_margin_distance_mm` 或 `sensitive_free_margin_min_distance_mm`。判定阈值由 `free_margin_distance_thresholds_mm` 按下睑、唇红缘、鼻翼、鼻尖、口角等结构选择，warning 文案会记录命中的阈值；这比单点锚更稳健，但仍是标准脸工程筛查，不能当作真实毫米级临床测量。

候选结构建议：

```json
{
  "type": "fusiform",
  "axis_source": "rstl",
  "center": [0.52, 0.41],
  "axis_angle_deg": 18.5,
  "length_mm": 18.0,
  "width_mm": 6.0,
  "target_ratio": 3.0,
  "tip_angle_deg": 30.0,
  "metrics": {
    "profile": "cubic_hermite_tip_angle_constrained",
    "tip_angle_target_deg": 30.0,
    "tip_angle_estimated_deg": 30.0,
    "tip_angle_error_deg": 0.0,
    "axis_coverage_required_mm": 18.0,
    "axis_coverage_deficit_mm": 0.0
  },
  "curve": [[0.1, 0.2], [0.2, 0.25]],
  "warnings": [],
  "overrides": []
}
```

### 21.6 计划模块

| 模块 | 计划位置 | 职责 |
| --- | --- | --- |
| 临床规则库 | `assets/clinical_rules_face_incision.json` | 区域规则、优先级、例外和审核状态 |
| 面部分区 | `src/langerface/anatomy/`, `web/anatomy*.js` | 点位到临床区域和美学亚单位的映射，输出分区低置信原因 |
| RSTL 方向服务 | `src/langerface/lines/direction.py` | 查询局部方向、置信度和依据 |
| 肿物模型 | `src/langerface/tumor/`, `web/tumor*.js` | 表达皮下/皮表肿物约束 |
| 切口生成 | `src/langerface/incision/` | 线性和梭形候选生成 |
| guardrails | `src/langerface/incision/guardrails.py` | 敏感结构风险提示 |
| 审阅 UI | `web/incision*.js` | 医生编辑、覆盖、确认和导出 |
| 验证指标 | `docs/VALIDATION.md` | 角度误差、稳定性、医生接受率等 |

## 22. 已实现功能清单

> 用户可见的已实现功能清单见 [README «它能做什么»](../README.md#它能做什么)，路线图与待办见 [TODO.md](TODO.md)。本文聚焦算法原理，不维护功能清单（避免与 README 漂移）。

## 23. 当前边界与局限

1. 图谱医学准确性是首要限制。当前内置 RSTL / Langer 图谱是方向场生成的示意首版，未完成临床验证。
2. MediaPipe 关键点在前额、强侧脸、强光、低光、遮挡、多脸快速进出时可能漂移。
3. Python 端只处理自遮挡，Web 端才有手部遮挡；器械、纱布、口罩等通用外物遮挡尚未实现。
4. 3D Beta 的实时投影是刚性配准，不随表情做非刚性形变。
5. 手术模拟是表面质点弹簧 demo，不是真实软组织 FEM。
6. Stage 2 的肿物模型、切口候选生成、敏感结构规则和医生审阅 UI 仍在路线图中。
7. 系统默认本地运行，不上传患者数据；若部署到外网，需要额外访问控制、合规审查和数据治理。

## 24. 推荐复现路径

> 从零搭建环境、安装依赖与构建步骤见 [CONTRIBUTING.md «开发环境»](CONTRIBUTING.md#开发环境) 与 [ENVIRONMENT.md](ENVIRONMENT.md)；测试运行见 [CONTRIBUTING.md «运行测试»](CONTRIBUTING.md#运行测试)。体验路径：Web 首页摄像头实时叠加 → 上传图片看贴合/平滑/背面剔除 → 3D Beta（示例脸或扫描重建）→ `/annotate.html` 标注导出草案与沿 RSTL 闭合演示 → `incision_agent.html` 生成肿物切口候选；改几何代码后务必跑 `pytest` 和 `cd web && npm test` 确认对拍仍通过。

## 25. 一句话总结

LangerFace 的核心不是“用 AI 猜线”，而是把可审核的医学线图谱编码到标准脸三角网格上，再通过 MediaPipe 关键点和重心坐标把它稳定迁移到当前人脸；在此基础上，系统逐步扩展 3D 重建、临床标注、手术模拟和未来的肿物切口候选设计。
