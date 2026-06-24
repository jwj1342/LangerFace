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
  "events": []
}
```

该快照只允许包含结构化事件、计数器、阶段耗时、fps、失败原因和资产版本；不得包含 canvas 像素、视频帧、人脸纹理、病例号或其他身份信息。

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

## 资产版本

`assetVersions` 至少记录：

- `topology`
- `triangles`
- `rstlAtlasVersion`
- `langerAtlasVersion`
- `faceLandmarker`
- `handLandmarker`

这些字段用于把一次评审或 bug 报告回指到具体图谱、拓扑和模型版本。

## 分享前检查

导出诊断 JSON 前需要确认：

- 没有姓名、病例号、联系方式或医院内部编号。
- 没有私有下载 URL、secret、Vercel bypass token。
- 没有真实患者照片、视频帧、3D 纹理或超声图像。
