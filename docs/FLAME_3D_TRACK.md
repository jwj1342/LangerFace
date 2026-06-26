# 3D FLAME 轨：设计与技术选型（issue #61）

> 状态：**Sprint 0 进行中**（本文件 + 拓扑契约基线 #65 + FLAME 资产管线）。
> 关联：#61（Epic）、#65（拓扑守卫）、#40（3D 可行性 gate）、#2（临床校验）。

## 1. 定位：与 2D MediaPipe 轨**独立双轨**

本仓库是**两条近乎独立的技术轨**，FLAME **不**替代 / 不统一 MediaPipe：

| | 2D MediaPipe 轨（现状不动） | 3D FLAME 轨（本文档） |
|---|---|---|
| 拓扑 | `mediapipe-468`（468 顶点） | `flame-2023`（~5023 顶点） |
| 用途 | 实时摄像头叠加，逐帧跟随表情 | 标准头标注 → 扫脸配准 → 张力线随形变迁移 |
| 运行 | 浏览器实时 | **离线拟合** + 浏览器查看 |
| 共享 | 仅「张力线 `[tri,u,v]` 数据格式 + `topologyId` 标签」（#65 守卫保证两轨图谱不混用） | |

## 2. 核心操作流程

1. **医生在标准 FLAME 头模上标注标准张力线** → 存为 FLAME 拓扑上的 `[tri,u,v]`（`topologyId:"flame-2023"`）。
2. **用户扫脸 → 离线配准/拟合 FLAME** → 得到与本人脸型一致的**个性化 FLAME 实例**（同拓扑、顶点形变）。
3. **张力线随 FLAME 形变自动迁移**：重心坐标在固定拓扑下**形变不变**，FLAME 的「标准头→个体」参数形变 `M(β,θ,ψ)` 本身就是迁移函数——**无需 MediaPipe↔FLAME 锚点表**。
4. **可视化**：在个体 FLAME 上渲染迁移后的张力线。

## 3. 拓扑契约基线（#65，已落地）

图谱信封带 `topologyId`/`topologyVersion`；加载边界 + 实时注入两处守卫，杜绝绑错拓扑的图谱被静默消费。`flame-2023` 是注册的第二拓扑，FLAME 图谱与 MediaPipe 图谱因此**互不误食**。

## 4. 拟合技术选型（research-backed，license 已逐仓库核实）

对 5 类方法做了调研。结论先行：**主线走「优化式 FLAME 拟合」**（非深度编码器）。

| 方法 | 输入 | 输出 | 算力 | License（**代码 + FLAME 依赖**） | 适配度 |
|---|---|---|---|---|---|
| **优化式 landmark/scan 拟合** *(TF_FLAME / flame-fitting / FLAME_PyTorch)* | **关键点 + 3D 扫描（都支持）** | FLAME β/ψ/pose + 配准网格 | **纯 CPU、离线**、秒级 | 代码：`FLAME_PyTorch` 为 **MIT**（薄封装）；模型：**FLAME 2023 Open = CC-BY-4.0（可商用）** | **★ 主线** |
| **MICA** *(ECCV'22)* | 单张照片 | **度量级 neutral 身份**（最准的中性形状） | GPU | 代码 **MPI 非商用**；FLAME 非商用 | 研究期可选「身份 seed」 |
| **DECA** *(SIGGRAPH'21)* | 单张照片 | FLAME 粗参 + 细节位移 | GPU | 代码 **MPI 非商用** | 研究 baseline，不在商用关键路径 |
| **EMOCA** *(CVPR'22)* | 单张照片 | FLAME + 情绪一致表情 | GPU | 代码 **MPI 非商用**；**已被作者弃用** | 不采用（表情对张力线迁移无关紧要） |
| **3D scan 非刚性配准** *(flame-fitting `fit_scan.py`)* | **3D 扫描** | FLAME 参数 + 5023 顶点配准网格 | **纯 CPU、离线** | 代码无显式 license（受 FLAME 约束）；FLAME 2023 Open 可商用 | scan 模式高保真后端 |

**为什么主线是优化式拟合：**
- **两种输入都覆盖**（用户明确要求）：既能拟合到关键点（MediaPipe 468），也能拟合到真实 3D 扫描。深度方法（MICA/DECA/EMOCA）**只吃单张照片**，覆盖不了关键点/扫描两种模式。
- **纯 CPU、离线**：形状/表情子问题是 FLAME 线性基上的**最小二乘**，pose/关节用 Gauss-Newton/L-BFGS，秒级；**不需要 GPU** → 干净落在 #40「3D 仅离线预处理」一侧（部署侧本就无 GPU）。
- **License 可商用**：`FLAME_PyTorch`(MIT) + 自写优化器 + **FLAME 2023 Open**(CC-BY-4.0) 是唯一对「日后商用」开放的组合。MICA/DECA/EMOCA 的**代码**均为 MPI 非商用，研究 demo 可用、商用受阻。
- **透明可审计**：无黑盒编码器，确定性、可解释——对临床场景更稳妥。

> 深度方法的角色：**研究期**可用 MICA 从一张照片 seed 一个高质量中性身份（再用优化式细化），但**不进商用关键路径**。

## 5. 两种输入模式（都做，敏捷分期）

- **模式 A — 关键点拟合**：用 MediaPipe/FAN 关键点拟合 FLAME。需要一张 **landmark-embedding**（关键点 ↔ FLAME mesh 上的 `[tri,bary]`，一次性产物，类比张力线存法）。2D 单视有尺度/深度歧义；先做、易上手。
- **模式 B — 3D 扫描拟合**：稠密 scan-to-mesh 配准到 FLAME 拓扑，保真最高、可得度量尺度；需要干净扫描 + 少量 3D landmark 初始化。作为高精度后端。
- 二者输出都是**固定 FLAME 拓扑**，所以张力线 `[tri,u,v]` 迁移零额外步骤。

## 6. 部署形态（详见 #61 评论 + #40）

所有拟合**离线**跑（你的 HPC/本机；CPU 即可，连 GPU 都非必需）→ 导出「个体 FLAME 网格 + 迁移后的张力线」为**静态资产** → Vercel 静态前端只做渲染。**生产侧零后端、零 GPU**。日后若要 app 内即时拟合，最轻是 CPU 最小二乘塞进一个 serverless 函数（basis 留服务端，不下发浏览器）。

## 7. License 边界（硬约束）

- **不向公开仓库提交任何 FLAME 衍生资产**（即便 CC-BY-4.0 的 FLAME 2023 Open，再分发通常仍需逐用户在 MPI 注册）。用「按需下载到 gitignored `assets/flame/`」模式（见 `assets/flame/README.md`）。
- **商用路径**：仅用 **FLAME 2023 Open**(CC-BY-4.0) + **MIT** 封装 + 自写优化器。避开 MICA/DECA/EMOCA 的**非商用代码**与 FLAME texture model（CC-BY-NC-SA）。
- 临床/医疗用途可能需要 MPI 额外书面确认（`ps-license@tue.mpg.de`）。

## 8. 临床有效性前提（须验证，非阻断）

bary 迁移保证线条落在解剖对应位置、方向随曲面形变。但「张力线能否纯由几何形状从模板迁到个体」本身是**临床假设**，与 RSTL 出处弱、#2 校验未解同源。先按 `validated:false / 几何近似，须临床校验` 标注。

## 9. 敏捷 backlog 与进度

- **Sprint 0 ✅**：选型文档；`flame-2023` 拓扑常量；拓扑导出工具 `tools/export_flame_topology.py`（读 FLAME .pkl → topology + neutral 顶点 JSON，缺资产安全跳过）；license 边界（`.gitignore` + `assets/flame/README.md`）；合成 fixture 单测。
- **Sprint 1 ✅**：`web/topology_registry.js` + 3D 标注器「加载 FLAME 头模」（`import.meta.glob` 加载 dev-local FLAME 资产；缺失则入口隐藏、不影响构建）。
- **Sprint 2 ✅**：在 FLAME 上标注 → 导出 `topologyId:"flame-2023"` 独立图谱；「设为活动图谱并预览」（2D 实时入口）按拓扑闸到 mediapipe-468。
- **Sprint 3 ✅（模式 A 关键点）**：`langerface.flame` 纯 numpy 线性形状拟合（FLAME 线性基最小二乘 + 项目 Umeyama，CPU 离线，**无需 PyTorch/GPU**）；`tools/fit_flame_to_landmarks.py` 用官方 `mediapipe_landmark_embedding.npz`（105 点）把 FLAME 拟合到 MediaPipe 关键点 → 个体 FLAME。真模型实测：5023 顶点、105 关键点、残差 ~1.6mm。合成单测验证 β 恢复 + `transfer_points` 线随形变迁移。
- **Sprint 4 ✅（个体可视化·初版）**：标注器「加载个体 FLAME（拟合）」加载 `flame_fitted_vertices.json`，可视化拟合后的个体脸。
- **Sprint 5 ✅（#86 经典 RSTL 图谱→FLAME 草案注册）**：`tools/register_rstl_atlas_to_flame.py` 默认从本地 `RSTL/RSTL PRSgo.png` 经典正面图谱抽取 RSTL 线段，再使用 `web/api/flame_basis.npz` 中的 FLAME neutral、三角面与官方 MediaPipe embedding 注册为 gitignored `local_outputs/atlas_rstl_flame.json`（`topologyId:"flame-2023"`）。本地 `RSTL/` 经典图谱资料作为 provenance bundle 记录；输出仍为 `validated:false`，需要 #2 临床复核。
- **Sprint 6（剩余）**：把医生复核后的 flame-2023 标准线**渲染到个体脸上**（载入已存图谱 + 在个体网格 `transfer_points` 重心采样）；**模式 B 3D 扫描配准**后端；眼周放射线/贴面平滑验收 fixture；`snapToSurface` 空间索引（5023 顶点）。

## 10. 端到端怎么跑（本地，dev-only）

```bash
# 1) 资产就位（仅一次）：FLAME 2023 Open 放 assets/flame/flame2023_Open.pkl（见 §7）
# 2) 导出 FLAME 拓扑 + neutral 顶点（读 pkl 需 scipy）
python tools/export_flame_topology.py
# 2b) 从 RSTL/RSTL PRSgo.png 经典图谱抽线，生成 RSTL-on-FLAME 草案图谱
python tools/register_rstl_atlas_to_flame.py
# 3) 拟合到一组 MediaPipe 关键点（缺省用标准脸做自包含 demo）
python tools/fit_flame_to_landmarks.py [your_landmarks.json]
# 4) 前端：web/ 下 npm run dev → annotate 页
#    「加载 FLAME 头模」在标准头标注；「加载个体 FLAME（拟合）」看个体脸
```

集群上读 pkl 需 scipy：`module load scipy-stack`；若非交互 shell 里 module 不生效，用 venv + `pip install --no-index scipy`，并以 `PYTHONPATH=src` 运行。所有 FLAME 衍生产物（topology/neutral/fitted JSON）均 **gitignore，dev-local，不部署**。

## 来源（选型核实）

FLAME（model license / 2023 Open CC-BY-4.0）<https://flame.is.tue.mpg.de/modellicense.html> ·
MICA <https://github.com/Zielon/MICA>（LICENSE: MPI 非商用）·
DECA <https://github.com/yfeng95/DECA>（LICENSE: MPI 非商用）·
EMOCA <https://github.com/radekd91/emoca>（弃用；MPI 非商用）·
TF_FLAME <https://github.com/TimoBolkart/TF_FLAME> · flame-fitting <https://github.com/Rubikplayer/flame-fitting> · FLAME_PyTorch <https://github.com/soubhiksanyal/FLAME_PyTorch>（MIT）· FLAME-Universe <https://github.com/TimoBolkart/FLAME-Universe>。
