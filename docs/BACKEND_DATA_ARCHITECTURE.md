# 后端与数据层架构

- **状态**：Accepted
- **日期**：2026-06-22
- **决策者**：项目组
- **相关**：issue #2（临床校验图谱）、issue #11-#22（Stage 2 肿物与切口设计）、[ARCHITECTURE.md](ARCHITECTURE.md#12-网页-3d-线标注与图谱草案导出)、[ARCHITECTURE.md](ARCHITECTURE.md#13-headspace--facescape-离线数据与配准管线)、[ARCHITECTURE.md](ARCHITECTURE.md#14-stage-2-肿物与切口设计技术路线)

## 背景

前端正在变大（实时叠加 → 3D 网页标注 → 将来切口设计），并开始出现**需要持久化与多用户协作**的运行时数据：

- **头模资产**：HeadSpace 等 3D 头模（大、二进制、**受许可、含生物特征**）。
- **标注产物**：医生在网页上画的 RSTL/Langer 线（结构化、可变、需评审/校验）。
- **Stage 2 术前规划记录**：肿物输入、候选切口、风险提示、医生编辑与审阅 provenance。
- **重计算**：Sim3 配准、网格求交、MediaPipe 检测、Blender 渲染、未来肿物模拟。

当前是纯静态前端（Vercel）+ 离线 `langerface` 包 + 本地 gitignore 的大数据，**没有运行时数据层与 API 边界**。目标是在**接近零成本**的前提下，把"代码 / 结构化状态 / 大二进制 / 受限数据 / 重计算"分开。

## 决策（方案甲）

**前端留在 Vercel（静态）+ Cloudflare Worker 瘦 API + D1（结构化数据）+ R2（大/受限二进制）+ 重计算留离线/HPC。**

```
前端 (Vercel, 静态)                Cloudflare Worker (瘦 API, TS)              数据层
────────────────────              ─────────────────────────────              ─────────────────────────
实时叠加 / 3D 标注 / 切口     →    /api/heads · /api/annotations · 鉴权   →    D1   : 标注 / 肿物 / 候选 / provenance
只做交互与渲染                     /api/cases · /api/tumors · /api/incisions  R2   : 头模 / 纹理 / 重建(签名URL)
经 API + 签名URL 取数据            ❌ 不放重计算                               ↑ 受限数据：私有桶 + Worker 鉴权

重计算 (langerface: 配准/重建/渲染)  →  本地 / HPC 离线批处理  →  产物上传 R2，元数据登记 D1
```

## 计算边界（为什么重计算不上 Workers）

Cloudflare Workers 是 V8 隔离 /（Python 版）Pyodide-WASM 运行时，**不是普通 Python 环境**：免费档单请求 CPU ≈ 10ms、内存 128MB、无原生二进制、无持久文件系统。`numpy` 在 Pyodide 里有，但 **`opencv` / `mediapipe` / `trimesh` / Blender 没有也跑不起来**。

因此计算按三处切分：
| 计算 | 放哪 |
|---|---|
| 关键点检测、3D 标注交互 | **浏览器**（MediaPipe wasm + Three.js，已实现） |
| Sim3 配准 / 重建 / 渲染 / 肿物模拟 | **离线 / HPC**（`langerface` 包，已实现） |
| 存取标注、托管/鉴权头模、状态流转 | **Worker（瘦 API）** |

> 结论：Workers + D1 + R2 服务的是**数据与状态**，不是重计算。当前需求恰好落在它们的甜点区。

## 重计算边界（明确约束）

本文中的**重计算**指：不能作为一次普通在线 API 请求稳定完成、且依赖原生 Python/图像/网格/视频工具链的计算。它通常具有以下特征之一：运行时间长、输入/输出文件大、需要本地文件系统、需要 OpenCV / MediaPipe / trimesh / Blender / ffmpeg 等原生依赖、需要 HPC/GPU/批处理调度，或处理受限/生物特征数据。

归入重计算的内容包括：

| 任务 | 原因 | 放置位置 |
|---|---|---|
| 视频逐帧 MediaPipe 检测 | 帧数多、CPU/GPU 时间不可控，依赖 MediaPipe 原生/wasm 运行时 | 浏览器交互或离线/HPC 批处理 |
| 个性化 3D 头模重建 | 多帧对齐、Sim3/Umeyama、逐顶点融合，可能处理真实人脸视频 | 本地 / HPC |
| HeadSpace 多视角管线 | 相机模型、射线-网格求交、多视角融合、局部残差修正 | 本地 / HPC |
| 网格投影、纹理、重采样、批量资产导出 | 大对象和几何处理，不适合短请求 Worker | 本地 / HPC |
| OpenCV / ffmpeg / Blender 渲染 | 原生二进制、长任务、文件系统依赖 | 本地 / HPC |
| Stage 2 肿物模拟 / 切口候选优化 | 一旦涉及约束优化、批量评估或复杂几何，即视为重计算 | 先放本地 / HPC，另开设计文档决定是否在线化 |

不归入重计算、可以放在 Worker 的内容包括：

| 任务 | 说明 |
|---|---|
| 标注 / 头模 / 用户 / 校验状态 CRUD | D1 结构化数据读写 |
| atlas JSON 轻量校验 | 只做 schema、字段、点数、状态流转检查；不做几何重建 |
| R2 签名 URL 生成 | Worker 鉴权后返回短期访问 URL |
| 已有标注导出为 `atlas.json` | 从 D1 读出线和点，重组 JSON；不重新计算几何 |
| 肿物与切口候选记录 | 保存医生输入、候选几何、警告、覆盖原因和审阅状态 |
| 作业状态记录 | 只记录 `queued/running/succeeded/failed` 等状态，不在 Worker 内执行作业 |

推荐作业流如下：

```
本地 / HPC runner
  读取本地数据或 R2 受限输入
  运行 langerface / tools/headspace / Blender / ffmpeg
  产出 mesh / texture / recon JSON / overlay video / validated atlas
  上传大文件到 R2
  写入 D1 元数据与 provenance

Worker
  只负责鉴权、状态、元数据、签名 URL
  不同步执行重建、配准、渲染或优化

前端
  通过 Worker 获取元数据和签名 URL
  加载产物做查看、标注、复核和导出
```

如果未来确实需要从网页触发计算，Worker 也只应创建作业记录、校验权限、返回作业 id；实际 runner 由本地/HPC/单独 Python 服务轮询或接收任务执行。引入在线 Python 计算服务（Fly/Render/VM/HPC 调度器等）必须另开设计文档，单独评估运行时、成本、隐私、合规、队列与失败恢复。

## 数据分层

| 数据 | 性质 | 存放 |
|---|---|---|
| 标准脸、三角拓扑、`.task`、示例 atlas | 小、参考、可公开 | **仓库 / 前端静态资产** |
| 标注线（`[tri,u,v]`/xyz + 作者/时间/校验状态/provenance） | 结构化、可变、多用户 | **D1** |
| 临床规则库（区域、RSTL、皱襞、亚单位、敏感结构） | 结构化、版本化、需医生审核 | **仓库 draft / D1 validated copy** |
| 肿物输入与切口候选 | 结构化、含病例上下文、需审计 | **D1（不含原始影像）** |
| HeadSpace 头模、纹理、重建网格 | 大、二进制、**受许可/生物特征** | **R2（私有桶 + Worker 鉴权 + 签名 URL）** |
| 患者照片、视频、3D 纹理、超声资料 | 敏感个人信息 / 医疗资料 | **默认不入公开仓库；仅本地、医院环境或受控 R2** |

## D1 表结构（SQLite DDL）

线的"点序列"作为 JSON 存在 `annotation_lines.points_json`（规整到"线"粒度即可，点不拆表，契合 D1）。

```sql
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  handle      TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role        TEXT NOT NULL DEFAULT 'annotator',   -- annotator | clinician | admin
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE head_models (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  source       TEXT NOT NULL,            -- canonical | headspace | reconstruction
  topology     TEXT NOT NULL,            -- canonical_468 | dense
  r2_key       TEXT,                     -- 对象存储键；canonical 可为空（前端静态自带）
  vertex_count INTEGER,
  tri_count    INTEGER,
  license      TEXT NOT NULL DEFAULT 'restricted',  -- public | restricted
  is_public    INTEGER NOT NULL DEFAULT 0,          -- 0/1
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE annotations (
  id            INTEGER PRIMARY KEY,
  head_model_id INTEGER NOT NULL REFERENCES head_models(id),
  system        TEXT NOT NULL,           -- rstl | langer
  author_id     INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'draft',   -- draft | submitted | validated
  validated_by  INTEGER REFERENCES users(id),
  validated_at  TEXT,
  provenance    TEXT,
  version       TEXT NOT NULL DEFAULT '0.1',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE annotation_lines (
  id            INTEGER PRIMARY KEY,
  annotation_id INTEGER NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  region        TEXT,
  ordinal       INTEGER NOT NULL DEFAULT 0,
  -- canonical 拓扑：[[tri,u,v],...]；自定义头模：[[x,y,z],...]
  points_json   TEXT NOT NULL
);

CREATE INDEX idx_ann_head_system ON annotations(head_model_id, system);
CREATE INDEX idx_ann_status      ON annotations(status);
CREATE INDEX idx_lines_ann       ON annotation_lines(annotation_id);
```

> 在标准脸（`topology=canonical_468`）上的已校验 annotation，可一键序列化为 `langerface` 图谱格式
> （`{system, version, provenance, validated, lines:[{name,region,points:[[tri,u,v]...]}]}`），
> 直接替换 `assets/atlas_*.json` —— 即 issue #2 的闭环。

### Stage 2 表结构扩展（草图）

肿物与切口候选属于术前规划记录。D1 只保存结构化元数据和几何，不默认保存原始照片、视频、纹理或超声文件；这些敏感资料如确需在线访问，应走私有 R2 + Worker 鉴权 + 审计。

```sql
CREATE TABLE cases (
  id            INTEGER PRIMARY KEY,
  case_code     TEXT NOT NULL UNIQUE,       -- 脱敏病例编号，不是姓名/病历号
  head_model_id INTEGER REFERENCES head_models(id),
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | reviewed | archived
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tumors (
  id             INTEGER PRIMARY KEY,
  case_id        INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  tumor_type     TEXT NOT NULL,       -- subcutaneous | cutaneous
  region         TEXT,
  center_json    TEXT NOT NULL,       -- 2D/3D 坐标 + 坐标系 + 单位
  boundary_json  TEXT,                -- 皮表肿物轮廓，可为空
  diameter_mm    REAL,
  depth_mm       REAL,
  margin_mm      REAL,
  source         TEXT NOT NULL,       -- manual | ultrasound | imported
  provenance     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE incision_candidates (
  id              INTEGER PRIMARY KEY,
  tumor_id        INTEGER NOT NULL REFERENCES tumors(id) ON DELETE CASCADE,
  candidate_type  TEXT NOT NULL,      -- linear | fusiform
  geometry_json   TEXT NOT NULL,      -- 端点/曲线/轴线/指标
  rule_trace_json TEXT NOT NULL,      -- RSTL/皱襞/亚单位/敏感结构命中
  warnings_json   TEXT,
  status          TEXT NOT NULL DEFAULT 'generated', -- generated | edited | accepted | rejected
  edited_by       INTEGER REFERENCES users(id),
  review_note     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Worker API 草图（REST，TS）

| 方法 & 路径 | 作用 |
|---|---|
| `GET /api/heads` | 列出头模（公开的匿名可见；受限的需鉴权） |
| `GET /api/heads/:id/url` | 返回 R2 **短期签名 URL**（受限头模先校验权限） |
| `POST /api/heads` | （admin）登记一个已上传到 R2 的头模 |
| `GET /api/annotations?head=:id&system=rstl` | 列表 |
| `GET /api/annotations/:id` | 取完整标注（含各线 points_json） |
| `POST /api/annotations` | 新建（body = 网页标注导出的 atlas/xyz JSON） |
| `PUT /api/annotations/:id` | 更新 |
| `POST /api/annotations/:id/validate` | （clinician）置 `validated` + 记录校验者/时间 |
| `GET /api/annotations/:id/atlas.json` | 导出 `langerface` 图谱格式 |
| `POST /api/cases` | （clinician/researcher）创建脱敏病例工作区 |
| `POST /api/tumors` | 保存肿物输入（中心、边界、直径、切缘、来源） |
| `POST /api/incision-candidates` | 保存候选切口、规则 trace、警告与医生编辑 |
| `POST /api/incision-candidates/:id/review` | 医生接受 / 拒绝 / 备注 / 覆盖原因 |

- **鉴权**：优先 **Cloudflare Access（Zero-Trust）** 套在 Worker 前；或简单 Bearer Token。受限 R2 资源只经 Worker 校验后发签名 URL，**桶绝不公开**。
- **CORS**：Vercel 前端跨域调用 Worker，需在 Worker 配置允许来源。

## R2 布局与访问控制

```
bucket: langerface-assets   (私有)
  heads/<source>/<id>.json        # {vertices:[[x,y,z]...], triangles:[[a,b,c]...]}
  heads/<source>/<id>.ply         # 可选原始网格
  textures/<source>/<id>.png
  reconstructions/<subject>/<...> # langerface 离线产物
```
- 受限/生物特征数据：**私有桶**，仅经 Worker 鉴权后发短期签名 URL；记录访问审计。
- 公开小资产（标准脸/示例 atlas）继续走前端静态，不进 R2。

## 前端数据源抽象（本地接口已落地，远端实现待 Phase 1）

目标形态：UI 不直接 `fetch("assets/...")` 或下载文件，统一通过数据源接口取存数据。React SPA 的真实实现位于
`web/src/services/dataSource.ts`；后端到位时**只换 service 实现、不改 UI**。当前本地接口为：

```js
// 已落地：listHeads() · getHeadMesh(id) · loadTopology(id) · loadAtlas(system)
//        saveAnnotation(payload) · listAnnotations(q)
//        stagePreviewAtlas(atlas) · takePreviewAtlas()
//        stageIncisionOverlay(overlay) · loadIncisionOverlay() · clearIncisionOverlay()
// Stage 2：saveTumor(payload) · generateLocalCandidate(input) · saveIncisionCandidate(payload)
// 今天：LocalDataSource —— 纯前端实现（无后端）
// 将来：ApiDataSource   —— 调用上面的 Worker API（仅切换实现，UI 不变）
```

**当前落地状态（Phase 0，本节更新）**：`web/src/services/dataSource.ts` 已实现 React SPA 使用的本地 `LocalDataSource`。
实时 pipeline、3D 重建参考、3D 标注标准脸 fallback、R3F 切除闭合演示等主路径读取标准头、拓扑和内置 atlas 时，
统一调用 `dataSource.loadTopology()` / `dataSource.loadAtlas()` / `dataSource.getHeadMesh()`；标注草稿通过
`saveAnnotation()` / `listAnnotations()` 存在 localStorage；跨页预览和切口 overlay 仍使用 sessionStorage 的一次性桥。

`web/src/services/assetLoader.ts` 仍是 URL / 懒加载 / `assetBase` / `VITE_LANGERFACE_ASSET_BASE_URL` 的单一真源；
`LocalDataSource` 复用 `loadJsonAsset()`，不复制资产 URL 字面量。保留的直接 `fetch` 只用于非数据源边界，例如
`/api/fit` 云函数调用、MediaPipe task URL 传递和 FLAME dev-local 动态 URL。

## 离线重计算

`langerface` 的配准/重建/渲染继续在**本地/HPC**批处理；产物（网格、recon JSON）上传 R2、元数据登记 D1。**不**作为在线 Worker 端点。若将来确需在线重计算，再单独引入能跑 Python 原生的服务（Fly/Render/VM/HPC），届时另开设计文档。

## 后果

**优点**
- 接近 **$0**：D1（GB 级 + 充足读写）、R2（~10GB + **出口免费**）、Workers（~10 万请求/天）对研究级流量实际免费。
- 数据/逻辑彻底分层；受限数据进私有受控存储，符合许可与隐私方向。
- 复用现有成果：`langerface` 仍是离线"计算大脑"；前端保留 Vercel 的 PR 预览。

**代价 / 取舍**
- 语言分裂：API 层 TS（Worker），重计算 Python（langerface）—— 可接受、常见。
- Workers 不能承载重计算（已由"浏览器 + 离线/HPC"覆盖）。
- 两个供应商（Vercel + Cloudflare）+ 跨域 CORS。
- 免费档不含医疗合规认证（HIPAA 等）；真患者数据级别需另行评估。

## 备选方案（已考虑）

- **方案乙（全 Cloudflare）**：前端也迁到 Cloudflare Pages，少一个供应商、一套鉴权。**暂不采用**：避免迁移正常工作的 Vercel 前端；保留为将来选项。
- **FastAPI(包 langerface) 上 VM/Fly/Render**：仅当需要"在线重计算"时才需要；现阶段离线已满足，推迟。
- **Vercel Serverless Functions + Vercel Postgres/Blob**：可行，但计算/出口限制与成本不如 Cloudflare 的数据形态划算。

## 分阶段落地与触发条件

- **Phase 0（现在）**：静态 Vercel + 网页标注**下载 JSON** → 评审 → 提交进仓库（issue #2 单图谱闭环，无需后端）。`web/src/services/dataSource.ts` 已落地 `LocalDataSource`，覆盖标准头 / 拓扑 / atlas 读取、localStorage 标注草稿、sessionStorage 跨页预览与切口 overlay；后端到位时增加同接口的 `ApiDataSource`。
- **Phase 1（触发：多用户在线标注持久化 / 在线服务受限头模）**：起 Worker + D1 + R2，实现 `ApiDataSource`；落地步骤、GitHub Actions 接入、Cloudflare token 权限和验收清单见 [CLOUDFLARE_BACKEND_ROLLOUT.md](CLOUDFLARE_BACKEND_ROLLOUT.md)。
- **Phase 2（触发：需要在线重计算）**：单独 Python 服务（另开设计文档）。
