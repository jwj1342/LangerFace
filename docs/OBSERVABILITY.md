# 可观测性与诊断事件

本文对应 GitHub issue [#51](https://github.com/jwj1342/LangerFace/issues/51)，定义运行时诊断的最小字段约定。目标是帮助本地调试、PR 验收和多人评审复现问题，不收集图像像素或患者身份信息。

## 诊断快照

浏览器端可在控制台调用：

```js
window.exportLangerfaceDiagnostics()
```

返回 JSON 字符串，结构如下：

```json
{
  "schemaVersion": "0.1",
  "startedAt": "2026-06-24T00:00:00.000Z",
  "exportedAt": "2026-06-24T00:01:00.000Z",
  "assetVersions": {},
  "counters": {},
  "metrics": {},
  "sections": {},
  "events": []
}
```

该快照只允许包含结构化事件、计数器、阶段耗时、fps、失败原因、脱敏 QA 摘要和资产版本；不得包含 canvas 像素、视频帧、人脸纹理、landmark 坐标、病例号或其他身份信息。

## 事件字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `t` | ISO datetime | 事件产生时间 |
| `level` | string | `info` / `warn` / `error` |
| `event` | string | 稳定事件名，例如 `scan.finished` |
| `message` | string | 与 `event` 同步保留，兼容旧调试习惯 |
| `detail.phase` | string | 阶段名，例如 `assets` / `frame` / `scan` |
| `detail.durationMs` | number | 阶段耗时，毫秒 |
| `detail.reason` | string | 失败原因枚举 |
| `detail.assetVersions` | object | 本次事件相关资产版本 |

## 计数器

计数器使用点分命名，适合累计失败次数：

- `camera.openFailure.permission_denied`
- `scan.cameraOpenFailure.not_found`
- `faceLandmarker.gpuFallback`
- `handLandmarker.loadFailure`
- `faceLandmarker.noFaceFrame.camera`
- `runtime.error`
- `runtime.unhandledrejection`
- `incisionOverlay.registration.pass`
- `incisionOverlay.registration.fail`
- `incisionOverlay.stability.pass`
- `incisionOverlay.stability.fail`

浏览器端会自动捕获 `window.error` 与 `unhandledrejection`，写入上述计数器和
`runtime.error` / `runtime.unhandledrejection` 事件。事件 detail 只记录 message、
文件名、行列号或 Error 摘要，不记录 canvas 像素、视频帧或人脸纹理。

## 指标样本

指标以 `metrics[name]` 保存聚合值与最近样本：

```json
{
  "frame.fps": {
    "count": 10,
    "latest": 29.7,
    "min": 24.1,
    "max": 31.2,
    "mean": 28.9,
    "samples": []
  }
}
```

当前浏览器端记录：

- `frame.fps`
- `frame.durationMs`
- `scan.durationMs`
- `incisionOverlay.registration.mappedPointCount`
- `incisionOverlay.registration.outOfFrameCount`
- `incisionOverlay.registration.bboxDiagonalPx`
- `incisionOverlay.stability.rmsPx`
- `incisionOverlay.stability.p95Px`
- `incisionOverlay.stability.maxPx`

切口 overlay registration / stability 指标只来自运行期 landmarks、三角面索引和
surface refs；导出只保留计数、阈值、RMS/P95/max、bbox 和失败原因，不包含照片、
视频帧、canvas 像素或 landmark 坐标。它用于 preview/回归时判断
`incision-overlay/v0.1` 是否能在当前 runtime landmarks 上投射并稳定跟随，不代表患者
个体化临床 AR 配准。

## 脱敏诊断区

`sections` 用于保存当前页面最小可复现状态摘要。当前实时切口叠加会写入：

- `incision_overlay_runtime.schema_version = "incision-overlay-runtime-diagnostics/v0.1"`
- `raw_image_sent=false`、`exported_raw_pixels=false`、`exported_landmarks=false`
- 当前 overlay 的候选类型、肿物类型、审阅状态、guardrail 摘要和 `live_overlay_ready`
- 最近一帧 `incision-overlay-registration/v0.1` 的脱敏结果
- 最近 8 帧滚动窗口 `incision-overlay-stability/v0.1` 的脱敏结果

该 section 只用于 PR preview、多人审阅和回归复现。候选切换或 overlay 被清除时，运行期
section 会同步重置，避免导出旧候选的 QA 结果。

3D Beta 查看器还会在存在候选 overlay 且重建头可用时写入：

- `incision_overlay_3d_view.schema_version = "incision-overlay-3d-view-diagnostics/v0.1"`
- `raw_image_sent=false`、`exported_raw_pixels=false`
- `mapping_mode`：`mediapipe_468_surface_refs` 或 `mediapipe_468_refs_to_flame_demo_nearest_surface`
- 当前 overlay 的候选类型、肿物类型、审阅状态和 `live_overlay_ready`
- viewer render summary：是否渲染、候选线点数、肿物边界点数、肿物中心是否渲染

FLAME 示例头上的切口 overlay 只是把 MediaPipe surface refs 映射到示例 FLAME 头的工程预览，
不是患者个体化临床 AR 配准。

## 资产版本

`assetVersions` 至少记录：

- `topology`
- `triangles`
- `rstlAtlasVersion`
- `langerAtlasVersion`
- `faceLandmarker`
- `handLandmarker`

这些字段用于把一次评审或 bug 报告回指到具体图谱、拓扑和模型版本。

## Python 端（业务路径结构化日志）

Python 端复用与 web 同一套字段命名（单一真源），通过标准 `logging` 的
`extra={...}` 把结构化字段挂到日志记录上。库代码只 `get_logger`，由应用入口
（`apps/*`）调用一次 `configure_logging()` 决定 handler 与级别——库不打印、不配置 handler。

字段约定（`src/langerface/log.py` 集中定义，与上表对齐）：

- `event`：稳定事件名，如 `assets.loaded` / `frame.detect` / `frame.noFace` / `detect.failure`。
- `phase`：阶段名常量 `Phase`（`assets` / `frame` / `detect` / `scan`）。
- `durationMs`：阶段耗时（`time.perf_counter()` 测得）。
- `reason`：可枚举失败原因常量 `DetectFailureReason`（`no_face` / `no_timestamp` /
  `atlas_missing` / `no_atlas_loaded` / `detector_close_error`），不再是自由文本告警。
- `assetVersions`：构造 `LinePipeline` 时一次性记录，含 `langerfaceVersion`（=`langerface.__version__`）、
  `model`、`topologyId` / `topologyVersion`、各线系统图谱 `version`。

业务路径埋点位置：

- `pipeline/line_pipeline.py`：`assets.loaded`（资产版本一次性）、`frame.detect`（检测阶段耗时）、
  `frame.noFace` / `frame.atlasMissing`（可枚举 `reason`）。
- `detection/mediapipe_detector.py`：`detect.infer`（推理阶段耗时）、`detect.noFace` /
  `detect.failure` / `detect.closeError`（可枚举 `reason`）。
- `media/video.py`：`frame.progress`（每 N 帧的逐帧耗时）、`video.finished`（总耗时 + 平均 fps）。

采集方式（多人评审）：把诊断字段落到结构化输出，例如在应用入口装一个 JSON formatter
或 `logging` handler 读取 `record.__dict__` 中上述字段；阶段耗时多为 `DEBUG`，
失败原因为 `WARNING` / `ERROR`，资产版本为 `INFO`。设 `LANGERFACE_LOG_LEVEL=DEBUG`
可采全部阶段耗时。`perf_counter`/`extra` 不含任何像素或患者身份信息。

## 分享前检查

导出诊断 JSON 前需要确认：

- 没有姓名、病例号、联系方式或医院内部编号。
- 没有私有下载 URL、secret、Vercel bypass token。
- 没有真实患者照片、视频帧、3D 纹理或超声图像。
