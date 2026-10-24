# 照片肿物候选与切口显示：审查和复现边界

本候选把照片输入后的异步肿物分割、切口消费端、风险显示和双端观察工具一起提交。分割结果仍是研究候选，浅色瘢痕漏识、部分边界完整性及专业安全距离尚未通过；不能作为自动手术指令。Refs #170、#172，不关闭这些事项。

## 实现和调用链

照片 / Worker → `detectControlledMarkerWithProfileAsync` → 同步颜色与多窗口候选 → `refineFilledCandidate` 原像素 GrabCut 复核 → 切口照片投影 → 风险显示。

默认族为 `small-lesion-boundary-candidate`，实现版本从 `controlled-marker-release.json` 回读。`current-v0.34` 和 `legacy-v0.23` 只显式选择；旧兼容别名不能代替实现版本。同步检测接口保留兼容，产品和 Worker 等待异步复核。OpenCV 加载失败不得被当成分割成功；测试和页面错误应保留。

手机病灶边界为 1.4 CSS px，切口为 0.8 CSS px，照片缩放不改变这两个屏幕线宽。中心点随照片缩放。普通模式隐藏开发说明，只有开发构建中显式 `developer=1` 才显示开发者界面。后台有限诊断记录与界面开关分别控制。

鼻孔禁区沿现有标准网格三角形投到照片，未缩小标准禁区；眼裂、口裂检查保留。投影缺失或退化时保留阻断。切口方向在病灶中心采样已有 RSTL 参考，不改变 RSTL 生成、检测、微调、密度、透明度或追踪。

## 环境与资源

从仓库锁文件安装依赖，在 `web` 运行 `npm ci`。OpenCV 使用已锁定的 `@techstark/opencv-js`；MediaPipe 模型与标准拓扑沿用 Base 中资源，本候选不迁移模型、不新增患者媒体。MediaPipe WASM 由 npm 依赖提供，不能依赖作者的 `node_modules` 缓存。

既有皱纹开发服务还需要其文档规定的 Python、NumPy、OpenCV、SciPy 和 PyTorch 环境及既有 checkpoint；本候选没有改变或重新授权这些资源。已有 checkpoint 的来源许可不由本 PR 重新认证。作者本机运行证据不能代替干净环境或另一成员复现。

规范入口：在 `web` 运行 `npm run verify:algorithm-release:dev`、`npm run dev:lesion-candidate`，或 `npm run build:lesion-candidate`。禁止用普通静态服务绕过运行身份；显式 profile 覆盖、缺少模型/WASM、源码指纹不符、恢复包漂移均应报告失败。

## 验证层次

1. `npm test`：现有交互、几何、诊断隐私及相关回归；不等于医学效果验收。
2. `node ../tools/test_controlled_marker_filled_candidate.ts` 及同族 scan/edge/recovered 测试：合成阳性、阴性和边界恢复。
3. `node ../tools/test_incision_mobile_overlay_scale.ts`、`test_workflow_photo_boundary_independence.ts`、`test_workflow_lesion_direction_anchor.ts`、`test_workflow_risk_candidate_display.ts`：显示、方向消费和门禁隔离。
4. `node ../tools/test_probe_marker_delivery.mjs`：错误身份、资源和超时负例。浏览器探针可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定已安装浏览器，不绑定作者安装路径。
5. `test_workflow_photo_opening_projection.ts <获准的本地几何证据JSON>` 需要含 `geometryProbe` 的授权证据；私人回放输入不公开，不声称仅克隆即可复现这些照片结果。相关患者回归脚本和原始证据保留在作者本地，不作为公开测试依赖。

最终 PR 应另附准确 Commit、测试结果、运行身份和未覆盖项。操作者评价仍 pending、编辑器保存确认仍 unknown；不可代签 PR 算法门禁，不以 Draft 或构建通过绕过它。

## 技术依据与限制

GrabCut 原始方法：Rother、Kolmogorov、Blake，SIGGRAPH 2004，DOI [10.1145/1015706.1015720](https://doi.org/10.1145/1015706.1015720)。实现接口见 [OpenCV GrabCut 文档](https://docs.opencv.org/4.x/d8/d83/tutorial_py_grabcut.html)。方法本身不证明本项目在发丝、弱对比或瘢痕上的完整性。手绘只作观察参考，不作临床金标准；跨落点一致也不等于边界正确。

可回滚方式为撤回本候选新增提交，保留既有 Base 和本地恢复包；没有数据库迁移或远端部署动作。历史提交的运行门禁、隐私元数据和诊断轮廓修复也包含在审查范围，不能只审最后一个提交。
