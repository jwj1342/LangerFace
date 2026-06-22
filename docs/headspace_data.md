# HeadSpace / FaceScape 数据（不入库）

本管线依赖的 3D 头模数据集**受许可限制、且含真人生物特征**，因此**不随本仓库分发**，
也不应提交到公开仓库。请各自获取并放在本地（仓库已在 `.gitignore` 忽略数据目录）。

## 获取

- **HeadSpace**（多视角 PNG + `.tka` 标定 + textured OBJ）：向数据集发布方申请许可后下载。
- **FaceScape**（模板头模 / landmarks）：同样需申请许可。

## 期望的本地目录（示例，可经 CLI 参数覆盖）

```
tools/headspace/data/            # 本地，被 .gitignore 忽略
├─ headspacePngTka/              # 多视角采集：subjects/<sid>/<capture>/*.png + calib_*.tka
├─ headspaceOnline/             # textured OBJ：subjects/<sid>/<capture>.obj(.mtl/.bmp)
└─ out/                          # 检测/融合/配准/渲染的产物
```

脚本通过 `--png_tka_root / --online_root / --out_root / --target_mesh / ...` 指定路径，
无内置绝对路径默认值。

## 模型权重

`assets/face_landmarker.task`（仓库已含）即 MediaPipe Face Landmarker，脚本默认用它；
无需另置外部副本。

## 网页标注用的头模

把某个头模导出为 `{vertices:[[x,y,z]...], triangles:[[a,b,c]...]}` JSON，即可在
[网页 3D 标注](annotation_web.md)（`/annotate.html`）里「上传头模 JSON」加载标注。
导出的标注线（xyz / 图谱）只含坐标，可入库评审。
