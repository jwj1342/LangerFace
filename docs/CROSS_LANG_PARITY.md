# 跨语言一致性（Python ⇄ Web TypeScript ⇄ 金标）

本文定义线条几何在 Python 与 Web TypeScript 两套实现间的**逐点等价不变式**、活体对拍机制，以及金标的一键重生成流程，
确保单边改动不会静默漂移过 CI。配合 [ARCHITECTURE.md](ARCHITECTURE.md)（几何算法）阅读。

## 不变式

线条几何在两套实现里必须逐点等价：

- **Python**（生产）：`langerface.lines.map_atlas` + `langerface.rendering.BackfaceCuller`
  + `langerface.detection.LandmarkSmoother`
- **Web TypeScript**（生产 / 浏览器）：`web/src/services/geometryAtlas.ts` 的 `mapAtlas` / `visibleTriangles`
  / `innerMouthTriangles` / `OneEuro`
- **金标**：`web/test/expected.json`（在若干真实帧上冻结的输入关键点 + 期望输出）

不变式：

```
Python(landmarks) == Web TypeScript(landmarks) == golden
```

具体到三个量：

1. **pts** —— 图谱分片仿射映射结果，`np.round(..., 4)`。三方在 `1e-2 px` 内一致。
2. **vis** —— 背面剔除 **且** 排除 #38 口裂（内唇）三角面后的逐三角面可见性。三方**逐位精确**相等。
3. **oneEuro** —— 一段确定性输入序列经 One-Euro 平滑的逐位输出（紧公差 `1e-12`）。

## 谁断言什么

| 断言方 | 文件 | 覆盖 |
|---|---|---|
| Python（live） | `tests/test_cross_lang_parity.py` | 从金标嵌入的关键点重算 pts/vis，断言匹配金标；One-Euro 夹具匹配 |
| Web TypeScript（对拍） | `tools/test_web_mapping.mjs`（`npm test` 内） | `web/src/services/geometryAtlas.ts` 输出对金标 pts/vis；One-Euro 夹具匹配 |

CI 现状（**无需改 `.github/workflows/ci.yml`**）：

- `pytest` 已自动收集并运行 `tests/test_cross_lang_parity.py`（live Python 侧）。
- `npm test` 已运行 `tools/test_web_mapping.mjs`（Web TypeScript 侧）。

历史缺口（#28）：CI 从不重跑 Python 生成金标，且旧 `.mjs` 的对拍路径**没有**应用口裂掩膜，
于是单边的 Python 改动（如 #38 排除口裂三角面）会从 CI 旁漏过去、让金标静默漂移。
现已通过「live Python 重算 + Web TypeScript 对拍应用同一口裂掩膜」双向闭合。

## 一键复现金标（非私有，无 mediapipe / 无私有素材）

金标里**已嵌入**每帧的关键点（`frames[].landmarks`，已 `round(6)`）。常规更新走**纯重算路径**，
只读这些嵌入关键点 + `assets/atlas_rstl.json` + 标准模型三角拓扑，不碰 mediapipe / cv2 / 私有视频：

```bash
PYTHONPATH=src python3 tools/dump_landmarks.py --regen
```

它重算每帧 `lines[].pts` / `lines[].vis`（含 #38 口裂排除，与生产渲染一致）并刷新
`oneEuro` 夹具，写回 `web/test/expected.json`。该路径在 CI 与本地均可复现。

## 何时、如何更新金标

- **生产数学合法变更后**（改了映射、背面剔除、口裂集合、One-Euro 常量等）：

  ```bash
  PYTHONPATH=src python3 tools/dump_landmarks.py --regen
  git diff web/test/expected.json     # 人工核对：差异应只来自你的改动
  ```

  随后跑全部门禁（`ruff` / `pytest` / `npm run build` / `npm test`）确认三方仍一致。

- **需要换帧 / 换关键点来源**（罕见，需本机 mediapipe + cv2 + 私有素材 `local_media/`）：

  ```bash
  PYTHONPATH=src python3 tools/dump_landmarks.py     # 重新抽帧检测，再嵌入新关键点
  ```

  该来源路径只负责产出 `frames[].landmarks`；CI 不跑、也不应依赖私有素材。

> 注：金标只存 `round(6)` 关键点，纯重算的 pts 相对历史值可能有 `≤1 ULP`（`1e-4`）的
> 末位舍入抖动——这是嵌入关键点精度所致，属预期，不代表重算路径有误。
