# NOTICE · wrinkle-yolov8s-seg-640 权重来源与再分发状态

本目录下的 4 个 `wrinkle-yolov8s-seg-640.onnx.part0*` 分片是从第三方权重继续微调后导出的**派生产物**。
合并前请先读完本文件与同目录的 [MODEL_CARD.md](MODEL_CARD.md)。

## 来源链条

| 项 | 值 |
|---|---|
| 上游基础权重 | `Wrinkle-Detection-StreamLit/best.pt`（23,846,637 bytes） |
| 上游声明的许可证 | **无**（截至 2026-07-28，上游仓库未附带 LICENSE 文件） |
| 本次微调权重 | `best_new_分辨率改成mask2_clean版本.pt`（23,941,044 bytes） |
| 微调权重 SHA-256 | `15542156d7cd4f720279ba4317ab924231cb0d76621d0529a341b6fec7b80dd3` |
| 导出工具 | ultralytics 8.4.138（PyTorch → ONNX，opset 12） |
| 导出产物 | `wrinkle-yolov8s-seg-640.onnx`，47,346,620 bytes |
| SHA-256 | `63E257B4789E11AA1416192D2DB026423ED624581282B95D179FD17CCABF7ABF` |
| 分片方式 | 按字节切成 4 份，运行时顺序拼接后校验总字节数与 SHA-256 |

## 许可状态：未确认（**明确记录，不做推定**）

- 上游基础权重**没有声明许可证**；继续微调和格式转换不会自动消除这一许可缺口。
- "无 LICENSE" 不等于公共领域：在多数司法辖区，未声明许可的作品默认保留全部权利。
- 导出工具 ultralytics 8.4.138 本身是 **AGPL-3.0**；它只用于一次性离线导出，未随本仓库分发，
  但如果上游权重本身是用 ultralytics 训练的，其权重的许可继承关系同样**未经确认**。

因此当前状态是：**权重在仓库内，许可未确认**。这是一个已知的、被记录的合规缺口，不是已解决项。

## 使用边界

- 仅用于**研究性**皱纹分割证据：产出低置信度 secondary cue，喂给 V6 RSTL 微调。
- **不**作为临床判断依据，**不**参与切口几何硬约束，**不**进入任何 LLM prompt。
- 推理全程在浏览器 WASM 内本地完成，不上传人脸图像，见 [`docs/tracks/PERSONALIZED_RSTL.md`](../../../../docs/tracks/PERSONALIZED_RSTL.md)。

## 未关闭的后续动作

1. 联系上游作者取得明确的再分发许可，或换用许可清晰的等价权重。
2. 在取得许可前，**不要**把这份权重用于任何对外发布、商用或临床用途。
3. 若最终确认不可再分发：按 `assets/flame/` 与 `assets/rstl_3dmm_prior_manifest.json` 的既有做法
   改为 gitignored + manifest 按需下载。注意此时**仅删除文件不足以清除 git 历史**——权重自
   PR #106 合并起即留存在历史中，需要专门的历史重写流程。
