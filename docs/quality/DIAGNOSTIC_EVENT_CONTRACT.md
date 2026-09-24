# 诊断事件扩展契约

本文档是后续接入诊断日志的入口。底层记录器位于
`web/src/services/controlledMarkerRunDiagnostics.ts`，电脑端和手机端共用同一实例。

## 选择哪个入口

- 受控标记一次检测：继续使用 `begin(...).finish(...)`，因为它需要原图像素、算法输入和复放绑定。
- 受控标记/自由轮廓控制器门禁：继续使用 `observeController(...)`。
- 切口候选生成、候选编辑、来源状态：继续使用 `observeWorkflow(...)`，因为它有候选前后几何快照。
- 其他动作（上传、皱纹识别、皱纹检测、RSTL 微调、摄像头切换、导出阶段、模型加载、服务调用等）：使用 `recordAction(...)`，写入独立的 `action_events`，不要伪装成 detector run。

## 通用事件示例

```ts
diagnostics.recordAction({
  domain: "wrinkle",
  action: "detection",
  stage: "started",
  reason: "wrinkle_detection_started",
  request_id: requestId,
  details: { input_kind: "photo", source_revision: revision },
});
```

推荐的 `domain`：`source`、`controlled_marker`、`freehand`、`wrinkle`、`rstl`、`camera`、`export`、`model`、`custom`。这些只是约定，不是封闭枚举；新领域使用小写 ASCII token 即可，不需要修改底层联合类型。

推荐的 `stage`：`started`、`completed`、`failed`、`cancelled`、`discarded`、`blocked`、`preview`、`committed`。`reason` 必须是稳定的机器码，不写姓名、文件名、路径、手机号、自由文本或医学结论。

`details` 只放脱敏、可序列化、能帮助定位的结构化数据，例如计数、布尔值、枚举、尺寸、错误码、版本和来源 revision；不要放原始图片、Blob、URL、路径、令牌、患者信息或完整异常堆栈。

## 事件关联与容量

记录器自动补齐 `event_seq`、`action_id`、`source_id`、`page_instance_id` 和时间戳。事件会进入 IndexedDB、本地会话导出和诊断包，并接受同一套隐私审计。当前 `action_events` 上限为 8192 条；超过后保留最新事件，并在导出中增加 `dropped_action_events`。其他事件流的上限见源码 `DIAGNOSTIC_LIMITS`。

采集失败必须不阻断产品流程；调用方可以检查返回值是否为 `null`，但不能因为日志失败改变算法、门禁或用户操作结果。

## 受控标记一次尝试的关联

一次受控标记点击可以同时产生检测器运行、控制器状态和界面失败预览。调用方应在开始识别时创建一个受控标记动作编号，并把同一个 `action_id` 传给 `begin(...)` 和 `observeController(...)`。检测器完成后，控制器终态事件应补充对应的 `diagnostic_run_id`。

`raw_result` 仍是检测器边界、失败码、拒绝边界和拒绝原因的唯一来源；控制器事件只记录拒绝边界点数和原因摘要，不能把拒绝预览当成正式边界。未能取得客户端源码或截图绑定时继续写 `UNKNOWN`，不得用动作编号伪造人工截图已核验。

关联链最低应能回答：哪一次动作、哪一个输入、哪一次检测运行、最终是成功/失败/未映射，以及失败预览是否出现。平滑前原始边界若没有由检测器提供，记录器不得自行推断；需要该证据时另行申请仅取证插桩。

## 接入验收

新增一个领域时至少补充：

1. 一个成功、失败和取消（如适用）的 `recordAction` 调用；
2. 同一 `source_id`、请求号或 revision 能与产品动作关联；
3. 本地定向测试覆盖导出、导入、隐私审计和容量淘汰；
4. 明确哪些动作仍未接入，不能以“日志文件存在”代替覆盖证明。

不要为接入诊断而修改算法、RSTL 生成逻辑、手机布局或公共安全门禁。若需要修改这些范围，先按项目门禁单独取得授权。
