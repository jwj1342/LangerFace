# 3D 标注线质量与验收清单

本文对应 issue [#84](https://github.com/jwj1342/LangerFace/issues/84)，用于验收网页 3D 线标注的贴面平滑、绘制反馈和导出一致性。

## 已实现的工程边界

- 控制点与渲染线分离：医生点击的是 `controls`，预览和导出使用重建后的 `points`。
- 跨三角面控制点会沿网格表面展开为路径点，减少直线段穿面和折线感。
- 不连通网格或无法贴面路由时会退回直线，并设置 `fallback=true`；当前线状态和已保存线列表都会显示“需复核 / 可能穿面”反馈。
- 标准脸 / FLAME 拓扑导出的图谱保持 `validated:false`，临床置 `validated:true` 仍走 #2。

## 手动验收清单

1. 打开 `/app/annotate`，选择 MediaPipe 标准脸或 FLAME 标准头。
2. 在脸颊、额部、眼周连续点击 4-6 个点，观察当前线预览是否贴面连接，无明显跨脸直线。
3. 点击“完成线”，确认线条颜色从当前线颜色切换为已完成线颜色，控制点标记位置不跳变。
4. 导出 atlas JSON，确认 `validated:false`、`topologyId`、`topologyVersion` 存在，且导出点数与屏幕预览路径点一致。
5. 在自定义/断连网格上跨岛画线时，确认当前线状态或已保存线列表能看到 fallback 风险，不静默伪装成贴面路径。

## 自动测试覆盖

- `tools/test_annotate_model.mjs`：验证跨三角面控制点会展开为表面路径、导出使用同一组 `points`、断连网格 fallback 非静默。
- `tools/test_annotate_ui.mjs`：验证 fallback 风险在当前线状态和已保存线列表中有可见提示。
- `tools/test_slicer_curve.mjs`：验证导入 3D Slicer 曲线时会平滑重采样并限制输出点数，避免异常输入造成过密路径。
- `npm test` 会运行以上测试，并同时检查标注预览图谱跨页注入的拓扑守卫。

## 仍需人工确认

- “平滑程度是否符合医生手绘习惯”属于交互体验，需要医生在实际标注会话中确认。
- FLAME 5023 顶点规模下的 `snapToSurface` 空间索引优化仍属于 #61 后续性能项，不改变当前导出正确性。
