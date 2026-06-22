# M0 实施计划：打通「标注 → 实时」app 内闭环

- **关联**：Epic [#33](https://github.com/jwj1342/LangerFace/issues/33)、[#48](https://github.com/jwj1342/LangerFace/issues/48)（数据源抽象层）、[#29](https://github.com/jwj1342/LangerFace/issues/29)（标注器复核）
- **架构依据**：[BACKEND_DATA_ARCHITECTURE.md](../BACKEND_DATA_ARCHITECTURE.md)「前端数据源抽象」、「分阶段落地」
- **范围**：Epic #33 的 **M0 里程碑**（最小闭环）。**不碰 D1 / 后端**（Phase 1），**不发布**、不写盘。
- **状态**：合约层已落地并通过 CI；UI 接线为待完成任务（见下）。

> 本文档是**交接说明**：基于对 master 当前代码的逐文件核实（真实行号），把 M0 拆成可独立认领的任务。每条任务标注**改哪个文件、锚点、改什么、依赖、风险**。

---

## 1. 目标（一句话）

医生在标注器（`annotate.html`，标准脸网格）画完一条线，点**「设为活动图谱并预览」**，**一次点击即跳到实时视图、该线立刻贴到活体/视频人脸上** —— 全程**无下载文件、无手放 assets、无 rebuild**。

## 2. 为什么不用 D1（关键认知）

「标注→实时」是**纯浏览器内的运行时缝**，不是数据库缝：医生画的线（`toAtlasJSON()` 产出）与脸上的线（`mapAtlas()` 消费）**同源、同浏览器、格式同构**，中间一个网络往返都不需要。Cloudflare D1/Worker 解决的是**持久化与多人协作**（Phase 1，触发条件是「多用户在线持久化」），与本闭环正交，且**即便接了 D1，前端注入接收侧照样要写**。因此：

- **本闭环 = 浏览器内闭环（M0/Phase 0），0 后端。**
- 按文档「现在就低成本埋 `web/data_source.js`」：闭环走 `LocalDataSource` 接口，**将来 Phase 1 换 `ApiDataSource` 时 UI 一行不改**，顺带还 #48 的债。
- ⚠️ **不要把「预览」变成「发布」**：注入图谱恒 `validated:false`、用完即清；写进 D1 是带 provenance 的发布动作，必须走 #2 的临床校验闸，**不在本闭环内**。

## 3. 已落地（本 PR 的合约层，CI 绿）

这部分是**接口/安全/验收契约**，已实现并测试，作为后续 UI 接线的稳固地基：

| 文件 | 内容 |
|---|---|
| `web/data_source.js`（新） | 前端数据源抽象。`LocalDataSource.stagePreviewAtlas(atlas)` / `takePreviewAtlas()`，内部用 sessionStorage（同源、随导航存活、关标签即清）。导出单例 `dataSource`；Phase 1 在此一行换 `ApiDataSource`。零 import、node 安全。 |
| `web/geometry.js` | 新增 `validateAtlasLines(lines, triangles)`（注入前最小边界校验）；`mapAtlas` 加防御性护栏（`lines` 非数组直接返回、越界三角面/缺关键点跳过该点而非崩溃）。**happy path 与 Python 对拍逐点不变**（已验证 5e-5）。 |
| `tools/test_atlas_roundtrip.mjs`（新） | 闭环数据保真对拍：`toAtlasJSON() → mapAtlas()` 逐点还原原始 xyz（误差 4.44e-16），并覆盖 `validateAtlasLines` 边界与 `mapAtlas` 坏数据降级。已接入 `npm test`。 |

**说明**：`data_source.js` 目前还没有消费者（接线任务会 import 它），这是**有意把缝预埋在消费者之前**，不是死代码。

## 4. 待完成任务（交接给实现者，按依赖顺序）

> 所有锚点基于 master 当前文件核实。若 PR #24 先合并，`annotate_*.js` / `package.json` 行号会漂移，**按符号重新定位**（见 §6 冲突）。

### T1 ·〔接收端〕`setActiveAtlas` + `restoreOfficialAtlas` `[S]`
- **文件**：`web/pipeline.js`
- **锚点**：`ensureReady()` 结束后（约 line 62，`detectHands` 之前）；并在 `ensureReady` 写 atlas 处（line 24）补一份官方快照。
- **改什么**：
  1. line 24 旁加 `modelState.officialAtlases.rstl = rstl.lines; modelState.officialAtlases.langer = langer.lines;`（需在 `state.js` 给 `modelState` 加 `officialAtlases: {}`）。
  2. 新增 `export function setActiveAtlas(system, lines)`：先 `validateAtlasLines(lines, modelState.triangles)`（已在 geometry.js），失败 `logWarn` 并 `return false`；通过则 `modelState.atlases[system] = lines`（**先写 atlas**）、再 `renderState.system = system`（镜像 `main.js:18`）；若 `sourceState.running && !sourceState.paused` 则 `requestAnimationFrame(loop)`。从 `./geometry.js` import `validateAtlasLines`。
  3. 新增 `export function restoreOfficialAtlas(system)`：把 `modelState.officialAtlases[system]` 写回 `modelState.atlases[system]`。
- **依赖**：无（`validateAtlasLines` 已就绪）。
- **风险**：**先写 atlas 再切 system**，否则 `render.js:15` 读到 undefined → `mapAtlas` 抛错。覆盖式预览：原图谱靠 `officialAtlases` 快照恢复。

### T2 ·〔护栏〕渲染循环 try/catch `[S]`
- **文件**：`web/pipeline.js`，`loop()` 内 line 157：`const dlm = projectVerts(lm); lineCount = draw(dlm, W, H, hulls); drawZooms(dlm, W);`
- **改什么**：把 `draw/drawZooms` 包进 try/catch，catch 里 `logWarn(...)` 后继续（line 164 的 `requestAnimationFrame(loop)` 仍要执行）。
- **风险**：**这是 M0 最高单点风险** —— 当前 loop 无 try/catch，注入图谱一旦抛错，rAF 永久停摆→黑屏。catch 要窄（只包 draw），且避免每帧刷日志。

### T3 ·〔发送端〕标注器「设为活动图谱并预览」按钮 `[M]`
- **文件**：`web/annotate.html` + `web/annotate_main.js`
- **锚点**：
  - `annotate.html`：导出 btn-row（line 58–61，含 `#btnExportAtlas`/`#btnExportXyz`）之后、`#btnClear`（line 62）之前，加 `<button class="btn btn-primary" id="btnSetActiveAtlas" disabled>设为活动图谱并预览</button>`。
  - `annotate_main.js`：`import { dataSource } from "./data_source.js";`；els 映射（line 8–15）加 `setActive: $("btnSetActiveAtlas")`；line 95 旁绑定 onclick → `model.toAtlasJSON({ provenance: "web-annotator-live" })`（复用 try/catch+`setHint` 失败提示，**不要调 `exportJSON`**，它会触发下载）→ `dataSource.stagePreviewAtlas(atlas)` → `location.href = "index.html"`；`refresh()` line 215 旁加 `els.setActive.disabled = !(model.lines.length && onCanonical)`（与导出图谱按钮**同款门控**）。
- **依赖**：T1（接收端必须先在）。
- **风险**：标注器与实时端是**两个独立 Vite 入口**，无共享 JS 内存，必须经 `dataSource`（sessionStorage）跨页；仅 canonical 标准脸可注入（自定义头模无 tri/bary，门控已挡）。

### T4 ·〔跨页接收〕index 启动时注入 `[M]`
- **文件**：`web/main.js`
- **锚点**：import line 5/8 扩展（加 `setActiveAtlas, restoreOfficialAtlas`、`setProvenance, setMsg`、`dataSource`）；末行 line 66 `ensureReady().catch(...)` 改为 `ensureReady().then(applyStagedAtlas).catch(...)`。
- **改什么**：`applyStagedAtlas()`：`const atlas = dataSource.takePreviewAtlas()`；无/非数组 lines 直接 return；`setActiveAtlas(atlas.system, atlas.lines)` 失败则 `setMsg(...)` return；成功则 `els.tmpl.value = atlas.system`（下拉与活动图谱同步，否则注入 langer 却停在 rstl 会「画了不显示」）、`setProvenance({source:"标注会话", validated:atlas.validated, count:atlas.lines.length})`、显示恢复按钮；若无 source 运行，`setMsg("已载入标注预览图谱（未验证）。开启摄像头或上传照片即可在脸上查看。")`。
- **依赖**：T1、T5（badge 元素 + `setProvenance`）。
- **风险**：**必须挂在 `ensureReady` 的 `.then`**（`modelState.atlases` 在 `pipeline.js:24` 前是 `{}`）；必须传 `atlas.lines`（数组）不是整个对象；`takePreviewAtlas` 解析失败要降级为「加载内置图谱」不崩溃（`data_source.js` 已 try/catch）。

### T5 ·〔出处 badge〕来源标签 `[S]`
- **文件**：`web/index.html` + `web/dom.js` + `web/ui.js`
- **改什么**：`index.html` 模板卡（`#templateSel` 那张，line 57–77）内加 `<div id="atlasProvenance" class="hint hidden">` 与 `<button class="btn hidden" id="restoreAtlasBtn">恢复官方图谱</button>`；`dom.js` els 加 `prov: $("atlasProvenance"), restoreAtlas: $("restoreAtlasBtn")`；`ui.js` 加 `export function setProvenance(meta)`：meta 为空则隐藏，否则显示「活动图谱：标注会话 · 未验证（仅预览）· N 条线」。
- **风险**：**N 取自注入图谱的线数，不是 `statLines`（线束渲染计数）**；**不要借用会误导的内置 version 号**。

### T6 ·〔恢复〕一键切回官方图谱 `[S]`
- **文件**：`web/main.js`
- **改什么**：绑定 `els.restoreAtlas.onclick` → `restoreOfficialAtlas(previewSystem)`、`setProvenance(null)`、`setMsg(null)`、隐藏自身。`previewSystem` 用模块级 `let` 在 T4 注入时记录。
- **依赖**：T1、T4、T5。

### T7 ·〔副作用界定〕mode3d 共享状态注释 `[S]`
- **文件**：`web/mode3d.js`，`buildViewer()` line 41（`modelState.atlases[renderState.system]`）。
- **改什么**：加注释说明 `setActiveAtlas` 改的是**共享** `modelState.atlases`，注入会流入 3D 头模，但**仅在下次 `buildViewer` 调用时**（非每帧）；M0 为 2D 范围，**注释即可**，不主动重建 3D viewer。

### T8 ·〔验收〕手动集成核查 `[S]`
- 摄像头开 → 打开标注器 → 画一条 canonical 线 → 点「设为活动图谱并预览」→ 跳回实时、线立刻贴脸；无下载、无 rebuild；注入 langer 时实时端自动切 langer；坏图谱不黑屏；可一键恢复官方图谱；badge 显示「未验证」。
- **测试覆盖缺口**（需在 PR 说明）：`toAtlasJSON → mapAtlas` 已由 `test_atlas_roundtrip.mjs` 守住；但 `setActiveAtlas` + 重绘这段**导入 `@mediapipe`，无法 node 单测**，只能手动/集成核查。

## 5. 验收标准（来自 Epic #33 §6）

1. canonical 画线 → 一次点击 → 实时脸上立刻显示，无文件交接。
2. 注入空/越界/无 tri 图谱不黑屏（被校验拦下）；注入 langer 自动切 langer。
3. 可一键恢复官方 rstl/langer，不刷新页面。
4. badge 显示「来源=标注会话 · validated:false · N 条」，不借用误导 version。
5. `test_atlas_roundtrip.mjs` 通过，守住 `toAtlasJSON → mapAtlas` 一致。

## 6. 与 PR #24 的冲突 & 合并顺序

PR #24（`codex/annotation-web-mesh-curve-import`）改动 `annotate_main.js`(+63/-11)、`annotate.html`、`package.json` 等，与本 PR 的 T3/测试接线**重叠**：

- **硬冲突**：`web/package.json` 的 `test` 单行 —— #24 追加 `test_mesh_io.mjs`/`test_slicer_curve.mjs`，本 PR 追加 `test_atlas_roundtrip.mjs`。
- **建议顺序**：**先合 #24 → 本 PR rebase**，把三个测试合到一条 `&&` 链；T3 的 `annotate_main.js` 锚点改**按符号定位**（`els.exAtlas.onclick`、`refresh` 里的 `els.exAtlas.disabled`），不要按绝对行号。

## 7. 不做（YAGNI，对齐会议「2D 优先、先打通、别过度优化」）

- ❌ D1 / Worker / R2 / `ApiDataSource`（Phase 1，触发条件未到）。
- ❌ 图谱写盘持久化 / 替代 `export_web_assets.py`（本闭环只内存注入，不发布）。
- ❌ 强 `validated` 门控（全图谱 `validated:false`，强门控会黑屏；本轮只加出处标签，门控延后 #2）。
- ❌ 非 canonical 载体 / `locate_3d` / 方向场迁移（Epic #33 M2，默认推迟）。
- ❌ 迁移质量度量（G5，独立后续 epic）。
